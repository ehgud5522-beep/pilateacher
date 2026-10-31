/**
 * 확정 직전의 중복 방지 (2026-10-31, 폰 출시 전). **순수 함수다.**
 *
 * 같은 수업이 폰과 PC 에 따로 들어가 있으면(id 가 다르다) 양쪽에서 확정할 때 회원권이 두
 * 번 빠진다. 원장의 차감 항목 id 는 수업마다라 다른 id 의 수업은 막지 못한다. 그래서
 * 확정하기 전에 **같은 강사 · 같은 시각 · 같은 회원으로 이미 확정된 다른 수업**이 있는지
 * 기기 일정과 서버에서 본다. 있으면 확정하지 않는다.
 *
 * 막지 않는 것 (정당한 경우):
 * - **같은 수업**의 두 번째 차감 -- 회원권이 둘인 듀엣은 한 수업을 두 번 차감한다
 * - **다른 강사**의 같은 시각 수업
 * - 같은 시각의 다른 회원
 */

const text = (value) => String(value ?? "").trim();
const attendeesOf = (lesson) => (Array.isArray(lesson?.attendees) ? lesson.attendees : []);

const millis = (value) => {
  if (!value) return null;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at.getTime() : null;
};

/** "2026-11-03" + "19:00" → 기기 시각(한국). 확정이 원장에 적는 시각과 같은 식이다. */
export const settlementTime = (lesson) => {
  const at = new Date(`${text(lesson?.date)}T${text(lesson?.start) || "00:00"}:00`);
  return Number.isFinite(at.getTime()) ? at : null;
};

export const DUPLICATE_SETTLEMENT_CODE = "duplicate_settlement";

/**
 * @param {{
 *   lesson: any, schedule?: Array<any>, serverLessons?: Array<any>,
 *   clientIds?: Array<string>, instructorId?: string,
 * }} input
 *   schedule       이 기기의 일정 (이 강사의 것)
 *   serverLessons  같은 시각 · 이 회원들의 확정된 서버 수업 (findCompletedLessonsAt)
 *   clientIds      이 수업 회원들의 센터 회원 id
 * @returns {{ source: "device" | "server", lessonId: string } | null}
 */
export function findDuplicateSettlement(input) {
  const lesson = input?.lesson;
  const id = text(lesson?.id);
  if (!lesson || !id) return null;
  const memberIds = new Set(attendeesOf(lesson).map((attendee) => text(attendee?.memberId)).filter(Boolean));
  const local = (Array.isArray(input?.schedule) ? input.schedule : []).find((other) => text(other?.id) !== id
    && text(other?.date) === text(lesson.date) && text(other?.start) === text(lesson.start)
    && (other?.orgSettledAt || other?.settledElsewhereAt)
    && attendeesOf(other).some((attendee) => memberIds.has(text(attendee?.memberId))));
  if (local) return { source: "device", lessonId: text(local.id) };

  const at = millis(settlementTime(lesson));
  const clientIds = new Set((Array.isArray(input?.clientIds) ? input.clientIds : []).map(text).filter(Boolean));
  const instructorId = text(input?.instructorId);
  const server = (Array.isArray(input?.serverLessons) ? input.serverLessons : []).find((doc) => {
    const docId = text(doc?.lessonId || doc?.id);
    if (!docId || docId === id) return false;
    if (text(doc?.status) !== "completed") return false;
    if (instructorId && text(doc?.instructorId) !== instructorId) return false;
    if (at === null || millis(doc?.startsAt) !== at) return false;
    const ids = [text(doc?.clientId), ...(Array.isArray(doc?.clientIds) ? doc.clientIds.map(text) : [])];
    return ids.some((clientId) => clientIds.has(clientId));
  });
  return server ? { source: "server", lessonId: text(server.lessonId || server.id) } : null;
}
