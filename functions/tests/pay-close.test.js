"use strict";

/* 서버 급여 확정 (2026-11-22 외부 검토 2차): 서버가 다시 계산 · 대표가 본 합계와 대조 · 회차 이력 · 대표급만. */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createPayCloseService } = require("../src/pay-close");

function fake(seed) {
  const docs = new Map(Object.entries(seed));
  const snap = (path) => ({ id: path.split("/").pop(), path, exists: docs.has(path), data: () => docs.get(path) });
  const match = (data, [field, op, value]) => {
    const actual = data?.[field];
    const time = (item) => (item instanceof Date ? item.getTime() : item);
    if (op === "==") return actual === value;
    if (op === "in") return value.includes(actual);
    if (op === ">=") return time(actual) >= time(value);
    if (op === "<") return time(actual) < time(value);
    return false;
  };
  const query = (pick, filters) => ({
    where: (field, op, value) => query(pick, [...filters, [field, op, value]]),
    get: async () => {
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
  return { docs, doc: docRef, collection: collectionRef, collectionGroup: (name) => query((key) => key.split("/").slice(-2)[0] === name, []), runTransaction };
}

const ORG = "o1";
const MONTH = "2026-11";
const member = (userId, role, extra = {}) => ({ organizationId: ORG, userId, role, status: "active", ...extra });
const ledger = (id, instructorId, unitPrice, extra = {}) => [`organizations/${ORG}/passes/p1/ledger/${id}`, {
  organizationId: ORG, instructorId, type: "deduct", delta: -1, unitPrice, clientId: "c1", occurredAt: new Date("2026-11-10T03:00:00Z"), ...extra,
}];
const base = (extra = {}) => ({
  "memberships/o1_owner": member("owner", "owner"),
  "memberships/o1_fc": member("fc", "manager"),
  "memberships/o1_t1": member("t1", "instructor"),
  "memberships/o1_t2": member("t2", "instructor", { previousUids: ["t2-old"] }),
  ...Object.fromEntries([
    ledger("a", "t1", 30000), ledger("b", "t1", 30000), ledger("c", "t2-old", 45000),
    ledger("d", "t1", 30000, { delta: 1, type: "correction" }),
    ledger("demo", "t1", 99999, { clientId: "demo" }),
    ledger("oct", "t1", 77777, { occurredAt: new Date("2026-10-31T14:59:00Z") }),
  ]),
  [`organizations/${ORG}/clients/demo`]: { reviewDemo: true },
  [`organizations/${ORG}/groupPayroll/${MONTH}/locations/bansong`]: { rows: [{ instructorId: "t2", fullCount: 2, fullRate: 20000, emptyCount: 1 }] },
  [`organizations/${ORG}/salesMonths/t1_${MONTH}`]: { instructorId: "t1", month: MONTH, status: "confirmed", snapshot: { total: 5000000, bracketAmount: 250000, otBonus: 0, groupBase: 0, groupBonus: 0, clawbackTotal: 0, payout: 250000 } },
  [`organizations/${ORG}/payAdjustments/adj1`]: { instructorId: "t1", month: MONTH, amount: -30000, reason: "중복" },
  [`organizations/${ORG}/payAdjustments/adj2`]: { instructorId: "t1", month: MONTH, amount: -99999, reason: "잘못 넣음", canceledAt: new Date(), cancelReason: "취소" },
  [`organizations/${ORG}/payrollSettings/tax`]: { noTaxIds: ["t2"] },
  ...extra,
});
const close = (store, callerUid, expectedNet) => createPayCloseService({
  firestore: store, membershipId: (org, uid) => `${org}_${uid}`, isOwnerLevel: (row) => ["owner", "area_manager"].includes(row?.role), now: () => new Date("2026-12-01T00:00:00Z"),
}).close({ callerUid, organizationId: ORG, month: MONTH, expectedNet });

test("서버가 원자료로 다시 센다: 차감 − 보정 · 심사용 회원 · 지난달(한국 시각) 제외 · 옛 계정 합치기 · 그룹 · 인센 · 조정(취소 제외) · 세금", async () => {
  const store = fake(base());
  /* t1: 30,000 × 2 − 30,000 = 30,000 + 인센 250,000 − 30,000 = 250,000 → 3.3% 8,250 → 241,750
     t2: 45,000(옛 계정) + 그룹 2 × 20,000 + 25,000 = 110,000, 공제 없음 → 110,000 */
  const result = await close(store, "owner", 351750);
  assert.equal(result.revision, 1);
  assert.deepEqual(result.totals, { gross: 360000, tax: 8250, net: 351750, instructors: 2 });
  const t1 = store.docs.get(`organizations/${ORG}/payStatements/t1_${MONTH}`);
  assert.deepEqual({ lessons: t1.lessons, extras: t1.extras, adjustTotal: t1.adjustTotal, net: t1.net, revision: t1.revision }, { lessons: 30000, extras: 250000, adjustTotal: -30000, net: 241750, revision: 1 });
  assert.equal(store.docs.get(`organizations/${ORG}/payStatements/t2_${MONTH}`).taxType, "none");
  assert.equal(store.docs.get(`organizations/${ORG}/payMonths/${MONTH}`).status, "closed");
  const run = store.docs.get(`organizations/${ORG}/payCloseRuns/${MONTH}_r1`);
  assert.equal(run.statements.t1.net, 241750);
  assert.equal(run.previous, null);
});

test("대표가 본 합계와 서버 계산이 다르면 거절 · FC · 강사는 못 함 · 이미 확정된 달은 거절 · 되돌린 뒤에는 회차가 오른다", async () => {
  await assert.rejects(close(fake(base()), "owner", 999), (error) => error.reason === "totals_changed" && error.details.serverNet === 351750);
  await assert.rejects(close(fake(base()), "fc", 351750), (error) => error.reason === "not_closer");
  await assert.rejects(close(fake(base()), "t1", 351750), (error) => error.reason === "not_closer");
  await assert.rejects(close(fake(base({ [`organizations/${ORG}/payMonths/${MONTH}`]: { status: "paid", revision: 1 } })), "owner", 351750), (error) => error.reason === "already_closed");
  const reopened = fake(base({ [`organizations/${ORG}/payMonths/${MONTH}`]: { status: "reopened", revision: 1, reopenReason: "조정 추가" } }));
  const result = await close(reopened, "owner", 351750);
  assert.equal(result.revision, 2);
  assert.deepEqual(reopened.docs.get(`organizations/${ORG}/payCloseRuns/${MONTH}_r2`).previous, { status: "reopened", revision: 1, reopenReason: "조정 추가" });
});
