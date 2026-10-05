/**
 * 차감 한 회차의 단가를 정한다. (2026-09-15 확정본)
 *
 * ── pay-rates.js 와 무엇이 다른가 ──
 * pay-rates.js 는 *발급* 시점에 "이 회원권의 기준 카테고리 단가"를 정한다.
 * 이 파일은 *차감* 시점에 "이 한 회차가 실제로 얼마인가"를 정한다. 같은
 * 회원권 안에서도 회차마다 답이 다르다 -- 누적 20회를 넘는 순간 값이 바뀐다.
 *
 * ── 판정 순서. 먼저 걸리는 것이 이긴다 ──
 *   0. 이 회원권에서 이미 service 차감이 있었다 → 0
 *   1. 담당 강사가 부원장 → (공급가액 ÷ totalSessions) ÷ 2
 *      공급가액은 계약 금액에서 부가세를 뺀 값이다 -- 카드 110만은 100만.
 *   2. 인수인계받은 회원권 → 25,000
 *   3. 이 강사에게 이 회원 누적 20회 미만 → 25,000
 *   4. 그 외 → 회원권의 기준 카테고리 단가
 *
 * ── 결과는 원장에 박히고 끝이다 ──
 * 여기서 정해진 값이 ledger 항목의 unitPrice 가 되고, 그 뒤로 이 파일을 고쳐도
 * 지난 급여는 움직이지 않는다. 급여를 합산하는 코드는 원장을 읽어야 한다.
 *
 * 이 파일은 순수하다. 읽지도 쓰지도 않고, 받은 값으로만 판정한다 -- 그래야
 * 확정본의 모든 예시를 테스트로 그대로 옮길 수 있다.
 */

import { MEMBERSHIP_TITLE, PAY_CATEGORY, PAYMENT_METHOD, isDiosaCategory } from "./constants.mjs";

/** 어느 판정이 이겼는가. 분쟁 때 "왜 이 금액인가"를 답하는 값이다. */
export const PRICING_RULE = Object.freeze({
  /** 이 회원권의 첫 서비스 회차. 센터가 지원하는 그 한 번이다. */
  SERVICE_FIRST: "service_first",
  SERVICE_ALREADY_USED: "service_already_used",
  DEPUTY_DIRECTOR: "deputy_director",
  /** 디오사 관리 수업. 표값 고정이고 직급·인수인계·누적에 걸리지 않는다. */
  DIOSA_FIXED: "diosa_fixed",
  /** 점장·팀장의 1:1 재등록(이벤트). 직급에 붙는 고정 단가다. */
  SENIOR_TITLE_EVENT: "senior_title_event",
  HANDED_OVER: "handed_over",
  NEW_TO_INSTRUCTOR: "new_to_instructor",
  BASE_CATEGORY: "base_category",
});

/**
 * 판정 2·3 이 주는 값.
 *
 * pt_1_1_new 의 표값과 우연히 같지만 같은 것이 아니다. 표가 바뀌어도 이 값은
 * 따라 움직이지 않는다 -- 신규 상품의 단가와 "이 강사에게 처음인 회원" 단가는
 * 서로 다른 이유로 정해진다.
 */
export const NEW_TO_INSTRUCTOR_UNIT_PRICE = 25000;

/**
 * 점장·팀장의 1:1 재등록(이벤트) 단가.
 *
 * 일반 강사는 표값 30,000 이고 이 둘만 31,000 이다. 직급에 붙는 금액이라
 * 표(PAY_RATES)에 두지 않는다 -- 표는 "이 상품이 얼마인가" 이고 이것은
 * "누가 했는가" 다. 표에 섞으면 상품 단가를 고칠 때 직급 수당이 함께 움직인다.
 */
export const SENIOR_TITLE_EVENT_UNIT_PRICE = 31000;

/**
 * 그 단가를 받는 직급. **부원장은 여기 없다.**
 *
 * 부원장은 판정 1 에서 이미 끝난다 (5:5). 2026-10-05 에 대표가 정했다 --
 * 부원장이면서 점장인 사람은 부원장 몫이 먼저다.
 */
export const SENIOR_TITLES = Object.freeze(
  /** @type {ReadonlyArray<string>} */ ([MEMBERSHIP_TITLE.TEAM_LEAD, MEMBERSHIP_TITLE.BRANCH_MANAGER]),
);

/**
 * 이 직급이 1:1 재등록(이벤트)에서 고정 단가를 받는가.
 *
 * @param {unknown} title @param {unknown} category
 */
export function hasSeniorTitleRate(title, category) {
  return SENIOR_TITLES.includes(String(title ?? ""))
    && String(category ?? "") === PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT;
}

/** 이 강사에게 이 회원 누적이 이 횟수 미만이면 신규로 본다. */
export const NEW_TO_INSTRUCTOR_THRESHOLD = 20;

/**
 * 한 회원권이 급여를 주는 서비스 회차 수.
 *
 * 서비스를 몇 회 붙였든 센터가 내는 것은 1회분이다. 두 번째부터는 강사 봉사이고
 * 단가가 0 이 된다 -- 잔여 횟수는 그대로 줄어든다. 급여만 0 이다.
 */
export const PAID_SERVICE_SESSIONS_PER_PASS = 1;

/**
 * 이 차감이 서비스 회차를 쓰는가.
 *
 * ── 서비스를 먼저 쓴다 ──
 * 한 회원권 안에 결제 회차와 서비스 회차가 섞여 있고, 잔여는 둘을 합친 숫자
 * 하나다. 그래서 "몇 번째 차감인가"가 곧 "어느 쪽을 쓰는가"이고, 그 순서는
 * 데이터가 정해 주지 않으므로 우리가 정한다.
 *
 * 서비스가 먼저다. 강사가 중도 퇴사하면 남은 서비스는 쓰이지 못하고 사라진다 --
 * 결제 회차는 다른 강사가 이어받아도 회원이 산 것이지만, 서비스는 그 강사가
 * 얹어 준 것이라 함께 사라진다. 결제 회차를 먼저 쓰면 사라질 쪽을 뒤에 두는
 * 셈이고, 그 손해는 회원이 본다.
 *
 * ── 어느 회원권을 먼저 쓰는가와는 다른 층위다 ──
 * 회원권이 여럿이면 만료가 이른 것부터 쓴다 (lesson-settlement.js 의
 * pickPassForClient). 그 판단이 먼저이고, 이 판단은 그렇게 고른 회원권 *안에서*
 * 일어난다. 앞의 것이 "어느 회원권", 뒤의 것이 "그 회원권의 어느 회차"를 답하므로
 * 둘은 부딪치지 않는다.
 *
 * 순서를 뒤집지 않는 이유: 만료는 회원이 돈을 낸 회차를 없앤다. 서비스는 받은
 * 것이라 잃어도 낸 돈이 사라지지는 않는다. 서비스가 남은 회원권을 만료가 이른
 * 회원권보다 앞세우면 더 큰 손해를 두고 작은 손해를 먼저 막게 된다.
 *
 * @param {{ category?: string, serviceSessions?: number, serviceUsed?: number }} input
 */
export function spendsServiceSession(input = {}) {
  /* 통째로 서비스인 회원권. 회차를 셀 것 없이 모든 차감이 서비스이고, 두 번째
     부터는 판정 0 이 0원으로 만든다. */
  if (String(input?.category ?? "") === PAY_CATEGORY.SERVICE) return true;
  return countOf(input?.serviceUsed) < countOf(input?.serviceSessions);
}

const requiredInt = (value, label, { min }) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
};

const countOf = (value) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

/* ── 부원장 5:5 는 현금가 기준이다 ──────────────────────────────────────────
   계약 금액이 언제나 반으로 접을 수 있는 돈인 것은 아니다. 카드로 받으면 그
   금액 안에 부가세가 들어 있고, 센터가 실제로 쥐는 것은 공급가액이다. 부가세는
   센터의 매출이 아니라 나라에 낼 돈이므로, 그것까지 반으로 접으면 센터가 받지도
   않은 돈의 절반을 지급하게 된다.

     카드 110만 → 공급가액 100만 → ÷ 총세션 ÷ 2

   ── 어느 결제 수단이 부가세를 포함하는가 ──
   기준은 수단의 이름이 아니라 "센터가 그 돈에서 부가세를 떼고 받는가"다.
   현금·계좌가 예외이고, 결제망을 타고 매출로 잡히는 나머지가 기본이다.

   2026-10-05 에 대표가 정했다: **카드만 뺀다.** 전에는 제로페이와 바우처도
   카드와 같이 두고 "수수료가 없다는 것과 세금이 없다는 것은 다른 이야기" 라고
   적어 두었는데, 대표가 보는 기준은 센터가 실제로 떼이는 결제 수수료였다.
   제로페이는 가맹점 수수료가 0% 이고 바우처도 떼이는 것이 없으므로, 그 돈은
   계약 금액 그대로 강사의 분자가 된다.

   이미 발급된 회원권은 움직이지 않는다 -- 발급 시점의 공급가액이 문서에 박혀
   있고(netContractPriceOf 가 그것을 먼저 본다), 이관분도 마찬가지다. 바뀌는
   것은 앞으로 발급되는 제로페이·바우처 회원권뿐이다.

   이 표에 빈칸을 두지 않는다. 결제 수단이 하나 늘면 여기서 반드시 답해야 하고,
   답하지 않으면 발급이 거부된다. 기본값을 두면 새 수단이 조용히 한쪽으로
   떨어지고, 그 오차는 원장에 박혀 고칠 수 없다. (테스트가 이 표와
   PAYMENT_METHOD 가 같은 집합인지 고정한다.)
   ────────────────────────────────────────────────────────────────────────── */

/** @type {Readonly<Record<string, boolean>>} */
export const PAYMENT_INCLUDES_VAT = Object.freeze({
  [PAYMENT_METHOD.CARD]: true,
  [PAYMENT_METHOD.CASH]: false,
  [PAYMENT_METHOD.TRANSFER]: false,
  [PAYMENT_METHOD.ZEROPAY]: false,
  [PAYMENT_METHOD.VOUCHER]: false,
});

/**
 * 계약 금액에서 부가세를 뺀 공급가액.
 *
 * ── 반올림 ──
 * 원 단위 반올림이다. 내림이면 언제나 강사가 덜 받고 올림이면 언제나 센터가 더
 * 준다 -- 한쪽으로만 기우는 오차는 회차가 쌓일수록 커진다. 반올림은 두 방향으로
 * 갈라져 상쇄되고, 한 계약당 최대 오차는 0.5원이다. 아래 deputyDirectorUnitPrice
 * 도 같은 규칙을 쓴다.
 *
 * 1.1 로 나누지 않고 10/11 을 곱한다. 1.1 은 이진 부동소수로 정확히 표현되지
 * 않아 110만 ÷ 1.1 이 999999.9999... 로 떨어지는데, 정수비로 계산하면 그 자리가
 * 정확히 100만이다.
 *
 * @param {number} contractPrice @param {string} paymentMethod
 * @returns {number}
 */
export function netContractPriceFor(contractPrice, paymentMethod) {
  const price = requiredInt(contractPrice, "contractPrice", { min: 0 });
  const method = String(paymentMethod ?? "");
  if (!(method in PAYMENT_INCLUDES_VAT)) throw new Error("Invalid paymentMethod");
  return PAYMENT_INCLUDES_VAT[method] ? Math.round((price * 10) / 11) : price;
}

/**
 * 이 회원권의 공급가액. 발급 시점에 박힌 값이 있으면 그것이다.
 *
 * ── 왜 발급 때 박는가 ──
 * 부가세율은 바뀔 수 있고, 결제 수단을 나중에 고칠 수도 있다. 둘 중 무엇이
 * 움직여도 이미 팔린 회원권의 급여 근거는 그대로여야 한다 -- baseUnitPrice 를
 * 박아 두는 것과 같은 이유다.
 *
 * ── 없으면 계산한다 ──
 * 이 필드가 생기기 전에 발급된 회원권에는 없다. 그때는 회원권이 들고 있는
 * 결제 수단으로 다시 계산한다 -- 세율은 법이 정한 값이라 그 회원권이 팔린
 * 조건이 아니다. 계약 금액이나 결제 수단을 읽을 수 없으면 null 이고, 부원장
 * 판정이 그때 멈춘다. 지어내면 부원장의 수업 전체가 틀린 금액으로 굳는다.
 *
 * @param {any} pass
 * @returns {number | null}
 */
export function netContractPriceOf(pass) {
  const stored = pass?.netContractPrice;
  if (Number.isInteger(stored) && stored >= 0) return stored;
  try {
    return netContractPriceFor(pass?.contractPrice, pass?.paymentMethod);
  } catch {
    return null;
  }
}

/**
 * 부원장의 회당 단가. 공급가액을 실제 진행 횟수로 나눠 반으로 접는다.
 *
 * 분자는 계약 금액이 아니라 공급가액이다 -- 위 netContractPriceFor 참고.
 *
 * 분모는 totalSessions 다. serviceSessions 를 더하지 않는다 -- 부원장에게는
 * 서비스 세션이 없다. 더하면 있지도 않은 회차로 나눠 단가가 낮아진다.
 *
 * @param {{ netContractPrice: number, totalSessions: number }} pass
 */
export function deputyDirectorUnitPrice({ netContractPrice, totalSessions }) {
  const price = requiredInt(netContractPrice, "netContractPrice", { min: 0 });
  const sessions = requiredInt(totalSessions, "totalSessions", { min: 1 });
  // 원 단위로 반올림한다. 나누어떨어지지 않는 계약이 실제로 많다.
  return Math.round(price / sessions / 2);
}

/**
 * 이 한 회차가 얼마인가.
 *
 * @param {{
 *   category?: string,
 *   baseUnitPrice?: number,
 *   netContractPrice?: number,
 *   totalSessions?: number,
 *   isDeputyDirector?: boolean,
 *   title?: string,
 *   handedOver?: boolean,
 *   priorSessions?: number,
 *   serviceUsedCount?: number,
 * }} input
 *   category          회원권의 기준 카테고리
 *   title             차감 시점의 강사 직급 (판정 1.5가 쓰는 값)
 *   baseUnitPrice     발급 시 박힌 기준 단가 (판정 4가 쓰는 값)
 *   netContractPrice  부가세를 뺀 공급가액 (판정 1의 분자)
 *   totalSessions     서비스를 뺀 기준 회차 (판정 1의 분모)
 *   isDeputyDirector  담당 강사가 부원장인가
 *   handedOver        이 회원권을 인수인계받았는가
 *   priorSessions     이 강사가 이 회원에게 이미 진행한 횟수
 *   serviceUsedCount  이 회원권에서 이미 나간 service 차감 수
 * @returns {{ unitPrice: number, rule: string }}
 */
export function resolveDeductionUnitPrice(input = {}) {
  const category = String(input?.category ?? "");
  const priorSessions = countOf(input?.priorSessions);
  const serviceUsedCount = countOf(input?.serviceUsedCount);

  /* ── 판정 0. 서비스 회차는 여기서 끝난다 ────────────────────────────
     여기의 category 는 **이 차감의** 성격이지 회원권의 카테고리가 아니다.
     결제 회차가 남아 있어도 서비스가 남아 있으면 그 회차는 service 다
     (spendsServiceSession).

     아래 판정 1·2·3 보다 앞이다. 전에는 "이미 썼는가" 만 앞에 두어서, 첫
     서비스 회차가 판정 3(누적 20회 미만)에 걸려 25,000원이 됐다 -- 신규
     회원일수록 그랬다. 부원장이면 5:5 가, 인수인계면 25,000 이 가로챘다.
     서비스는 센터가 정한 금액이지 그 강사의 단가가 아니므로, 어느 쪽에도
     걸리지 않아야 한다.

     센터가 급여를 주는 서비스는 회원권당 PAID_SERVICE_SESSIONS_PER_PASS
     회분이고, 그다음부터는 0원이다. 회차는 그대로 빠진다 -- 회원은 받은
     것이고, 0원인 것은 강사에게 주는 돈이다. */
  if (category === PAY_CATEGORY.SERVICE) {
    if (serviceUsedCount >= PAID_SERVICE_SESSIONS_PER_PASS) {
      return { unitPrice: 0, rule: PRICING_RULE.SERVICE_ALREADY_USED };
    }
    /* 표에 적힌 서비스 금액. baseUnitPrice 로 들어온다 -- 부르는 쪽이
       defaultUnitPriceFor(SERVICE) 를 넣는다 (pass-repository). */
    return {
      unitPrice: requiredInt(input?.baseUnitPrice, "baseUnitPrice", { min: 0 }),
      rule: PRICING_RULE.SERVICE_FIRST,
    };
  }

  // 판정 1. 누적에도, 인수인계에도, 카테고리에도 걸리지 않는다. 언제나 5:5.
  if (input?.isDeputyDirector === true) {
    return {
      unitPrice: deputyDirectorUnitPrice({
        // 계약 금액이 아니라 공급가액이다. 카드 110만은 100만을 반으로 접는다.
        netContractPrice: input?.netContractPrice,
        totalSessions: input?.totalSessions,
      }),
      rule: PRICING_RULE.DEPUTY_DIRECTOR,
    };
  }

  /* ── 판정 1.2. 디오사는 표값 고정 ───────────────────────────────────────
     관리 수업이다. PT 와 다른 상품이고, 강사가 누구든 같은 금액이다.

     **부원장(판정 1)보다는 뒤다.** 2026-10-05 에 대표가 정했다 -- 디오사도
     5:5 는 그대로 받는다.

     **직급·인수인계·누적 20회보다는 앞이다.** 저 셋은 전부 PT 를 전제로 한
     판정이다. 디오사에 걸리면 20,000 짜리 관리 수업이 25,000 으로 나가고,
     그 차이는 원장에 박혀 고칠 수 없다. */
  if (isDiosaCategory(category)) {
    return {
      unitPrice: requiredInt(input?.baseUnitPrice, "baseUnitPrice", { min: 0 }),
      rule: PRICING_RULE.DIOSA_FIXED,
    };
  }

  /* ── 판정 1.5. 점장·팀장의 1:1 재등록(이벤트) ──────────────────────────
     직급에 붙는 고정 단가다. 일반 강사는 표값 30,000 이고 이 둘만 31,000 이다.

     **부원장보다 뒤다.** 부원장이면서 점장인 사람은 5:5 가 먼저다 --
     2026-10-05 에 대표가 정했다.

     **인수인계·누적 20회보다는 앞이다.** 점장이 넘겨받은 회원권을 하든 처음
     보는 회원을 하든 31,000 이다. 뒤에 두면 그 두 판정이 25,000 으로
     가로채고, 직급 수당은 그 회원이 20회를 넘긴 뒤에야 나타난다.

     직급은 차감 시점의 값이다. 부르는 쪽이 그때의 소속 문서에서 읽어 넣고,
     원장 항목에 함께 박힌다 -- 승진해도 지난달 급여가 흔들리지 않는다. */
  if (hasSeniorTitleRate(input?.title, category)) {
    return { unitPrice: SENIOR_TITLE_EVENT_UNIT_PRICE, rule: PRICING_RULE.SENIOR_TITLE_EVENT };
  }

  // 판정 2. 넘겨받은 회원권은 횟수와 무관하게 계속 신규 단가다.
  if (input?.handedOver === true) {
    return { unitPrice: NEW_TO_INSTRUCTOR_UNIT_PRICE, rule: PRICING_RULE.HANDED_OVER };
  }

  /* 판정 3. 기준은 강사-회원 쌍이다. 같은 회원이라도 강사가 다르면 각자 0부터
     세고, 같은 강사에게 재등록해도 그 강사 기준 20회까지는 신규 단가다.
     카테고리를 가리지 않는다 -- 2:1 재등록 상품이라도 19회째면 25,000 이다. */
  if (priorSessions < NEW_TO_INSTRUCTOR_THRESHOLD) {
    return { unitPrice: NEW_TO_INSTRUCTOR_UNIT_PRICE, rule: PRICING_RULE.NEW_TO_INSTRUCTOR };
  }

  // 판정 4. 발급 시 박힌 기준값. 지어내지 않는다 -- 없으면 0원 급여가 된다.
  return {
    unitPrice: requiredInt(input?.baseUnitPrice, "baseUnitPrice", { min: 0 }),
    rule: PRICING_RULE.BASE_CATEGORY,
  };
}
