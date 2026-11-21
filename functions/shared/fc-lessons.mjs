/**
 * 강사 FC 복지 수업료 (2026-11-21 대표 결정). 앱 · 서버가 이 파일 하나를 같이 쓴다.
 *
 * FC(센터 직원, role manager)가 복지로 강사에게 수업을 받으면 그 강사가 수업료를 받는다:
 *   진행 25,000원 · 캔슬 15,000원.
 *  - **FC 한 명당 한 달 8회까지** -- 진행과 캔슬을 합쳐, 어느 강사에게 받았든 (대표 결정 "FC 1명당 진행+캔슬 8회")
 *  - **그 달에 대표 · 총괄이 지정한 강사만** FC 수업을 넣을 수 있다 (fcLessonDesignations/{YYYY-MM})
 *  - 강사가 넣고, FC · 대표 · 총괄이 확정한다 (두 장부 대조 없음). 확정은 서버(confirmFcLessonMonth)가 한도 · 지정을 다시 본다.
 *    수업을 받은 FC 본인은 그 강사의 달을 확정하지 못한다 -- 자기가 받은 수업을 자기가 확정하는 셈이다.
 * 매출 인센과는 따로 정산한다 (급여 집계의 "FC 수업료" 칸).
 * 순수 함수다.
 */

const text = (value) => String(value ?? "").trim();
const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const FC_LESSON_OUTCOME = Object.freeze({ DONE: "done", CANCEL: "cancel" });
export const FC_LESSON_OUTCOME_LABELS = Object.freeze({ done: "진행", cancel: "캔슬" });
export const FC_LESSON_RATE = Object.freeze(/** @type {Record<string, number>} */ ({ done: 25000, cancel: 15000 }));
const OUTCOMES = /** @type {string[]} */ (Object.values(FC_LESSON_OUTCOME));
export const FC_LESSON_MONTHLY_CAP = 8;
export const FC_LESSON_CONFIRMED_INBOX_KIND = "fc_lessons_confirmed";

const millisOf = (value) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : 0;
};

/** 한 줄의 수업료. */
export const fcLessonAmount = (entry) => FC_LESSON_RATE[text(entry?.outcome)] || 0;

/** 강사 한 명 · 한 달의 합. */
export function fcLessonTotals(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const done = list.filter((entry) => text(entry.outcome) === FC_LESSON_OUTCOME.DONE).length;
  const cancel = list.filter((entry) => text(entry.outcome) === FC_LESSON_OUTCOME.CANCEL).length;
  return { done, cancel, count: done + cancel, amount: done * FC_LESSON_RATE.done + cancel * FC_LESSON_RATE.cancel };
}

/**
 * 한도 판정. 그 달 **모든 강사**의 줄을 FC 별로 수업일 · 넣은 시각 순으로 세어, 9번째부터를 넘친 줄로 본다.
 * @param {any[]} entries  그 달 센터 전체 fcLessons
 * @returns {{ byFc: Map<string, { count: number, remaining: number }>, overIds: Set<string> }}
 */
export function fcCapCheck(entries) {
  const byFc = new Map();
  const overIds = new Set();
  const sorted = (Array.isArray(entries) ? entries : []).filter(Boolean)
    .slice().sort((left, right) => text(left.lessonDate).localeCompare(text(right.lessonDate)) || millisOf(left.createdAt) - millisOf(right.createdAt) || text(left.id).localeCompare(text(right.id)));
  for (const entry of sorted) {
    const fc = text(entry.fcUserId);
    const current = byFc.get(fc) || { count: 0, remaining: FC_LESSON_MONTHLY_CAP };
    current.count += 1;
    if (current.count > FC_LESSON_MONTHLY_CAP) overIds.add(text(entry.id));
    current.remaining = Math.max(0, FC_LESSON_MONTHLY_CAP - current.count);
    byFc.set(fc, current);
  }
  return { byFc, overIds };
}

/** 그 달 지정 강사인가. designation = fcLessonDesignations/{month} 문서 (없으면 아무도 아님). */
export const isDesignated = (designation, instructorId) => (Array.isArray(designation?.instructorIds) ? designation.instructorIds.map(text) : []).includes(text(instructorId));

/**
 * 저장 전 문제 코드. 규칙과 같은 판단 + 한도 (앱이 먼저 막는다).
 * @param {any} entry
 * @param {{ designation?: any, monthEntries?: any[] }} [context]  monthEntries = 그 달 센터 전체 줄 (고치는 줄 자신은 빼고 센다)
 */
export function fcLessonProblems(entry, { designation = null, monthEntries = null } = {}) {
  const problems = [];
  if (!MONTH.test(text(entry?.month))) problems.push("month_invalid");
  if (!DATE.test(text(entry?.lessonDate)) || text(entry?.lessonDate).slice(0, 7) !== text(entry?.month)) problems.push("lesson_date_invalid");
  if (!OUTCOMES.includes(text(entry?.outcome))) problems.push("outcome_required");
  if (!text(entry?.fcUserId)) problems.push("fc_required");
  if (text(entry?.fcUserId) && text(entry?.fcUserId) === text(entry?.instructorId)) problems.push("fc_is_instructor");
  if (designation !== null && !isDesignated(designation, entry?.instructorId)) problems.push("not_designated");
  if (designation !== null && text(entry?.fcUserId) && !(Array.isArray(designation?.fcUserIds) ? designation.fcUserIds.map(text) : []).includes(text(entry.fcUserId))) problems.push("fc_unknown");
  if (Array.isArray(monthEntries) && text(entry?.fcUserId)) {
    const others = monthEntries.filter((item) => text(item?.fcUserId) === text(entry.fcUserId) && text(item?.id) !== text(entry?.id));
    if (others.length >= FC_LESSON_MONTHLY_CAP) problems.push("fc_cap_reached");
  }
  return problems;
}

export const FC_LESSON_PROBLEM_TEXT = Object.freeze({
  month_invalid: "달이 맞지 않아요",
  lesson_date_invalid: "수업일을 이 달 안으로 골라 주세요",
  outcome_required: "진행인지 캔슬인지 골라 주세요",
  fc_required: "수업을 받은 FC 를 골라 주세요",
  fc_is_instructor: "자기 자신은 고를 수 없어요",
  fc_unknown: "이번 달 FC 명단에 없는 사람이에요 -- 대표 · 총괄이 지정할 때 명단이 정해져요",
  not_designated: "이번 달 FC 수업 지정 강사가 아니에요 -- 대표 · 총괄이 지정해요",
  fc_cap_reached: `그 FC 는 이번 달 ${FC_LESSON_MONTHLY_CAP}회를 다 받았어요 (진행 + 캔슬)`,
});

const won = (value) => `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
const monthTitle = (month) => { const [year, value] = text(month).split("-").map(Number); return Number.isFinite(value) ? `${year}년 ${value}월` : text(month); };

/** 대표 알림함 한 줄 (FC 가 확정했을 때). FC 이름은 수업을 받은 직원 -- 회원이 아니다. */
export function fcLessonsConfirmedNotice({ confirmerName, instructorName, month, snapshot }) {
  return {
    title: "[FC 수업료 확정]",
    body: `${text(confirmerName)} 님이 ${text(instructorName)} 강사의 ${monthTitle(month)} FC 복지 수업료를 확정했어요 · ${won(snapshot?.amount)} (진행 ${Number(snapshot?.done) || 0}회 · 캔슬 ${Number(snapshot?.cancel) || 0}회)`,
  };
}
