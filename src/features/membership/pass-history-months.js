/**
 * 회원권 이력을 달로 묶는다 (2026-11-04 대표).
 *
 * 한 회원의 원장이 백 줄을 넘으면서 한 줄로 늘어놓은 이력에서 "이번 달 몇 번
 * 왔나" 를 셀 수 없게 됐다. 달마다 머리줄 하나 — "11월 · 차감 2회 · 보정 0건".
 *
 * ── 무엇을 세는가 ──
 *   차감  deduct 항목의 회차 (−delta). 나중에 보정된 것도 그 달에 차감은 있었다
 *   보정  correction 항목의 건수
 *   급여  deduct + correction 의 금액 (summarizeInstructorPay 와 같은 식).
 *         **대표 · 총괄매니저에게만 보인다** -- 화면이 그 판단을 한다
 *
 * 달은 수업일(occurredAt) 기준, 기기 시간대다. 급여 화면과 같은 기준이다.
 * 조정 · 보정 · 세션업 줄도 그대로 그 달에 들어간다 -- 묶는다고 빠지지 않는다.
 */

import { LEDGER_ENTRY_TYPE } from "../../data/schema/constants.js";
import {
  PAYROLL_ENTRY_TYPES, summarizeInstructorPay, toDate,
} from "../../data/repositories/payroll-repository.js";

export const ALL_PASSES = "all";
export const UNKNOWN_MONTH = "unknown";

/** @param {unknown} value */
export function monthKeyOf(value) {
  const at = toDate(value);
  if (!Number.isFinite(at.getTime())) return UNKNOWN_MONTH;
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 회원권 칩으로 거른 뒤 달로 묶는다. 최근 달이 앞, 날짜를 못 읽은 줄은 맨 뒤.
 * 달 안의 순서는 받은 그대로다.
 *
 * @param {Array<any>} entries
 * @param {{ passId?: string }} [filter]
 */
export function historyMonths(entries, filter = {}) {
  const passId = String(filter.passId || ALL_PASSES);
  /** @type {Map<string, Array<any>>} */
  const byMonth = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry) continue;
    if (passId !== ALL_PASSES && String(entry.passId || "") !== passId) continue;
    const key = monthKeyOf(entry.occurredAt);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(entry);
  }
  return [...byMonth]
    .sort(([left], [right]) => {
      if (left === UNKNOWN_MONTH) return 1;
      if (right === UNKNOWN_MONTH) return -1;
      return right.localeCompare(left);
    })
    .map(([key, rows]) => ({
      key,
      entries: rows,
      deductSessions: rows
        .filter((entry) => entry.type === LEDGER_ENTRY_TYPE.DEDUCT)
        .reduce((sum, entry) => sum - (Number(entry.delta) || 0), 0),
      corrections: rows.filter((entry) => entry.type === LEDGER_ENTRY_TYPE.CORRECTION).length,
      payTotal: summarizeInstructorPay(rows.filter((entry) => PAYROLL_ENTRY_TYPES.includes(entry.type))).total,
    }));
}

/**
 * 달 머리줄. 올해면 "11월", 아니면 "2025년 11월".
 *
 * @param {{ key: string, deductSessions: number, corrections: number, payTotal: number }} month
 * @param {{ now?: Date, showPay?: boolean }} [options]
 */
export function monthHeading(month, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const [year, mm] = month.key.split("-");
  const label = month.key === UNKNOWN_MONTH
    ? "날짜 없음"
    : Number(year) === now.getFullYear() ? `${Number(mm)}월` : `${year}년 ${Number(mm)}월`;
  const parts = [label, `차감 ${month.deductSessions}회`, `보정 ${month.corrections}건`];
  if (options.showPay) parts.push(`급여 ₩${(Number(month.payTotal) || 0).toLocaleString("ko-KR")}`);
  return parts.join(" · ");
}

/** 회원권 칩마다의 줄 수. 줄이 없는 회원권도 칩은 남긴다 (0). */
export function entryCountsByPass(entries) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = String(entry?.passId || "");
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}
