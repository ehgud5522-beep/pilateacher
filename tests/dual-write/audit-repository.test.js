import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_ACTION, AUDIT_FIELDS, auditEntry, auditLogId, createFirestoreAuditStore,
  listAuditLogs, recordMigrationUpload, reviewAudit,
} from "../../src/data/repositories/audit-repository.js";
import { RepositoryReadError, connectRepositoryLog, disconnectRepositoryLog } from "../../src/data/repositories/repository-read.js";

const ORG = "center-a";

function fakeStore(documents = []) {
  const calls = { list: [], commit: [] };
  return {
    calls,
    list: async (query) => { calls.list.push(query); return documents; },
    commit: async (writes) => { calls.commit.push(writes); },
    serverTimestamp: async () => "SERVER_TIME",
  };
}

const base = (overrides = {}) => ({
  action: AUDIT_ACTION.FULL_ROOM_RATE_SET,
  actorId: "owner-a",
  actorRole: "owner",
  stampedAt: "SERVER_TIME",
  ...overrides,
});

/* ── 무엇이 들어가고 무엇이 들어가지 않는가 ────────────────────────────── */

test("an entry carries ids and numbers, never a name", () => {
  /* 이름은 개명과 오타 수정으로 바뀌는데 이 컬렉션은 고칠 수 없고, 삭제 요청이
     왔을 때 지울 수도 없다. 화면이 clients 에서 그때 붙인다. */
  const entry = auditEntry(ORG, base({ targetId: "instructor-a", amount: 50000, previousAmount: 45000 }));
  assert.deepEqual(Object.keys(entry).sort(), [
    "action", "actorId", "actorRole", "amount", "createdAt", "organizationId", "previousAmount", "targetId",
  ]);
  for (const field of Object.keys(entry)) {
    assert.ok(AUDIT_FIELDS.includes(field), `${field} 는 규칙이 허용하지 않는다`);
  }
});

test("the field list matches what the rules allow, and holds no free text", () => {
  /* 자유 문장 칸이 하나라도 있으면 언젠가 거기에 회원 이름이 들어간다. 규칙의
     hasOnly 와 이 목록이 함께 움직여야 한다. */
  for (const field of ["clientName", "summary", "note", "memo", "message"]) {
    assert.ok(!AUDIT_FIELDS.includes(field), field);
  }
});

test("a field that makes no sense for the action is left out, not zeroed", () => {
  /* 0 이나 빈 문자열로 채우면 화면이 그것을 진짜 값으로 읽는다 -- "단가를 0원으로
     바꿨다"로 보이는 기록이 남는다. */
  const entry = auditEntry(ORG, base({ action: AUDIT_ACTION.DEPUTY_DIRECTOR_SET, enabled: false }));
  assert.equal("amount" in entry, false);
  assert.equal("previousAmount" in entry, false);
  assert.equal(entry.enabled, false, "끈 것도 남아야 한다 -- 켠 것과 다른 사건이다");
});

test("an entry without an actor, a role or a clock is refused", () => {
  for (const missing of ["actorId", "actorRole", "stampedAt"]) {
    const input = base();
    delete input[missing];
    assert.throws(() => auditEntry(ORG, input), new RegExp(`Missing ${missing}`), missing);
  }
  assert.throws(() => auditEntry("", base()), /Missing organizationId/);
});

test("an action the rules do not know is refused here first", () => {
  // 규칙도 막지만, 거부된 쓰기는 permission-denied 로만 돌아와 이유를 말하지 않는다.
  assert.throws(() => auditEntry(ORG, base({ action: "pass_deducted" })), /Invalid action/);
  assert.throws(() => auditEntry(ORG, base({ action: "whatever" })), /Invalid action/);
});

test("a count has to be a whole number that is not negative", () => {
  for (const bad of ["118", -1, 1.5]) {
    assert.throws(
      () => auditEntry(ORG, base({ action: AUDIT_ACTION.MIGRATION_UPLOADED, succeeded: bad })),
      /Invalid succeeded/,
      JSON.stringify(bad),
    );
  }
  assert.equal(auditEntry(ORG, base({ succeeded: 0 })).succeeded, 0, "0건도 사실이다");
});

test("a document id never carries a character a path cannot hold", () => {
  assert.equal(auditLogId("full_room_rate_set", "u1", "17"), "full_room_rate_set_u1_17");
  assert.equal(auditLogId("a", "b/c", "1"), "a_bc_1", "슬래시는 경로를 쪼갠다");
});

/* ── 읽기 ─────────────────────────────────────────────────────────────── */

test("the read is narrowed by organization, because the rule needs it to be", async () => {
  /* 최상위 컬렉션이라 경로가 조직을 고정해 주지 않는다. 좁히지 않은 list 는
     규칙이 거부하고, 그 거부는 화면에 빈 목록으로 도착한다. */
  const store = fakeStore([]);
  const start = new Date(2026, 8, 1);
  const end = new Date(2026, 9, 1);
  await listAuditLogs(ORG, { start, end, store });
  assert.deepEqual(store.calls.list[0], { organizationId: ORG, start, end });
});

test("another organization's entry never survives the read", async () => {
  const store = fakeStore([
    { id: "mine", organizationId: ORG, action: AUDIT_ACTION.FULL_ROOM_RATE_SET },
    { id: "theirs", organizationId: "center-b", action: AUDIT_ACTION.FULL_ROOM_RATE_SET },
  ]);
  const found = await listAuditLogs(ORG, { start: new Date(2026, 8, 1), end: new Date(2026, 9, 1), store });
  assert.deepEqual(found.map((entry) => entry.id), ["mine"]);
});

test("a range that is not a range is refused before the query", async () => {
  const store = fakeStore();
  await assert.rejects(
    () => listAuditLogs(ORG, { start: /** @type {any} */ ("2026-09-01"), end: new Date(), store }),
    /Invalid range/,
  );
  assert.equal(store.calls.list.length, 0);
});

test("a failed read is never a quiet empty history", async () => {
  /* "이달 조작이 없었다"와 "읽지 못했다"가 같은 화면이면, 감사 화면은 아무것도
     감사하지 못한다. */
  const entries = [];
  connectRepositoryLog((code, detail) => entries.push({ code, detail }));
  const store = fakeStore();
  store.list = async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); };
  await assert.rejects(
    () => listAuditLogs(ORG, { start: new Date(2026, 8, 1), end: new Date(2026, 9, 1), store }),
    RepositoryReadError,
  );
  assert.equal(entries[0].code, "audit_log_read_failed");
  assert.equal(entries[0].detail.errorCode, "permission-denied");
  disconnectRepositoryLog();
});

/* ── 이관 업로드 ───────────────────────────────────────────────────────── */

test("an upload is recorded once, with how many landed and how many did not", async () => {
  /* 이관은 행마다 따로 쓰고 한 행이 실패해도 멈추지 않으므로 묶을 배치가 없다.
     남길 수 있는 것은 끝난 뒤의 결과 한 줄이다. */
  const store = fakeStore();
  const { entry } = await recordMigrationUpload(ORG, {
    stage: "passes", succeeded: 118, failed: 2, actorId: "owner-a", actorRole: "owner",
  }, { store });
  assert.equal(store.calls.commit.length, 1);
  assert.ok(store.calls.commit[0][0].path.startsWith("auditLogs/"));
  assert.equal(entry.action, AUDIT_ACTION.MIGRATION_UPLOADED);
  assert.equal(entry.stage, "passes");
  assert.equal(entry.succeeded, 118);
  assert.equal(entry.failed, 2);
  assert.equal(entry.createdAt, "SERVER_TIME", "규칙이 createdAt == request.time 을 요구한다");
});

test("an upload with no stage is refused — the two halves are different events", async () => {
  const store = fakeStore();
  await assert.rejects(() => recordMigrationUpload(ORG, {
    succeeded: 1, failed: 0, actorId: "owner-a", actorRole: "owner",
  }, { store }), /Missing stage/);
  assert.equal(store.calls.commit.length, 0);
});

test("the Firestore store answers the whole AuditStore shape", () => {
  const store = createFirestoreAuditStore();
  assert.equal(typeof store.list, "function");
  assert.equal(typeof store.commit, "function");
  assert.equal(typeof store.serverTimestamp, "function");
});

test("the Firestore store is what a caller gets when none is injected", async () => {
  const error = await listAuditLogs(ORG, { start: new Date(2026, 8, 1), end: new Date(2026, 9, 1) })
    .then(() => null, (thrown) => thrown);
  assert.ok(error);
  assert.notEqual(error.name, "TypeError", `기본 store 가 사라졌다: ${error.message}`);
  assert.equal(error.code, "app/no-app", error.message);
});

/* ── 이상한 것만 보는 목록 ──────────────────────────────────────────────

   감사 화면의 용도는 전체 이력을 읽는 것이 아니다. 백 줄을 눈으로 훑는 일은
   아무도 하지 않는다 -- 3중 대조가 그래서 매달 늦어진다. */

const NOW = new Date(2026, 9, 3, 12, 0, 0);
const START = new Date(2026, 9, 1);
const END = new Date(2026, 10, 1);

const product = (overrides = {}) => ({
  id: "product-a", defaultSessions: 20, defaultPrice: 1300000, ...overrides,
});

const pass = (overrides = {}) => ({
  id: "pass-a",
  clientId: "client-a",
  locationId: "bansong",
  instructorId: "u1",
  productId: "product-a",
  totalSessions: 20,
  contractPrice: 1300000,
  paymentMethod: "card",
  remainingCount: 8,
  status: "active",
  createdAt: new Date(2026, 9, 2),
  expiresAt: new Date(2027, 3, 1),
  ...overrides,
});

test("an issue that differs from the product it was sold as is pulled out", () => {
  /* 상품은 추가와 종료만 되고 고쳐지지 않으므로, 지금 상품을 읽어도 그때 팔린
     조건과 같다. 발급 시점의 값을 따로 박아 둘 이유가 없다. */
  const review = reviewAudit({
    products: [product()],
    passes: [
      pass({ id: "same" }),
      pass({ id: "fewer-sessions", totalSessions: 18 }),
      pass({ id: "cheaper", contractPrice: 1100000 }),
    ],
    start: START, end: END, now: NOW,
  });
  assert.deepEqual(review.adjustedIssues.map((row) => row.passId), ["fewer-sessions", "cheaper"]);
  assert.equal(review.adjustedIssues[0].sessionsOff, true);
  assert.equal(review.adjustedIssues[0].priceOff, false);
  assert.equal(review.adjustedIssues[0].defaultSessions, 20, "무엇과 다른지가 함께 있어야 한다");
});

test("a migrated pass has no baseline, so it is counted rather than guessed at", () => {
  /* 옛 엑셀에는 상품이라는 개념이 없었다. 기준이 없으면 조정인지 아닌지 말할 수
     없고, 지어내면 매달 같은 건이 목록을 채운다. */
  const review = reviewAudit({
    products: [product()],
    passes: [pass({ id: "csv_1", productId: "1:1 20회 가을" })],
    start: START, end: END, now: NOW,
  });
  assert.deepEqual(review.adjustedIssues, []);
  assert.equal(review.unmatchedProductCount, 1);
});

test("every voucher payment is pulled out, migrated ones included", () => {
  // 인센 10% 를 손으로 조정하는 대상이라 한 건도 놓치면 안 된다.
  const review = reviewAudit({
    products: [product()],
    passes: [
      pass({ id: "card" }),
      pass({ id: "voucher-app", paymentMethod: "voucher" }),
      pass({ id: "voucher-csv", paymentMethod: "voucher", productId: "csv" }),
      pass({ id: "voucher-last-month", paymentMethod: "voucher", createdAt: new Date(2026, 8, 20) }),
    ],
    start: START, end: END, now: NOW,
  });
  assert.deepEqual(review.voucherPayments.map((row) => row.passId), ["voucher-app", "voucher-csv"]);
});

test("a pass with sessions left and no recent deduction is pulled out", () => {
  /* 주 1회 수업이면 30일 사이 네 번이 있었어야 한다. 한 번도 없었다는 것은
     회원이 그만뒀거나 강사가 출석을 안 눌렀거나 잘못 발급된 것이다. */
  const review = reviewAudit({
    passes: [
      pass({ id: "moving", createdAt: new Date(2026, 6, 1) }),
      pass({ id: "stalled", createdAt: new Date(2026, 6, 1) }),
      pass({ id: "never-started", createdAt: new Date(2026, 7, 20) }),
      pass({ id: "finished", remainingCount: 0, createdAt: new Date(2026, 6, 1) }),
      pass({ id: "cancelled", status: "cancelled", createdAt: new Date(2026, 6, 1) }),
      // 만료된 회원권은 멈춘 것이 아니라 끝난 것이다.
      pass({ id: "expired", createdAt: new Date(2026, 6, 1), expiresAt: new Date(2026, 8, 1) }),
    ],
    entries: [
      { passId: "moving", type: "deduct", occurredAt: new Date(2026, 9, 1) },
      { passId: "stalled", type: "deduct", occurredAt: new Date(2026, 7, 1) },
      // 발급 항목은 "움직임"이 아니다. 차감만 센다.
      { passId: "never-started", type: "issue", occurredAt: new Date(2026, 7, 20) },
    ],
    start: START, end: END, now: NOW, staleDays: 30,
  });
  assert.deepEqual(review.stalePasses.map((row) => row.passId), ["stalled", "never-started"]);
  assert.equal(review.stalePasses[0].deducted, true);
  assert.equal(review.stalePasses[1].deducted, false, "한 번도 차감된 적 없는 건은 그렇게 보여야 한다");
  assert.ok(review.stalePasses[0].days > review.stalePasses[1].days, "오래 멈춘 것이 앞이다");
});

test("the rate and migration histories come from the audit log", () => {
  const review = reviewAudit({
    auditLogs: [
      { id: "a", action: AUDIT_ACTION.DEPUTY_DIRECTOR_SET, createdAt: new Date(2026, 9, 2), actorId: "owner-a" },
      { id: "b", action: AUDIT_ACTION.FULL_ROOM_RATE_SET, createdAt: new Date(2026, 9, 2), actorId: "owner-a" },
      { id: "c", action: AUDIT_ACTION.MIGRATION_UPLOADED, createdAt: new Date(2026, 9, 2), actorId: "owner-a" },
      { id: "old", action: AUDIT_ACTION.FULL_ROOM_RATE_SET, createdAt: new Date(2026, 8, 2), actorId: "owner-a" },
    ],
    start: START, end: END, now: NOW,
  });
  assert.deepEqual(review.rateChanges.map((row) => row.id), ["a", "b"]);
  assert.deepEqual(review.migrations.map((row) => row.id), ["c"]);
});

test("the history is one stream, the audit log and the ledger merged by time", () => {
  /* 보는 사람에게는 한 줄기이고, 저장은 한 벌이다 -- 발급·교체·차감을 감사
     로그에 한 벌 더 쓰지 않는 이유는 이 파일 머리말에 있다. */
  const review = reviewAudit({
    auditLogs: [
      { id: "rate", action: AUDIT_ACTION.FULL_ROOM_RATE_SET, createdAt: new Date(2026, 9, 2, 9, 0), actorId: "owner-a", actorRole: "owner" },
    ],
    entries: [
      { id: "deduct", passId: "pass-a", type: "deduct", delta: -1, unitPrice: 25000, rule: "new_to_instructor", occurredAt: new Date(2026, 9, 2, 19, 0), createdBy: "u1", clientId: "client-a" },
      { id: "issue", passId: "pass-a", type: "issue", delta: 22, unitPrice: 0, occurredAt: new Date(2026, 9, 1, 10, 0), createdBy: "owner-a", clientId: "client-a" },
    ],
    start: START, end: END, now: NOW,
  });
  assert.deepEqual(review.timeline.map((row) => row.id), ["deduct", "rate", "issue"], "최근이 앞이다");
  assert.deepEqual(review.timeline.map((row) => row.source), ["ledger", "audit", "ledger"]);
  assert.equal(review.timeline[0].rule, "new_to_instructor", "왜 이 금액인지가 함께 온다");
  assert.equal(review.timeline[0].actorId, "u1", "누가 눌렀는가");
});

test("nothing in the review carries a name", () => {
  /* 화면이 그때 clients 와 memberships 에서 붙인다. 목록을 만드는 쪽에 이름이
     끼어들면 그것을 저장하고 싶어지는 날이 온다. */
  const review = reviewAudit({
    products: [product()],
    passes: [pass({ id: "adjusted", totalSessions: 18, paymentMethod: "voucher" })],
    entries: [{ id: "d", passId: "pass-a", type: "deduct", delta: -1, unitPrice: 25000, occurredAt: new Date(2026, 9, 2) }],
    start: START, end: END, now: NOW,
  });
  const text = JSON.stringify(review);
  for (const key of ["name", "displayName", "phone"]) {
    assert.ok(!text.includes(`"${key}"`), key);
  }
});
