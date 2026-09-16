/**
 * 급여 단가표.
 *
 * ── 표는 기준값일 뿐, 기록된 값이 진실이다 ──
 * 여기서 정해지는 숫자는 발급하는 그 순간에만 쓰인다. 급여를 계산하는 값은
 * 언제나 passes/{passId}/ledger 항목에 저장된 unitPrice 다.
 *
 * 단가는 바뀐다. 강사가 등급 시험에 합격하면 풀방금액이 오른다. 표나 강사의
 * 풀방금액을 고쳤을 때 지난달 급여가 함께 흔들리면 이미 정산이 끝난 달의 근거가
 * 사라지고, 원장은 append-only 라 사후 보정도 불가능하다. 그래서 발급·차감
 * 시점의 단가를 항목에 박아 두고, 이 파일은 그 시점에 한 번만 읽는다.
 *
 * 급여를 합산하는 코드가 이 파일이나 memberships.fullRoomRate 를 참조하면 그
 * 원칙이 깨진다. 계산은 원장을 읽어야 한다.
 *
 * ── 강사별로 갈리는 것은 한 줄뿐이다 ──
 * pt_1_1_repurchase_normal 만 강사 본인의 풀방금액을 쓴다. 나머지 일곱은 강사가
 * 누구든 같은 금액이다 -- 특히 이벤트페이(pt_1_1_repurchase_event)는 풀방금액이
 * 있는 강사에게도 정해진 금액으로 나간다. 풀방금액이 다른 카테고리 단가를 끌고
 * 움직이면 안 된다.
 */

import { PAY_CATEGORY } from "./constants.js";

/**
 * 강사와 무관하게 고정된 단가(원).
 *
 * 여기 없는 카테고리는 표가 정해 줄 수 없다는 뜻이고, 어디서 값이 오는지는
 * UNIT_PRICE_SOURCE 가 말한다.
 */
export const PAY_RATES = Object.freeze({
  [PAY_CATEGORY.PT_1_1_NEW]: 25000,
  [PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT]: 30000,
  [PAY_CATEGORY.PT_2_1_NEW]: 30000,
  [PAY_CATEGORY.PT_2_1_REPURCHASE]: 35000,
  [PAY_CATEGORY.SERVICE]: 10000,
  [PAY_CATEGORY.LETMEIN]: 28000,
});

/** 단가가 어디서 오는가. 화면은 이 값으로 무엇을 물어볼지 정한다. */
export const UNIT_PRICE_SOURCE = Object.freeze({
  /** 표에 적힌 고정 금액. 물어볼 것이 없다. */
  TABLE: "table",
  /** 담당 강사의 풀방금액. 강사가 정해지면 따라온다. */
  FULL_ROOM_RATE: "full_room_rate",
  /** 사람이 직접 넣는다. */
  MANUAL: "manual",
});

/**
 * @param {string} payCategory
 * @returns {string} UNIT_PRICE_SOURCE 중 하나
 */
export function unitPriceSourceFor(payCategory) {
  const category = String(payCategory ?? "");
  if (category in PAY_RATES) return UNIT_PRICE_SOURCE.TABLE;
  if (category === PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL) return UNIT_PRICE_SOURCE.FULL_ROOM_RATE;
  return UNIT_PRICE_SOURCE.MANUAL;
}

/**
 * 표의 고정 단가. 표 밖의 카테고리는 null 이다 -- 0 을 돌려주면 "무료"와 "표가
 * 정해 주지 않는다"가 같은 값이 되어, 묻지 않고 0원으로 발급된다.
 *
 * @param {string} payCategory
 * @returns {number | null}
 */
export function defaultUnitPriceFor(payCategory) {
  const rate = PAY_RATES[String(payCategory ?? "")];
  return typeof rate === "number" ? rate : null;
}

/** 화면이 단가 칸을 보여줘야 하는가. @param {string} payCategory */
export function requiresManualUnitPrice(payCategory) {
  return unitPriceSourceFor(payCategory) === UNIT_PRICE_SOURCE.MANUAL;
}

/** 담당 강사의 풀방금액이 있어야 발급되는가. @param {string} payCategory */
export function requiresFullRoomRate(payCategory) {
  return unitPriceSourceFor(payCategory) === UNIT_PRICE_SOURCE.FULL_ROOM_RATE;
}

/** 빈 칸과 0 을 가른다. Number("") 는 0 이라, 거르지 않으면 빈 칸이 무료가 된다. */
const parsePositiveInt = (value, label) => {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
    return value;
  }
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid ${label}`);
  return parsed;
};

/**
 * 원장에 적을 단가를 정한다. 표에서 오든, 강사의 풀방금액에서 오든, 사람이
 * 넣든, 최종적으로 항목에 박히는 그 값이다.
 *
 * 풀방금액이 0 이거나 비어 있으면 발급을 막는다. 0 을 그대로 받아들이면 그
 * 강사의 재등록 수업이 통째로 무보수로 기록되고, 원장은 고칠 수 없다.
 *
 * @param {string} payCategory
 * @param {{ unitPrice?: number | string | null, fullRoomRate?: number | string | null }} [options]
 * @returns {number}
 */
export function resolveUnitPrice(payCategory, options = {}) {
  const source = unitPriceSourceFor(payCategory);
  if (source === UNIT_PRICE_SOURCE.TABLE) {
    // 표가 값을 정해 주는 카테고리에서는 화면이 보낸 값도 풀방금액도 보지 않는다.
    return /** @type {number} */ (defaultUnitPriceFor(payCategory));
  }
  if (source === UNIT_PRICE_SOURCE.FULL_ROOM_RATE) {
    const rate = parsePositiveInt(options?.fullRoomRate, "fullRoomRate");
    if (rate === 0) throw new Error("Missing fullRoomRate");
    return rate;
  }
  return parsePositiveInt(options?.unitPrice, "unitPrice");
}
