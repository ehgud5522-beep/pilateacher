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
 * 확정 전 수업료의 합. **빠질 수 없는 것은 세지 않는다.**
 *
 * 미리보기가 "회원권이 없다" 고 답한 사람은 확정해도 한 푼도 나가지 않는다.
 * 그것을 예정에 넣으면 강사는 받을 수 없는 돈을 본다 -- 그리고 월말에 그만큼
 * 비는 이유를 아무도 설명하지 못한다.
 *
 * 추가 관리(디오사)는 PT 줄 **아래 따로** 선다. 한 수업에서 회원권 둘이 빠지고
 * 금액도 둘이라, 한쪽만 세면 그만큼 모자란다.
 *
 * @param {{
 *   schedule?: Array<any>, month?: string,
 *   rateOf?: (lesson: any) => Map<string, any> | null,
 * }} input
 * @returns {{ total: number, sessions: number, lessons: number, blocked: number }}
 */
export function upcomingPayPreview({ schedule, month, rateOf } = {}) {
  const lessons = unsettledLessonsOf(schedule, month);
  let total = 0;
  let sessions = 0;
  let blocked = 0;

  for (const lesson of lessons) {
    const rates = typeof rateOf === "function" ? rateOf(lesson) : null;
    if (!rates || typeof rates.get !== "function") continue;
    for (const attendee of attendeesOf(lesson)) {
      const row = rates.get(text(attendee?.memberId));
      if (!row) continue;
      /* 빠질 수 없는 사람. 사유가 있으면 미리보기가 금액 대신 그것을 돌려준다. */
      if (row.skip) { blocked += 1; continue; }
      /* 듀엣은 회원권 하나를 둘이 나눠 쓴다. 차감하는 쪽에만 금액이 붙으므로
         (deducts), 짝까지 세면 한 수업에 두 번 센다. */
      if (row.deducts === false) continue;
      total += count(row.unitPrice);
      sessions += 1;
      // 추가 관리는 같은 사람의 두 번째 줄이다. 금액도 회차도 따로 간다.
      if (row.care && !row.care.skip && row.care.deducts !== false) {
        total += count(row.care.unitPrice);
        sessions += 1;
      }
    }
  }

  return { total, sessions, lessons: lessons.length, blocked };
}
