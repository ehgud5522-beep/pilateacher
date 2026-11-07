/**
 * 아직 확정하지 않은 수업의 수업료. **"예정" 으로만 센다.**
 *
 * ── 왜 따로 세는가 ──
 * 강사의 "이달 예상 급여" 는 원장(ledger)에 박힌 차감을 더한 값이다. 확정한
 * 수업만 원장에 들어가므로, 월 중반에는 이미 한 수업의 절반이 그 숫자에 없다.
 * 강사는 그것을 보고 "이번 달은 왜 이렇게 적지" 를 묻는다.
 *
 * 그렇다고 한 숫자로 합치면 안 된다. **확정된 것과 아직 아닌 것은 다른
 * 종류의 숫자다** -- 앞은 원장에 박혀 되돌릴 수 없고, 뒤는 회원권이 모자라면
 * 한 푼도 나가지 않는다. 합쳐 보여주면 강사는 둘을 구분할 수 없고, 월말에
 * 대표의 집계와 다른 숫자를 들고 묻게 된다.
 *
 * 그래서 두 줄이다: 확정 ₩X · 예정 ₩Y.
 *
 * ── 미리보기와 같은 함수를 쓴다 ──
 * 금액은 previewLessonRates 가 정한다 -- 일정 카드의 예상 단가와 같은 값이고,
 * 그것은 다시 확정이 쓰는 planPassSelection 을 지난다. 여기서 한 줄이라도
 * 다시 계산하면 세 화면이 서로 다른 금액을 말하는 날이 온다.
 *
 * ── 확정된 수업은 여기 없다 ──
 * 확정한 순간 그 수업은 원장으로 간다. 여기서도 세면 **두 번 센다.**
 */

import { attendeesOf, isSettledLesson } from "./lesson-settlement.js";

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** 이 일정이 그 달의 것인가. 날짜는 달력 날짜 문자열이다 (YYYY-MM-DD). */
const inMonth = (lesson, month) => text(lesson?.date).slice(0, 7) === text(month);

/**
 * 아직 확정하지 않은, 급여가 걸린 수업.
 *
 * 개인 일정·샘플·그룹 취소는 세지 않는다. 참가자가 없는 기구 그룹도 아니다 --
 * 그쪽은 회원권이 아니라 진행 완료로 세는 수업이고, 원장에 들어가지 않는다.
 */
export function unsettledLessonsOf(schedule, month) {
  return (Array.isArray(schedule) ? schedule : []).filter((lesson) => {
    if (!lesson || lesson.personal || lesson.isSample === true) return false;
    if (!inMonth(lesson, month)) return false;
    if (isSettledLesson(lesson)) return false;
    if (lesson.groupCancelled) return false;
    return attendeesOf(lesson).length > 0;
  });
}

/**
 * 확정 전 수업을 **한 사람 · 한 줄씩** (2026-11-08 내 급여 화면). 금액 판정은 아래 합계와 같은 줄이다 --
 * 합계는 이 줄들을 더한 것이라 둘이 어긋날 수 없다.
 *
 * 빠질 수 없는 사람(skip)은 줄이 아니라 blocked 로만 센다. 듀엣의 짝(deducts:false)은 금액이 없다.
 * 추가 관리(디오사)는 같은 사람의 두 번째 줄이다.
 *
 * @returns {{ rows: Array<{ id: string, lessonId: string, date: string, start: string, memberId: string,
 *   unitPrice: number, care: boolean, isDuet: boolean }>, lessons: number, blocked: number }}
 */
export function upcomingPayRows({ schedule, month, rateOf } = {}) {
  const lessons = unsettledLessonsOf(schedule, month);
  const rows = [];
  let blocked = 0;
  for (const lesson of lessons) {
    const rates = typeof rateOf === "function" ? rateOf(lesson) : null;
    if (!rates || typeof rates.get !== "function") continue;
    const attendees = attendeesOf(lesson);
    for (const attendee of attendees) {
      const memberId = text(attendee?.memberId);
      const row = rates.get(memberId);
      if (!row) continue;
      if (row.skip) { blocked += 1; continue; }
      if (row.deducts === false) continue;
      const base = { lessonId: text(lesson.id), date: text(lesson.date), start: text(lesson.start), memberId, isDuet: attendees.length > 1 };
      rows.push({ ...base, id: `${base.lessonId}|${memberId}`, unitPrice: count(row.unitPrice), care: false });
      if (row.care && !row.care.skip && row.care.deducts !== false) {
        rows.push({ ...base, id: `${base.lessonId}|${memberId}|care`, unitPrice: count(row.care.unitPrice), care: true });
      }
    }
  }
  return { rows, lessons: lessons.length, blocked };
}

/**
 * 확정 전 수업료의 합. **빠질 수 없는 것은 세지 않는다.**
 *
 * 미리보기가 "회원권이 없다" 고 답한 사람은 확정해도 한 푼도 나가지 않는다.
 * 그것을 예정에 넣으면 강사는 받을 수 없는 돈을 본다.
 * 추가 관리(디오사)는 PT 줄 **아래 따로** 선다 -- 한 수업에서 회원권 둘이 빠지고 금액도 둘이다.
 * 금액은 upcomingPayRows 의 줄을 더한 것이다 (내 급여 화면의 줄과 같은 수).
 *
 * @param {{
 *   schedule?: Array<any>, month?: string,
 *   rateOf?: (lesson: any) => Map<string, any> | null,
 * }} input
 * @returns {{ total: number, sessions: number, lessons: number, blocked: number }}
 */
export function upcomingPayPreview(input = {}) {
  const { rows, lessons, blocked } = upcomingPayRows(input);
  return { total: rows.reduce((sum, row) => sum + row.unitPrice, 0), sessions: rows.length, lessons, blocked };
}
