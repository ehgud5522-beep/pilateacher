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
const { createMemberLinkService } = require("./member-link");
const { createFirestoreMemberLinkPorts } = require("./member-link-store");
const {
  createFirestoreMemberViewAdminPorts, createMemberViewAdminService,
} = require("./member-view-admin");
const { createMemberLookupService } = require("./member-lookup");
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
  memberViewAdminHttpsError,
  requestPath,
};
