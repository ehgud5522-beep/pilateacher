/**
 * "내 만료 회원" 현황 — 강사 화면과 대표 화면이 함께 쓴다.
 *
 * ── 왜 한 파일인가 ──
 * 대표 화면은 강사마다 같은 표를 본다. 따로 세면 두 화면의 숫자가 갈라지고,
 * 그러면 비교가 의미를 잃는다 -- 강사는 자기 화면을 믿고 대표는 자기 화면을
 * 믿는데 둘이 다르면 대화가 안 된다.
 *
 * 세는 일 자체는 functions/shared/instructor-scope.mjs 가 한다. 여기 있는 것은
 * **기간을 고르는 일과 화면에 쓸 말**뿐이다.
 */

import { summarizeExpiries } from "../../data/schema/instructor-scope.js";

/** 어느 기간을 보는가. */
export const EXPIRY_PERIOD = Object.freeze({
  THIS_MONTH: "this_month",
  LAST_MONTH: "last_month",
  ALL: "all",
});

export const EXPIRY_PERIOD_LABELS = Object.freeze({
  [EXPIRY_PERIOD.THIS_MONTH]: "이번 달",
  [EXPIRY_PERIOD.LAST_MONTH]: "지난달",
  [EXPIRY_PERIOD.ALL]: "전체",
});

/**
 * 그 기간의 경계.
 *
 * **센터의 시계로 자른다.** UTC 로 자르면 한국 시각 기준 말일 밤에 끝난
 * 회원권이 다음 달로 넘어간다 -- payroll-repository 의 monthRange 와 같은
 * 이유다.
 *
 * @returns {{ start: Date, end: Date }|undefined} 전체면 undefined -- 기간을
 *   주지 않는다는 뜻이고, 그때 집계는 마지막 만료를 본다.
 */
export function periodRange(period, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  if (period === EXPIRY_PERIOD.THIS_MONTH) {
    return { start: new Date(year, month, 1), end: new Date(year, month + 1, 1) };
  }
  if (period === EXPIRY_PERIOD.LAST_MONTH) {
    return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
  }
  return undefined;
}

/**
 * 한 강사(또는 센터 전체)의 만료·재등록 현황.
 *
 * @param {Array<{ clientId: string, name?: string, passes: Array<any> }>} rows
 * @param {{ period?: string, instructorId?: string, now?: Date,
 *   lastDeductedAtByPassId?: any }} [options]
 */
export function expiryReport(rows, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const period = options.period || EXPIRY_PERIOD.THIS_MONTH;
  return {
    period,
    ...summarizeExpiries(rows, {
      now,
      instructorId: options.instructorId,
      lastDeductedAtByPassId: options.lastDeductedAtByPassId,
      within: periodRange(period, now),
    }),
  };
}

const percent = (rate) => `${Math.round((Number(rate) || 0) * 100)}%`;

/**
 * 한 줄 요약.
 *
 * **아직 30일이 안 지난 건은 따로 말한다.** 그것을 "안 돌아옴" 에 섞으면
 * 이번 달 재등록률이 늘 낮게 나오고, 달이 끝나야 참값이 되는 숫자를 달
 * 중간에 보고 판단하게 된다.
 */
export function expiryReportMessage(report) {
  const expired = Number(report?.expired) || 0;
  if (!expired) return "만료된 회원이 없습니다.";
  const pending = Number(report?.pending) || 0;
  const reenrolled = Number(report?.reenrolled) || 0;
  const head = `${expired}명 중 ${reenrolled}명이 다시 등록했습니다 (${percent(report?.rate)})`;
  if (!pending) return `${head}.`;
  return `${head}. ${pending}명은 아직 30일이 안 지나 세지 않았습니다.`;
}

/** 목록 한 줄의 오른쪽에 붙는 말. */
export function outcomeLabel(outcome) {
  if (outcome === "returned") return "재등록";
  if (outcome === "pending") return "기다리는 중";
  return "";
}
