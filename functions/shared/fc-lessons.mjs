/**
 * 강사 FC 복지 수업료 (2026-11-21 대표 결정). 앱 · 서버가 이 파일 하나를 같이 쓴다.
 *
 * FC(센터 직원)가 복지로 강사에게 수업을 받으면 그 강사가 수업료를 받는다: 진행 25,000원 · 캔슬 15,000원.
 *
 * ── 횟수만 넣는다 (같은 날 대표: "FC 는 모두 다 있는 게 아니라서 선택이 불가함. 각 지점당 한 명만 대표가 정하면
 *    강사 FC 수업 진행한 걸로 입력하게, 횟수만") ──
 *  - 대표 · 총괄이 그 달 **지점마다 강사 한 명**을 정한다 (fcLessonDesignations/{YYYY-MM} 의 branches: { 지점: 강사 })
 *  - 지정된 강사는 그 달 **진행 횟수 · 캔슬 횟수만** 넣는다 (누구에게 했는지는 넣지 않는다 -- FC 가 앱에 다 있지 않다)
 *  - 한 달 **진행 + 캔슬 8회**까지 (지점마다 한 사람이므로 지정 강사의 한 달 합으로 센다). 규칙도 같은 상한을 본다
 *  - FC · 대표 · 총괄이 확정한다. 확정은 서버(confirmFcLessonMonth)가 지정 · 횟수를 다시 본다. 자기 수업료는 자기가 확정하지 못한다
 * 매출 인센과는 따로 정산한다.
 * 순수 함수다.
 */

const text = (value) => String(value ?? "").trim();

export const FC_LESSON_RATE = Object.freeze({ done: 25000, cancel: 15000 });
export const FC_LESSON_MONTHLY_CAP = 8;
export const FC_LESSON_CONFIRMED_INBOX_KIND = "fc_lessons_confirmed";

const count = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : NaN;
};

/** 그 달 지정 강사들 (지점 → 강사). */
export function designatedInstructorIds(designation) {
  const branches = designation?.branches && typeof designation.branches === "object" ? designation.branches : {};
  return [...new Set(Object.values(branches).map(text).filter(Boolean))];
}
export const isDesignated = (designation, instructorId) => Boolean(text(instructorId)) && designatedInstructorIds(designation).includes(text(instructorId));
/** 그 강사가 맡은 지점들 (한 강사가 두 지점을 맡을 수도 있다). */
export function branchesOf(designation, instructorId) {
  const branches = designation?.branches && typeof designation.branches === "object" ? designation.branches : {};
  return Object.entries(branches).filter(([, id]) => text(id) === text(instructorId)).map(([branch]) => branch);
}

/** 횟수 → 수업료.
 * @param {{ done?: unknown, cancel?: unknown }} [counts] */
export function fcLessonTotals({ done, cancel } = {}) {
  const d = Number.isFinite(count(done)) ? count(done) : 0;
  const c = Number.isFinite(count(cancel)) ? count(cancel) : 0;
  return { done: d, cancel: c, count: d + c, amount: d * FC_LESSON_RATE.done + c * FC_LESSON_RATE.cancel };
}

/** 남은 횟수.
 * @param {{ done?: unknown, cancel?: unknown }} [counts] */
export const fcRemaining = ({ done, cancel } = {}) => Math.max(0, FC_LESSON_MONTHLY_CAP - fcLessonTotals({ done, cancel }).count);

/**
 * 저장 전 문제 코드 (규칙과 같은 판단).
 * @param {{ done: unknown, cancel: unknown }} counts
 * @param {{ designation?: any, instructorId?: string }} [context]
 */
export function fcCountProblems(counts, { designation = null, instructorId = "" } = {}) {
  const problems = [];
  const done = count(counts?.done);
  const cancel = count(counts?.cancel);
  if (!Number.isFinite(done) || !Number.isFinite(cancel)) problems.push("count_invalid");
  else if (done + cancel > FC_LESSON_MONTHLY_CAP) problems.push("fc_cap_exceeded");
  if (designation !== null && !isDesignated(designation, instructorId)) problems.push("not_designated");
  return problems;
}

export const FC_LESSON_PROBLEM_TEXT = Object.freeze({
  count_invalid: "횟수는 0 이상의 정수로 적어 주세요",
  fc_cap_exceeded: `진행 + 캔슬은 한 달 ${FC_LESSON_MONTHLY_CAP}회까지예요`,
  not_designated: "이번 달 FC 수업 지정 강사가 아니에요 -- 대표 · 총괄이 지점마다 한 명 정해요",
});

const won = (value) => `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
const monthTitle = (month) => { const [year, value] = text(month).split("-").map(Number); return Number.isFinite(value) ? `${year}년 ${value}월` : text(month); };

/** 대표 알림함 한 줄 (FC 등 대표 · 총괄이 아닌 사람이 확정했을 때). */
export function fcLessonsConfirmedNotice({ confirmerName, instructorName, month, snapshot }) {
  return {
    title: "[FC 수업료 확정]",
    body: `${text(confirmerName)} 님이 ${text(instructorName)} 강사의 ${monthTitle(month)} FC 복지 수업료를 확정했어요 · ${won(snapshot?.amount)} (진행 ${Number(snapshot?.done) || 0}회 · 캔슬 ${Number(snapshot?.cancel) || 0}회)`,
  };
}
