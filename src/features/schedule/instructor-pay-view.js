/**
 * 강사 급여 화면이 보여 줄 숫자를 **이미 계산된 값에서** 꺼낸다 (2026-11-04).
 *
 * ── 계산은 여기서 하지 않는다 ──
 * 금액과 회차는 전부 summarizeInstructorPay 에 맡긴다 -- 급여 화면 · 대표의
 * 급여 집계 · 정산 CSV 가 쓰는 그 함수다. 여기서 `단가 × 회차` 를 다시 곱하면
 * 세 화면 중 하나가 다른 숫자를 말하는 날이 온다. 이 파일이 하는 일은 같은
 * 항목들을 **보여 줄 묶음으로 나누는 것**뿐이고, 묶음의 합은 언제나 원래
 * 합계와 같다 (테스트가 묶어 둔다).
 *
 * ── 무엇으로 나누는가 ──
 *   수업      차감 항목을 (구분 · 단가) 로. "1:1 재등록 ₩30,000 × 3건 = ₩90,000"
 *   서비스 수업  서비스 회차 중 센터가 수업료를 내는 것 (판정 service_first). 화면 이름은
 *              "서비스 수업" -- "센터 지원" 은 타지점 지원과 헷갈린다 (2026-11-04 대표)
 *   보정      되돌린 차감. 금액은 음수다
 *
 * 잔여 조정(adjust)은 급여 항목이 아니다 -- 원장의 급여 질의가 애초에 읽지
 * 않는다 (PAYROLL_ENTRY_TYPES). 그래서 이 화면에 줄이 없다.
 */

import { summarizeInstructorPay } from "../../data/repositories/payroll-repository.js";
import { LEDGER_ENTRY_TYPE } from "../../data/schema/constants.js";
import { PRICING_RULE } from "../../data/schema/deduction-pricing.js";

const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** 묶음 하나의 합. 곱셈은 summarizeInstructorPay 가 한다. */
const totalsOf = (entries) => {
  const summary = summarizeInstructorPay(entries);
  return { sessions: summary.sessions, amount: summary.total };
};

/**
 * 단가별 요약.
 *
 * @param {Array<any>} entries 그 달의 급여 항목 (pay.entries)
 * @returns {{
 *   rows: Array<{ key: string, kind: "lesson" | "support", category: string, unitPrice: number, sessions: number, amount: number }>,
 *   correction: { count: number, sessions: number, amount: number },
 *   total: number,
 * }}
 */
export function unitPriceSummary(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  /** @type {Map<string, { kind: "lesson" | "support", category: string, unitPrice: number, entries: Array<any> }>} */
  const groups = new Map();
  const corrections = [];
  for (const entry of list) {
    if (entry.type === LEDGER_ENTRY_TYPE.CORRECTION) { corrections.push(entry); continue; }
    const kind = entry.rule === PRICING_RULE.SERVICE_FIRST ? "support" : "lesson";
    const category = String(entry.category || "");
    const unitPrice = count(entry.unitPrice);
    const key = `${kind}|${category}|${unitPrice}`;
    if (!groups.has(key)) groups.set(key, { kind, category, unitPrice, entries: [] });
    groups.get(key).entries.push(entry);
  }
  const rows = [...groups].map(([key, group]) => ({
    key, kind: group.kind, category: group.category, unitPrice: group.unitPrice, ...totalsOf(group.entries),
  }))
    /* 수업이 먼저, 서비스 수업이 뒤. 그 안에서는 금액이 큰 줄이 위 -- 강사가
       먼저 확인하고 싶은 순서다. */
    .sort((left, right) => (left.kind === right.kind ? 0 : left.kind === "lesson" ? -1 : 1)
      || right.amount - left.amount
      || right.unitPrice - left.unitPrice);
  return {
    rows,
    correction: { count: corrections.length, ...totalsOf(corrections) },
    total: summarizeInstructorPay(list).total,
  };
}

/**
 * 맨 위 두 숫자. 확정과 확정 대기는 **따로 둔다** -- 앞은 원장에 박혀 있고,
 * 뒤는 회원권이 모자라면 나가지 않는다. 합친 값은 그 아래 한 줄로만 쓴다.
 *
 * @param {{ total?: number } | null} pay loadInstructorMonthlyPay 의 결과
 * @param {{ total?: number, lessons?: number } | null} upcoming upcomingPayPreview 의 결과
 */
export function payHeadline(pay, upcoming) {
  const confirmed = count(pay?.total);
  const pendingAmount = count(upcoming?.total);
  const pendingLessons = count(upcoming?.lessons);
  return { confirmed, pendingAmount, pendingLessons, withPending: confirmed + pendingAmount };
}
