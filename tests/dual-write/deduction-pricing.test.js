import assert from "node:assert/strict";
import test from "node:test";
import {
  NEW_TO_INSTRUCTOR_THRESHOLD, NEW_TO_INSTRUCTOR_UNIT_PRICE, PRICING_RULE,
  deputyDirectorUnitPrice, resolveDeductionUnitPrice,
} from "../../src/data/schema/deduction-pricing.js";
import { PAY_RATES } from "../../src/data/schema/pay-rates.js";

/** 1:1 재등록(이벤트) 회원권. 판정 4 가 걸리면 30,000 이다. */
const pass = (overrides = {}) => ({
  category: "pt_1_1_repurchase_event",
  baseUnitPrice: 30000,
  contractPrice: 2100000,
  totalSessions: 30,
  isDeputyDirector: false,
  handedOver: false,
  priorSessions: 99,
  serviceUsedCount: 0,
  ...overrides,
});

const priceOf = (overrides) => resolveDeductionUnitPrice(pass(overrides));

/* ── 판정 4. 아무것도 걸리지 않으면 기준값 ───────────────────────────── */

test("a seasoned instructor on their own pass gets the base rate", () => {
  const result = priceOf({});
  assert.equal(result.unitPrice, 30000);
  assert.equal(result.rule, PRICING_RULE.BASE_CATEGORY);
});

test("the base rate is whatever was frozen at issue, not the table", () => {
  /* 표가 바뀐 뒤에 지난 회원권을 차감해도 그때 팔린 조건으로 계산돼야 한다. */
  const stale = PAY_RATES.pt_1_1_repurchase_event - 5000;
  assert.equal(priceOf({ baseUnitPrice: stale }).unitPrice, stale);
});

test("a missing base rate is refused rather than paid as zero", () => {
  for (const bad of [undefined, null, "30000", -1, 1.5]) {
    assert.throws(() => priceOf({ baseUnitPrice: bad }), /Invalid baseUnitPrice/, JSON.stringify(bad));
  }
});

/* ── 판정 3. 이 강사에게 이 회원 누적 20회 미만 ──────────────────────── */

test("the twentieth lesson with an instructor is still the new rate", () => {
  // 누적 19회 상태에서 20회째를 한다.
  const result = priceOf({ priorSessions: 19 });
  assert.equal(result.unitPrice, NEW_TO_INSTRUCTOR_UNIT_PRICE);
  assert.equal(result.rule, PRICING_RULE.NEW_TO_INSTRUCTOR);
});

test("the twenty-first lesson moves to the base rate", () => {
  assert.equal(priceOf({ priorSessions: 20 }).unitPrice, 30000);
  assert.equal(priceOf({ priorSessions: 20 }).rule, PRICING_RULE.BASE_CATEGORY);
});

test("one pass can pay two different rates as the count crosses", () => {
  /* 확정본의 예시: A 기준 누적 10회인 회원이 30회 재등록.
     다음 10회는 25,000, 그 뒤 20회는 기준 단가. */
  const rates = [];
  for (let prior = 10; prior < 40; prior += 1) rates.push(priceOf({ priorSessions: prior }).unitPrice);
  assert.deepEqual(rates.slice(0, 10), Array(10).fill(25000), "11~20회째");
  assert.deepEqual(rates.slice(10), Array(20).fill(30000), "21~40회째");
});

test("the count is per instructor-client pair, whatever the category", () => {
  // 2:1 재등록 상품(35,000)이라도 그 강사에게 19회째면 25,000 이다.
  const twoOnOne = { category: "pt_2_1_repurchase", baseUnitPrice: 35000 };
  assert.equal(priceOf({ ...twoOnOne, priorSessions: 19 }).unitPrice, 25000);
  assert.equal(priceOf({ ...twoOnOne, priorSessions: 20 }).unitPrice, 35000);
});

test("a missing or nonsense count is read as nobody has taught them yet", () => {
  // 모르면 신규로 본다. 반대로 두면 처음 온 회원이 기준 단가를 받는다.
  for (const unknown of [undefined, null, "19", -1]) {
    assert.equal(priceOf({ priorSessions: unknown }).unitPrice, 25000, JSON.stringify(unknown));
  }
});

test("the threshold is the number the spec fixed", () => {
  assert.equal(NEW_TO_INSTRUCTOR_THRESHOLD, 20);
  assert.equal(NEW_TO_INSTRUCTOR_UNIT_PRICE, 25000);
});

/* ── 판정 2. 인수인계 ─────────────────────────────────────────────────── */

test("a handed-over pass pays the new rate however long it runs", () => {
  const result = priceOf({ handedOver: true, priorSessions: 999 });
  assert.equal(result.unitPrice, NEW_TO_INSTRUCTOR_UNIT_PRICE);
  assert.equal(result.rule, PRICING_RULE.HANDED_OVER);
});

test("a hand-over beats the accumulated count, not the other way round", () => {
  // A→B→C 로 두 번 넘어가도 C 역시 25,000 이다.
  assert.equal(priceOf({ handedOver: true, priorSessions: 0 }).rule, PRICING_RULE.HANDED_OVER);
  assert.equal(priceOf({ handedOver: true, priorSessions: 100 }).rule, PRICING_RULE.HANDED_OVER);
});

/* ── 판정 1. 부원장 ───────────────────────────────────────────────────── */

test("a deputy director always splits the contract in half", () => {
  // 확정본의 예시: 30회 210만원 → 회당 70,000 → 부원장 35,000
  const result = priceOf({ isDeputyDirector: true });
  assert.equal(result.unitPrice, 35000);
  assert.equal(result.rule, PRICING_RULE.DEPUTY_DIRECTOR);
});

test("the deputy's divisor excludes service sessions", () => {
  /* 부원장에게는 서비스 세션이 없다. 분모에 더하면 있지도 않은 회차로 나눠
     단가가 낮아진다. 30+2 회원권이어도 분모는 30 이다. */
  const withService = pass({ isDeputyDirector: true, totalSessions: 30, serviceSessions: 2 });
  assert.equal(resolveDeductionUnitPrice(withService).unitPrice, 35000);
  assert.notEqual(resolveDeductionUnitPrice(withService).unitPrice, Math.round(2100000 / 32 / 2));
});

test("an uneven contract rounds to the won", () => {
  assert.equal(deputyDirectorUnitPrice({ contractPrice: 2100000, totalSessions: 32 }), 32813);
  assert.equal(deputyDirectorUnitPrice({ contractPrice: 1000000, totalSessions: 3 }), 166667);
});

test("the deputy rate ignores the count, the hand-over and the category", () => {
  /* 확정된 대우다. 신규 단가보다 높아지는 경우가 생기는 것이 의도다. */
  const asDeputy = { isDeputyDirector: true };
  assert.equal(priceOf({ ...asDeputy, priorSessions: 0 }).rule, PRICING_RULE.DEPUTY_DIRECTOR);
  assert.equal(priceOf({ ...asDeputy, handedOver: true }).rule, PRICING_RULE.DEPUTY_DIRECTOR);
  assert.equal(
    priceOf({ ...asDeputy, category: "pt_1_1_new", baseUnitPrice: 25000 }).unitPrice,
    35000,
    "신규 상품이어도 5:5 이고, 25,000 보다 높다",
  );
});

test("a deputy pass without a contract or sessions is refused", () => {
  // 0 으로 나누거나 0원을 지급하는 대신 막는다.
  assert.throws(() => priceOf({ isDeputyDirector: true, totalSessions: 0 }), /Invalid totalSessions/);
  assert.throws(() => priceOf({ isDeputyDirector: true, totalSessions: undefined }), /Invalid totalSessions/);
  assert.throws(() => priceOf({ isDeputyDirector: true, contractPrice: undefined }), /Invalid contractPrice/);
});

/* ── 판정 0. 서비스는 회원권당 한 번만 급여가 나간다 ──────────────────── */

const servicePass = (overrides = {}) => pass({
  category: "service", baseUnitPrice: 10000, ...overrides,
});

test("the first service session of a pass pays, the rest do not", () => {
  /* 서비스를 몇 회 붙였든 센터가 내는 것은 1회분이다. 두 번째부터는 강사
     봉사이고, 잔여 횟수는 그대로 줄어든다 -- 급여만 0 이다. */
  assert.equal(resolveDeductionUnitPrice(servicePass({ serviceUsedCount: 0 })).unitPrice, 10000);
  const second = resolveDeductionUnitPrice(servicePass({ serviceUsedCount: 1 }));
  assert.equal(second.unitPrice, 0);
  assert.equal(second.rule, PRICING_RULE.SERVICE_ALREADY_USED);
  assert.equal(resolveDeductionUnitPrice(servicePass({ serviceUsedCount: 2 })).unitPrice, 0);
});

test("a used service session does not zero out the other categories", () => {
  /* 카테고리를 보지 않고 판정 0 을 앞에 세우면, 서비스를 한 번 쓴 회원권의
     1:1 수업까지 0원이 된다. */
  assert.equal(priceOf({ serviceUsedCount: 3 }).unitPrice, 30000);
  assert.equal(priceOf({ serviceUsedCount: 3, priorSessions: 5 }).unitPrice, 25000);
  assert.equal(priceOf({ serviceUsedCount: 3, handedOver: true }).unitPrice, 25000);
});

test("the first service session still follows the rest of the order", () => {
  // 판정 0 이 걸리지 않으면 아래 판정이 그대로 이어진다.
  assert.equal(resolveDeductionUnitPrice(servicePass({ priorSessions: 5 })).rule, PRICING_RULE.NEW_TO_INSTRUCTOR);
  assert.equal(resolveDeductionUnitPrice(servicePass({ priorSessions: 5 })).unitPrice, 25000);
  assert.equal(resolveDeductionUnitPrice(servicePass({ handedOver: true })).unitPrice, 25000);
});

test("a second service session is zero even for a seasoned instructor", () => {
  assert.equal(resolveDeductionUnitPrice(servicePass({ serviceUsedCount: 1, priorSessions: 0 })).unitPrice, 0);
  assert.equal(resolveDeductionUnitPrice(servicePass({ serviceUsedCount: 1, handedOver: true })).unitPrice, 0);
});

/* ── 순서 그 자체 ─────────────────────────────────────────────────────── */

test("each rule beats the ones below it", () => {
  // 전부 걸리게 해 두고 하나씩 꺼 가며 무엇이 이기는지 본다.
  const everything = servicePass({
    serviceUsedCount: 1, isDeputyDirector: true, handedOver: true, priorSessions: 0,
  });
  assert.equal(resolveDeductionUnitPrice(everything).rule, PRICING_RULE.SERVICE_ALREADY_USED);
  assert.equal(
    resolveDeductionUnitPrice({ ...everything, serviceUsedCount: 0 }).rule,
    PRICING_RULE.DEPUTY_DIRECTOR,
  );
  assert.equal(
    resolveDeductionUnitPrice({ ...everything, serviceUsedCount: 0, isDeputyDirector: false }).rule,
    PRICING_RULE.HANDED_OVER,
  );
  assert.equal(
    resolveDeductionUnitPrice({
      ...everything, serviceUsedCount: 0, isDeputyDirector: false, handedOver: false,
    }).rule,
    PRICING_RULE.NEW_TO_INSTRUCTOR,
  );
  assert.equal(
    resolveDeductionUnitPrice({
      ...everything, serviceUsedCount: 0, isDeputyDirector: false, handedOver: false, priorSessions: 20,
    }).rule,
    PRICING_RULE.BASE_CATEGORY,
  );
});

test("every answer says which rule decided it", () => {
  // 분쟁 때 "왜 이 금액인가"를 답할 수 있어야 한다.
  const rules = new Set(Object.values(PRICING_RULE).map(String));
  for (const input of [
    servicePass({ serviceUsedCount: 1 }),
    pass({ isDeputyDirector: true }),
    pass({ handedOver: true }),
    pass({ priorSessions: 0 }),
    pass({}),
  ]) {
    assert.ok(rules.has(resolveDeductionUnitPrice(input).rule));
  }
});

test("a flag has to be true, not merely truthy", () => {
  // "false" 나 1 이 들어와 부원장 단가가 나가면 그 달 급여가 통째로 틀린다.
  for (const notTrue of ["true", 1, "1", {}]) {
    assert.equal(priceOf({ isDeputyDirector: notTrue }).rule, PRICING_RULE.BASE_CATEGORY, JSON.stringify(notTrue));
    assert.equal(priceOf({ handedOver: notTrue }).rule, PRICING_RULE.BASE_CATEGORY, JSON.stringify(notTrue));
  }
});
