/**
 * 일정 고치기 · 지우기를 한 번에 (2026-10-30, 회원 앱 개편 4단계). **순수 함수다.**
 *
 * ── 왜 있는가 ──
 * 일정이 등록 즉시 회원 앱에 나간다(3단계). 잘못 넣은 일정은 회원이 먼저 본다.
 * 그런데 고치려면 "수업 관리" → "일정 정보 수정" → "수정 저장" 을, 지우려면 시트
 * 맨 아래 버튼 → "삭제할까요?" 를 지나야 했다. 대표 결정: 고치기 · 지우기를 한
 * 번에.
 *
 * ── 확정된 수업은 지우지도, 시간을 바꾸지도 않는다 ──
 * 확정은 원장에 차감을 박는다(append-only). 전에는 확정된 수업도 지울 수 있었고,
 * 그러면 일정은 사라지는데 차감과 급여는 남았다 -- 무엇이 나갔는지 되짚을 수업이
 * 없어진다. 시간을 바꾸면 원장의 수업 시각(occurredAt)과 일정이 어긋난다. 고치려면
 * 확정을 먼저 되돌린다(대표). 서버 쪽도 완료된 수업을 일정이 덮지 않는다
 * (lesson-schedule-repository.js) -- 여기는 그 앞, 화면에서 막는 자리다.
 *
 * ── 한 번에 지우되, 되돌릴 수 있게 ──
 * 확인 창 대신 바로 지우고 "되돌리기" 를 준다. 되돌리면 같은 id 로 다시 들어가고,
 * 회원 앱에도 다시 예정으로 나간다. 출석으로 회차를 뺀 수업(기기 모드의 deductFrom)
 * 은 지우면 회차가 돌아온다 -- 되돌리기로 그것까지 되짚을 수는 없으니, 그런 수업만
 * 지금처럼 한 번 묻는다.
 */

import { attendeesOf, isSettledLesson } from "./lesson-settlement.js";

export const DELETE_MODE = Object.freeze({
  /** 지울 수 없다 (확정된 수업). */
  BLOCKED: "blocked",
  /** 한 번 묻고 지운다 (회차가 돌아오는 수업). */
  CONFIRM: "confirm",
  /** 바로 지우고 되돌리기를 준다. */
  ONE_TAP: "one_tap",
});

export const DELETE_BLOCK_REASON = Object.freeze({
  MISSING: "missing",
  SETTLED: "settled",
  /** 다른 기기에서 확정됐다 (동기화 2단계). 이 기기에는 확정 기록이 없다. */
  SETTLED_ELSEWHERE: "settled_elsewhere",
});

/** 다른 기기에서 확정된 수업인가 -- 서버를 읽어 합칠 때 표시된다 (schedule-sync.js). */
export const isSettledElsewhere = (lesson) => Boolean(lesson?.settledElsewhereAt);

/** 확정으로 잠긴 수업인가 -- 이 기기에서든 다른 기기에서든. */
export const isLockedBySettlement = (lesson) => isSettledLesson(lesson) || isSettledElsewhere(lesson);

/** 확정된 수업을 지우거나 고치려 할 때. 되돌릴 수 있는 사람에 따라 다음 할 일이 다르다. */
export function settledLockNotice({ canUnsettle = false, elsewhere = false } = {}) {
  if (elsewhere) {
    return canUnsettle
      ? "다른 기기에서 확정된 수업이에요. 지우거나 시간을 바꾸려면 그 기기에서 확정을 먼저 되돌려 주세요."
      : "다른 기기에서 확정된 수업이에요. 지우거나 시간을 바꿀 수 없어요. 대표에게 확정 되돌리기를 요청해 주세요.";
  }
  return canUnsettle
    ? "확정된 수업은 지우거나 시간을 바꿀 수 없어요. 확정을 먼저 되돌려 주세요."
    : "확정된 수업은 지우거나 시간을 바꿀 수 없어요. 대표에게 확정 되돌리기를 요청해 주세요.";
}

/**
 * 이 일정을 어떻게 지우는가.
 * @returns {{ mode: string, reason: string }}
 */
export function lessonDeletePolicy(lesson) {
  if (!lesson?.id) return { mode: DELETE_MODE.BLOCKED, reason: DELETE_BLOCK_REASON.MISSING };
  if (isSettledLesson(lesson)) return { mode: DELETE_MODE.BLOCKED, reason: DELETE_BLOCK_REASON.SETTLED };
  if (isSettledElsewhere(lesson)) return { mode: DELETE_MODE.BLOCKED, reason: DELETE_BLOCK_REASON.SETTLED_ELSEWHERE };
  if (attendeesOf(lesson).some((attendee) => attendee?.deductFrom)) return { mode: DELETE_MODE.CONFIRM, reason: "" };
  return { mode: DELETE_MODE.ONE_TAP, reason: "" };
}

/** 날짜 · 시간 · 회원을 고칠 수 있는가. 확정된 수업만 잠근다. */
export const canEditLessonInfo = (lesson) => !isLockedBySettlement(lesson);

/**
 * 시트를 열자마자 고치는 칸을 펼칠까.
 *
 * 앞날의 일정을 여는 것은 거의 "잘못 넣은 것을 고치러" 다 -- 출석할 것이 아직
 * 없다. 오늘과 지난 수업은 출석 · 확정 자리가 먼저다. 그때는 지금처럼 요약 줄
 * 하나와 "일정 정보 수정" 이 위에 있다.
 */
export function opensEditingFirst(lesson, today) {
  if (!lesson?.id || !canEditLessonInfo(lesson)) return false;
  return String(lesson.date || "") > String(today || "");
}

/**
 * 지운 일정을 되돌린다. 그사이 같은 id 가 이미 돌아와 있으면 그대로 둔다 --
 * 되돌리기를 두 번 눌러도 한 건이다.
 */
export function restoreDeletedLesson(schedule, lesson) {
  const list = Array.isArray(schedule) ? schedule : [];
  if (!lesson?.id || list.some((item) => item?.id === lesson.id)) return list;
  return [...list, lesson];
}
