import assert from "node:assert/strict";
import test from "node:test";

import { issuePass, transferPass } from "../../src/data/repositories/pass-repository.js";
import { TRANSFER_BLOCK } from "../../src/data/schema/pass-transfer.js";
import { netContractPriceFor } from "../../src/data/schema/deduction-pricing.js";

/**
 * 회원권 양도가 실제로 쓰는 네 문서.
 *
 * 원본의 잔여, 원본의 원장(어디로 갔는가), 새 회원권, 새 회원권의 발급 항목.
 * 하나라도 빠지면 회차가 증발하거나 근거 없이 생기고, 원장은 append-only 라
 * 어느 쪽도 나중에 고칠 수 없다.
 */

const storeWith = () => {
  const writes = [];
  return {
    writes,
    list: async () => [],
    read: async () => null,
    commit: async (list) => { for (const write of list) writes.push(write); },
    serverTimestamp: async () => "SERVER_TIME",
  };
};

const source = (overrides = {}) => ({
  id: "pass-1", organizationId: "center-a", clientId: "client-a",
  locationId: "bansong", productId: "product-1", category: "pt_1_1_repurchase_event",
  status: "active", totalSessions: 20, serviceSessions: 2, serviceUsed: 0,
  remainingCount: 22, contractPrice: 1300000, paymentMethod: "card",
  netContractPrice: netContractPriceFor(1300000, "card"),
  expiresAt: new Date(2027, 0, 31), instructorId: "u-source",
  ...overrides,
});

const run = (store, overrides = {}) => transferPass("center-a", source(overrides.pass), {
  toClientId: "client-b", sessions: 5, instructorId: "u-target", createdBy: "owner-a",
  purchaseRound: 1, ...overrides.input,
}, { store, newId: () => "pass-new" });

const byPath = (store, suffix) => store.writes.find((write) => write.path.endsWith(suffix));

/* ── 네 문서 ─────────────────────────────────────────────────────────── */

test("한 배치에 네 문서를 쓴다", async () => {
  const store = storeWith();
  await run(store);
  assert.deepEqual(store.writes.map((write) => write.path), [
    "organizations/center-a/passes/pass-1",
    "organizations/center-a/passes/pass-1/ledger/pass-new_handover",
    "organizations/center-a/passes/pass-new",
    "organizations/center-a/passes/pass-new/ledger/pass-new_issue",
  ]);
});

test("원본은 읽어서 빼지 않고 서버가 더한다", async () => {
  /* 같은 회원권에 차감과 양도가 겹쳐도 한쪽이 다른 쪽을 덮어쓰지 않는다. */
  const store = storeWith();
  await run(store);
  const update = byPath(store, "passes/pass-1");
  assert.equal(update.operation, "decrement");
  assert.deepEqual(update.data, { remainingCount: -5 });
});

test("나간 회차가 어디로 갔는지 원장에 남는다", async () => {
  /* 이것이 없으면 회차가 줄어든 사실만 남고 그 회차가 어디로 갔는지는 아무도
     모른다 -- 회원이 물을 때 답할 것이 없다. */
  const store = storeWith();
  await run(store);
  const entry = byPath(store, "ledger/pass-new_handover").data;
  assert.equal(entry.type, "handover");
  assert.equal(entry.delta, -5);
  assert.equal(entry.toPassId, "pass-new");
  assert.equal(entry.toClientId, "client-b");
  assert.equal(entry.clientId, "client-a", "항목은 원본 회원의 것이다");
  assert.equal(entry.passId, "pass-1");
});

test("양도 항목에는 단가도 카테고리도 없다", async () => {
  /* 수업이 일어나지 않았으므로 급여가 나가지 않는다. 필수 목록을 채우자고
     지어내면 급여가 그 허구를 카테고리별로 묶어 센다. */
  const store = storeWith();
  await run(store);
  const entry = byPath(store, "ledger/pass-new_handover").data;
  for (const field of ["category", "unitPrice", "lessonId", "correctsEntryId", "reason"]) {
    assert.equal(field in entry, false, `${field} 가 양도 항목에 있다`);
  }
});

/* ── 받는 회원권 ─────────────────────────────────────────────────────── */

test("받는 회원권은 언제나 1:1 신규다", async () => {
  /* 원본의 분류(이벤트 재등록 같은 것)는 그 회원이 그때 받은 조건이지 이
     회원의 조건이 아니다. */
  const store = storeWith();
  await run(store);
  const pass = byPath(store, "passes/pass-new").data;
  assert.equal(pass.category, "pt_1_1_new");
  assert.equal(byPath(store, "ledger/pass-new_issue").data.category, "pt_1_1_new");
});

test("넘겨받은 회원권으로 표시하지 않는다", async () => {
  /* handedOver 는 담당 강사를 넘겨받았다는 뜻이다. 회원이 회원에게 회차를
     넘긴 것이라 인수인계 단가(판정 2)를 태울 이유가 없다. */
  const store = storeWith();
  await run(store);
  assert.equal(byPath(store, "passes/pass-new").data.handedOver, false);
});

test("서비스 회차는 따라가지 않는다", async () => {
  const store = storeWith();
  await run(store);
  const pass = byPath(store, "passes/pass-new").data;
  assert.equal(pass.serviceSessions, 0);
  assert.equal(pass.serviceUsed, 0);
  assert.equal(pass.totalSessions, 5);
  assert.equal(pass.remainingCount, 5);
});

test("만료일은 원본 그대로다", async () => {
  // 넘겼다고 기한이 늘어나지 않는다 (확정 8번).
  const store = storeWith();
  await run(store);
  assert.deepEqual(byPath(store, "passes/pass-new").data.expiresAt, new Date(2027, 0, 31));
});

test("받는 회원 한 사람만 적힌다", async () => {
  const store = storeWith();
  await run(store);
  const pass = byPath(store, "passes/pass-new").data;
  assert.equal(pass.clientId, "client-b");
  assert.deepEqual(pass.clientIds, ["client-b"]);
  assert.equal(pass.instructorId, "u-target", "받는 회원의 강사다");
});

test("금액은 부원장 단가가 같아지도록 정해진다", async () => {
  const store = storeWith();
  const result = await run(store);
  const pass = byPath(store, "passes/pass-new").data;
  assert.equal(pass.contractPrice, 324999);
  assert.equal(pass.paymentMethod, "card");
  assert.equal(result.pricing.deputyUnitPrice, result.pricing.sourceDeputyUnitPrice);
});

test("발급과 같은 필드를 쓴다", async () => {
  /* 규칙의 hasAll 목록이 둘을 같이 본다. 한쪽에만 필드가 늘면 다른 쪽이 어느
     날 거부되는데, 그날 거부되는 것은 양도다. */
  const transferStore = storeWith();
  await run(transferStore);
  const issueStore = storeWith();
  await issuePass("center-a", {
    clientId: "client-b", locationId: "bansong", productId: "product-1",
    payCategory: "pt_1_1_new", totalSessions: 5, contractPrice: 324999,
    instructorId: "u-target", createdBy: "owner-a", expiresAt: new Date(2027, 0, 31),
  }, { store: issueStore, newId: () => "pass-issued" });

  const transferred = byPath(transferStore, "passes/pass-new").data;
  const issued = byPath(issueStore, "passes/pass-issued").data;
  assert.deepEqual(Object.keys(transferred).sort(), Object.keys(issued).sort());
});

/* ── 막히는 자리 ─────────────────────────────────────────────────────── */

test("막히면 코드와 함께 멈춘다", async () => {
  const store = storeWith();
  await assert.rejects(
    () => run(store, { pass: { clientIds: ["client-a", "client-b"] } }),
    (error) => {
      assert.equal(error.code, TRANSFER_BLOCK.DUET);
      return true;
    },
  );
  assert.deepEqual(store.writes, [], "막혔는데 무언가 쓰였다");
});

test("회차가 모자라면 몇 회까지 되는지 함께 말한다", async () => {
  const store = storeWith();
  await assert.rejects(
    () => run(store, { input: { sessions: 21 } }),
    (error) => {
      assert.equal(error.code, TRANSFER_BLOCK.TOO_MANY);
      assert.equal(error.limit, 20);
      return true;
    },
  );
});

test("누가 넘기는지 모르면 쓰지 않는다", async () => {
  const store = storeWith();
  await assert.rejects(() => run(store, { input: { createdBy: "" } }), /createdBy/);
  await assert.rejects(() => run(store, { input: { instructorId: "" } }), /instructorId/);
  assert.deepEqual(store.writes, []);
});

test("만료일을 읽을 수 없으면 쓰지 않는다", async () => {
  const store = storeWith();
  await assert.rejects(() => run(store, { pass: { expiresAt: "언젠가" } }), /expiresAt/);
  assert.deepEqual(store.writes, []);
});
