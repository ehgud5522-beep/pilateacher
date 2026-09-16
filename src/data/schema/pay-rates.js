/**
 * 급여 단가표.
 *
 * ── 표는 기준값일 뿐, 기록된 값이 진실이다 ──
 * 여기 적힌 숫자는 발급 화면이 칸을 채워 줄 때만 쓴다. 실제로 급여를 계산하는
 * 값은 언제나 passes/{passId}/ledger 항목에 저장된 unitPrice 다.
 *
 * 단가는 바뀐다. 표를 고쳤을 때 지난달 급여가 함께 흔들리면 이미 정산이 끝난
 * 달의 근거가 사라진다. 원장은 append-only 라 사후 보정도 불가능하다. 그래서
 * 발급·차감 시점의 단가를 항목에 박아 두고, 이 표는 그 시점에 한 번만 읽는다.
 *
 * 급여를 합산하는 코드가 이 파일을 참조하면 그 원칙이 깨진다. 계산은 원장을
 * 읽어야 한다.
 *
 * constants.js 와 나눠 둔 이유는 성격이 달라서다. PAY_CATEGORY 는 저장값이라
 * 규칙·인덱스·이미 저장된 문서가 걸려 있어 함부로 못 바꾸지만, 단가는 센터가
 * 정하기 나름이고 실제로 바뀐다.
 */

import { PAY_CATEGORY } from "./constants.js";

/**
 * 카테고리별 기본 단가(원). null 은 "표로 정할 수 없다"는 뜻이고, 발급 화면이
 * 사람에게 물어본다.
 *
 * - pt_1_1_repurchase_normal 은 강사별 풀방금액이라 아직 미확정이다. 강사마다
 *   다른 값을 표 하나에 적을 수 없으므로, 정해질 때까지 입력받는다.
 * - etc 는 정의상 표 밖의 건이다.
 */
export const PAY_RATES = Object.freeze({
  [PAY_CATEGORY.PT_1_1_NEW]: 25000,
  [PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT]: 30000,
  [PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL]: null,
  [PAY_CATEGORY.PT_2_1_NEW]: 30000,
  [PAY_CATEGORY.PT_2_1_REPURCHASE]: 35000,
  [PAY_CATEGORY.SERVICE]: 10000,
  [PAY_CATEGORY.LETMEIN]: 28000,
  [PAY_CATEGORY.ETC]: null,
});

/**
 * 표가 값을 정해 주지 못하는 카테고리인가. 화면은 이때만 단가 칸을 보여준다.
 * @param {string} payCategory
 */
export function requiresManualUnitPrice(payCategory) {
  return PAY_RATES[String(payCategory ?? "")] == null;
}

/**
 * 표의 기준 단가. 표에 없거나 미확정이면 null 이다 — 0 을 돌려주면 "무료"와
 * "아직 모른다"가 같은 값이 되어, 물어보지 않고 0원으로 발급된다.
 * @param {string} payCategory
 * @returns {number | null}
 */
export function defaultUnitPriceFor(payCategory) {
  const rate = PAY_RATES[String(payCategory ?? "")];
  return typeof rate === "number" ? rate : null;
}

/**
 * 원장에 적을 단가를 정한다. 표에서 오든 사람이 넣든, 최종적으로 항목에 박히는
 * 그 값이다.
 *
 * @param {string} payCategory
 * @param {number | string | null | undefined} manualUnitPrice 화면이 받은 값
 * @returns {number}
 */
export function resolveUnitPrice(payCategory, manualUnitPrice) {
  const fromTable = defaultUnitPriceFor(payCategory);
  if (fromTable !== null) return fromTable;
  /* 빈 칸을 Number() 에 그대로 넘기면 0 이 되어 통과한다 -- 아무도 묻지 않은
     0원짜리 발급이 되고, 그 달 급여가 조용히 빈다. 빈 값은 값이 아니다. */
  if (typeof manualUnitPrice !== "number") {
    const text = String(manualUnitPrice ?? "").trim();
    if (!text) throw new Error("Missing unitPrice");
    const parsed = Number(text);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Invalid unitPrice");
    return parsed;
  }
  if (!Number.isInteger(manualUnitPrice) || manualUnitPrice < 0) throw new Error("Invalid unitPrice");
  return manualUnitPrice;
}
