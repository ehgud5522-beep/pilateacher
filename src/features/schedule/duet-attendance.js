/**
 * 여러 명 수업(듀엣)의 출석 — 확정 전에 **전원**을 정한다 (2026-11-06 대표).
 *
 * ── 왜 ──
 * 확정 버튼은 출석이 한 명이라도 정해지면 열렸다 (canSettleLesson). 강사가 한
 * 사람만 [출석]을 누르고 확정하면 다른 사람은 서버에 "예약" 그대로 올라갔다 --
 * 최근 60일 확정된 듀엣 125건 중 48건이 그랬다. 차감은 맞다 (2:1 은 두 회원이
 * 함께 쓰는 회원권 한 장이라 한 번 빠진다). 틀린 것은 그 회원의 출석 기록이다.
 *
 * 그래서 두 가지:
 *   1. 확정 전 막기 -- 여러 명 수업은 전원이 출석 · 노쇼 · 취소 중 하나여야 한다
 *   2. 이미 확정된 수업은 고치지 않는다. 대표가 볼 목록으로만 모은다
 *
 * 판정만 둔다. 읽기 · 쓰기는 부르는 쪽이 한다.
 */

import { attendeesOf } from "./lesson-settlement.js";
import { lessonTypeKeyOf } from "./lesson-types.js";

const text = (value) => String(value ?? "").trim();

/** 아직 아무것도 고르지 않은 사람 (기기의 "booked"). */
export const UNMARKED_STATUS = "booked";

/**
 * 확정을 막는 사람들. **듀엣만** 본다 -- 한 명 수업과 그룹 수업은 전과 같다
 * (그룹은 오지 않은 사람을 "예약" 으로 두는 운영이 있어 이번 결정 밖이다).
 *
 * @param {any} lesson
 * @returns {Array<string>} 출석을 아직 안 고른 회원 id
 */
export function unmarkedAttendeeIds(lesson) {
  if (lessonTypeKeyOf(lesson) !== "duet") return [];
  const list = attendeesOf(lesson);
  if (list.length < 2) return [];
  return list
    .filter((attendee) => (text(attendee.status) || UNMARKED_STATUS) === UNMARKED_STATUS)
    .map((attendee) => text(attendee.memberId))
    .filter(Boolean);
}

/**
 * 확정 버튼 아래에 띄울 말. 막을 것이 없으면 빈 문자열.
 *
 * @param {any} lesson
 * @param {(memberId: string) => string} nameOf 화면의 회원 이름
 */
export function unmarkedSettleMessage(lesson, nameOf = () => "") {
  const ids = unmarkedAttendeeIds(lesson);
  if (ids.length === 0) return "";
  const names = ids.map((id) => text(nameOf(id)) || "회원").join(" · ");
  return `${names}님 출석을 표시해 주세요`;
}

/** 서버 참석 문서의 "아직 안 고름". */
const SERVER_UNMARKED = "booked";

/**
 * 이미 확정된 여러 명 수업 중 참석 문서에 "예약" 이 남은 것 -- 대표 확인 목록.
 *
 * **고치지 않는다.** 차감은 이미 맞게 나갔고, 그 사람이 왔는지는 그 자리에 있던
 * 강사만 안다. 짐작해서 출석으로 바꾸면 기록이 거짓이 된다.
 *
 * @param {Array<any>} lessons 서버 lessons 문서 (id, clientIds, status, startsAt, ...)
 * @param {Map<string, Array<any>>} participantsByLesson lessonId → participants 문서들
 * @param {{ since?: Date }} [options]
 */
export function settledDuetsWithUnmarked(lessons, participantsByLesson, options = {}) {
  const since = options.since instanceof Date ? options.since.getTime() : -Infinity;
  const rows = [];
  for (const lesson of Array.isArray(lessons) ? lessons : []) {
    const clientIds = Array.isArray(lesson?.clientIds) ? lesson.clientIds.map(text).filter(Boolean) : [];
    if (clientIds.length < 2) continue;
    if (text(lesson?.status) !== "completed") continue;
    if (lesson?.deletedAt) continue;
    const at = new Date(lesson?.startsAt?.toDate ? lesson.startsAt.toDate() : lesson?.startsAt).getTime();
    if (!Number.isFinite(at) || at < since) continue;
    const parts = (participantsByLesson.get(text(lesson?.id || lesson?.lessonId)) || [])
      .filter((part) => clientIds.includes(text(part?.clientId || part?.id)));
    const unmarked = parts.filter((part) => (text(part?.attendanceStatus) || SERVER_UNMARKED) === SERVER_UNMARKED);
    if (unmarked.length === 0) continue;
    rows.push({
      lessonId: text(lesson?.id || lesson?.lessonId),
      startsAt: new Date(at),
      locationId: text(lesson?.locationId),
      instructorId: text(lesson?.instructorId),
      members: clientIds.length,
      unmarked: unmarked.length,
    });
  }
  return rows.sort((left, right) => right.startsAt.getTime() - left.startsAt.getTime());
}
