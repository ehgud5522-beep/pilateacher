import assert from "node:assert/strict";
import test from "node:test";
import {
  NEW_TO_INSTRUCTOR_THRESHOLD, NEW_TO_INSTRUCTOR_UNIT_PRICE, PAYMENT_INCLUDES_VAT, PRICING_RULE,
  SENIOR_TITLES, SENIOR_TITLE_EVENT_UNIT_PRICE, VAT_BY_PARTS, vatablePortionOf,
  deputyDirectorUnitPrice, netContractPriceFor, netContractPriceOf, resolveDeductionUnitPrice,
  spendsServiceSession,
} from "../../src/data/schema/deduction-pricing.js";
import {
  DUET_PAY_CATEGORIES, LEGACY_PAYMENT_METHOD, MEMBERSHIP_TITLE,
  PAY_CATEGORY, PAYMENT_METHOD, SINGLE_PAYMENT_METHODS, STORED_PAYMENT_METHODS,
  isDuetPayCategory,
} from "../../src/data/schema/constants.js";
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

test("the count is per instructor-client pair, and the new rate follows the shape", () => {
  /* 누적은 카테고리를 가리지 않는다. **금액은 가린다** (2026-10-13 확정).

     2:1 은 수업 한 번에 두 사람을 가르친다. 처음 스무 회차를 1:1 값으로
     주면 같은 노동이 한 사람 값으로 나간다. */
  const twoOnOne = { category: "pt_2_1_repurchase", baseUnitPrice: 35000 };
  assert.equal(priceOf({ ...twoOnOne, priorSessions: 19 }).unitPrice, 30000, "2:1 신규 단가");
  assert.equal(priceOf({ ...twoOnOne, priorSessions: 20 }).unitPrice, 35000);

  // 1:1 쪽은 그대로 25,000 이다.
  assert.equal(priceOf({ priorSessions: 19 }).unitPrice, 25000);
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

test("a handed-over pass pays the new rate for every session left on it", () => {
  /* ── 두 번 뒤집힌 테스트 (2026-10-16 이 최종) ─────────────────────
     2026-10-13 에 이 판정을 지웠다가 되돌렸다.

     넘겨받은 회원권은 **전 강사가 판 것**이다. 새 강사는 그 계약에 기여가
     없고, 그 회원권이 끝날 때까지는 "처음 맡은 회원" 단가를 받는다. 누적으로
     판단하면 전 강사가 스무 번 가르친 회원을 넘겨받는 순간 첫 수업부터 기준
     단가가 되어, 판 사람과 가르치는 사람의 몫이 뒤집힌다. */
  for (const priorSessions of [0, 5, 19, 20, 100]) {
    const found = priceOf({ handedOver: true, priorSessions });
    assert.equal(found.unitPrice, NEW_TO_INSTRUCTOR_UNIT_PRICE, String(priorSessions));
    assert.equal(found.rule, PRICING_RULE.HANDED_OVER, String(priorSessions));
  }
});

test("the next pass after a handover is judged by the carried count", () => {
  /* 신규 단가로 묶이는 것은 **넘겨받은 그 회원권 하나**다. 같은 회원이
     재등록하면 그 새 회원권은 handedOver 가 아니고, 인계 때 따라온 누적으로
     판정 3 을 지난다 (transferPassInstructor 가 더한다).

     0 에서 다시 세면 같은 회원을 스무 번 더 가르쳐야 기준 단가가 되고, 그
     스무 번은 이미 일어난 일이다. */
  const renewed = priceOf({ handedOver: false, priorSessions: 30 });
  assert.equal(renewed.unitPrice, 30000);
  assert.equal(renewed.rule, PRICING_RULE.BASE_CATEGORY);
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
  // 인수인계는 누적과 무관하게 신규 단가다 (판정 2).
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
  // 부원장이 아니면 인수인계가 받는다 (판정 2). 누적은 보지 않는다.
  assert.equal(
    resolveDeductionUnitPrice({ ...everything, isDeputyDirector: false }).rule,
    PRICING_RULE.HANDED_OVER,
  );
  assert.equal(
    resolveDeductionUnitPrice({ ...everything, isDeputyDirector: false, handedOver: false }).rule,
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

test("cash is the contract itself", () => {
  assert.equal(netContractPriceFor(1300000, "cash"), 1300000);
});

test("only cash sits outside VAT (2026-10-27 대표 정정)", () => {
  /* 한 번 뒤집힌 자리다. 2026-10-05 에는 "카드만 뺀다" 였고, 기준을 센터가
     떼이는 **결제 수수료**로 잡았다 -- 제로페이는 가맹점 수수료가 0% 이니
     계약 금액 그대로 간다는 셈이었다.

     그 셈이 틀렸다. 수수료와 부가세는 다른 돈이다. 계좌이체도 제로페이도
     바우처도 매출로 잡히고 세금계산서가 나간다. 현금만 그 바깥에 있다. */
  assert.equal(netContractPriceFor(1100000, "cash"), 1100000, "현금만 그대로다");
  for (const method of ["card", "transfer", "other", "zeropay", "voucher"]) {
    assert.equal(netContractPriceFor(1100000, method), 1000000, method);
  }
});

test("only transfer, zeropay and voucher move under the corrected rule", () => {
  /* 대표가 확인하라고 한 것: 기존 단일 결제수단 회원권 중 **계산이 바뀌는
     것은 이 셋뿐**인가. 카드는 전에도 깎였고 현금은 전에도 안 깎였다.

     여기서 "전" 은 2026-10-05 의 표다 (카드만 true). 그 표를 그대로 적어 두고
     두 답을 견준다 -- 말로만 "셋뿐" 이라고 하면 다음에 표가 또 움직일 때
     무엇이 바뀌는지 아무도 모른다. */
  const BEFORE_2026_10_27 = { card: true, cash: false, transfer: false, zeropay: false, voucher: false };
  const moved = [];
  for (const [method, wasVat] of Object.entries(BEFORE_2026_10_27)) {
    const before = wasVat ? Math.round((1100000 * 10) / 11) : 1100000;
    if (netContractPriceFor(1100000, method) !== before) moved.push(method);
  }
  assert.deepEqual(moved.sort(), ["transfer", "voucher", "zeropay"]);
});

test("an already issued pass keeps the net price it was sold with", () => {
  /* 이 변경이 지난 회원권의 급여를 흔들면 안 된다. 발급 때 박은 값이
     먼저이고, 그것이 없을 때만 지금 규칙으로 다시 센다. 이미 박힌 값을
     바로잡을지는 대표가 따로 정한다. */
  assert.equal(netContractPriceOf({ netContractPrice: 1100000, contractPrice: 1100000, paymentMethod: "zeropay" }), 1100000);
  // 박힌 값이 없는 옛 회원권만 지금 규칙을 탄다.
  assert.equal(netContractPriceOf({ contractPrice: 1100000, paymentMethod: "zeropay" }), 1000000);
});

test("every payment method answers whether it carries VAT", () => {
  /* 빈칸이 있으면 새 결제 수단이 조용히 한쪽으로 떨어지고, 그 오차가 원장에
     박힌다. 표와 **저장 가능한 수단 전부**가 같은 집합이어야 한다 -- 옛 값
     (제로페이 · 바우처)도 포함이다. 그것들을 표에서 빼면 이미 발급된 회원권을
     양도하거나 다시 계산하는 길이 통째로 막힌다. */
  assert.deepEqual(
    Object.keys(PAYMENT_INCLUDES_VAT).sort(),
    [...STORED_PAYMENT_METHODS].sort(),
  );
  for (const method of SINGLE_PAYMENT_METHODS) {
    assert.equal(typeof PAYMENT_INCLUDES_VAT[method], "boolean", method);
  }
  for (const method of Object.values(LEGACY_PAYMENT_METHOD)) {
    assert.equal(typeof PAYMENT_INCLUDES_VAT[method], "boolean", method);
  }
  /* 복합결제만 불리언이 아니다. 카드 50만 + 현금 30만 을 한 글자로 답할 수
     없기 때문이고, 그 답은 "수단별 금액을 보라" 다. */
  assert.equal(PAYMENT_INCLUDES_VAT[PAYMENT_METHOD.MIXED], VAT_BY_PARTS);
});

test("a mixed payment leaves only the cash share whole (2026-10-27 결정 A)", () => {
  /* 카드 50만 + 현금 30만 짜리 100만 계약. 공급가액은
     30만 + round(70만 x 10/11) = 300,000 + 636,364 = 936,364.

     분모가 "카드+잔금" 이 아니라 **계약금액 - 현금분** 인 것에 주의한다.
     잔금 20만도 받기로 한 돈이고, 그것이 현금일지 카드일지는 아직 모른다 --
     모를 때는 세금계산서가 따라가는 쪽으로 둔다.

     전부 부가세 포함으로 보면 909,091 이 되어 **강사가 덜 받고**, 전부
     미포함으로 보면 100만이 되어 **센터가 더 낸다.** 둘 다 매번 틀린다. */
  const net = netContractPriceFor(1000000, "mixed", {
    card: 500000, cash: 300000, transfer: 0, other: 0,
  });
  assert.equal(net, 936364);
  assert.equal(net, 300000 + Math.round((700000 * 10) / 11));
});

test("a mixed payment of one method lands exactly where that method alone lands", () => {
  /* 쪼갬이 단일 결제와 어긋나면 "같은 돈을 어떻게 적었느냐" 로 급여가 갈린다. */
  for (const price of [1100000, 1000000, 1300000, 550000, 6, 0]) {
    assert.equal(
      netContractPriceFor(price, "mixed", { card: price, cash: 0, transfer: 0, other: 0 }),
      netContractPriceFor(price, "card"),
      `카드 ${price}`,
    );
    assert.equal(
      netContractPriceFor(price, "mixed", { cash: price, card: 0, transfer: 0, other: 0 }),
      netContractPriceFor(price, "cash"),
      `현금 ${price}`,
    );
  }
});

test("adding mixed payment does not move any single method on its own", () => {
  /* 복합결제를 더한 것만으로는 단일 수단이 움직이지 않는다. 움직인 것은 위
     테스트가 짚는 부가세 기준 정정이고, 그 둘은 다른 변경이다. */
  for (const { method, expected } of [
    { method: "card", expected: 1000000 },
    { method: "cash", expected: 1100000 },
  ]) {
    assert.equal(netContractPriceFor(1100000, method), expected, method);
  }
});

test("a mixed payment without amounts is refused, never guessed", () => {
  /* 0 으로 읽으면 카드분이 사라져 공급가액이 조용히 계약 금액과 같아진다.
     netContractPriceOf 가 이 던짐을 null 로 받아 부원장 판정이 멈춘다. */
  for (const bad of [undefined, null, "", 0]) {
    assert.throws(
      () => netContractPriceFor(1000000, "mixed", bad),
      /Invalid paymentBreakdown/, JSON.stringify(bad),
    );
  }
  assert.equal(netContractPriceOf({ contractPrice: 1000000, paymentMethod: "mixed" }), null);
  // 박힌 값이 있으면 그것이 먼저다 -- 쪼갠 금액을 못 읽어도 급여는 움직이지 않는다.
  assert.equal(
    netContractPriceOf({ contractPrice: 1000000, netContractPrice: 954545, paymentMethod: "mixed" }),
    954545,
  );
});

test("the VAT-bearing share of a pass is read the same way for single and mixed", () => {
  assert.equal(vatablePortionOf({ contractPrice: 1100000, paymentMethod: "card" }), 1100000);
  assert.equal(vatablePortionOf({ contractPrice: 1100000, paymentMethod: "transfer" }), 1100000);
  assert.equal(vatablePortionOf({ contractPrice: 1100000, paymentMethod: "cash" }), 0);
  /* 복합결제는 계약 금액에서 현금 칸을 뺀다. 잔금 20만도 여기 들어간다 --
     받기로 한 돈이고, 현금일지는 아직 모른다. */
  assert.equal(vatablePortionOf({
    contractPrice: 1000000, paymentMethod: "mixed",
    paymentBreakdown: { card: 500000, cash: 300000, transfer: 0, other: 0 },
  }), 700000);
  // 현금분이 계약 금액을 넘는 입력 실수. 그 위는 세지 않는다.
  assert.equal(vatablePortionOf({
    contractPrice: 1000000, paymentMethod: "mixed",
    paymentBreakdown: { cash: 9000000, card: 0, transfer: 0, other: 0 },
  }), 0);
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

test("the senior title waits for the twentieth session, like everyone else", () => {
  /* ── 2026-10-13 에 뒤집힌 테스트 ──────────────────────────────────
     전에는 직급이 20회 판정보다 앞이라 점장·팀장은 1회차부터 31,000 이었다.
     이제 **처음 스무 회차는 직급과 무관하게 25,000** 이고, 직급 수당은 그
     회원이 스물한 번째에 들어선 뒤부터다.

     20회 규칙이 "이 강사가 이 회원을 아직 모른다" 는 뜻이라, 점장이라고
     해서 새 회원을 덜 새롭게 아는 것은 아니다. */
  for (const title of ["branch_manager", "team_lead"]) {
    assert.equal(priceOf({ title, priorSessions: 19 }).unitPrice, NEW_TO_INSTRUCTOR_UNIT_PRICE, title);
    assert.equal(priceOf({ title, priorSessions: 19 }).rule, PRICING_RULE.NEW_TO_INSTRUCTOR, title);
    assert.equal(priceOf({ title, priorSessions: 20 }).unitPrice, 31000, title);
    assert.equal(priceOf({ title, priorSessions: 20 }).rule, PRICING_RULE.SENIOR_TITLE_EVENT, title);
  }
  // 같은 자리의 일반 강사는 30,000 이다. 그 1,000원이 직급 수당이다.
  assert.equal(priceOf({ title: "instructor", priorSessions: 20 }).unitPrice, 30000);
  /* **인수인계가 직급보다 앞이다** (2026-10-16). 점장이 넘겨받은 회원권은
     그 장이 끝날 때까지 신규 단가다 -- 그 계약은 전 강사가 팔았다. */
  const handed = priceOf({ title: "branch_manager", handedOver: true, priorSessions: 20 });
  assert.equal(handed.unitPrice, NEW_TO_INSTRUCTOR_UNIT_PRICE);
  assert.equal(handed.rule, PRICING_RULE.HANDED_OVER);
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

/* ── 2:1 재등록(이벤트) ─────────────────────────────────────────────────────

   2026-10-09 에 대표가 정했다. 32,000 고정이고, 디오사와 같은 자리(판정 1.2)
   에 선다 -- 표값이 곧 답인 카테고리다. */

test("the 2:1 event rate is 32,000 once the twentieth session has passed", () => {
  /* ── 2026-10-13 에 뒤집힌 테스트 ──────────────────────────────────
     전에는 디오사와 같은 자리(판정 1.2)에 서서 1회차부터 32,000 이었다.
     이제 **2:1 도 PT 라 20회 규칙을 탄다** -- 처음 스무 회차는 2:1 신규
     단가(30,000)이고 그 뒤가 32,000 이다.

     디오사는 그대로 앞에 남는다. 관리 수업에는 "이 강사에게 처음인 회원"
     이라는 말이 성립하지 않는다. */
  const duetEvent = {
    category: PAY_CATEGORY.PT_2_1_REPURCHASE_EVENT, baseUnitPrice: 32000,
    totalSessions: 20, netContractPrice: 1280000, serviceUsedCount: 0,
  };
  const early = resolveDeductionUnitPrice({ ...duetEvent, priorSessions: 19 });
  assert.equal(early.unitPrice, 30000, "2:1 신규 단가");
  assert.equal(early.rule, PRICING_RULE.NEW_TO_INSTRUCTOR);

  /* 스물한 번째부터는 32,000 고정이다. 직급도 인수인계도 그것을 바꾸지
     않는다 -- 2:1 이벤트는 강사가 누구든 같은 금액이다. */
  for (const extra of [{}, { title: "branch_manager" }, { title: "team_lead" }]) {
    const result = resolveDeductionUnitPrice({ ...duetEvent, priorSessions: 50, ...extra });
    assert.equal(result.unitPrice, 32000, JSON.stringify(extra));
    assert.equal(result.rule, PRICING_RULE.DUET_EVENT_FIXED, JSON.stringify(extra));
  }

  /* 넘겨받은 2:1 이벤트는 예외다 -- 그 장이 끝날 때까지 2:1 신규 단가다
     (판정 2 가 앞에 있다). */
  const handed = resolveDeductionUnitPrice({ ...duetEvent, priorSessions: 50, handedOver: true });
  assert.equal(handed.unitPrice, PAY_RATES[PAY_CATEGORY.PT_2_1_NEW]);
  assert.equal(handed.rule, PRICING_RULE.HANDED_OVER);
});

test("the deputy director still gets five-five on a 2:1 event pass", () => {
  /* 고정 단가가 5:5 를 덮지 않는다. 5:5 는 그 회원권이 실제로 팔린 금액에서
     나오므로, 덮으면 비싼 계약일수록 부원장이 손해를 본다. */
  const result = resolveDeductionUnitPrice({
    category: PAY_CATEGORY.PT_2_1_REPURCHASE_EVENT, baseUnitPrice: 32000, isDeputyDirector: true,
    // 1,280,000 ÷ 20 ÷ 2 = 32,000 -- 우연히 같아도 거쳐 온 길이 다르다.
    netContractPrice: 1280000, totalSessions: 20, priorSessions: 50, serviceUsedCount: 0,
  });
  assert.equal(result.rule, PRICING_RULE.DEPUTY_DIRECTOR);
  assert.equal(result.unitPrice, 32000);

  // 다른 금액으로 팔린 계약에서는 갈라진다.
  const cheaper = resolveDeductionUnitPrice({
    category: PAY_CATEGORY.PT_2_1_REPURCHASE_EVENT, baseUnitPrice: 32000, isDeputyDirector: true,
    netContractPrice: 1000000, totalSessions: 20, priorSessions: 50, serviceUsedCount: 0,
  });
  assert.equal(cheaper.unitPrice, 25000, "고정 단가가 아니라 그 계약의 절반이다");
});

test("the service judgment still comes first for a 2:1 event pass", () => {
  const result = resolveDeductionUnitPrice({
    category: PAY_CATEGORY.SERVICE, baseUnitPrice: 10000,
    totalSessions: 20, netContractPrice: 1280000, priorSessions: 50, serviceUsedCount: 0,
  });
  assert.equal(result.rule, PRICING_RULE.SERVICE_FIRST);
  assert.equal(result.unitPrice, 10000);
});

test("every duet category sits in one list, so no screen can miss one", () => {
  /* 전에는 네 곳이 각자 들고 있었다: 차감 · 발급 안내 · 이관 검사 · 발급
     화면의 카테고리 목록. 하나를 빠뜨리면 조용히 다르게 동작했다. */
  assert.deepEqual([...DUET_PAY_CATEGORIES], [
    PAY_CATEGORY.PT_2_1_NEW,
    PAY_CATEGORY.PT_2_1_REPURCHASE,
    PAY_CATEGORY.PT_2_1_REPURCHASE_EVENT,
  ]);
  for (const category of DUET_PAY_CATEGORIES) assert.equal(isDuetPayCategory(category), true, category);
  for (const category of [PAY_CATEGORY.PT_1_1_NEW, PAY_CATEGORY.DIOSA_A, PAY_CATEGORY.SERVICE, ""]) {
    assert.equal(isDuetPayCategory(category), false, String(category));
  }
});
