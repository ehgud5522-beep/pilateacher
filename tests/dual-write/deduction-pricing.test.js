import assert from "node:assert/strict";
import test from "node:test";
import {
  NEW_TO_INSTRUCTOR_THRESHOLD, NEW_TO_INSTRUCTOR_UNIT_PRICE, PAYMENT_INCLUDES_VAT, PRICING_RULE,
  SENIOR_TITLES, SENIOR_TITLE_EVENT_UNIT_PRICE,
  deputyDirectorUnitPrice, netContractPriceFor, netContractPriceOf, resolveDeductionUnitPrice,
  spendsServiceSession,
} from "../../src/data/schema/deduction-pricing.js";
import { MEMBERSHIP_TITLE, PAYMENT_METHOD } from "../../src/data/schema/constants.js";
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

test("아래 판정이 첫 서비스를 가로채지 않는다 (2026-10-03 정정)", () => {
  /* 전에는 판정 0 이 "이미 썼는가" 만 보고 지나가서, 첫 서비스가 판정 3(누적
     20회 미만)에 걸려 25,000원이 됐다 -- 신규 회원일수록 그랬다. 부원장이면
     5:5 가, 인수인계면 25,000 이 가로챘다.

     서비스는 센터가 정한 금액이지 그 강사의 단가가 아니다. 어느 판정에도
     걸리지 않는다. */
  for (const overrides of [
    { priorSessions: 5 },
    { priorSessions: 0 },
    { handedOver: true },
    { isDeputyDirector: true, netContractPrice: 1000000, totalSessions: 20 },
  ]) {
    const found = resolveDeductionUnitPrice(servicePass(overrides));
    assert.equal(found.unitPrice, 10000, JSON.stringify(overrides));
    assert.equal(found.rule, PRICING_RULE.SERVICE_FIRST, JSON.stringify(overrides));
  }
});

test("a second service session is zero even for a seasoned instructor", () => {
  assert.equal(resolveDeductionUnitPrice(servicePass({ serviceUsedCount: 1, priorSessions: 0 })).unitPrice, 0);
  assert.equal(resolveDeductionUnitPrice(servicePass({ serviceUsedCount: 1, handedOver: true })).unitPrice, 0);
});

/* ── 순서 그 자체 ─────────────────────────────────────────────────────── */

test("each rule beats the ones below it", () => {
  /* 서비스 차감은 판정 0 에서 끝난다 -- 아래 어느 것도 보지 않는다. 쓴 적이
     있으면 0원, 없으면 센터 금액이다. */
  const anyService = { isDeputyDirector: true, handedOver: true, priorSessions: 0 };
  assert.equal(
    resolveDeductionUnitPrice(servicePass({ ...anyService, serviceUsedCount: 1 })).rule,
    PRICING_RULE.SERVICE_ALREADY_USED,
  );
  assert.equal(
    resolveDeductionUnitPrice(servicePass({ ...anyService, serviceUsedCount: 0 })).rule,
    PRICING_RULE.SERVICE_FIRST,
  );

  /* 서비스가 아닌 차감은 아래 순서대로다. serviceUsedCount 는 보지 않는다 --
     서비스를 한 번 쓴 회원권의 1:1 수업까지 0원이 되면 안 된다. */
  const everything = pass({
    serviceUsedCount: 1, isDeputyDirector: true, handedOver: true, priorSessions: 0,
    netContractPrice: 1000000, totalSessions: 20,
  });
  assert.equal(resolveDeductionUnitPrice(everything).rule, PRICING_RULE.DEPUTY_DIRECTOR);
  assert.equal(
    resolveDeductionUnitPrice({ ...everything, isDeputyDirector: false }).rule,
    PRICING_RULE.HANDED_OVER,
  );
  assert.equal(
    resolveDeductionUnitPrice({
      ...everything, isDeputyDirector: false, handedOver: false,
    }).rule,
    PRICING_RULE.NEW_TO_INSTRUCTOR,
  );
  assert.equal(
    resolveDeductionUnitPrice({
      ...everything, isDeputyDirector: false, handedOver: false, priorSessions: 20,
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

test("어느 회차를 쓰는가가 판정을 가른다 (2026-10-03 정정)", () => {
  /* 전에는 "서비스 회차라도 판정 순서는 그대로" 였다. 그래서 이 강사에게 이
     회원이 20회 미만이면 서비스도 25,000 이었다 -- 이 테스트가 그것을 정상으로
     못 박고 있었다.

     서비스는 센터가 정한 금액이지 그 강사의 단가가 아니다. 같은 입력에서
     서비스 회차와 정규 회차가 다른 답을 낸다. */
  const early = { priorSessions: 3 };
  const service = resolveDeductionUnitPrice(pass({
    ...early, category: "service", baseUnitPrice: PAY_RATES.service,
  }));
  assert.equal(service.unitPrice, PAY_RATES.service);
  assert.equal(service.rule, PRICING_RULE.SERVICE_FIRST);

  // 같은 강사·같은 회원이라도 정규 회차는 판정 3 이 가져간다.
  const regular = resolveDeductionUnitPrice(pass({ ...early, category: "pt_1_1_new" }));
  assert.equal(regular.unitPrice, NEW_TO_INSTRUCTOR_UNIT_PRICE);
  assert.equal(regular.rule, PRICING_RULE.NEW_TO_INSTRUCTOR);
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

test("only a card is discounted — zeropay and voucher are not (2026-10-05 변경)", () => {
  /* 전에는 셋을 같이 두고 "수수료가 없다는 것과 세금이 없다는 것은 다른
     이야기" 라고 적었다. 대표가 보는 기준은 센터가 실제로 떼이는 결제
     수수료였고, 제로페이(가맹점 수수료 0%)와 바우처는 떼이는 것이 없다.

     이미 발급된 회원권은 움직이지 않는다 -- 발급 시점의 공급가액이 문서에
     박혀 있고 netContractPriceOf 가 그것을 먼저 본다. 이관분도 마찬가지다. */
  assert.equal(netContractPriceFor(1100000, "card"), 1000000, "카드만 뺀다");
  assert.equal(netContractPriceFor(1100000, "zeropay"), 1100000);
  assert.equal(netContractPriceFor(1100000, "voucher"), 1100000);
  assert.equal(netContractPriceFor(1100000, "cash"), 1100000);
  assert.equal(netContractPriceFor(1100000, "transfer"), 1100000);
});

test("an already issued pass keeps the net price it was sold with", () => {
  /* 이 변경이 지난 회원권의 급여를 흔들면 안 된다. 발급 때 박은 값이
     먼저이고, 그것이 없을 때만 지금 규칙으로 다시 센다. */
  assert.equal(netContractPriceOf({ netContractPrice: 1000000, contractPrice: 1100000, paymentMethod: "zeropay" }), 1000000);
  // 박힌 값이 없는 옛 회원권만 지금 규칙을 탄다.
  assert.equal(netContractPriceOf({ contractPrice: 1100000, paymentMethod: "zeropay" }), 1100000);
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

/* ── 판정 1.5. 점장·팀장의 1:1 재등록(이벤트) ──────────────────────────────

   2026-10-05 에 대표가 정했다. 직급에 붙는 고정 단가이고, 부원장보다는 뒤,
   인수인계·누적 20회보다는 앞이다. */

test("a branch manager and a team lead get 31,000 on the event repurchase", () => {
  for (const title of ["branch_manager", "team_lead"]) {
    const result = priceOf({ title });
    assert.equal(result.unitPrice, SENIOR_TITLE_EVENT_UNIT_PRICE, title);
    assert.equal(result.rule, PRICING_RULE.SENIOR_TITLE_EVENT, title);
  }
});

test("a plain instructor still gets 30,000", () => {
  /* 표값 그대로다. 직급 수당이 일반 강사까지 번지면 센터 전체의 인건비가
     조용히 올라간다. */
  for (const title of ["instructor", "", undefined]) {
    const result = priceOf({ title });
    assert.equal(result.unitPrice, 30000, String(title));
    assert.equal(result.rule, PRICING_RULE.BASE_CATEGORY, String(title));
  }
});

test("the senior title beats the handover and the under-20 rules", () => {
  /* 뒤에 두면 저 둘이 25,000 으로 가로채고, 직급 수당은 그 회원이 20회를
     넘긴 뒤에야 나타난다 -- 점장이 새 회원을 맡을수록 손해가 된다. */
  assert.equal(priceOf({ title: "branch_manager", handedOver: true }).unitPrice, 31000);
  assert.equal(priceOf({ title: "team_lead", priorSessions: 3 }).unitPrice, 31000);
  // 같은 조건의 일반 강사는 그대로 25,000 이다.
  assert.equal(priceOf({ title: "instructor", handedOver: true }).unitPrice, NEW_TO_INSTRUCTOR_UNIT_PRICE);
  assert.equal(priceOf({ title: "instructor", priorSessions: 3 }).unitPrice, NEW_TO_INSTRUCTOR_UNIT_PRICE);
});

test("the deputy director rule still wins over the senior title", () => {
  /* 부원장이면서 점장인 사람이 있다. 2026-10-05 에 대표가 정했다: 부원장이
     먼저다. 5:5 는 그 회원권이 실제로 판 금액에서 나오므로, 고정 단가로
     덮으면 비싼 계약일수록 그 사람이 손해를 본다. */
  const result = priceOf({ title: "branch_manager", isDeputyDirector: true });
  assert.equal(result.rule, PRICING_RULE.DEPUTY_DIRECTOR);
  // 2,100,000 ÷ 30 ÷ 2 = 35,000
  assert.equal(result.unitPrice, 35000);
});

test("the service judgment still comes first for a senior title", () => {
  /* 서비스는 센터가 정한 금액이지 그 강사의 단가가 아니다. 직급도 가로채지
     않는다. */
  const result = priceOf({ title: "branch_manager", category: "service", baseUnitPrice: 10000 });
  assert.equal(result.rule, PRICING_RULE.SERVICE_FIRST);
  assert.equal(result.unitPrice, 10000);
});

test("only the 1:1 event repurchase carries the senior rate", () => {
  /* 2:1 재등록은 이번 변경 대상이 아니다. 1:1 정상(풀방금액)도 아니다 --
     거기는 강사별 금액이라 직급 수당이 이중으로 얹힌다. */
  assert.equal(priceOf({ title: "branch_manager", category: "pt_2_1_repurchase", baseUnitPrice: 35000 }).unitPrice, 35000);
  assert.equal(priceOf({ title: "branch_manager", category: "pt_1_1_repurchase_normal", baseUnitPrice: 45000 }).unitPrice, 45000);
  assert.equal(priceOf({ title: "branch_manager", category: "pt_1_1_new", baseUnitPrice: 25000 }).unitPrice, 25000);
});

test("every senior title is a real membership title", () => {
  /* 오타 하나면 그 직급은 영영 31,000 을 못 받고, 아무도 그 사실을 모른다. */
  const known = /** @type {ReadonlyArray<string>} */ (Object.values(MEMBERSHIP_TITLE));
  for (const title of SENIOR_TITLES) {
    assert.ok(known.includes(title), title);
  }
  assert.equal(SENIOR_TITLES.includes(MEMBERSHIP_TITLE.INSTRUCTOR), false);
});
