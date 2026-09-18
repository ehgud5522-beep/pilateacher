import assert from "node:assert/strict";
import test from "node:test";
import {
  NEW_TO_INSTRUCTOR_THRESHOLD, NEW_TO_INSTRUCTOR_UNIT_PRICE, PAYMENT_INCLUDES_VAT, PRICING_RULE,
  deputyDirectorUnitPrice, netContractPriceFor, netContractPriceOf, resolveDeductionUnitPrice,
  spendsServiceSession,
} from "../../src/data/schema/deduction-pricing.js";
import { PAYMENT_METHOD } from "../../src/data/schema/constants.js";
import { PAY_RATES } from "../../src/data/schema/pay-rates.js";

/** 1:1 재등록(이벤트) 회원권. 판정 4 가 걸리면 30,000 이다. */
const pass = (overrides = {}) => ({
  category: "pt_1_1_repurchase_event",
  baseUnitPrice: 30000,
  /* 현금 계약이라 계약 금액이 곧 공급가액이다. 카드였다면 1.1 로 나뉜다. */
  netContractPrice: 2100000,
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
  assert.equal(deputyDirectorUnitPrice({ netContractPrice: 2100000, totalSessions: 32 }), 32813);
  assert.equal(deputyDirectorUnitPrice({ netContractPrice: 1000000, totalSessions: 3 }), 166667);
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
  assert.throws(() => priceOf({ isDeputyDirector: true, netContractPrice: undefined }), /Invalid netContractPrice/);
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

/* ── 서비스를 먼저 쓴다 ─────────────────────────────────────────────────────

   잔여는 결제 회차와 서비스 회차를 합친 숫자 하나라, 어느 쪽을 쓰는지는 순서가
   정한다. 서비스가 먼저다 -- 강사가 중도 퇴사하면 남은 서비스는 쓰이지 못하고
   사라지고, 그 손해는 회원이 본다. */

test("a pass that still has a service session spends it before the paid ones", () => {
  assert.equal(spendsServiceSession({ category: "pt_1_1_new", serviceSessions: 1, serviceUsed: 0 }), true);
});

test("once the service sessions are used up the paid ones take over", () => {
  assert.equal(spendsServiceSession({ category: "pt_1_1_new", serviceSessions: 1, serviceUsed: 1 }), false);
  assert.equal(spendsServiceSession({ category: "pt_1_1_new", serviceSessions: 2, serviceUsed: 1 }), true);
});

test("a pass with no service sessions never reports one", () => {
  assert.equal(spendsServiceSession({ category: "pt_1_1_new", serviceSessions: 0, serviceUsed: 0 }), false);
  // 옛 회원권에는 두 필드가 아예 없다. 없는 것을 있다고 읽으면 안 된다.
  assert.equal(spendsServiceSession({ category: "pt_1_1_new" }), false);
});

test("a pass that is entirely service says so without counting", () => {
  // 통째로 서비스인 회원권. 두 번째부터는 판정 0 이 0원으로 만든다.
  assert.equal(spendsServiceSession({ category: "service" }), true);
  assert.equal(spendsServiceSession({ category: "service", serviceSessions: 0, serviceUsed: 9 }), true);
});

test("the judgement order is unchanged by which session is being spent", () => {
  /* 서비스 회차라도 판정 순서는 그대로다. 판정 3 이 카테고리를 가리지 않으므로,
     이 강사에게 이 회원이 아직 20회 미만이면 서비스라도 25,000 이다. */
  const early = resolveDeductionUnitPrice(pass({
    category: "service", baseUnitPrice: PAY_RATES.service, priorSessions: 3,
  }));
  assert.equal(early.unitPrice, NEW_TO_INSTRUCTOR_UNIT_PRICE);
  assert.equal(early.rule, PRICING_RULE.NEW_TO_INSTRUCTOR);
});

/* ── 부원장 5:5 는 현금가 기준이다 ──────────────────────────────────────────

   카드로 받은 금액 안에는 부가세가 들어 있다. 그것은 센터의 매출이 아니라
   나라에 낼 돈이라, 반으로 접을 대상이 아니다. */

test("the same contract pays a deputy differently on card and in cash", () => {
  // 110만 카드 → 공급가액 100만 → 20회 → 25,000. 현금 110만이면 27,500.
  const card = netContractPriceFor(1100000, "card");
  const cash = netContractPriceFor(1100000, "cash");
  assert.equal(card, 1000000);
  assert.equal(cash, 1100000);
  assert.equal(deputyDirectorUnitPrice({ netContractPrice: card, totalSessions: 20 }), 25000);
  assert.equal(deputyDirectorUnitPrice({ netContractPrice: cash, totalSessions: 20 }), 27500);
});

test("cash and transfer are the contract itself", () => {
  assert.equal(netContractPriceFor(1300000, "cash"), 1300000);
  assert.equal(netContractPriceFor(1300000, "transfer"), 1300000);
});

test("zeropay and voucher are taxed like a card", () => {
  /* 수수료가 없다는 것과 세금이 없다는 것은 다른 이야기다. 제로페이도
     바우처도 매출로 잡히고 부가세가 나간다. */
  assert.equal(netContractPriceFor(1100000, "zeropay"), 1000000);
  assert.equal(netContractPriceFor(1100000, "voucher"), 1000000);
});

test("every payment method answers whether it carries VAT", () => {
  /* 빈칸이 있으면 새 결제 수단이 조용히 한쪽으로 떨어지고, 그 오차가 원장에
     박힌다. 표와 열거형이 같은 집합이어야 한다. */
  assert.deepEqual(
    Object.keys(PAYMENT_INCLUDES_VAT).sort(),
    Object.values(PAYMENT_METHOD).sort(),
  );
  for (const method of Object.values(PAYMENT_METHOD)) {
    assert.equal(typeof PAYMENT_INCLUDES_VAT[method], "boolean", method);
  }
});

test("an unknown payment method is refused rather than guessed", () => {
  for (const bad of ["", "paypal", undefined, null]) {
    assert.throws(() => netContractPriceFor(1100000, bad), /Invalid paymentMethod/, JSON.stringify(bad));
  }
});

test("the division rounds to the won and does not drift on 1.1", () => {
  /* 1.1 은 이진 부동소수로 정확하지 않다. 10/11 로 계산하면 110만이 정확히
     100만으로 떨어진다. */
  assert.equal(netContractPriceFor(1100000, "card"), 1000000);
  // 딱 떨어지지 않는 계약. 1,000,000 ÷ 1.1 = 909,090.909…
  assert.equal(netContractPriceFor(1000000, "card"), 909091);
  assert.equal(netContractPriceFor(0, "card"), 0);
});

test("a pass carries its net price, and an older one is worked out again", () => {
  // 발급 때 박힌 값이 먼저다 -- 세율이 바뀌어도 그 회원권은 움직이지 않는다.
  assert.equal(netContractPriceOf({ netContractPrice: 999, contractPrice: 1100000, paymentMethod: "card" }), 999);
  // 이 필드가 생기기 전의 회원권. 결제 수단으로 다시 계산한다.
  assert.equal(netContractPriceOf({ contractPrice: 1100000, paymentMethod: "card" }), 1000000);
  assert.equal(netContractPriceOf({ contractPrice: 1100000, paymentMethod: "cash" }), 1100000);
  /* 읽을 수 없으면 null 이다. 지어내면 부원장의 수업 전체가 틀린 금액으로
     굳고, 원장은 고칠 수 없다. */
  assert.equal(netContractPriceOf({ contractPrice: 1100000 }), null);
  assert.equal(netContractPriceOf({ paymentMethod: "card" }), null);
  assert.equal(netContractPriceOf(null), null);
});
