"use strict";

/* FC 회원권 발급 → 대표 · 총괄 알림 (2026-11-21 대표). FC 만 · 이관 제외 · 눈여겨볼 것 · 실패해도 던지지 않음. */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createIssueNoticeService } = require("../src/issue-notice");

function fake(seed, { failInbox = false } = {}) {
  const docs = new Map(Object.entries(seed));
  const writes = [];
  const snap = (path) => ({ id: path.split("/").pop(), exists: docs.has(path), data: () => docs.get(path) });
  const query = (path, filters) => ({
    where: (field, _op, value) => query(path, [...filters, [field, value]]),
    get: async () => ({ docs: [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
      .map(snap).filter((row) => filters.every(([field, value]) => row.data()[field] === value)) }),
  });
  const collectionRef = (path) => ({ doc: (id) => docRef(`${path}/${id}`), where: (field, op, value) => query(path, []).where(field, op, value) });
  const docRef = (path) => ({
    get: async () => snap(path),
    set: async (data) => { if (failInbox && path.includes("/inbox/")) throw Object.assign(new Error("boom"), { code: "unavailable" }); writes.push({ path, data }); docs.set(path, data); },
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  return { writes, doc: docRef, collection: collectionRef };
}
const member = (userId, role, extra = {}) => ({ organizationId: "o1", userId, role, status: "active", ...extra });
const seed = {
  "memberships/o1_owner": member("owner", "owner", { displayName: "대표" }),
  "memberships/o1_area": member("area", "area_manager"),
  "memberships/o1_fc": member("fc", "manager", { displayName: "박에프씨" }),
  "memberships/o1_t1": member("t1", "instructor", { displayName: "정예진" }),
  "organizations/o1/clients/c1": { name: "김하나" },
  "organizations/o1/products/pr1": { name: "1:1 가을 이벤트" },
  "organizations/o1/locations/yul": { name: "율하" },
};
const pass = (extra = {}) => ({
  clientId: "c1", productId: "pr1", locationId: "yul", instructorId: "t1", createdBy: "fc",
  totalSessions: 20, serviceSessions: 0, contractPrice: 1320000, paymentMethod: "card", balance: 0, unitPriceSource: "table", ...extra,
});
const run = (store, id, data, logs = []) => createIssueNoticeService({
  firestore: store, isOwnerLevel: (row) => ["owner", "area_manager"].includes(row?.role), log: (level, event, fields) => logs.push({ level, event, fields }),
}).onPassCreated("o1", id, data, new Date("2026-11-21T03:00:00Z"));

test("FC 가 발급하면 대표 · 총괄에게 한 줄 (같은 회원권은 같은 id)", async () => {
  const store = fake(seed);
  assert.deepEqual(await run(store, "p1", pass()), { sent: 2 });
  assert.deepEqual(store.writes.map((write) => write.path).sort(), ["users/area/inbox/issue_p1", "users/owner/inbox/issue_p1"]);
  const notice = store.writes[0].data;
  assert.equal(notice.kind, "pass_issued_by_fc");
  assert.equal(notice.title, "[FC 회원권 발급]");
  assert.equal(notice.body, "박에프씨 님이 율하 · 김하나 님께 1:1 가을 이벤트 20회 · 1,320,000원 (카드) 을 발급했어요 · 담당 정예진");
});

test("서비스 회차 · 단가 직접 입력 · 잔금은 제목 앞에 '확인' 으로", async () => {
  const store = fake(seed);
  await run(store, "p2", pass({ serviceSessions: 3, unitPriceSource: "manual", paymentMethod: "mixed", balance: 200000 }));
  const notice = store.writes[0].data;
  assert.equal(notice.title, "[FC 회원권 발급 · 확인] 서비스 3회 · 단가 직접 입력 · 잔금 200,000원");
  assert.match(notice.body, /20회 \+ 서비스 3회 · 1,320,000원 \(복합결제\)/);
  assert.deepEqual(notice.watch, ["서비스 3회", "단가 직접 입력", "잔금 200,000원"]);
});

test("대표 · 총괄이 발급한 것 · 이관 회원권 · 만든 사람 없음은 보내지 않는다", async () => {
  const store = fake(seed);
  assert.deepEqual(await run(store, "p3", pass({ createdBy: "owner" })), { sent: 0, skipped: "not_fc" });
  assert.deepEqual(await run(store, "csv_9", pass()), { sent: 0, skipped: "migrated" });
  assert.deepEqual(await run(store, "p4", pass({ contractedAt: "2025-01-01" })), { sent: 0, skipped: "migrated" });
  assert.deepEqual(await run(store, "p5", pass({ createdBy: "" })), { sent: 0, skipped: "no_creator" });
  assert.equal(store.writes.length, 0);
});

test("알림을 못 써도 던지지 않고 진단만 남긴다", async () => {
  const logs = [];
  const result = await run(fake(seed, { failInbox: true }), "p6", pass(), logs);
  assert.deepEqual(result, { sent: 0, errorCode: "unavailable" });
  assert.equal(logs[0].event, "issue_notice_failed");
  assert.equal(logs[0].fields.feature, "issue_notice");
});
