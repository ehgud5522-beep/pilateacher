/**
 * 회원 관리의 강사 묶음 (2026-11-04): 활성 회원권의 담당으로 묶고, 회원 단위로 센다.
 *
 * 활성의 정의는 isDeductablePass 그대로다 -- 차감 선택과 명부의 잔여가 쓰는 판정.
 * 여기서 그 판정을 다시 쓰지 않고, 같은 함수가 쓰이는지 결과로 확인한다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { isDeductablePass } from "../../src/data/repositories/pass-repository.js";
import {
  INSTRUCTOR_GROUP, activeAssignments, assignedInstructorCount, groupsOf, inInstructorGroup, instructorChips,
} from "../../src/features/members/instructor-groups.js";

const NOW = new Date(2026, 10, 4, 12, 0);
const LATER = new Date(2027, 0, 1);
const pass = (overrides = {}) => ({
  id: "p", clientId: "c1", instructorId: "u-a", status: "active", remainingCount: 5, expiresAt: LATER, ...overrides,
});
const CLIENTS = ["c1", "c2", "c3", "c4", "c5"].map((id) => ({ id }));
const INSTRUCTORS = [{ userId: "u-a", displayName: "강사가" }, { userId: "u-b", displayName: "강사나" }];

test("활성은 차감 선택과 같은 판정이다 — 사용 중 · 잔여 1 이상 · 만료 전", () => {
  const cases = [
    pass({ id: "ok" }),
    pass({ id: "zero", remainingCount: 0 }),
    pass({ id: "expired", expiresAt: new Date(2026, 9, 1) }),
    pass({ id: "cancelled", status: "cancelled" }),
    pass({ id: "no-expiry", expiresAt: null }),
  ];
  for (const item of cases) {
    const grouped = activeAssignments([item], NOW).has("c1");
    assert.equal(grouped, isDeductablePass(item, NOW), item.id);
  }
});

test("한 회원이 여러 강사에 나오고, 강사별 수는 회원 단위로 센다", () => {
  const assignments = activeAssignments([
    pass({ id: "1", clientId: "c1", instructorId: "u-a" }),
    pass({ id: "2", clientId: "c1", instructorId: "u-b" }),
    pass({ id: "3", clientId: "c2", instructorId: "u-a" }),
    pass({ id: "4", clientId: "c2", instructorId: "u-a" }), // 같은 강사 두 장 -- 1명
    pass({ id: "5", clientId: "c3", instructorId: "" }),
    pass({ id: "6", clientId: "c4", instructorId: "u-a", remainingCount: 0 }),
  ], NOW);
  assert.deepEqual(groupsOf(assignments.get("c1")).sort(), ["u-a", "u-b"]);
  assert.equal(assignedInstructorCount(assignments.get("c1")), 2);
  assert.equal(assignedInstructorCount(assignments.get("c2")), 1);
  assert.deepEqual(groupsOf(assignments.get("c3")), [INSTRUCTOR_GROUP.UNASSIGNED]);
  assert.deepEqual(groupsOf(assignments.get("c4")), [INSTRUCTOR_GROUP.NO_ACTIVE], "다 쓴 회원권만 있으면 활성 없음");

  const { chips, unassigned, noActive } = instructorChips(CLIENTS, assignments, INSTRUCTORS);
  assert.deepEqual(chips.map((chip) => [chip.name, chip.count]), [["강사가", 2], ["강사나", 1]]);
  assert.equal(unassigned, 1);
  assert.equal(noActive, 2, "c4 · c5");
});

test("듀엣 회원권은 두 회원 모두 그 강사 밑에 나온다", () => {
  const assignments = activeAssignments([pass({ clientId: "c1", clientIds: ["c1", "c2"], instructorId: "u-b" })], NOW);
  assert.ok(inInstructorGroup(assignments.get("c1"), "u-b"));
  assert.ok(inInstructorGroup(assignments.get("c2"), "u-b"));
});

test("칩은 받은 회원만 센다 — 지점 칩 · 검색을 거친 목록", () => {
  const assignments = activeAssignments([
    pass({ id: "1", clientId: "c1", instructorId: "u-a" }),
    pass({ id: "2", clientId: "c2", instructorId: "u-a" }),
  ], NOW);
  assert.deepEqual(instructorChips([{ id: "c1" }], assignments, INSTRUCTORS).chips.map((chip) => chip.count), [1]);
});

test("명부에 없는 담당도 버리지 않는다", () => {
  const assignments = activeAssignments([pass({ instructorId: "u-gone" })], NOW);
  const { chips } = instructorChips([{ id: "c1" }], assignments, INSTRUCTORS);
  assert.deepEqual(chips, [{ id: "u-gone", name: "명부에 없는 강사", known: false, count: 1 }]);
});

test("전체 칩은 모두, 특별 묶음은 그 회원만", () => {
  const assignments = activeAssignments([pass({ clientId: "c1" }), pass({ id: "2", clientId: "c2", instructorId: "" })], NOW);
  assert.ok(inInstructorGroup(assignments.get("c3"), INSTRUCTOR_GROUP.ALL));
  assert.ok(inInstructorGroup(assignments.get("c3"), INSTRUCTOR_GROUP.NO_ACTIVE));
  assert.ok(!inInstructorGroup(assignments.get("c1"), INSTRUCTOR_GROUP.NO_ACTIVE));
  assert.ok(inInstructorGroup(assignments.get("c2"), INSTRUCTOR_GROUP.UNASSIGNED));
});

test("담당을 바꾼 직후 다시 읽으면 새 강사 밑으로 옮겨 간다", () => {
  /* 화면은 담당 변경 뒤 회원권을 다시 읽는다 (refreshKey). 다시 읽은 회원권으로
     세면 옛 강사 칩에서 빠지고 새 강사 칩에 들어가야 한다. */
  const before = activeAssignments([pass({ instructorId: "u-a" })], NOW);
  const after = activeAssignments([pass({ instructorId: "u-b", handedOver: true })], NOW);
  assert.deepEqual(instructorChips([{ id: "c1" }], before, INSTRUCTORS).chips.map((chip) => chip.id), ["u-a"]);
  assert.deepEqual(instructorChips([{ id: "c1" }], after, INSTRUCTORS).chips.map((chip) => chip.id), ["u-b"]);
});
