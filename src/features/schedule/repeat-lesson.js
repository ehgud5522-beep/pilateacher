/**
 * 같은 회원 · 같은 시간으로 다음 주 수업 등록 (2026-11-15 강사 제보: "같은 회원 다음 주 똑같은
 * 수업 일정 등록하기 버튼 -- 고정 시간대를 미리 예약할 수 있게").
 *
 * 수업 상세에서 한 번 눌러 7일 뒤 같은 시각에 예약한다. 판정만 여기 두고, 저장은 일정 등록과
 * 같은 길(saveSchedule)을 지난다 -- 홀딩 검사 · 서버 동기화 · 알림이 거기 있다.
 *
 * 복사하는 것: 날짜(+7) · 시작 · 끝 · 종류 · 강사 · 방 · 기구 · 그룹 정원 · 회원.
 * 복사하지 않는 것: 출석 상태(전부 예약으로) · 차감 · 노쇼 · 확정 · 회원 취소 · 메모 · AI 추천.
 * 메모와 추천은 그 수업의 것이라 다음 주에 그대로 서면 지난 내용을 새 것으로 읽는다.
 */

import { freesSlot as freesCancelledSlot } from "./member-cancel-view.js";

const text = (value) => String(value ?? "").trim();
const minutes = (hhmm) => {
  const [h, m] = text(hhmm).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

/** "YYYY-MM-DD" + n일. 시간대와 무관하게 달력 날짜만 옮긴다. */
export function addDaysISO(date, days) {
  const [y, m, d] = text(date).split("-").map(Number);
  if (!y || !m || !d) return "";
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return at.toISOString().slice(0, 10);
}

const attendeeIds = (lesson) => (Array.isArray(lesson?.attendees) ? lesson.attendees : [])
  .map((item) => text(item?.memberId)).filter(Boolean);

/** 전부 취소된 수업은 그 시간을 막지 않는다 -- 등록 화면과 같은 판정을 쓴다. */
const freesSlot = (lesson) => !lesson || Boolean(lesson.deletedAt) || freesCancelledSlot(lesson);

export const REPEAT_BLOCK = Object.freeze({
  NOT_MEMBER_LESSON: "not_member_lesson",
  ALREADY_BOOKED: "already_booked",
  NO_REMAINING: "no_remaining",
});

/**
 * @param {{ lesson: any, schedule?: any[], newId: string, remainingOf?: (memberId: string) => number }} input
 * @returns {{ lesson: any|null, block: string|null, blockedMemberIds: string[], clashes: any[] }}
 *   block 이 있으면 등록하지 않는다. clashes 는 다른 수업과 시간이 겹치는 것 -- 막지 않고 묻는다
 *   (등록 화면도 "겹쳐서 등록됩니다" 경고만 한다).
 */
export function planNextWeekLesson({ lesson, schedule = [], newId, remainingOf = null }) {
  const ids = attendeeIds(lesson);
  const empty = { lesson: null, blockedMemberIds: [], clashes: [] };
  if (!lesson || lesson.personal || !ids.length || !text(lesson.date) || !text(lesson.start)) {
    return { ...empty, block: REPEAT_BLOCK.NOT_MEMBER_LESSON };
  }
  const date = addDaysISO(lesson.date, 7);
  const start = text(lesson.start);
  const end = text(lesson.end) || start;
  const myStart = minutes(start);
  const myEnd = Number.isFinite(minutes(end)) && minutes(end) > myStart ? minutes(end) : myStart + 50;
  const sameDay = (Array.isArray(schedule) ? schedule : []).filter((item) => text(item?.date) === date && !freesSlot(item));

  /* 같은 회원이 같은 시각에 이미 있으면 두 번 만들지 않는다 -- 버튼을 두 번 누른 경우가 대부분이다. */
  const already = sameDay.find((item) => text(item.start) === start && attendeeIds(item).some((id) => ids.includes(id)));
  if (already) return { ...empty, block: REPEAT_BLOCK.ALREADY_BOOKED, clashes: [already] };

  /* 잔여 0회인 회원은 등록 화면처럼 막는다. 다음 주에 쓸 회차가 없다. */
  const blockedMemberIds = typeof remainingOf === "function" ? ids.filter((id) => !(Number(remainingOf(id)) > 0)) : [];
  if (blockedMemberIds.length) return { ...empty, block: REPEAT_BLOCK.NO_REMAINING, blockedMemberIds };

  const clashes = sameDay.filter((item) => {
    const a = minutes(item.start);
    const b = Number.isFinite(minutes(item.end)) && minutes(item.end) > a ? minutes(item.end) : a + 50;
    return myStart < b && a < myEnd;
  });

  const isGroup = lesson.groupCount !== undefined && lesson.groupCount !== null;
  const copy = {
    id: newId, date, start, end: text(lesson.end) || undefined,
    type: lesson.type, instructor: lesson.instructor || "", room: lesson.room || "", memo: "",
    ...(Array.isArray(lesson.equipmentIds) ? { equipmentIds: [...lesson.equipmentIds] } : {}),
    ...(lesson.equip ? { equip: lesson.equip } : {}),
    ...(isGroup ? { groupCount: lesson.groupCount, actualCount: 0, noshowCount: 0, groupDone: false, groupCancelled: false } : {}),
    /* 새 칸(예: 원본 수업 id)은 넣지 않는다 -- 서버 수업 문서의 규칙이 모르는 칸을 거절할 수 있다.
       등록 화면이 만드는 것과 같은 모양이어야 같은 길로 저장된다. */
    attendees: ids.map((memberId) => ({ memberId, status: "booked", deductFrom: null, noshowFee: null })),
  };
  Object.keys(copy).forEach((key) => { if (copy[key] === undefined) delete copy[key]; });
  return { lesson: copy, block: null, blockedMemberIds: [], clashes };
}
