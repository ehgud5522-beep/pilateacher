/**
 * 순서가 틀린 차감이 **얼마짜리였는가**, 그리고 잔여를 어떻게 되돌리는가.
 *
 * audit-deduction-order 는 "어느 것이 틀렸는가" 까지 답한다. 그다음 대표가
 * 묻는 것은 둘이다 -- 돈이 얼마나 어긋났는가, 그리고 회원권 잔여를 어떻게
 * 맞추는가.
 *
 * ── 차액의 뜻 ──
 * **"맞는 회원권에서 빠졌다면 얼마였을까" 와 실제로 적힌 금액의 차이다.**
 * 회원권마다 기준 단가와 카테고리가 다르므로, 틀린 회원권에서 빠지면 금액도
 * 함께 틀린다. 두 회원권이 같은 단가면 차액은 0 이고, 그래도 **잔여는
 * 되돌려야 한다** -- 만료가 이른 쪽이 그만큼 더 사라진다.
 *
 * ── 잔여 정정 ──
 * 되돌리는 방향은 둘뿐이다. 잘못 빠진 회원권은 **돌려받고**(+), 빠졌어야 할
 * 회원권은 **빼야 한다**(-). 두 수를 회원권별로 합쳐서 낸다.
 *
 * 원장은 append-only 라 지난 항목을 옮길 수 없다. 이 목록은 "사람이 콘솔에서
 * 무엇을 몇 개 움직여야 하는가" 를 적은 것이지, 자동으로 돌릴 것이 아니다.
 */

import { resolveDeductionUnitPrice } from "../../functions/shared/deduction-pricing.mjs";

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/**
 * 한 줄의 차액. **맞는 회원권의 값으로 다시 계산한다.**
 *
 * 누적(priorSessions)과 직급은 **그때 적힌 것을 그대로 쓴다** -- 지금 값으로
 * 다시 세면 이 셈이 "순서가 틀려서 생긴 차이" 가 아니라 "그 뒤에 일어난 모든
 * 것" 을 함께 담게 된다. 여기서 묻는 것은 순서 하나다.
 *
 * @param {{
 *   row?: any, usedEntry?: any, shouldPass?: any, priorSessions?: number,
 *   title?: string, isDeputyDirector?: boolean,
 * }} input
 * @returns {{ oldUnitPrice: number, newUnitPrice: number, difference: number,
 *   newRule: string, unknown: boolean }}
 */
export function impactOfRow({
  row, usedEntry, shouldPass, priorSessions, title, isDeputyDirector,
} = {}) {
  const oldUnitPrice = count(row?.usedUnitPrice ?? usedEntry?.unitPrice);
  /* 맞는 회원권을 못 읽으면 셈하지 않는다. 0 으로 두면 "차액 없음" 과
     구별되지 않고, 그 줄은 조용히 목록에서 사라진 것과 같다. */
  if (!shouldPass) {
    return { oldUnitPrice, newUnitPrice: 0, difference: 0, newRule: "", unknown: true };
  }
  const priced = resolveDeductionUnitPrice({
    category: text(shouldPass.category),
    baseUnitPrice: count(shouldPass.baseUnitPrice),
    netContractPrice: shouldPass.netContractPrice,
    totalSessions: shouldPass.totalSessions,
    isDeputyDirector: isDeputyDirector === true,
    title: text(title),
    handedOver: shouldPass.handedOver === true,
    priorSessions: count(priorSessions),
    serviceUsedCount: count(shouldPass.serviceUsed),
  });
  return {
    oldUnitPrice,
    newUnitPrice: priced.unitPrice,
    difference: priced.unitPrice - oldUnitPrice,
    newRule: priced.rule,
    unknown: false,
  };
}

/**
 * 회원권별 잔여 정정. **잘못 빠진 쪽은 +, 빠졌어야 할 쪽은 -.**
 *
 * @param {Array<any>} rows misorderedDeductions 의 결과
 * @returns {Array<{ passId: string, delta: number, clientId: string }>}
 */
export function remainingCorrections(rows) {
  const map = new Map();
  const bump = (passId, delta, clientId) => {
    const id = text(passId);
    if (!id) return;
    const at = map.get(id) || { passId: id, delta: 0, clientId: text(clientId) };
    at.delta += delta;
    map.set(id, at);
  };
  for (const row of (Array.isArray(rows) ? rows : [])) {
    // 잘못 빠진 회원권은 돌려받는다.
    bump(row?.usedPassId, +1, row?.clientId);
    // 빠졌어야 할 회원권에서 그만큼 나간다.
    bump(row?.shouldPassId, -1, row?.clientId);
  }
  /* 서로 지워져 0 이 된 회원권은 뺀다 -- 움직일 것이 없는 줄을 목록에 남기면
     대표가 그것까지 확인하게 된다. */
  return [...map.values()]
    .filter((item) => item.delta !== 0)
    .sort((left, right) => right.delta - left.delta);
}

/** 강사별 차액 합계. 올라간 것과 내려간 것을 따로 센다. */
export function impactByInstructor(rows) {
  const map = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (row?.unknown) continue;
    const id = text(row.instructorId);
    const at = map.get(id) || { instructorId: id, entries: 0, up: 0, down: 0, difference: 0 };
    at.entries += 1;
    at.difference += row.difference || 0;
    if ((row.difference || 0) > 0) at.up += row.difference;
    else at.down += row.difference || 0;
    map.set(id, at);
  }
  return [...map.values()].sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference));
}

/** 사람이 읽는 요약. */
export function summarizeImpact(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const known = list.filter((row) => !row.unknown);
  return {
    entries: list.length,
    priced: known.length,
    unknown: list.length - known.length,
    increased: known.filter((row) => row.difference > 0).length,
    decreased: known.filter((row) => row.difference < 0).length,
    unchanged: known.filter((row) => row.difference === 0).length,
    totalDifference: known.reduce((sum, row) => sum + (row.difference || 0), 0),
  };
}
