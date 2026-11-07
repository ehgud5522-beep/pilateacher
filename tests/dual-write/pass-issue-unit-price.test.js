/* 발급 화면에서 강사 기준 단가를 직접 정한다 (2026-11-07 대표 결정).

   1. 지점마다 단가가 다르다 -- 표 · 풀방금액 · 상품 단가는 제안값이다.
   2. 직접 넣은 값은 기준값(baseUnitPrice)만 바꾼다. 부원장 5:5 · 인수인계
      25,000 · 이 강사에게 20회 미만 신규 단가는 차감할 때 그대로 위에 선다.
      부원장은 20회 미만 판정에 걸리지 않는다.
   3. 정할 수 있는 사람은 대표 · 총괄매니저 · FC매니저다.
   누가 · 무엇을 · 왜 바꿨는지 회원권 문서에 남는다. */

import assert from "node:assert/strict";
import test from "node:test";
import { PAY_CATEGORY } from "../../src/data/schema/constants.js";
import {
  ISSUE_UNIT_PRICE_SOURCE, UNIT_PRICE_EDITOR_ROLES, canSetUnitPrice, resolveIssueUnitPrice,
  standardIssueUnitPrice,
} from "../../src/data/schema/pay-rates.js";
import { PRICING_RULE, resolveDeductionUnitPrice } from "../../src/data/schema/deduction-pricing.js";
import { issuePass } from "../../src/data/repositories/pass-repository.js";

const ORG = "center-a";

function fakeStore() {
  const calls = { commit: [] };
  return {
    calls,
    list: async () => [],
    read: async () => null,
    commit: async (writes) => { calls.commit.push(writes); },
    serverTimestamp: async () => "SERVER_TIME",
  };
}

const issueInput = (overrides = {}) => ({
  clientId: "client-a",
  expiresAt: new Date(2027, 2, 31),
  locationId: "yangsan",
  productId: "product-a",
  payCategory: PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT,
  totalSessions: 20,
  contractPrice: 1300000,
  paymentMethod: "cash",
  instructorId: "instructor-a",
  createdBy: "manager-a",
  issuerRole: "manager",
  ...overrides,
});

/* ── 누가 정할 수 있는가 ─────────────────────────────────────────────── */

test("owner, area manager and FC manager may set the unit price; nobody else", () => {
  assert.deepEqual([...UNIT_PRICE_EDITOR_ROLES].sort(), ["area_manager", "manager", "owner"]);
  for (const role of ["owner", "area_manager", "manager"]) assert.equal(canSetUnitPrice(role), true, role);
  for (const role of ["instructor", "staff", "member", "", undefined]) {
    assert.equal(canSetUnitPrice(role), false, String(role));
  }
});

test("a typed unit price from a role that may not set it is refused before anything is written", async () => {
  for (const role of ["instructor", "staff", "", undefined]) {
    const store = fakeStore();
    await assert.rejects(
      () => issuePass(ORG, issueInput({ issuerRole: role, manualUnitPrice: 33000, unitPriceReason: "지점 단가" }), { store }),
      /Forbidden manualUnitPrice/, String(role),
    );
    assert.equal(store.calls.commit.length, 0);
  }
});

/* ── 제안값 ──────────────────────────────────────────────────────────── */

test("the suggestion comes from the table, the full-room rate or the product", () => {
  assert.deepEqual(standardIssueUnitPrice(PAY_CATEGORY.PT_1_1_NEW), { value: 25000, source: "table" });
  assert.deepEqual(
    standardIssueUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, { fullRoomRate: 45000 }),
    { value: 45000, source: "full_room_rate" },
  );
  assert.deepEqual(
    standardIssueUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, { fullRoomRate: 0 }),
    { value: null, source: "full_room_rate" },
    "0 은 풀방금액이 없는 것이다",
  );
  assert.deepEqual(standardIssueUnitPrice(PAY_CATEGORY.ETC, { productUnitPrice: 28000 }), { value: 28000, source: "product" });
  assert.deepEqual(standardIssueUnitPrice(PAY_CATEGORY.ETC), { value: null, source: "product" });
});

test("leaving the field empty issues the suggestion, as before", async () => {
  const { pass, entry } = await issuePass(ORG, issueInput(), { store: fakeStore() });
  assert.equal(pass.baseUnitPrice, 30000);
  assert.equal(entry.unitPrice, 30000);
  assert.equal(pass.unitPriceSource, "table");
  assert.equal(pass.standardUnitPrice, 30000);
  assert.equal(pass.unitPriceReason, undefined);
});

/* ── 직접 정한 값 ────────────────────────────────────────────────────── */

test("a typed price replaces the table value and records what, who and why", async () => {
  const { pass, entry } = await issuePass(ORG, issueInput({
    manualUnitPrice: 33000, unitPriceReason: "  양산점 단가  ",
  }), { store: fakeStore() });
  assert.equal(pass.baseUnitPrice, 33000, "기준값이 바뀐다");
  assert.equal(entry.unitPrice, 33000, "발급 항목도 같은 값");
  assert.equal(pass.unitPriceSource, ISSUE_UNIT_PRICE_SOURCE.MANUAL);
  assert.equal(pass.standardUnitPrice, 30000, "원래 제안값이 남는다");
  assert.equal(pass.unitPriceReason, "양산점 단가");
  assert.equal(pass.createdBy, "manager-a", "누가는 createdBy");
});

test("changing the suggestion needs a reason", async () => {
  const store = fakeStore();
  await assert.rejects(
    () => issuePass(ORG, issueInput({ manualUnitPrice: 33000, unitPriceReason: "   " }), { store }),
    /Missing unitPriceReason/,
  );
  assert.equal(store.calls.commit.length, 0);
});

test("typing the suggestion itself is not a change", () => {
  const found = resolveIssueUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT, {
    manualUnitPrice: "30000", issuerRole: "owner",
  });
  assert.deepEqual(found, { unitPrice: 30000, source: "table", standardUnitPrice: 30000, reason: "" });
});

test("zero, negatives and fractions are refused -- a zero rate makes the lessons unpaid", () => {
  for (const bad of [0, "0", -1, 2500.5, "abc"]) {
    assert.throws(
      () => resolveIssueUnitPrice(PAY_CATEGORY.PT_1_1_NEW, { manualUnitPrice: bad, issuerRole: "owner", unitPriceReason: "x" }),
      /Invalid manualUnitPrice/, String(bad),
    );
  }
});

test("without a suggestion the typed price needs no reason", async () => {
  /* 풀방금액이 없는 강사 · 회당 단가가 없는 옛 기타 상품. 적는 것 자체가 답이다. */
  const repurchase = await issuePass(ORG, issueInput({
    payCategory: PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, manualUnitPrice: 42000,
  }), { store: fakeStore() });
  assert.equal(repurchase.pass.baseUnitPrice, 42000);
  assert.equal(repurchase.pass.unitPriceSource, "manual");
  assert.equal(repurchase.pass.standardUnitPrice, undefined);

  const etc = await issuePass(ORG, issueInput({ payCategory: PAY_CATEGORY.ETC, manualUnitPrice: 31000 }), { store: fakeStore() });
  assert.equal(etc.pass.baseUnitPrice, 31000);
});

test("the full-room rate is still required when nothing is typed", async () => {
  await assert.rejects(
    () => issuePass(ORG, issueInput({ payCategory: PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL }), { store: fakeStore() }),
    /Missing fullRoomRate/,
  );
});

/* ── 차감: 기준값만 바뀌고 판정은 그대로 ───────────────────────────────── */

const deduct = (overrides = {}) => resolveDeductionUnitPrice({
  category: PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT,
  baseUnitPrice: 33000,
  netContractPrice: 1300000,
  totalSessions: 20,
  isDeputyDirector: false,
  handedOver: false,
  priorSessions: 25,
  serviceUsedCount: 0,
  ...overrides,
});

test("past twenty sessions with this instructor, the typed base price is what is paid", () => {
  assert.deepEqual(deduct(), { unitPrice: 33000, rule: PRICING_RULE.BASE_CATEGORY });
});

test("under twenty sessions the new-to-instructor rate still wins over the typed price", () => {
  assert.deepEqual(deduct({ priorSessions: 3 }), { unitPrice: 25000, rule: PRICING_RULE.NEW_TO_INSTRUCTOR });
});

test("a handed-over pass still pays the handover rate", () => {
  assert.deepEqual(deduct({ handedOver: true }), { unitPrice: 25000, rule: PRICING_RULE.HANDED_OVER });
});

test("a deputy director is paid 5:5 and is not caught by the twenty-session rule", () => {
  /* 대표 결정 2: 부원장은 신규 20회 미만에서 제외. 판정 1 이 맨 앞이라 누적이
     몇이든, 기준값이 무엇이든 공급가액 ÷ 회차 ÷ 2 다. */
  for (const priorSessions of [0, 5, 19, 25]) {
    const found = deduct({ isDeputyDirector: true, priorSessions });
    assert.equal(found.rule, PRICING_RULE.DEPUTY_DIRECTOR, String(priorSessions));
    assert.equal(found.unitPrice, 32500, "1,300,000 ÷ 20 ÷ 2");
  }
});
