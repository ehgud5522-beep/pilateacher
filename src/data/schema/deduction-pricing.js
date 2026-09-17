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
 *   1. 담당 강사가 부원장 → (계약금액 ÷ totalSessions) ÷ 2
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

import { PAY_CATEGORY } from "./constants.js";

/** 어느 판정이 이겼는가. 분쟁 때 "왜 이 금액인가"를 답하는 값이다. */
export const PRICING_RULE = Object.freeze({
  SERVICE_ALREADY_USED: "service_already_used",
  DEPUTY_DIRECTOR: "deputy_director",
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

/** 이 강사에게 이 회원 누적이 이 횟수 미만이면 신규로 본다. */
export const NEW_TO_INSTRUCTOR_THRESHOLD = 20;

/**
 * 한 회원권이 급여를 주는 서비스 회차 수.
 *
 * 서비스를 몇 회 붙였든 센터가 내는 것은 1회분이다. 두 번째부터는 강사 봉사이고
 * 단가가 0 이 된다 -- 잔여 횟수는 그대로 줄어든다. 급여만 0 이다.
 */
export const PAID_SERVICE_SESSIONS_PER_PASS = 1;

const requiredInt = (value, label, { min }) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
};

const countOf = (value) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

/**
 * 부원장의 회당 단가. 계약 금액을 실제 진행 횟수로 나눠 반으로 접는다.
 *
 * 분모는 totalSessions 다. serviceSessions 를 더하지 않는다 -- 부원장에게는
 * 서비스 세션이 없다. 더하면 있지도 않은 회차로 나눠 단가가 낮아진다.
 *
 * @param {{ contractPrice: number, totalSessions: number }} pass
 */
export function deputyDirectorUnitPrice({ contractPrice, totalSessions }) {
  const price = requiredInt(contractPrice, "contractPrice", { min: 0 });
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
 *   contractPrice?: number,
 *   totalSessions?: number,
 *   isDeputyDirector?: boolean,
 *   handedOver?: boolean,
 *   priorSessions?: number,
 *   serviceUsedCount?: number,
 * }} input
 *   category          회원권의 기준 카테고리
 *   baseUnitPrice     발급 시 박힌 기준 단가 (판정 4가 쓰는 값)
 *   contractPrice     계약 금액 (판정 1)
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

  /* 판정 0. service 카테고리일 때만 본다.
     "이미 service 차감이 있었는가"는 service 차감에 대한 이야기다. 카테고리를
     보지 않고 앞에 세우면, 서비스를 한 번 쓴 회원권의 1:1 수업까지 0원이 된다.
     부원장에게는 서비스 세션이 없어 판정 1과 부딪칠 일은 없지만, 언젠가
     부딪치면 확정본의 번호대로 0이 이긴다. */
  if (category === PAY_CATEGORY.SERVICE && serviceUsedCount >= PAID_SERVICE_SESSIONS_PER_PASS) {
    return { unitPrice: 0, rule: PRICING_RULE.SERVICE_ALREADY_USED };
  }

  // 판정 1. 누적에도, 인수인계에도, 카테고리에도 걸리지 않는다. 언제나 5:5.
  if (input?.isDeputyDirector === true) {
    return {
      unitPrice: deputyDirectorUnitPrice({
        contractPrice: input?.contractPrice,
        totalSessions: input?.totalSessions,
      }),
      rule: PRICING_RULE.DEPUTY_DIRECTOR,
    };
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
