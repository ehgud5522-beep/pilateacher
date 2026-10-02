/**
 * 잔여 점검을 **실제 함수가 쓴 것**으로 견준다.
 *
 * 앞 파일(pass-reconcile.test.js)은 내가 손으로 적은 항목 모양으로 부호를
 * 확인한다. 그것만으로는 부족하다 -- 내가 옮겨 적은 모양이 앱이 실제로 쓰는
 * 모양과 다르면, 테스트는 통과하고 대표 화면은 멀쩡한 회원권을 전부
 * "안 맞음" 으로 세운다.
 *
 * 그래서 여기서는 저장소 함수를 그대로 돌린다. issuePass · deductPass ·
 * correctDeduction · cancelPass · transferPass · transferPassInstructor ·
 * applyPassMigration 이 메모리 저장소에 쓴 문서를 그대로 걷어 점검에 넣는다.
 *
 * ── 특히 이관 ──
 * 이관의 issue 항목은 **총 횟수가 아니라 남은 횟수**를 적는다 (이미 진행한
 * 회차는 옛 엑셀에 있고, 원장으로 옮기면 지난 급여가 두 번 계산된다).
 * 총 횟수를 적었다면 이관된 회원권 전부가 불일치로 떴을 것이다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  cancelPass, correctDeduction, deductPass, issuePass, transferPass, transferPassInstructor,
} from "../../src/data/repositories/pass-repository.js";
import { applyPassMigration } from "../../src/data/repositories/migration-repository.js";
import { RECONCILE_STATE, reconcilePass } from "../../src/features/members/pass-reconcile.js";

const ORG = "center-a";
const AT = new Date(2026, 8, 28, 10, 0, 0);

/** 파이어스토어 흉내. commit 의 네 가지 operation 을 그대로 흉내 낸다. */
function memoryStore() {
  const docs = new Map();
  const apply = (path, data, operation) => {
    const current = docs.get(path) || null;
    if (operation === "decrement") {
      const next = { ...(current || {}) };
      for (const [field, by] of Object.entries(data)) next[field] = (Number(next[field]) || 0) + Number(by);
      docs.set(path, next);
    } else if (operation === "bump") {
      const { delta, ...fields } = data;
      const next = { ...(current || {}), ...fields };
      for (const [field, by] of Object.entries(delta || {})) next[field] = (Number(next[field]) || 0) + Number(by);
      docs.set(path, next);
    } else if (operation === "update") {
      docs.set(path, { ...(current || {}), ...data });
    } else {
      docs.set(path, { ...data });
    }
  };
  return {
    docs,
    exists: async (path) => docs.has(path),
    read: async (path) => (docs.has(path) ? { id: path.split("/").pop(), ...docs.get(path) } : null),
    list: async (prefix) => [...docs.entries()]
      .filter(([key]) => key.startsWith(`${prefix}/`) && !key.slice(prefix.length + 1).includes("/"))
      .map(([key, value]) => ({ id: key.split("/").pop(), ...value })),
    commit: async (writes) => { for (const write of writes) apply(write.path, write.data, write.operation); },
    serverTimestamp: async () => AT,
  };
}

/** 저장소에서 회원권 하나와 그 원장을 걷는다. */
function collect(store, passId) {
  const root = `organizations/${ORG}/passes/${passId}`;
  return {
    pass: { id: passId, ...(store.docs.get(root) || {}) },
    entries: [...store.docs.entries()]
      .filter(([key]) => key.startsWith(`${root}/ledger/`))
      .map(([, value]) => value),
  };
}

const check = (store, passId) => {
  const { pass, entries } = collect(store, passId);
  return { ...reconcilePass(pass, entries), pass, entries };
};

const issueInput = (overrides = {}) => ({
  clientId: "client-a", locationId: "bansong", productId: "product-1",
  payCategory: "pt_1_1_new", sessionType: "pt_1_1",
  totalSessions: 20, serviceSessions: 0, contractPrice: 1200000,
  paymentMethod: "card", purchaseRound: 1, instructorId: "instructor-1",
  expiresAt: new Date(2027, 2, 31), createdBy: "owner-1",
  ...overrides,
});

const deductInput = (overrides = {}) => ({
  instructorId: "instructor-1", createdBy: "owner-1", occurredAt: AT,
  lessonId: "lesson-1", entryId: "entry-1",
  /* 부원장 여부는 단가를 가르므로 차감이 반드시 요구한다 -- 모른 채로
     차감하면 급여가 조용히 틀린다. 점검과는 상관없는 값이라 false 로 둔다. */
  isDeputyDirector: false,
  ...overrides,
});

test("발급한 그대로 점검하면 맞는다 — 서비스 회차 포함", async () => {
  /* **서비스 회차도 잔여에 들어간다.** totalCount = totalSessions +
     serviceSessions 이고 remainingCount 도 원장 delta 도 그 값이다.
     한쪽만 서비스를 빼면 모든 회원권이 서비스 수만큼 어긋난다. */
  const store = memoryStore();
  const { passId } = await issuePass(ORG, issueInput({ totalSessions: 20, serviceSessions: 2 }),
    { store, newId: () => "pass-1" });

  const result = check(store, passId);
  assert.equal(result.pass.remainingCount, 22, "20 + 서비스 2");
  assert.equal(result.ledgerTotal, 22);
  assert.equal(result.state, RECONCILE_STATE.MATCHED);
});

test("차감하고 되돌려도 맞는다", async () => {
  const store = memoryStore();
  await issuePass(ORG, issueInput(), { store, newId: () => "pass-1" });

  let { pass } = collect(store, "pass-1");
  await deductPass(ORG, pass, deductInput(), { store, now: () => AT });
  ({ pass } = collect(store, "pass-1"));
  await deductPass(ORG, pass, deductInput({ lessonId: "lesson-2", entryId: "entry-2" }), { store, now: () => AT });

  let result = check(store, "pass-1");
  assert.equal(result.pass.remainingCount, 18);
  assert.equal(result.state, RECONCILE_STATE.MATCHED);

  /* 되돌리기. 원래 항목을 지목하므로 그 항목을 그대로 넘긴다. */
  ({ pass } = collect(store, "pass-1"));
  const deducted = result.entries.find((row) => row.type === "deduct");
  await correctDeduction(ORG, pass, { ...deducted, id: "entry-2" },
    { reason: "잘못 눌렀습니다", createdBy: "owner-1" }, { store, now: () => AT });

  result = check(store, "pass-1");
  assert.equal(result.pass.remainingCount, 19);
  assert.equal(result.state, RECONCILE_STATE.MATCHED);
});

test("듀엣 회원권도 맞는다 — 수업 한 번에 한 회차다", async () => {
  /* 계약서가 하나이고 회원권도 하나다. 두 사람이 함께 쓰는 30회이고, 수업
     한 번에 1회 차감된다 -- 사람 수만큼 빠지지 않는다. */
  const store = memoryStore();
  await issuePass(ORG, issueInput({
    totalSessions: 30, clientIds: ["client-a", "client-b"], payCategory: "pt_2_1_new",
    sessionType: "pt_2_1",
  }), { store, newId: () => "pass-duet" });

  const { pass } = collect(store, "pass-duet");
  assert.deepEqual(pass.clientIds, ["client-a", "client-b"]);
  await deductPass(ORG, pass, deductInput({
    attendanceByClientId: { "client-a": "attended", "client-b": "attended" },
  }), { store, now: () => AT });

  const result = check(store, "pass-duet");
  assert.equal(result.pass.remainingCount, 29, "두 명이 왔어도 한 회차다");
  assert.equal(result.state, RECONCILE_STATE.MATCHED);
});

test("양도하면 보내는 쪽과 받는 쪽이 각각 맞는다", async () => {
  const store = memoryStore();
  await issuePass(ORG, issueInput(), { store, newId: () => "pass-1" });
  const { pass } = collect(store, "pass-1");

  await transferPass(ORG, pass, {
    toClientId: "client-b", sessions: 5,
    instructorId: "instructor-1", createdBy: "owner-1",
  }, { store, newId: () => "pass-2", now: () => AT });

  const source = check(store, "pass-1");
  assert.equal(source.pass.remainingCount, 15);
  assert.equal(source.state, RECONCILE_STATE.MATCHED);

  const received = check(store, "pass-2");
  assert.equal(received.pass.remainingCount, 5);
  assert.equal(received.state, RECONCILE_STATE.MATCHED, "받은 쪽은 issue 한 줄로 시작한다");
});

test("담당 강사만 바꾸면 회차는 그대로다", async () => {
  const store = memoryStore();
  await issuePass(ORG, issueInput(), { store, newId: () => "pass-1" });
  await transferPassInstructor(ORG, "pass-1", {
    clientId: "client-a", locationId: "bansong",
    fromInstructorId: "instructor-1", toInstructorId: "instructor-2",
    createdBy: "owner-1",
  }, { store, newId: () => "entry-move" });

  const result = check(store, "pass-1");
  assert.equal(result.pass.remainingCount, 20);
  assert.equal(result.state, RECONCILE_STATE.MATCHED);
});

test("취소하면 0 으로 맞는다", async () => {
  /* 취소는 **잘못 발급한 회원권을 무효화**하는 것이라 차감이 남아 있으면
     할 수 없다 (isCancellablePass). 전부 보정한 뒤에는 할 수 있다 -- 두
     경우를 다 본다. */
  const store = memoryStore();
  await issuePass(ORG, issueInput(), { store, newId: () => "pass-1" });
  const { pass, entries } = collect(store, "pass-1");
  await cancelPass(ORG, pass, { reason: "잘못 발급", createdBy: "owner-1", entries },
    { store, now: () => AT });

  const result = check(store, "pass-1");
  assert.equal(result.pass.remainingCount, 0);
  assert.equal(result.pass.status, "cancelled");
  assert.equal(result.state, RECONCILE_STATE.MATCHED);
});

test("차감을 보정한 뒤 취소해도 맞는다", async () => {
  const store = memoryStore();
  await issuePass(ORG, issueInput(), { store, newId: () => "pass-1" });

  let { pass } = collect(store, "pass-1");
  await deductPass(ORG, pass, deductInput(), { store, now: () => AT });

  ({ pass } = collect(store, "pass-1"));
  const deducted = collect(store, "pass-1").entries.find((row) => row.type === "deduct");
  await correctDeduction(ORG, pass, { ...deducted, id: "entry-1" },
    { reason: "잘못 눌렀습니다", createdBy: "owner-1" }, { store, now: () => AT });

  ({ pass } = collect(store, "pass-1"));
  const withIds = [...store.docs.entries()]
    .filter(([key]) => key.includes("/passes/pass-1/ledger/"))
    .map(([key, value]) => ({ id: key.split("/").pop(), ...value }));
  await cancelPass(ORG, pass, { reason: "환불", createdBy: "owner-1", entries: withIds },
    { store, now: () => AT });

  const result = check(store, "pass-1");
  assert.equal(result.pass.remainingCount, 0);
  assert.equal(result.state, RECONCILE_STATE.MATCHED, "발급 +20, 차감 -1, 보정 +1, 취소 -20");
});

test("엑셀 이관 회원권도 맞는다 — issue 가 남은 횟수다", async () => {
  /* **여기가 가장 조마조마한 자리다.** 이관의 issue 항목이 총 횟수였다면
     이관된 회원권 전부가 "이미 진행한 회차" 만큼 불일치로 떴을 것이다 --
     첫 점검에서 수백 건이 빨갛게 뜨고, 대표는 장부가 깨진 줄 안다.

     실제로는 남은 횟수를 적는다. 그래야 지난 급여가 두 번 계산되지 않는다. */
  const store = memoryStore();
  await applyPassMigration(ORG, [{
    passId: "pass-migrated",
    clientId: "client-a",
    instructorId: "instructor-1",
    priorSessions: 12,
    pass: {
      clientId: "client-a", locationId: "bansong", productId: "product-1",
      category: "pt_1_1_new", totalSessions: 30, serviceSessions: 0,
      contractPrice: 1800000, paymentMethod: "card", purchaseRound: 1,
      remainingCount: 18, baseUnitPrice: 60000, instructorId: "instructor-1",
      status: "active", expiresAt: new Date(2027, 2, 31), createdBy: "owner-1",
      handedOver: false,
    },
  }], { store });

  const result = check(store, "pass-migrated");
  assert.equal(result.pass.totalSessions, 30, "계약은 30회다");
  assert.equal(result.pass.remainingCount, 18, "그중 18회가 남았다");
  assert.equal(result.ledgerTotal, 18, "원장에는 남은 18회만 적는다");
  assert.equal(result.state, RECONCILE_STATE.MATCHED);

  /* 이관한 뒤 수업을 해도 계속 맞는다. */
  const { pass } = collect(store, "pass-migrated");
  await deductPass(ORG, pass, deductInput(), { store, now: () => AT });
  const after = check(store, "pass-migrated");
  assert.equal(after.pass.remainingCount, 17);
  assert.equal(after.state, RECONCILE_STATE.MATCHED);
});

test("이관 회원권을 총 횟수로 세면 안 맞는다 — 왜 남은 횟수인지", async () => {
  /* 반대 방향으로도 못 박는다. 누가 "발급이면 총 횟수가 맞지" 하고 고치면
     이관된 회원권 전부가 이미 진행한 회차만큼 어긋난다. */
  const migrated = { id: "p", clientId: "c", remainingCount: 18 };
  const asTotal = [{ type: "issue", delta: 30 }];
  const wrong = reconcilePass(migrated, asTotal);
  assert.equal(wrong.state, RECONCILE_STATE.MISMATCHED);
  assert.equal(wrong.difference, -12, "이미 진행한 12회만큼 어긋난다");
});
