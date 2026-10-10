"use strict";

const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { logger } = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const {
  clientIdsFromLessonNoteChange, clientIdsFromPassChange, rebuildMemberViews,
} = require("./member-view-triggers");
const { createAccountDeletionService } = require("./account-deletion");
const { createAIGatewayHandler } = require("./ai-gateway");
const { createAIRecordingOperations } = require("./ai-recording-operations");
const { applyCors, parseAllowedOrigins } = require("./cors");
const { sendError, GatewayError } = require("./errors");
const { createFirestoreIdempotencyStore } = require("./idempotency");
const { createMemberLinkService, isActiveOwner, isOwnerLevel, membershipId } = require("./member-link");
const { confirmInstructorNames, planInstructorNames } = require("./instructor-names");
const {
  clientIdsFromPassChange: clientIdsFromPassChangeForScope,
  rebuildInstructorIds,
  syncInstructorIds,
  verifyInstructorIds,
} = require("./instructor-scope-triggers");
const { planMigrationReset, runMigrationReset } = require("./migration-reset");
const {
  findServiceDeductions, planServiceSessionFix, runServiceSessionFix,
} = require("./service-session-fix");
const { isPassAdmin, runHandover, runSessionUp } = require("./pass-admin");
const { readRuntimeConfig, writeRuntimeConfig } = require("./runtime-config-admin");
const { monthlyPayFor, planAccountSwap, runAccountSwap } = require("./instructor-swap");
const { reconcileOrganization } = require("./pass-reconcile-nightly");
const { createFirestoreMemberLinkPorts } = require("./member-link-store");
const {
  createFirestoreMemberViewAdminPorts, createMemberViewAdminService,
} = require("./member-view-admin");
const { createMemberLookupService } = require("./member-lookup");
const { createClientPhoneService } = require("./client-phone-service");
const { createFirestoreClientPhonePorts } = require("./client-phone-store");
const { DEFAULT_MODEL, createOpenAIProvider } = require("./openai-provider");
const { createFirestorePolicyService } = require("./policy");
const { createPhotoBackupCleanupService } = require("./photo-backup-cleanup");

if (!getApps().length) initializeApp();

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const AI_EXECUTE_ROUTE = "/v1/ai/execute";
const allowedOrigins = parseAllowedOrigins(process.env.AI_ALLOWED_ORIGINS);
const firestore = getFirestore();
const policyService = createFirestorePolicyService({
  firestore,
  mode: process.env.AI_POLICY_MODE,
  consentPolicyVersion: "2026-08-23",
  minuteLimit: process.env.AI_RATE_LIMIT_PER_MINUTE || 8,
  dailyLimit: process.env.AI_RATE_LIMIT_PER_DAY || 80,
});
const idempotencyStore = createFirestoreIdempotencyStore({ firestore });
const aiRecordingOperations = createAIRecordingOperations({ firestore, logger });
const photoBackupCleanupService = createPhotoBackupCleanupService({ firestore, bucket: getStorage().bucket() });
let openAIProvider;

const accountDeletionService = createAccountDeletionService({
  async listMembershipsByUserId(uid) {
    const snapshot = await getFirestore().collection("memberships").where("userId", "==", uid).get();
    return snapshot.docs.map((membership) => ({ id: membership.id, data: membership.data() }));
  },
  async listActiveOwnersByOrganizationId(organizationId) {
    const snapshot = await getFirestore().collection("memberships").where("organizationId", "==", organizationId).get();
    return snapshot.docs.map((membership) => ({ id: membership.id, data: membership.data() }));
  },
  async listOrganizationsOwnedByUserId(uid) {
    const snapshot = await getFirestore().collection("organizations").where("ownerId", "==", uid).get();
    return snapshot.docs.map((organization) => ({ id: organization.id }));
  },
  deleteStoragePrefix(prefix) {
    return getStorage().bucket().deleteFiles({ prefix, force: true });
  },
  deleteUserTree(path) {
    const db = getFirestore();
    return db.recursiveDelete(db.doc(path));
  },
  deleteLegacyOrganization(path) {
    const db = getFirestore();
    return db.recursiveDelete(db.doc(path));
  },
  deleteMembership(path) {
    return getFirestore().doc(path).delete();
  },
  deleteAuthUser(uid) {
    return getAuth().deleteUser(uid);
  },
});

const memberLookupService = createMemberLookupService({
  findUserByEmail: (email) => getAuth().getUserByEmail(email),
  async readMembership(membershipDocumentId) {
    const snapshot = await getFirestore().collection("memberships").doc(membershipDocumentId).get();
    return snapshot.exists ? snapshot.data() : null;
  },
});

const memberLinkService = createMemberLinkService(
  createFirestoreMemberLinkPorts({ firestore, FieldValue }),
);

/* 연락처 변경. 번호는 회원의 정체라 서버만 바꾼다 -- 규칙은 클라이언트가
   phone 을 직접 쓰지 못하게 잠그고, 여기가 유일한 문이다. */
const clientPhoneService = createClientPhoneService({
  ...createFirestoreClientPhonePorts({ firestore, FieldValue }),
  async readMembership(membershipDocumentId) {
    const snapshot = await firestore.collection("memberships").doc(membershipDocumentId).get();
    return snapshot.exists ? snapshot.data() : null;
  },
});

/* 투영 점검·재작성. loadBuildJourney 는 아래에 선언돼 있지만 함수 선언이라
   끌어올려지고, 실제로 불리는 것은 요청이 왔을 때다. */
const memberViewAdminService = createMemberViewAdminService(
  createFirestoreMemberViewAdminPorts({ firestore, loadBuildJourney }),
);

const handler = createAIGatewayHandler({
  verifyIdToken: (token) => getAuth().verifyIdToken(token, true),
  policyService,
  idempotencyStore,
  aiRecordingOperations,
  getProvider: async () => {
    if (!openAIProvider) {
      openAIProvider = createOpenAIProvider({
        apiKey: OPENAI_API_KEY.value(),
        model: process.env.AI_MODEL || DEFAULT_MODEL,
      });
    }
    return openAIProvider;
  },
});

function requestPath(req) {
  const raw = String(req.path || req.url || "").split("?")[0];
  return raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

exports.aiGateway = onRequest({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 60,
  memory: "256MiB",
  secrets: [OPENAI_API_KEY],
  cors: false,
  invoker: "public",
}, async (req, res) => {
  try {
    if (applyCors(req, res, allowedOrigins)) return;
    if (requestPath(req) !== AI_EXECUTE_ROUTE) throw new GatewayError("invalid_request", { status: 404 });
    await handler(req, res);
  } catch (error) {
    sendError(res, error);
  }
});

function accountDeletionHttpsError(error) {
  const details = {
    code: String(error?.code || "account_deletion_failed"),
    stage: String(error?.stage || "unknown"),
    completedStages: Array.isArray(error?.completedStages) ? error.completedStages : [],
    retryable: error?.retryable === true,
  };
  if (details.code === "unauthenticated" || details.code === "reauthentication_required") {
    return new HttpsError("unauthenticated", "Please sign in again before deleting the account.", details);
  }
  if (details.code === "sole_organization_owner") {
    return new HttpsError("failed-precondition", "Assign another organization owner before deleting this account.", details);
  }
  if (["invalid_request", "confirmation_required", "client_authority_rejected", "invalid_membership_scope"].includes(details.code)) {
    return new HttpsError("invalid-argument", "The account deletion request is invalid.", details);
  }
  if (details.retryable) return new HttpsError("unavailable", "Account deletion did not finish. Please retry.", details);
  return new HttpsError("internal", "Account deletion did not finish.", details);
}

exports.deleteCurrentUserAccount = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 540,
  memory: "256MiB",
  invoker: "public",
}, async (request) => {
  try {
    return await accountDeletionService.deleteCurrentUserAccount(request);
  } catch (error) {
    logger.error("account_deletion_failed", {
      code: String(error?.code || "unknown"),
      stage: String(error?.stage || "unknown"),
      retryable: error?.retryable === true,
    });
    throw accountDeletionHttpsError(error);
  }
});

exports.purgeExpiredPhotoBackups = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 120,
  memory: "256MiB",
  invoker: "public",
}, async (request) => {
  const uid = String(request?.auth?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "Authentication is required.");
  try {
    return await photoBackupCleanupService.purgeForUser(uid);
  } catch (error) {
    logger.error("photo_backup_cleanup_failed", { code: String(error?.code || "unknown") });
    throw new HttpsError("internal", "Photo backup cleanup failed.");
  }
});

/**
 * 조회 실패를 종류별로 가른다. 대표에게는 "오타인가, 아직 가입을 안 했나,
 * 내가 이 센터의 대표가 아닌가"가 서로 다른 할 일이다.
 */
function memberLookupHttpsError(error) {
  const code = String(error?.code || "lookup_unavailable");
  const details = { code, stage: String(error?.stage || "unknown") };
  if (code === "unauthenticated") return new HttpsError("unauthenticated", "Please sign in again.", details);
  if (code === "not_owner") return new HttpsError("permission-denied", "Only the centre owner may look up a member.", details);
  if (code === "user_not_found") return new HttpsError("not-found", "No account uses that e-mail yet.", details);
  if (code === "invalid_email" || code === "invalid_request") {
    return new HttpsError("invalid-argument", "The lookup request is invalid.", details);
  }
  return new HttpsError("unavailable", "The lookup did not finish. Please retry.", details);
}

exports.lookupCentreMemberByEmail = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 30,
  memory: "256MiB",
  invoker: "public",
}, async (request) => {
  try {
    const result = await memberLookupService.lookupByEmail(request);
    /* 조회 자체를 남긴다. 이메일도 uid 도 적지 않는다 (§7) -- 어느 센터에서
       몇 번 조회했는지만으로 이 통로가 캐는 데 쓰이는지 알 수 있다. */
    logger.info("member_lookup_succeeded", {
      organizationId: String(request?.data?.organizationId || ""),
      alreadyMember: result.membership !== null,
    });
    return result;
  } catch (error) {
    logger.warn("member_lookup_failed", {
      organizationId: String(request?.data?.organizationId || ""),
      code: String(error?.code || "unknown"),
      stage: String(error?.stage || "unknown"),
    });
    throw memberLookupHttpsError(error);
  }
});

/* ── 계정 ↔ 회원 연결 ─────────────────────────────────────────────────────
   설계 10장 6번. 근거는 member-link.js 머리말에 있다. */

function memberLinkHttpsError(error) {
  const code = String(error?.code || "link_unavailable");
  const details = { code, stage: String(error?.stage || "unknown") };
  if (code === "unauthenticated") return new HttpsError("unauthenticated", "Please sign in again.", details);
  if (code === "phone_not_verified") {
    return new HttpsError("failed-precondition", "Verify your phone number first.", details);
  }
  if (code === "not_owner") return new HttpsError("permission-denied", "Only the centre owner may link a member.", details);
  if (code === "client_not_found") return new HttpsError("not-found", "That member is not on the roster.", details);
  if (code === "already_linked") return new HttpsError("already-exists", "That member is linked to another account.", details);
  if (code === "invalid_request") return new HttpsError("invalid-argument", "The link request is invalid.", details);
  return new HttpsError("unavailable", "The link did not finish. Please retry.", details);
}

const MEMBER_LINK_OPTIONS = {
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 60,
  memory: "256MiB",
  invoker: "public",
};

/** 연결 통로 하나를 감싼다. 로그에 uid·번호는 적지 않는다 (§7). */
function memberLinkCallable(stage, run) {
  return async (request) => {
    try {
      const result = await run(request);
      logger.info("member_link_succeeded", {
        feature: "member_link", stage,
        organizationId: String(request?.data?.organizationId || ""),
        status: String(result?.status || ""),
      });
      return result;
    } catch (error) {
      logger.warn("member_link_failed", {
        feature: "member_link", stage,
        organizationId: String(request?.data?.organizationId || ""),
        errorDomain: "member_link",
        errorCode: String(error?.code || "unknown"),
        failedStage: String(error?.stage || "unknown"),
      });
      throw memberLinkHttpsError(error);
    }
  };
}

exports.linkMemberAccount = onCall(
  MEMBER_LINK_OPTIONS,
  memberLinkCallable("self", (request) => memberLinkService.linkForCaller(request)),
);

exports.linkMemberAccountByOwner = onCall(
  MEMBER_LINK_OPTIONS,
  memberLinkCallable("owner", (request) => memberLinkService.linkByOwner(request)),
);

exports.unlinkMemberAccount = onCall(
  MEMBER_LINK_OPTIONS,
  memberLinkCallable("unlink", (request) => memberLinkService.unlink(request)),
);

exports.listPendingMemberLinks = onCall(
  MEMBER_LINK_OPTIONS,
  memberLinkCallable("pending", (request) => memberLinkService.listPending(request)),
);

/* ── 투영 점검 · 재작성 ───────────────────────────────────────────────────
   설계 11장. 대표만 부른다. 근거는 member-view-admin.js 머리말에 있다. */

function memberViewAdminHttpsError(error) {
  const code = String(error?.code || "admin_unavailable");
  const details = { code, stage: String(error?.stage || "unknown") };
  if (code === "unauthenticated") return new HttpsError("unauthenticated", "Please sign in again.", details);
  if (code === "not_owner") return new HttpsError("permission-denied", "Only the centre owner may run this.", details);
  if (code === "invalid_request") return new HttpsError("invalid-argument", "A location or a member is required.", details);
  return new HttpsError("unavailable", "The check did not finish. Please retry.", details);
}

const MEMBER_VIEW_ADMIN_OPTIONS = {
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  /* 회원을 200명까지 훑는다. 함수 안의 시간 예산(45초)이 먼저 걸려 커서를
     돌려주므로, 이 값은 그 위의 여유다. */
  timeoutSeconds: 120,
  memory: "512MiB",
  invoker: "public",
};

function memberViewAdminCallable(stage, run) {
  return async (request) => {
    try {
      const result = await run(request);
      logger.info("member_view_admin_finished", {
        feature: "member_view", stage,
        organizationId: String(request?.data?.organizationId || ""),
        checked: Number(result?.checked) || 0,
        ok: result?.ok === true,
        dryRun: result?.dryRun,
      });
      return result;
    } catch (error) {
      logger.warn("member_view_admin_failed", {
        feature: "member_view", stage,
        organizationId: String(request?.data?.organizationId || ""),
        errorDomain: "member_view_admin",
        errorCode: String(error?.code || "unknown"),
        failedStage: String(error?.stage || "unknown"),
      });
      throw memberViewAdminHttpsError(error);
    }
  };
}

exports.verifyMemberViews = onCall(
  MEMBER_VIEW_ADMIN_OPTIONS,
  memberViewAdminCallable("verify", (request) => memberViewAdminService.verify(request)),
);

exports.rebuildMemberViews = onCall(
  MEMBER_VIEW_ADMIN_OPTIONS,
  memberViewAdminCallable("rebuild", (request) => memberViewAdminService.rebuild(request)),
);

exports.cleanupExpiredPhotoBackups = onSchedule({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  schedule: "every day 03:00",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 300,
  memory: "256MiB",
}, async () => {
  const result = await photoBackupCleanupService.purgeExpiredGlobal();
  logger.info("photo_backup_cleanup_completed", { purged: result.purged, remaining: result.remaining });
});

/* ── 연락처 변경 ──────────────────────────────────────────────────────────
   번호는 회원의 정체다. 회원 앱이 인증된 번호로 명부를 찾고, 엑셀 이관이
   번호로 문서 id 를 만든다 -- 그래서 바꾸는 일은 중복 검사와 이전 번호 기록,
   그리고 연결 해제가 함께 일어나야 한다. 규칙으로는 못 하므로 callable 이고,
   규칙은 클라이언트가 phone 을 직접 쓰지 못하게 잠근다. */

function clientPhoneHttpsError(error) {
  const code = String(error?.code || "phone_unavailable");
  const details = { code };
  /* 중복일 때 누구의 번호인지는 **대표·FC매니저에게만** 실린다. 판정이 이미
     걸러서 올려 보내므로 여기서는 있는 것만 전달한다 (client-phone.js 의
     duplicateAnswer). */
  if (error?.clientName) details.clientName = error.clientName;
  if (Number.isInteger(error?.limit)) details.limit = error.limit;

  if (code === "unauthenticated") return new HttpsError("unauthenticated", "Please sign in again.", details);
  if (["phone_not_allowed", "phone_not_my_client", "not_owner"].includes(code)) {
    return new HttpsError("permission-denied", "This account may not change that number.", details);
  }
  if (code === "phone_daily_limit") {
    return new HttpsError("resource-exhausted", "The daily limit was reached.", details);
  }
  if (["phone_invalid", "phone_same", "phone_duplicate", "phone_no_client", "phone_invalid_request"].includes(code)) {
    return new HttpsError("invalid-argument", "The number was refused.", details);
  }
  return new HttpsError("unavailable", "The change did not finish. Please retry.", details);
}

const CLIENT_PHONE_OPTIONS = {
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 60,
  memory: "256MiB",
  invoker: "public",
};

function clientPhoneCallable(stage, run) {
  return async (request) => {
    try {
      const result = await run(request);
      logger.info("client_phone_finished", { feature: "client_phone", stage });
      return result;
    } catch (error) {
      /* 원본 코드를 그대로 남긴다. 번호도 이름도 남기지 않는다 -- 진단에
         개인정보를 적지 않는 것이 이 저장소의 규칙이다. */
      logger.error("client_phone_failed", {
        feature: "client_phone", stage,
        errorDomain: "firestore",
        errorCode: String(error?.code || "unknown"),
        message: String(error?.cause?.message || error?.message || "").slice(0, 200),
      });
      throw clientPhoneHttpsError(error);
    }
  };
}

exports.updateClientPhone = onCall(
  CLIENT_PHONE_OPTIONS,
  clientPhoneCallable("update", (request) => clientPhoneService.update(request)),
);

/* 번호 철자가 깨진 회원 목록. 읽기만 한다 -- 한꺼번에 정규화하면 아예 틀린
   번호가 "정상" 이 되어 더 찾기 어려워진다 (client-phone-store.js). */
exports.listMalformedClientPhones = onCall(
  CLIENT_PHONE_OPTIONS,
  clientPhoneCallable("list_malformed", (request) => clientPhoneService.listMalformed(request)),
);

/* ── 회원용 투영 트리거 ────────────────────────────────────────────────────
   설계 10장 5번. 자세한 근거는 member-view-triggers.js 머리말에 있다.

   passes 와 clients 둘만 단다. 원장에 쓰는 다섯 함수가 전부 같은 배치에서
   passes 문서도 쓰므로, passes 트리거 하나가 원장 변화까지 잡는다.

   retry 는 끄고 간다. 망가진 문서 하나가 무한히 재시도되면 비용만 쌓이고,
   놓친 투영은 다음 쓰기나 백필이 채운다. */

/* 여정 계산은 functions/shared 에 ESM 으로 있다. 이 파일은 CommonJS 라
   require 할 수 없어 동적 import 로 읽는다 -- Node 가 모듈을 캐시하므로
   인스턴스당 한 번이다. 복사본을 두지 않는 이유는 그 사본이 언젠가 원본과
   어긋나기 때문이다. */
let journeyModule = null;
async function loadBuildJourney() {
  if (!journeyModule) journeyModule = await import("../shared/pass-journey.mjs");
  return journeyModule.buildPassJourney;
}

const MEMBER_VIEW_TRIGGER_OPTIONS = {
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  memory: "256MiB",
  timeoutSeconds: 120,
  retry: false,
};

exports.rebuildMemberViewOnPassWrite = onDocumentWritten({
  ...MEMBER_VIEW_TRIGGER_OPTIONS,
  document: "organizations/{organizationId}/passes/{passId}",
}, async (event) => {
  const clientIds = clientIdsFromPassChange(
    event.data?.before?.data() || null,
    event.data?.after?.data() || null,
  );
  if (!clientIds.length) return;
  const results = await rebuildMemberViews(firestore, {
    organizationId: event.params.organizationId,
    clientIds,
    eventAt: new Date(event.time),
    buildJourney: await loadBuildJourney(),
    log: logger,
  });
  logger.info("member_view_rebuilt", {
    feature: "member_view", stage: "pass_write",
    organizationId: event.params.organizationId,
    // 회원 id 는 남기지 않는다. 몇 건이 어떻게 끝났는지만 센다.
    counts: results.reduce((tally, item) => ({ ...tally, [item.outcome]: (tally[item.outcome] || 0) + 1 }), {}),
  });
});

exports.rebuildMemberViewOnClientWrite = onDocumentWritten({
  ...MEMBER_VIEW_TRIGGER_OPTIONS,
  document: "organizations/{organizationId}/clients/{clientId}",
}, async (event) => {
  const results = await rebuildMemberViews(firestore, {
    organizationId: event.params.organizationId,
    clientIds: [event.params.clientId],
    eventAt: new Date(event.time),
    buildJourney: await loadBuildJourney(),
    log: logger,
  });
  logger.info("member_view_rebuilt", {
    feature: "member_view", stage: "client_write",
    organizationId: event.params.organizationId,
    counts: results.reduce((tally, item) => ({ ...tally, [item.outcome]: (tally[item.outcome] || 0) + 1 }), {}),
  });
});

/* 강사가 회원에게 보낼 말을 적었을 때. 이 쓰기는 회원권도 회원 문서도
   건드리지 않으므로 위의 두 트리거로는 잡히지 않는다. */
exports.rebuildMemberViewOnLessonNoteWrite = onDocumentWritten({
  ...MEMBER_VIEW_TRIGGER_OPTIONS,
  document: "organizations/{organizationId}/lessonNotes/{noteId}",
}, async (event) => {
  const clientIds = clientIdsFromLessonNoteChange(
    event.data?.before?.data() || null,
    event.data?.after?.data() || null,
  );
  if (!clientIds.length) return;
  const results = await rebuildMemberViews(firestore, {
    organizationId: event.params.organizationId,
    clientIds,
    eventAt: new Date(event.time),
    buildJourney: await loadBuildJourney(),
    log: logger,
  });
  logger.info("member_view_rebuilt", {
    feature: "member_view", stage: "lesson_note_write",
    organizationId: event.params.organizationId,
    counts: results.reduce((tally, item) => ({ ...tally, [item.outcome]: (tally[item.outcome] || 0) + 1 }), {}),
  });
});

exports._test = {
  AI_EXECUTE_ROUTE,
  accountDeletionHttpsError,
  memberLinkHttpsError,
  memberLookupHttpsError,
  clientPhoneHttpsError,
  memberViewAdminHttpsError,
  requestPath,
};

/* ── 강사가 보는 회원의 범위 ──────────────────────────────────────────────
   clients.instructorIds 를 채운다. 근거는 instructor-scope-triggers.js 머리말과
   docs/instructor-scope-plan.md 에 있다.

   passes 하나만 단다. 발급·차감·인수인계·양도·종료·취소가 전부 같은 배치에서
   passes 문서를 쓰므로 이 트리거 하나가 모두를 잡는다.

   retry 는 끄고 간다. 놓친 회원은 rebuildInstructorIds 가 채운다 -- 무한히
   재시도되는 망가진 문서 하나보다 다시 돌릴 수 있는 문 하나가 낫다. */
const INSTRUCTOR_SCOPE_TRIGGER_OPTIONS = {
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  memory: "256MiB",
  timeoutSeconds: 120,
  retry: false,
};

exports.syncInstructorIdsOnPassWrite = onDocumentWritten({
  ...INSTRUCTOR_SCOPE_TRIGGER_OPTIONS,
  document: "organizations/{organizationId}/passes/{passId}",
}, async (event) => {
  const clientIds = clientIdsFromPassChangeForScope(
    event.data?.before?.data() || null,
    event.data?.after?.data() || null,
  );
  if (!clientIds.length) return;
  const results = await syncInstructorIds(firestore, {
    organizationId: event.params.organizationId,
    clientIds,
    now: new Date(event.time),
    log: logger,
  });
  logger.info("instructor_scope_synced", {
    feature: "instructor_scope", stage: "pass_write",
    organizationId: event.params.organizationId,
    // 회원 id 는 남기지 않는다. 몇 건이 어떻게 끝났는지만 센다.
    counts: results.reduce((tally, item) => ({ ...tally, [item.outcome]: (tally[item.outcome] || 0) + 1 }), {}),
  });
});

const INSTRUCTOR_SCOPE_ADMIN_OPTIONS = {
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  memory: "512MiB",
  /* 조직 전체를 훑는다. 회원 120명 규모에서는 몇 초지만, 여유를 둔다 --
     중간에 잘리면 절반만 채워진 채로 끝나고 그것이 제일 나쁜 상태다. */
  timeoutSeconds: 540,
};

/**
 * 대표만 부른다. 채우기와 검증 둘 다 조직 전체를 읽으므로, 소속만으로는
 * 열 수 없다 -- 강사가 부를 수 있으면 센터 전체 회원 수를 세는 문이 된다.
 */
function instructorScopeCallable(stage, run) {
  return async (request) => {
    const callerUid = String(request?.auth?.uid || "").trim();
    const organizationId = String(request?.data?.organizationId || "").trim();
    const dryRun = request?.data?.dryRun === true;
    if (!callerUid) throw new HttpsError("unauthenticated", "Please sign in again.");
    if (!organizationId) throw new HttpsError("invalid-argument", "organizationId is required.");

    const membership = await firestore
      .collection("memberships").doc(membershipId(organizationId, callerUid)).get();
    if (!isOwnerLevel(membership.exists ? membership.data() : null)) {
      throw new HttpsError("permission-denied", "Only an owner or area manager can run this.");
    }

    try {
      const result = await run({ organizationId, dryRun });
      /* 결과를 통째로 뿌리지 않는다. verify 가 담당 없는 회원의 **이름**을
         함께 돌려주는데, 그것은 대표 화면으로 가는 값이지 로그에 남길 값이
         아니다 (CLAUDE.md 진단 7번). 숫자만 센다. */
      logger.info("instructor_scope_admin", {
        feature: "instructor_scope", stage, organizationId,
        ...Object.fromEntries(Object.entries(result || {})
          .filter(([, value]) => typeof value === "number" || typeof value === "boolean")),
      });
      return result;
    } catch (error) {
      logger.error("instructor_scope_admin_failed", {
        feature: "instructor_scope", stage, organizationId,
        errorCode: error?.code || "unknown", message: error?.message || "",
      });
      throw new HttpsError("internal", `instructor_scope_${stage}_failed`);
    }
  };
}

/* 일회용 마이그레이션이 아니다. instructorIds 는 파생값이라 트리거가 한 번
   실패하면 강사가 회원을 잃는다 -- 언제든 다시 돌릴 수 있어야 한다. */
exports.rebuildInstructorIds = onCall(
  INSTRUCTOR_SCOPE_ADMIN_OPTIONS,
  instructorScopeCallable("rebuild", ({ organizationId, dryRun }) => (
    rebuildInstructorIds(firestore, { organizationId, dryRun, log: logger })
  )),
);

/* 고치지 않고 센다. 배포 순서에서 채우기 다음에 이것을 돌려 "운영중인데
   instructorIds 가 빈 회원이 없다" 를 확인한 뒤에야 앱을 내보낸다. */
exports.verifyInstructorIds = onCall(
  INSTRUCTOR_SCOPE_ADMIN_OPTIONS,
  instructorScopeCallable("verify", ({ organizationId }) => (
    verifyInstructorIds(firestore, { organizationId, log: logger })
  )),
);

/* ── 야간 재계산 ──────────────────────────────────────────────────────────
   회원권이 **날짜만 지나 만료되는 순간에는 아무도 쓰지 않는다.** 그래서 A 와 B
   의 회원권을 함께 쓰던 회원이 A 것만 만료되면 다음 쓰기까지 A 가 남는다.

   하루 한 번 다시 센다. 바뀐 것이 없으면 아무것도 쓰지 않으므로(syncOneClient
   의 same 검사) 평소에는 읽기만 하고 끝난다 -- 쓰기가 없으면 memberViews
   트리거도 깨어나지 않는다.

   04:00 KST 다. 수업이 없고, 자정 직후의 만료가 이미 지나간 시각이다. */
/* ── 강사 계정 교체 ──────────────────────────────────────────────────────
   대표 전용. 근거는 instructor-swap.js 머리말에 있다.

   confirm 을 보내지 않으면 미리보기다. 되돌릴 수 없는 쪽이 기본값이면 안
   된다 -- 누적 진행은 더하는 값이라 두 번 돌면 두 배가 되고, 그것은 고칠 수
   없다. 실행도 두 번 눌러 안전하게 만들어 두었지만 기본값은 그대로 읽기다. */
exports.swapInstructorAccount = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 120,
  memory: "512MiB",
  invoker: "public",
}, async (request) => {
  const callerUid = String(request?.auth?.uid || "").trim();
  const organizationId = String(request?.data?.organizationId || "").trim();
  if (!callerUid) throw new HttpsError("unauthenticated", "Please sign in again.");
  if (!organizationId) throw new HttpsError("invalid-argument", "organizationId is required.");

  const membership = await firestore
    .collection("memberships").doc(membershipId(organizationId, callerUid)).get();
  if (!isOwnerLevel(membership.exists ? membership.data() : null)) {
    throw new HttpsError("permission-denied", "Only an owner or area manager can swap an account.");
  }

  const payload = {
    organizationId,
    fromUid: String(request?.data?.fromUid || "").trim(),
    toUid: String(request?.data?.toUid || "").trim(),
    actorId: callerUid,
    /* 소속 문서에서 읽은 역할이다. 부르는 쪽이 보낸 값이 아니다 -- 보냈다면
       "나는 대표입니다" 한 줄로 아래 판정을 지나갈 수 있다. */
    actorRole: String(membership.data()?.role || ""),
  };
  const confirmed = request?.data?.confirm === true;

  try {
    const result = confirmed
      ? await runAccountSwap(firestore, payload)
      : await planAccountSwap(firestore, payload);
    /* 이번 달에 옛 uid 로 박힌 수업료. 옮기지는 않고, 세는 쪽이 합쳐 보여 줄
       금액이 얼마인지만 말한다. */
    const pay = await monthlyPayFor(firestore, {
      organizationId, instructorId: payload.fromUid, month: String(request?.data?.month || ""),
    });
    /* 건수만 남긴다. 이름도 uid 도 로그에 적지 않는다 (§7). */
    logger.info("instructor_swap", {
      feature: "instructor_swap", stage: confirmed ? "apply" : "plan", organizationId,
      passes: result?.counts?.passes || 0, clients: result?.counts?.clients || 0,
      applied: result?.applied === true,
    });
    return { ...result, pay, confirmed };
  } catch (error) {
    logger.error("instructor_swap_failed", {
      feature: "instructor_swap", stage: confirmed ? "apply" : "plan", organizationId,
      errorCode: error?.message || "unknown",
    });
    throw new HttpsError("failed-precondition", String(error?.message || "instructor_swap_failed"));
  }
});

/* ── 운영 설정 쓰기 ──────────────────────────────────────────────────────
   대표 전용. 근거는 runtime-config-admin.js 머리말에 있다.

   규칙은 runtimeConfig 의 쓰기를 닫아 두었다 -- 숫자 하나가 센터 전체의 수업
   확정을 막을 수 있어, 앱에서 실수로 눌러지는 자리를 만들지 않았다. 그 문을
   여는 대신 통로를 하나 낸다. */
exports.updateRuntimeConfig = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 60,
  invoker: "public",
}, async (request) => {
  const callerUid = String(request?.auth?.uid || "").trim();
  const organizationId = String(request?.data?.organizationId || "").trim();
  if (!callerUid) throw new HttpsError("unauthenticated", "Please sign in again.");
  if (!organizationId) throw new HttpsError("invalid-argument", "organizationId is required.");

  const membership = await firestore
    .collection("memberships").doc(membershipId(organizationId, callerUid)).get();
  /* 화면이 카드를 감추는 것은 안내이고 막는 것은 여기다. 이 설정은 조직의
     것이 아니라 앱 전체의 것이라, 어느 센터의 대표든 바꿀 수 있다는 뜻이
     되지 않도록 소속 확인을 지나게 둔다.

     **총괄매니저에게는 열지 않는다** (2026-10-10 결정). 다른 자리는 전부
     대표와 같지만 여기만은 아니다 -- settlement 최소 빌드를 올리면 **센터
     전체의 수업 확정이 막히고**, appUpdate 최소 빌드를 올리면 그 번호보다
     낮은 앱이 전부 필수 팝업에 갇힌다. 숫자 하나가 센터를 세우는 자리라
     이관 초기화와 같은 선에 둔다. */
  if (!isActiveOwner(membership.exists ? membership.data() : null)) {
    throw new HttpsError("permission-denied", "Only the centre owner can change this.");
  }

  /* 쓰지 않고 읽기만 할 수도 있다. 화면이 고치기 전에 지금 값을 보여준다. */
  const document = String(request?.data?.document || "").trim();
  if (!document) return { config: await readRuntimeConfig(firestore) };

  try {
    const result = await writeRuntimeConfig(firestore, {
      document, value: request?.data?.value, actorId: callerUid,
    });
    /* 숫자만 남긴다. 이 값이 센터 전체를 막을 수 있어 누가 언제 무엇으로
       바꿨는지가 남아야 한다 (§7 -- 이름도 번호도 아니다). */
    logger.info("runtime_config_updated", {
      feature: "runtime_config", stage: "write", organizationId, document,
    });
    return { ...result, config: await readRuntimeConfig(firestore) };
  } catch (error) {
    logger.error("runtime_config_write_failed", {
      feature: "runtime_config", stage: "write", organizationId, document,
      errorCode: error?.message || "unknown",
    });
    throw new HttpsError("failed-precondition", String(error?.message || "runtime_config_failed"));
  }
});

/* ── 세션업과 회원 간 양도 ───────────────────────────────────────────────
   대표와 FC매니저가 쓴다. 근거는 pass-admin.js 머리말에 있다.

   규칙은 그대로 둔다 -- 양도는 규칙이 대표에게만 열어 두었고, 세션업이 바꾸는
   totalSessions 는 아예 막혀 있다. 그 문을 여는 대신 통로를 하나 낸다. */
const assertPassAdmin = async (organizationId, callerUid) => {
  if (!callerUid) throw new HttpsError("unauthenticated", "Please sign in again.");
  if (!organizationId) throw new HttpsError("invalid-argument", "organizationId is required.");
  const membership = await firestore
    .collection("memberships").doc(membershipId(organizationId, callerUid)).get();
  /* 화면이 버튼을 감추는 것은 안내이고 막는 것은 여기다. 화면만 믿으면
     호출 한 번으로 지나간다. */
  if (!isPassAdmin(membership.exists ? membership.data() : null)) {
    throw new HttpsError("permission-denied", "Only the owner or manager can do this.");
  }
};

exports.sessionUpPass = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 60,
  invoker: "public",
}, async (request) => {
  const callerUid = String(request?.auth?.uid || "").trim();
  const organizationId = String(request?.data?.organizationId || "").trim();
  await assertPassAdmin(organizationId, callerUid);
  try {
    const expiresAt = request?.data?.expiresAt ? new Date(String(request.data.expiresAt)) : null;
    const result = await runSessionUp(firestore, {
      organizationId,
      passId: String(request?.data?.passId || "").trim(),
      actorId: callerUid,
      addSessions: Number(request?.data?.addSessions),
      addPrice: Number(request?.data?.addPrice),
      addService: Number(request?.data?.addService || 0),
      paymentMethod: String(request?.data?.paymentMethod || ""),
      expiresAt: expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : null,
    });
    /* 이름도 금액 밖의 것도 적지 않는다 (§7). 무엇이 몇 회 늘었는지만. */
    logger.info("session_up_done", {
      feature: "session_up", stage: "done", organizationId,
      addedSessions: Number(request?.data?.addSessions) || 0,
    });
    return result;
  } catch (error) {
    logger.error("session_up_failed", {
      feature: "session_up", stage: "done", organizationId,
      errorCode: error?.message || "unknown",
    });
    /* 막힌 이유를 그대로 올린다 -- 화면이 "왜 안 되는지" 를 말할 수 있어야 한다. */
    throw new HttpsError("failed-precondition", String(error?.message || "session_up_failed"));
  }
});

exports.handoverPass = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 60,
  invoker: "public",
}, async (request) => {
  const callerUid = String(request?.auth?.uid || "").trim();
  const organizationId = String(request?.data?.organizationId || "").trim();
  await assertPassAdmin(organizationId, callerUid);
  try {
    const result = await runHandover(firestore, {
      organizationId,
      passId: String(request?.data?.passId || "").trim(),
      toClientId: String(request?.data?.toClientId || "").trim(),
      sessions: Number(request?.data?.sessions),
      instructorId: String(request?.data?.instructorId || "").trim(),
      unitPrice: Number(request?.data?.unitPrice || 0),
      actorId: callerUid,
    });
    logger.info("handover_done", {
      feature: "handover", stage: "done", organizationId,
      sessions: Number(request?.data?.sessions) || 0,
    });
    return result;
  } catch (error) {
    logger.error("handover_failed", {
      feature: "handover", stage: "done", organizationId,
      errorCode: error?.message || "unknown",
    });
    throw new HttpsError("failed-precondition", String(error?.message || "handover_failed"));
  }
});

/* ── 이관분 서비스 보정 ───────────────────────────────────────────────────
   한 번 쓰고 지울 통로다. 근거는 service-session-fix.js 머리말에 있다.

   규칙은 그대로 둔다 -- passes 의 update 가 totalSessions 를 막고 있고, 한 번
   쓰는 보정을 위해 그 문을 여는 것은 그 문이 영원히 열려 있게 되는 일이다. */
exports.fixMigratedServiceSessions = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 300,
  memory: "512MiB",
  invoker: "public",
}, async (request) => {
  const callerUid = String(request?.auth?.uid || "").trim();
  const organizationId = String(request?.data?.organizationId || "").trim();
  /* 미리보기가 기본이다. 고치려면 confirm 을 명시해야 한다. */
  const confirmed = request?.data?.confirm === true;
  if (!callerUid) throw new HttpsError("unauthenticated", "Please sign in again.");
  if (!organizationId) throw new HttpsError("invalid-argument", "organizationId is required.");

  const membership = await firestore
    .collection("memberships").doc(membershipId(organizationId, callerUid)).get();
  if (!isOwnerLevel(membership.exists ? membership.data() : null)) {
    throw new HttpsError("permission-denied", "Only an owner or area manager can run this.");
  }

  try {
    const plan = await planServiceSessionFix(firestore, { organizationId });
    /* 이관 뒤에 서비스로 나간 수업. serviceUsed 가 0 이었던 탓에 센터가 같은
       회차를 두 번 지원했을 수 있다 -- 되돌리지 않고 목록만 올린다. */
    const since = new Date("2026-10-01T00:00:00+09:00");
    const served = await findServiceDeductions(firestore, {
      organizationId, passIds: plan.rows.map((row) => row.passId), since,
    });

    if (!confirmed) {
      logger.info("service_session_fix_preview", {
        feature: "service_session_fix", stage: "preview", organizationId,
        passes: plan.rows.length, servedSince: served.length,
      });
      return { stage: "preview", rows: plan.rows, served };
    }

    const result = await runServiceSessionFix(firestore, { organizationId, actorId: callerUid });
    logger.warn("service_session_fix_done", {
      feature: "service_session_fix", stage: "done", organizationId,
      fixed: result.fixed, servedSince: served.length,
    });
    return { stage: "done", fixed: result.fixed, rows: result.rows, served };
  } catch (error) {
    logger.error("service_session_fix_failed", {
      feature: "service_session_fix", stage: confirmed ? "done" : "preview", organizationId,
      errorCode: error?.code || "unknown", message: error?.message || "",
    });
    throw new HttpsError("internal", "service_session_fix_failed");
  }
});

/* ── 강사 이름 확정 ──────────────────────────────────────────────────────
   한 번 쓰는 통로다. 근거는 shared/instructor-names.mjs 머리말에 있다.

   요약: 2026-10-10 까지 강사 앱이 열릴 때마다 로그인 계정 이름을 덮어썼고,
   그 문을 닫는 표시(displayNameBy)가 **이미 있는 소속에는 없다.** 대표가
   강사 수만큼 강사 관리에 들어가 저장해야 붙는데, 하나를 빠뜨리면 그 사람만
   계속 되돌아가고 왜 그 사람만인지는 아무도 모른다. */
exports.confirmInstructorNames = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 120,
  memory: "512MiB",
  invoker: "public",
}, async (request) => {
  const callerUid = String(request?.auth?.uid || "").trim();
  const organizationId = String(request?.data?.organizationId || "").trim();
  /* 미리보기가 기본이다. 찍으려면 confirm 을 명시해야 한다 -- 되돌리는 문이
     없는 쪽이 기본값이면 안 된다. */
  const confirmed = request?.data?.confirm === true;
  if (!callerUid) throw new HttpsError("unauthenticated", "Please sign in again.");
  if (!organizationId) throw new HttpsError("invalid-argument", "organizationId is required.");

  const membership = await firestore
    .collection("memberships").doc(membershipId(organizationId, callerUid)).get();
  /* 대표만이다. 총괄매니저에게도 열지 않는다 -- 센터 전체의 이름을 한 번에
     굳히는 일이고, 되돌리려면 한 사람씩 다시 저장하는 길밖에 없다. */
  if (!isActiveOwner(membership.exists ? membership.data() : null)) {
    throw new HttpsError("permission-denied", "Only the centre owner can confirm instructor names.");
  }

  try {
    const result = confirmed
      ? await confirmInstructorNames(firestore, { organizationId })
      : await planInstructorNames(firestore, { organizationId });
    /* 건수만 남긴다. **이름은 로그에 적지 않는다** -- 화면에는 보여야 대표가
       확정할지 정할 수 있지만, 로그에 남길 이유는 없다. */
    logger.info("instructor_names_confirm", {
      feature: "instructor_names", stage: confirmed ? "apply" : "preview", organizationId,
      targets: result.counts.targets, already: result.counts.already, noName: result.counts.noName,
    });
    return { ...result, confirmed };
  } catch (error) {
    logger.error("instructor_names_failed", {
      feature: "instructor_names", stage: confirmed ? "apply" : "preview", organizationId,
      errorCode: String(error?.code || error?.message || "unknown"),
    });
    throw new HttpsError("internal", "instructor_names_failed");
  }
});

/* ── 이관 데이터 초기화 ──────────────────────────────────────────────────
   출시 전 한 번 쓰는 통로다. 근거는 migration-reset.js 머리말에 있다.

   **규칙을 건드리지 않는다.** Admin SDK 가 규칙을 우회하므로 "아무도 원장을
   못 지운다" 는 규칙은 그대로 남고, 그 예외는 대표가 부르는 이 함수뿐이다. */
exports.resetMigratedData = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 540,
  memory: "512MiB",
  invoker: "public",
}, async (request) => {
  const callerUid = String(request?.auth?.uid || "").trim();
  const organizationId = String(request?.data?.organizationId || "").trim();
  /* 미리보기가 기본이다. 지우려면 confirm 을 명시해야 한다 -- 되돌릴 수 없는
     쪽이 기본값이면 안 된다. */
  const confirmed = request?.data?.confirm === true;
  if (!callerUid) throw new HttpsError("unauthenticated", "Please sign in again.");
  if (!organizationId) throw new HttpsError("invalid-argument", "organizationId is required.");

  const membership = await firestore
    .collection("memberships").doc(membershipId(organizationId, callerUid)).get();
  if (!isActiveOwner(membership.exists ? membership.data() : null)) {
    throw new HttpsError("permission-denied", "Only the centre owner can reset migrated data.");
  }

  try {
    if (!confirmed) {
      const plan = await planMigrationReset(firestore, { organizationId });
      logger.info("migration_reset_preview", {
        feature: "migration_reset", stage: "preview", organizationId, ...plan.counts,
      });
      /* 숫자와 막힌 회원 목록만 돌려준다. 지울 문서 경로 수천 개를 화면에
         보낼 이유가 없다. */
      return { stage: "preview", counts: plan.counts, blockedClients: plan.blockedClients };
    }
    const result = await runMigrationReset(firestore, getStorage().bucket(), {
      organizationId, actorId: callerUid,
    });
    /* 이름은 로그에 적지 않는다 (§7). 건수와 사본 경로만. */
    logger.warn("migration_reset_done", {
      feature: "migration_reset", stage: "done", organizationId,
      passes: result.passes, ledger: result.ledger, clients: result.clients,
      instructorClientTotals: result.instructorClientTotals, memberViews: result.memberViews,
      snapshotPath: result.snapshot.path,
    });
    return { stage: "done", ...result };
  } catch (error) {
    logger.error("migration_reset_failed", {
      feature: "migration_reset", stage: confirmed ? "done" : "preview", organizationId,
      errorCode: error?.code || "unknown", message: error?.message || "",
    });
    throw new HttpsError("internal", "migration_reset_failed");
  }
});

/* ── 밤마다 잔여를 견준다 ────────────────────────────────────────────────
   담당 강사 재계산과 같은 시각이다. **건수만 적고 고치지 않는다** --
   어긋난 것을 자동으로 맞추면 어느 쪽이 참인지 모른 채 한쪽을 덮어쓰게
   되고, 밤에 아무도 보지 않는 사이에 그 선택을 내리는 것이 가장 나쁘다.
   원장은 append-only 라 잘못 덮어쓴 것은 되돌릴 수도 없다.

   근거는 pass-reconcile-nightly.js 머리말에 있다. */
exports.reconcilePassesNightly = onSchedule({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  schedule: "every day 04:00",
  timeZone: "Asia/Seoul",
  memory: "512MiB",
  timeoutSeconds: 540,
}, async () => {
  const organizations = await firestore.collection("organizations").select().get();
  for (const snapshot of organizations.docs) {
    try {
      const tally = await reconcileOrganization(firestore, { organizationId: snapshot.id });
      /* 이름도 회원권 id 도 적지 않는다 (§7). 누가 어긋났는지는 대표가
         화면에서 본다. */
      logger.info("pass_reconcile_nightly", {
        feature: "pass_reconcile", stage: "nightly",
        organizationId: snapshot.id, ...tally,
      });
    } catch (error) {
      /* 한 센터가 실패해도 나머지는 돈다. */
      logger.error("pass_reconcile_nightly_failed", {
        feature: "pass_reconcile", stage: "nightly",
        organizationId: snapshot.id,
        errorCode: error?.code || "unknown", message: error?.message || "",
      });
    }
  }
});

exports.rebuildInstructorIdsNightly = onSchedule({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  schedule: "every day 04:00",
  timeZone: "Asia/Seoul",
  memory: "512MiB",
  timeoutSeconds: 540,
}, async () => {
  const organizations = await firestore.collection("organizations").select().get();
  for (const snapshot of organizations.docs) {
    try {
      const tally = await rebuildInstructorIds(firestore, {
        organizationId: snapshot.id, log: logger,
      });
      logger.info("instructor_scope_nightly", {
        feature: "instructor_scope", stage: "nightly",
        organizationId: snapshot.id, ...tally,
      });
    } catch (error) {
      /* 한 센터가 실패해도 나머지는 돈다. 센터 하나의 문제로 전부 멈추면
         다음 날까지 아무도 갱신되지 않는다. */
      logger.error("instructor_scope_nightly_failed", {
        feature: "instructor_scope", stage: "nightly",
        organizationId: snapshot.id,
        errorCode: error?.code || "unknown", message: error?.message || "",
      });
    }
  }
});
