/**
 * 감사 로그. 되돌릴 수 없거나 돈에 닿는 조작을 남긴다.
 *
 * ── 여기에 무엇을 쓰지 "않는지"가 먼저다 ──
 * 발급 · 담당 교체 · 차감은 이미 passes/{passId}/ledger 에 남는다. 그 항목은
 * append-only 이고, 누가(createdBy · instructorId) 언제(occurredAt · createdAt)
 * 무엇을(type · delta · unitPrice · rule · lessonId) 했는지를 감사 항목보다 더
 * 많이 들고 있다.
 *
 * 그것을 여기에 한 번 더 쓰면 두 가지를 얻는다 -- 차감할 때마다 쓰기가 하나 더
 * 붙고(출석 체크는 이 앱에서 가장 자주 눌리는 버튼이다), 같은 사건을 말하는
 * 기록이 두 벌 생긴다. 두 벌은 언젠가 어긋나고, 어긋나면 어느 쪽이 맞는지
 * 아무도 모른다.
 *
 * 그래서 이 컬렉션은 다른 데 남지 않는 것만 담는다:
 *   deputy_director_set      부원장 지정 · 해제
 *   full_room_rate_set       풀방금액 변경
 *   migration_uploaded       이관 업로드 (건수와 실패 수)
 *   member_added             강사를 센터에 붙임
 *   member_profile_changed   이름 · 직함 · 지점 변경
 *   member_revoked           퇴사 · 복직
 *
 * 감사 화면은 이 컬렉션과 원장을 시간순으로 합쳐 하나의 이력으로 보여준다.
 * 보는 사람에게는 한 줄기이고, 저장은 한 벌이다.
 *
 * (부원장·단가는 memberships/{id}/rateHistory 에도 남는다. 그쪽은 한 강사의
 *  이력이라 센터 전체를 보려면 강사 수만큼 읽어야 한다. 이 컬렉션은 한 번에
 *  읽는다 -- 목적이 다르다.)
 *
 * ── 개인정보는 넣지 않는다 ──
 * 회원 이름도 강사 이름도 적지 않는다. clientId 와 uid 만 남기고, 화면이 그때
 * clients · memberships 에서 이름을 붙인다.
 *
 * 이유가 셋이다. 이름은 개명과 오타 수정으로 바뀌는데 이 컬렉션은 고칠 수 없다.
 * 이미 clients 에 있는 것을 한 벌 더 두면 개인정보가 사는 곳이 늘어난다. 그리고
 * 이름이 들어간 기록은 삭제 요청이 왔을 때 지울 수 없는 자리에 남는다.
 *
 * 규칙이 필드 집합을 hasOnly 로 닫아, 이름을 넣을 칸 자체가 없다.
 *
 * ── 최상위 컬렉션이다 ──
 * 경로가 조직을 고정하지 않으므로, 읽는 쪽이 반드시
 * where("organizationId", "==", …) 로 좁혀야 한다. 규칙의 read 가
 * resource.data.organizationId 를 보기 때문에, 좁히지 않은 list 는 거부된다 --
 * firestore.foundation.rules 머리말의 class B.
 */

import { COLLECTIONS } from "../schema/constants.js";
import { paths } from "../schema/paths.js";
import { readCollection } from "./repository-read.js";

/** 무엇을 했는가. 규칙의 auditActions() 와 같아야 한다. */
export const AUDIT_ACTION = Object.freeze({
  DEPUTY_DIRECTOR_SET: "deputy_director_set",
  FULL_ROOM_RATE_SET: "full_room_rate_set",
  MIGRATION_UPLOADED: "migration_uploaded",
  /* 강사 관리. 소속 문서는 현재 상태만 들고 있어 "언제 붙었고, 언제 직함이
     바뀌었고, 언제 나갔나"를 답할 수 없다 -- 그 이력이 여기 남는다.

     이메일 조회는 여기 없다. 대표가 성공한 조회만 이 컬렉션에 적으면 거부된
     조회가 빠져 오히려 덜 완전한 기록이 된다. 조회는 Functions 로그가 센터와
     성공 여부로 남긴다 (functions/src/index.js). */
  MEMBER_ADDED: "member_added",
  MEMBER_PROFILE_CHANGED: "member_profile_changed",
  MEMBER_REVOKED: "member_revoked",
});

/**
 * 감사 항목이 가질 수 있는 필드 전부. 규칙의 hasOnly 와 같아야 한다.
 *
 * 전부 id · 열거값 · 숫자다. 자유 문장 칸이 하나도 없는 것이 요점이다 -- 있으면
 * 언젠가 거기에 회원 이름이 들어간다.
 */
export const AUDIT_FIELDS = Object.freeze([
  "organizationId", "actorId", "actorRole", "action", "createdAt",
  "locationId", "targetId", "clientId",
  "amount", "previousAmount", "succeeded", "failed", "enabled", "stage",
  // 직함. 열거값이라 자유 문장이 아니고, "무엇으로 불리게 됐나"를 남긴다.
  "title",
]);

const requiredText = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  return text;
};

const requiredInt = (value, label) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
};

/**
 * 항목 하나를 만든다. 쓰지는 않는다 -- 호출하는 쪽이 자기 배치에 얹는다.
 *
 * 배치에 얹는 것이 요점이다. 조작과 그 기록이 따로 나가면, 기록만 실패한 조작이
 * 생긴다. 감사 로그에서 그것은 "일어나지 않은 일"과 구별되지 않는다.
 *
 * @param {string} organizationId
 * @param {{
 *   action?: string, actorId?: string, actorRole?: string, stampedAt?: any,
 *   locationId?: string, targetId?: string, clientId?: string,
 *   amount?: number | null, previousAmount?: number | null,
 *   succeeded?: number, failed?: number, enabled?: boolean, stage?: string, title?: string,
 * }} input
 */
export function auditEntry(organizationId, input = {}) {
  const organization = requiredText(organizationId, "organizationId");
  const action = requiredText(input?.action, "action");
  if (!(/** @type {Array<string>} */ (Object.values(AUDIT_ACTION))).includes(action)) {
    throw new Error("Invalid action");
  }

  const entry = {
    organizationId: organization,
    actorId: requiredText(input?.actorId, "actorId"),
    // 역할은 규칙이 membership 과 대조한다. 거짓말한 역할이 남으면 기록이 해롭다.
    actorRole: requiredText(input?.actorRole, "actorRole"),
    action,
    createdAt: input?.stampedAt,
  };
  if (entry.createdAt === undefined) throw new Error("Missing stampedAt");

  /* 아래는 전부 선택이다. 동작마다 말이 되는 칸이 다르고, 말이 안 되는 칸을 0
     이나 빈 문자열로 채우면 화면이 그것을 진짜 값으로 읽는다. */
  const optionalText = (field) => {
    const text = String(input?.[field] ?? "").trim();
    if (text) entry[field] = text;
  };
  optionalText("locationId");
  optionalText("targetId");
  optionalText("clientId");
  optionalText("stage");
  optionalText("title");

  for (const field of ["amount", "previousAmount", "succeeded", "failed"]) {
    const value = input?.[field];
    if (value === undefined || value === null) continue;
    entry[field] = requiredInt(value, field);
  }
  if (typeof input?.enabled === "boolean") entry.enabled = input.enabled;

  return entry;
}

/** 문서 id. 조작마다 하나이고, 같은 조작을 두 번 적지 않는다. */
export const auditLogId = (action, targetId, stamp) =>
  `${action}_${targetId}_${stamp}`.replace(/[^A-Za-z0-9_-]/g, "");

/**
 * @typedef {object} AuditStore
 * @property {(query: { organizationId: string, start: Date, end: Date }) => Promise<Array<any>>} list
 * @property {(writes: Array<{ path: string, data: object }>) => Promise<void>} [commit]
 * @property {() => Promise<any>} [serverTimestamp]
 */

export function createFirestoreAuditStore() {
  const load = () => import("firebase/firestore");
  return {
    /* organizationId 를 반드시 좁힌다. 규칙이 그것 없이는 평가할 것이 없어
       쿼리 전체를 거부한다 -- 그 거부는 화면에 빈 목록으로 도착한다. */
    list: async ({ organizationId, start, end }) => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(
        collection(getFirestore(), COLLECTIONS.AUDIT_LOGS),
        where("organizationId", "==", organizationId),
        where("createdAt", ">=", start),
        where("createdAt", "<", end),
      ));
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    },
    commit: async (writes) => {
      const { doc, getFirestore, writeBatch } = await load();
      const firestore = getFirestore();
      const batch = writeBatch(firestore);
      for (const write of writes) batch.set(doc(firestore, write.path), write.data);
      await batch.commit();
    },
    serverTimestamp: async () => {
      const { serverTimestamp } = await load();
      return serverTimestamp();
    },
  };
}

/**
 * 한 기간의 감사 항목.
 *
 * @param {string} organizationId
 * @param {{ start?: Date, end?: Date, store?: AuditStore }} [options]
 */
export async function listAuditLogs(organizationId, options = {}) {
  const { start, end, store = createFirestoreAuditStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  if (!(start instanceof Date) || !(end instanceof Date)) throw new Error("Invalid range");
  // 조회 실패는 빈 목록이 아니라 RepositoryReadError 로 나간다 -- repository-read.js 참고.
  const found = await readCollection({
    feature: "audit_log",
    path: `${COLLECTIONS.AUDIT_LOGS}?organizationId=${organization}`,
    read: () => store.list({ organizationId: organization, start, end }),
  });
  /* 서버가 이미 걸러 주지만 한 번 더 본다. 쿼리를 잘못 고치면 남의 조직 기록이
     조용히 섞여 들어오고, 감사 화면에서 그것은 알아챌 방법이 없다. */
  return found.filter((entry) => entry.organizationId === organization);
}

/**
 * 이관 업로드 한 번을 기록한다.
 *
 * 다른 조작과 달리 배치에 얹지 않는다. 이관은 행마다 따로 쓰고 한 행이 실패해도
 * 멈추지 않으므로, 묶을 수 있는 배치가 없다 -- 남길 수 있는 것은 끝난 뒤의
 * 결과 한 줄이다. 그래서 건수와 실패 수를 함께 적는다.
 *
 * @param {string} organizationId
 * @param {{ stage?: string, succeeded?: number, failed?: number, actorId?: string, actorRole?: string }} input
 * @param {{ store?: AuditStore }} [options]
 */
export async function recordMigrationUpload(organizationId, input, options = {}) {
  const { store = createFirestoreAuditStore() } = options;
  const stampedAt = await store.serverTimestamp();
  const entry = auditEntry(organizationId, {
    action: AUDIT_ACTION.MIGRATION_UPLOADED,
    actorId: input?.actorId,
    actorRole: input?.actorRole,
    stage: requiredText(input?.stage, "stage"),
    succeeded: requiredInt(input?.succeeded ?? 0, "succeeded"),
    failed: requiredInt(input?.failed ?? 0, "failed"),
    stampedAt,
  });
  const logId = auditLogId(entry.action, entry.stage, String(Date.now()));
  await store.commit([{ path: paths.auditLog(logId), data: entry }]);
  return { logId, entry };
}

/* ── 이상한 것만 보는 목록 ───────────────────────────────────────────────

   감사 화면의 용도는 전체 이력을 읽는 것이 아니다. 백 줄을 눈으로 훑는 일은
   아무도 하지 않는다 -- 3중 대조가 그래서 매달 늦어진다. 그래서 먼저 "이상한
   것"만 뽑고, 전체 이력은 그 아래에 둔다.

   어디서 읽는지는 항목마다 다르다. 감사 로그에 있는 것은 감사 로그에서, 이미
   passes 와 ledger 가 더 정확하게 알고 있는 것은 거기서 읽는다. 옮겨 적은 사본을
   보면 옮기다 틀린 것까지 함께 보게 된다.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * 며칠 동안 차감이 없으면 들여다볼 회원권인가.
 *
 * 30일로 둔다. 주 1회 수업이면 그 사이 네 번이 있었어야 하고, 한 번도 없었다는
 * 것은 회원이 그만뒀거나 강사가 출석을 안 눌렀거나 잘못 발급된 것이다 -- 셋 다
 * 대표가 알아야 할 일이다. 정산 주기와도 맞아, 매달 같은 자리에서 보게 된다.
 *
 * 더 짧게 잡으면 휴가 간 회원이 매달 목록을 채우고, 목록이 길어지면 아무도 보지
 * 않는다.
 */
export const STALE_PASS_DAYS = 30;

const millisecondsPerDay = 24 * 60 * 60 * 1000;

const atOf = (value) => {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") {
    try { return value.toDate(); } catch (_error) { return new Date(NaN); }
  }
  return new Date(String(value ?? ""));
};

const inRange = (value, start, end) => {
  const at = atOf(value).getTime();
  return Number.isFinite(at) && at >= start.getTime() && at < end.getTime();
};

/**
 * 감사 화면이 보여줄 것을 한 번에 만든다. 읽지도 쓰지도 않는다.
 *
 * @param {{
 *   auditLogs?: Array<any>, passes?: Array<any>, products?: Array<any>,
 *   entries?: Array<any>, start?: Date, end?: Date, now?: Date, staleDays?: number,
 * }} input
 */
export function reviewAudit(input = {}) {
  const auditLogs = Array.isArray(input.auditLogs) ? input.auditLogs : [];
  const passes = Array.isArray(input.passes) ? input.passes : [];
  const products = Array.isArray(input.products) ? input.products : [];
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const start = input.start instanceof Date ? input.start : new Date(0);
  const end = input.end instanceof Date ? input.end : new Date(8.64e15);
  const now = input.now instanceof Date ? input.now : new Date();
  const staleDays = Number.isInteger(input.staleDays) ? input.staleDays : STALE_PASS_DAYS;

  const productById = new Map(products.map((product) => [product.id, product]));

  /* 1. 기준값 조정 발급.

     상품은 추가와 종료만 되고 고쳐지지 않는다(규칙의 products 블록). 그래서
     지금 상품을 읽어도 그때 팔린 조건과 같고, 발급 시점의 값을 따로 박아 둘
     이유가 없다.

     이관된 회원권은 상품을 가리키지 않는다 -- 옛 엑셀에 상품이라는 개념이
     없었다. 기준이 없으므로 조정인지 아닌지 말할 수 없고, 지어내지 않는다. */
  const adjustedIssues = [];
  const unmatchedProducts = [];
  for (const pass of passes) {
    if (!inRange(pass.createdAt, start, end)) continue;
    const product = productById.get(pass.productId);
    if (!product) { unmatchedProducts.push(pass); continue; }
    const sessionsOff = Number(pass.totalSessions) !== Number(product.defaultSessions);
    const priceOff = Number(pass.contractPrice) !== Number(product.defaultPrice);
    if (!sessionsOff && !priceOff) continue;
    adjustedIssues.push({
      passId: pass.id,
      clientId: pass.clientId,
      locationId: pass.locationId,
      instructorId: pass.instructorId,
      productId: pass.productId,
      totalSessions: Number(pass.totalSessions) || 0,
      defaultSessions: Number(product.defaultSessions) || 0,
      contractPrice: Number(pass.contractPrice) || 0,
      defaultPrice: Number(product.defaultPrice) || 0,
      sessionsOff,
      priceOff,
      at: atOf(pass.createdAt),
    });
  }

  /* 2. 바우처 결제. 인센 10% 를 손으로 조정하는 대상이라 한 건도 놓치면 안 된다.
     passes 에서 읽으므로 이관해 온 건도 함께 잡힌다. */
  const voucherPayments = passes
    .filter((pass) => pass.paymentMethod === "voucher" && inRange(pass.createdAt, start, end))
    .map((pass) => ({
      passId: pass.id,
      clientId: pass.clientId,
      locationId: pass.locationId,
      contractPrice: Number(pass.contractPrice) || 0,
      at: atOf(pass.createdAt),
    }));

  /* 3. 장기 미차감. 마지막 움직임이 언제였는지는 원장이 안다 -- 차감이 없으면
     발급이 마지막 움직임이다. */
  const lastDeductAt = new Map();
  for (const entry of entries) {
    if (entry.type !== "deduct") continue;
    const at = atOf(entry.occurredAt).getTime();
    if (!Number.isFinite(at)) continue;
    const seen = lastDeductAt.get(entry.passId) || 0;
    if (at > seen) lastDeductAt.set(entry.passId, at);
  }
  const staleBefore = now.getTime() - staleDays * millisecondsPerDay;
  const stalePasses = passes
    .filter((pass) => pass.status === "active" && (Number(pass.remainingCount) || 0) > 0)
    // 만료된 회원권은 멈춘 것이 아니라 끝난 것이다. 목록에 넣으면 매달 쌓인다.
    .filter((pass) => atOf(pass.expiresAt).getTime() >= now.getTime())
    .map((pass) => {
      const last = lastDeductAt.get(pass.id) || atOf(pass.createdAt).getTime();
      return { pass, last, deducted: lastDeductAt.has(pass.id) };
    })
    .filter((item) => Number.isFinite(item.last) && item.last < staleBefore)
    .map((item) => ({
      passId: item.pass.id,
      clientId: item.pass.clientId,
      locationId: item.pass.locationId,
      instructorId: item.pass.instructorId,
      remainingCount: Number(item.pass.remainingCount) || 0,
      deducted: item.deducted,
      at: new Date(item.last),
      days: Math.floor((now.getTime() - item.last) / millisecondsPerDay),
    }))
    .sort((left, right) => right.days - left.days);

  /* 4. 발급 취소 · 차감 보정. 원장에 남으므로 감사 로그에 또 쓰지 않는다 --
     한 사건에 기록이 두 벌이면 언젠가 어긋난다. */
  const corrections = entries
    .filter((entry) => (entry.type === "correction" || entry.type === "cancel"))
    .filter((entry) => inRange(entry.occurredAt, start, end))
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      passId: entry.passId,
      clientId: entry.clientId,
      locationId: entry.locationId,
      instructorId: entry.instructorId || "",
      correctsEntryId: entry.correctsEntryId || "",
      reason: entry.reason || "",
      delta: Number(entry.delta) || 0,
      amount: -(Number(entry.delta) || 0) * (Number(entry.unitPrice) || 0),
      actorId: entry.createdBy || "",
      at: atOf(entry.occurredAt),
    }))
    .sort((left, right) => right.at.getTime() - left.at.getTime());

  const inWindow = auditLogs.filter((entry) => inRange(entry.createdAt, start, end));
  const rateChanges = inWindow.filter((entry) => (
    entry.action === AUDIT_ACTION.DEPUTY_DIRECTOR_SET || entry.action === AUDIT_ACTION.FULL_ROOM_RATE_SET
  ));
  const migrations = inWindow.filter((entry) => entry.action === AUDIT_ACTION.MIGRATION_UPLOADED);

  /* 전체 이력. 감사 로그와 원장을 한 줄기로 합친다. 보는 사람에게는 하나의
     이력이고, 저장은 한 벌이다.

     시각은 "그 일이 일어난 때"다 -- 감사 항목은 조작한 시각(createdAt), 원장
     항목은 수업·발급이 일어난 시각(occurredAt). 밤에 몰아 누른 차감이 그날
     수업 자리에 서야 대표가 하루를 읽을 수 있다. */
  /* 두 출처가 한 줄기로 합쳐지므로 줄마다 있는 칸이 다르다. 화면이 동작을
     보고 무엇을 읽을지 정한다. */
  const timeline = /** @type {Array<Record<string, any>>} */ ([
    ...inWindow.map((entry) => ({
      id: entry.id,
      source: "audit",
      action: entry.action,
      at: atOf(entry.createdAt),
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      locationId: entry.locationId || "",
      targetId: entry.targetId || "",
      clientId: entry.clientId || "",
      amount: entry.amount,
      previousAmount: entry.previousAmount,
      succeeded: entry.succeeded,
      failed: entry.failed,
      enabled: entry.enabled,
      stage: entry.stage,
    })),
    ...entries
      .filter((entry) => inRange(entry.occurredAt, start, end))
      .map((entry) => ({
        id: entry.id,
        source: "ledger",
        action: entry.type,
        at: atOf(entry.occurredAt),
        actorId: entry.createdBy || entry.instructorId || "",
        actorRole: "",
        locationId: entry.locationId || "",
        targetId: entry.passId || "",
        clientId: entry.clientId || "",
        delta: Number(entry.delta) || 0,
        amount: Number(entry.unitPrice) || 0,
        rule: entry.rule,
        fromInstructorId: entry.fromInstructorId,
        toInstructorId: entry.toInstructorId,
      })),
  ]).sort((left, right) => right.at.getTime() - left.at.getTime());

  return {
    adjustedIssues,
    voucherPayments,
    stalePasses,
    corrections,
    rateChanges,
    migrations,
    timeline,
    // 기준이 없어 1번을 판정할 수 없었던 건. 화면이 그 사실을 말한다.
    unmatchedProductCount: unmatchedProducts.length,
    staleDays,
  };
}
