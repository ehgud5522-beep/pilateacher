/**
 * 회원 관리의 강사 묶음 — 지점 → 강사 → 회원 (2026-11-04 대표).
 *
 * ── 무엇으로 묶는가 ──
 * **활성 회원권의 담당 강사.** 활성은 isDeductablePass 그대로다 -- 차감 선택
 * (lesson-settlement.js)과 회원 명부의 잔여(roster-bridge.js)가 쓰는 판정이다.
 * 사용 중 · 잔여 1 이상 · 만료 전. 화면이 따로 세면 같은 회원이 한쪽에서는
 * 활성이고 다른 쪽에서는 아니게 된다.
 *
 * 한 회원이 활성 회원권을 여러 장 가졌고 담당이 다르면 **그 강사들 모두의
 * 묶음에 나온다.** 듀엣 회원권은 두 회원 모두에게 같은 담당이다.
 *
 * ── 특별 묶음 둘 ──
 *   담당 미지정     활성 회원권이 있는데 담당 칸이 빈 것이 하나라도 있다
 *   활성 회원권 없음  활성 회원권이 한 장도 없다 (화면에서 기본으로 접힌다)
 *
 * 세는 것은 **회원 단위**다. 한 강사가 한 회원의 회원권 두 장을 맡아도 1명이다.
 * 읽기만 한다. 아무것도 쓰지 않는다.
 */

import { isDeductablePass } from "../../data/repositories/pass-repository.js";
import { passClientIds } from "../../data/schema/pass-clients.js";

export const INSTRUCTOR_GROUP = Object.freeze({
  ALL: "all",
  UNASSIGNED: "__unassigned__",
  NO_ACTIVE: "__no_active__",
});

const text = (value) => String(value ?? "").trim();

/**
 * 회원별 활성 회원권의 담당. 활성 회원권이 없는 회원은 맵에 없다.
 *
 * @param {Array<any>} passes
 * @param {Date} [now]
 * @returns {Map<string, { instructorIds: Array<string>, unassigned: boolean }>}
 */
export function activeAssignments(passes, now = new Date()) {
  /** @type {Map<string, { ids: Set<string>, unassigned: boolean }>} */
  const byClient = new Map();
  for (const pass of Array.isArray(passes) ? passes : []) {
    if (!pass || !isDeductablePass(pass, now)) continue;
    const instructorId = text(pass.instructorId);
    for (const clientId of passClientIds(pass)) {
      if (!byClient.has(clientId)) byClient.set(clientId, { ids: new Set(), unassigned: false });
      const entry = byClient.get(clientId);
      if (instructorId) entry.ids.add(instructorId);
      else entry.unassigned = true;
    }
  }
  return new Map([...byClient].map(([clientId, entry]) => [
    clientId, { instructorIds: [...entry.ids], unassigned: entry.unassigned },
  ]));
}

/** 이 회원이 들어가는 묶음들. @param {{ instructorIds: Array<string>, unassigned: boolean } | undefined} assignment */
export function groupsOf(assignment) {
  if (!assignment) return [INSTRUCTOR_GROUP.NO_ACTIVE];
  return [
    ...assignment.instructorIds,
    ...(assignment.unassigned ? [INSTRUCTOR_GROUP.UNASSIGNED] : []),
  ];
}

/** 이 회원이 그 묶음에 드는가. ALL 은 모두. */
export function inInstructorGroup(assignment, group) {
  if (!group || group === INSTRUCTOR_GROUP.ALL) return true;
  return groupsOf(assignment).includes(group);
}

/** 담당 강사 수. 2 이상이면 화면이 "담당 N명" 을 붙인다. */
export const assignedInstructorCount = (assignment) => (assignment ? assignment.instructorIds.length : 0);

/**
 * 강사 칩 줄. **받은 회원들만 센다** -- 지점 칩 · 검색을 거친 목록을 넘기면 칩의
 * 숫자도 그만큼이다. 담당 회원이 없는 강사는 칩을 만들지 않는다.
 *
 * 명부에 없는 담당(퇴사했거나 못 읽은 강사)도 버리지 않는다. 빼면 그 회원은
 * 어느 강사 칩에서도 안 보인다.
 *
 * @param {Array<{ id: string }>} clients
 * @param {Map<string, { instructorIds: Array<string>, unassigned: boolean }>} assignments
 * @param {Array<{ userId: string, displayName?: string }>} instructors
 */
export function instructorChips(clients, assignments, instructors = []) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  let unassigned = 0;
  let noActive = 0;
  for (const client of Array.isArray(clients) ? clients : []) {
    const assignment = assignments.get(text(client?.id));
    if (!assignment) { noActive += 1; continue; }
    if (assignment.unassigned) unassigned += 1;
    for (const id of assignment.instructorIds) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const nameOf = (id) => text((Array.isArray(instructors) ? instructors : [])
    .find((item) => text(item?.userId) === id)?.displayName);
  const chips = [...counts].map(([id, count]) => ({ id, name: nameOf(id) || "명부에 없는 강사", known: Boolean(nameOf(id)), count }))
    .sort((left, right) => Number(right.known) - Number(left.known) || left.name.localeCompare(right.name, "ko"));
  return { chips, unassigned, noActive };
}
