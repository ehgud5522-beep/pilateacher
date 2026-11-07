/**
 * 노쇼 차감 / 미차감을 **누가 언제 골랐는지** 서버에 남긴다 (2026-11-07 대표).
 *
 * 고르는 것은 기기에서 한다 (#138 -- attendee.noshowFee · noshowFeeBy · noshowFeeAt).
 * 확정이 그것을 읽어 회차를 정하지만, 서버에는 참석 문서의 attendanceStatus
 * "noshow" 만 올라갔다. 그래서 두 달 뒤 "그 노쇼를 왜 안 뺐나 / 누가 뺐나" 에
 * 답할 것이 기기 밖에 없었다.
 *
 * ── 서버에 쓰는 모양 (참석 문서 lessons/{id}/participants/{clientId}) ──
 *   noshowCharge    bool       true 노쇼 차감 · false 노쇼 미차감
 *   noshowChosenBy  string     고른 사람 uid. **쓰는 사람과 같아야 한다** (규칙)
 *   noshowChosenAt  timestamp  고른 시각 (기기 시각)
 * 이름은 싣지 않는다. attendanceStatus 가 noshow 일 때만 붙는다.
 *
 * ── 고른 사람이 지금 쓰는 사람과 다르면 ──
 * 싣지 않는다. 규칙이 그 쓰기를 거절하고, 같은 배치의 차감까지 함께 막힌다 --
 * 기록 하나 때문에 확정이 실패하면 안 된다. 빠진 수는 진단에 남긴다.
 *
 * 판정만 순수 함수로 둔다. 쓰기는 pass-repository.js 가 한다.
 */

const text = (value) => String(value ?? "").trim();

/** @param {any} attendee */
const statusOf = (attendee) => text(attendee?.status);

const ATTENDANCE_BY_STATUS = Object.freeze({ done: "attended", noshow: "noshow", cancel: "cancelled" });

/**
 * 기기에 적힌 선택 하나를 서버에 쓸 수 있는 모양으로. 못 쓰면 null.
 *
 * @param {any} attendee
 * @param {string} userId 지금 쓰는 사람
 * @returns {{ charge: boolean, by: string, at: Date } | null}
 */
export function noshowChoiceOf(attendee, userId) {
  if (statusOf(attendee) !== "noshow") return null;
  if (typeof attendee?.noshowFee !== "boolean") return null;
  const by = text(attendee?.noshowFeeBy);
  if (!by || by !== text(userId)) return null;
  const at = new Date(attendee?.noshowFeeAt);
  if (!Number.isFinite(at.getTime())) return null;
  return { charge: attendee.noshowFee, by, at };
}

/**
 * 한 수업의 참석 상태와 노쇼 선택을 회원권 쪽 id(clientId)로.
 *
 * @param {any} lesson 기기 일정 (attendees)
 * @param {Array<any>} members 명부 (id → orgClientId)
 * @param {{ userId?: string, attendeesOf?: (lesson: any) => Array<any> }} [options]
 * @returns {{
 *   attendance: Record<string, string>,
 *   choices: Record<string, { charge: boolean, by: string, at: Date }>,
 *   skippedOtherChooser: number,
 * }}
 */
export function noshowRecordFor(lesson, members = [], options = {}) {
  const userId = text(options.userId);
  const list = typeof options.attendeesOf === "function"
    ? options.attendeesOf(lesson)
    : (Array.isArray(lesson?.attendees) ? lesson.attendees : []);
  const byId = new Map((Array.isArray(members) ? members : []).map((member) => [text(member?.id), member]));
  /** @type {Record<string, string>} */
  const attendance = {};
  /** @type {Record<string, { charge: boolean, by: string, at: Date }>} */
  const choices = {};
  let skippedOtherChooser = 0;
  for (const attendee of Array.isArray(list) ? list : []) {
    const clientId = text(byId.get(text(attendee?.memberId))?.orgClientId);
    if (!clientId) continue;
    const status = ATTENDANCE_BY_STATUS[statusOf(attendee)];
    if (!status) continue;
    attendance[clientId] = status;
    const choice = noshowChoiceOf(attendee, userId);
    if (choice) choices[clientId] = choice;
    else if (statusOf(attendee) === "noshow" && typeof attendee?.noshowFee === "boolean") skippedOtherChooser += 1;
  }
  return { attendance, choices, skippedOtherChooser };
}

/** 참석 문서에 얹을 칸. 선택이 없으면 빈 객체. */
export function noshowChoiceFields(choice) {
  if (!choice || typeof choice.charge !== "boolean" || !text(choice.by) || !(choice.at instanceof Date)) return {};
  return { noshowCharge: choice.charge, noshowChosenBy: text(choice.by), noshowChosenAt: choice.at };
}

/**
 * 차감 배치가 참석 문서를 쓰지 않은 노쇼 회원. 그 사람들의 선택은 따로 남긴다 --
 * 1:1 노쇼 미차감이 그렇고, 그룹 수업에서 차감 없이 빠진 사람이 그렇다.
 *
 * @param {Record<string, any>} choices
 * @param {Iterable<string>} covered 차감 배치가 참석 문서를 쓴 clientId
 */
export function uncoveredChoiceClients(choices, covered) {
  const done = new Set(covered);
  return Object.keys(choices || {}).filter((clientId) => !done.has(clientId));
}
