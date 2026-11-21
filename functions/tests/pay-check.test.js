"use strict";

/* 정산 점검 서버 (2026-11-22): 점검 문서 덮어쓰기 · 못 읽으면 미완료 · 확정 직전 재점검(차단 · 확인함으로 풀림) · 대조 기록. */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createPayCheckService, nightlyMonths } = require("../src/pay-check");
const { createPayCloseService } = require("../src/pay-close");

function fake(seed, { failGroup = false } = {}) {
  const docs = new Map(Object.entries(seed));
  const snap = (path) => ({ id: path.split("/").pop(), path, exists: docs.has(path), data: () => docs.get(path) });
  const time = (item) => (item instanceof Date ? item.getTime() : item);
  const match = (data, [field, op, value]) => {
    const actual = data?.[field];
    if (op === "==") return actual === value;
    if (op === "in") return value.includes(actual);
    if (op === ">=") return time(actual) >= time(value);
    if (op === "<") return time(actual) < time(value);
    return false;
  };
  const query = (pick, filters, failing = false) => ({
    where: (field, op, value) => query(pick, [...filters, [field, op, value]], failing),
    get: async () => {
      if (failing) throw Object.assign(new Error("boom"), { code: "unavailable" });
      const rows = [...docs.keys()].filter(pick).map(snap).filter((row) => filters.every((filter) => match(row.data(), filter)));
      return { docs: rows, size: rows.length };
    },
  });
  const inCollection = (path) => (key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1;
  const collectionRef = (path) => ({ doc: (id) => docRef(`${path}/${id}`), where: (...args) => query(inCollection(path), []).where(...args), get: () => query(inCollection(path), []).get() });
  const docRef = (path) => ({ path, get: async () => snap(path), set: async (data) => { docs.set(path, data); }, collection: (name) => collectionRef(`${path}/${name}`) });
  const runTransaction = async (fn) => {
    const pending = [];
    const value = await fn({ get: (target) => target.get(), set: (ref, data) => pending.push([ref, data]) });
    for (const [ref, data] of pending) await ref.set(data);
    return value;
  };
  return { docs, doc: docRef, collection: collectionRef, collectionGroup: (name) => query((key) => key.split("/").slice(-2)[0] === name, [], failGroup), runTransaction };
}

const ORG = "o1";
const MONTH = "2026-11";
const NOW = () => new Date("2026-11-25T01:00:00Z");
const member = (userId, role) => ({ organizationId: ORG, userId, role, status: "active" });
const deduct = (id, lessonId) => [`organizations/${ORG}/passes/p1/ledger/${id}`, {
  organizationId: ORG, passId: "p1", instructorId: "t1", type: "deduct", delta: -1, unitPrice: 30000, clientId: "c1", lessonId, occurredAt: new Date("2026-11-10T03:00:00Z"),
}];
const base = (extra = {}) => ({
  "memberships/o1_owner": member("owner", "owner"),
  "memberships/o1_t1": member("t1", "instructor"),
  "runtimeConfig/scheduleSync": { mode: "listed", userIds: ["t1"] },
  [`organizations/${ORG}/passes/p1`]: { clientId: "c1", instructorId: "t1", remainingCount: 8 },
  [`organizations/${ORG}/passes/p1/ledger/issue`]: [`x`, { organizationId: ORG, passId: "p1", type: "issue", delta: 10, occurredAt: new Date("2026-10-01T03:00:00Z") }][1],
  ...Object.fromEntries([deduct("d1", "L1"), deduct("d2", "L2")]),
  [`organizations/${ORG}/lessons/L1`]: { lessonId: "L1", instructorId: "t1", clientIds: ["c1"], status: "completed", startsAt: new Date("2026-11-10T03:00:00Z") },
  [`organizations/${ORG}/lessons/L2`]: { lessonId: "L2", instructorId: "t1", clientIds: ["c1"], status: "completed", startsAt: new Date("2026-11-10T03:00:00Z") },
  [`organizations/${ORG}/lessons/L3`]: { lessonId: "L3", instructorId: "t1", clientIds: ["c1"], status: "completed", startsAt: new Date("2026-11-12T03:00:00Z") },
  [`organizations/${ORG}/lessons/L4`]: { lessonId: "L4", instructorId: "t1", clientIds: ["c1"], status: "scheduled", startsAt: new Date("2026-11-20T03:00:00Z") },
  ...extra,
});
const deps = (store) => ({ firestore: store, membershipId: (org, uid) => `${org}_${uid}`, isOwnerLevel: (row) => ["owner", "area_manager"].includes(row?.role), now: NOW });

test("점검: 달마다 문서 하나에 덮어쓰고, 완료인데 차감 없음(L3)은 차단 · 미처리(L4) · 중복(L1/L2 같은 시각)은 확인", async () => {
  const store = fake(base());
  const service = createPayCheckService(deps(store));
  const result = await service.check(ORG, MONTH, "manual");
  assert.equal(result.complete, true);
  assert.deepEqual(result.counts.byKind, { completed_no_deduct: 1, unsettled_past: 1, duplicate_deduct: 1 });
  assert.equal(result.openBlocks, 1);
  const stored = store.docs.get(`organizations/${ORG}/payChecks/${MONTH}`);
  assert.equal(stored.trigger, "manual");
  await service.check(ORG, MONTH, "nightly");
  assert.equal(store.docs.get(`organizations/${ORG}/payChecks/${MONTH}`).items.length, 3, "다시 돌려도 쌓이지 않는다");
  assert.deepEqual(nightlyMonths(new Date("2026-12-10T00:00:00Z")), ["2026-12", "2026-11"], "15일까지는 지난달도");
  assert.deepEqual(nightlyMonths(new Date("2026-12-20T00:00:00Z")), ["2026-12"]);
});

test("못 읽으면 0건이 아니라 점검 미완료 -- 확정도 거절", async () => {
  const store = fake(base(), { failGroup: true });
  const check = await createPayCheckService(deps(store)).check(ORG, MONTH, "manual");
  assert.equal(check.complete, false);
  assert.deepEqual(check.failures.map((item) => item.source).sort(), ["ledger_all", "ledger_month"]);
});

test("확정 직전 재점검: 확인 안 한 차단이 있으면 거절, 확인함(같은 내용)을 남기면 확정 · 대조 기록이 맞는다", async () => {
  const store = fake(base());
  const payCheck = createPayCheckService(deps(store));
  const close = createPayCloseService({ ...deps(store), payCheck });
  await assert.rejects(close.close({ callerUid: "owner", organizationId: ORG, month: MONTH }), (error) => error.reason === "check_blocked" && error.details.openBlocks === 1);
  const blocked = store.docs.get(`organizations/${ORG}/payChecks/${MONTH}`).items.find((item) => item.severity === "block");
  store.docs.set(`organizations/${ORG}/payCheckAcks/${MONTH}__${blocked.key}`, { month: MONTH, key: blocked.key, signature: blocked.signature, reason: "옛 앱에서 처리, 원장 확인", ackedBy: "owner" });
  const result = await close.close({ callerUid: "owner", organizationId: ORG, month: MONTH });
  assert.equal(result.status, "closed");
  const run = store.docs.get(`organizations/${ORG}/payCloseRuns/${MONTH}_r1`);
  assert.equal(run.reconciliation.deducts, 2);
  assert.equal(run.reconciliation.ledgerAmount, 60000);
  assert.equal(run.reconciliation.matched, true);
  assert.deepEqual(run.check, { block: 1, warn: 2, openWarns: 2, ackedBlocks: 1 });
});
