/**
 * 다음 주 같은 시간 등록 (2026-11-15 강사 제보).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { addDaysISO, planNextWeekLesson, REPEAT_BLOCK } from "../../src/features/schedule/repeat-lesson.js";

const lesson = (overrides = {}) => ({
  id: "L1", date: "2026-11-15", start: "10:00", end: "10:50", type: "개인레슨", instructor: "강사", room: "A",
  memo: "오늘만의 메모", equipmentIds: ["reformer"], orgSettledAt: "2026-11-15T11:00:00Z", aiRecommendation: { x: 1 },
  attendees: [{ memberId: "m1", status: "done", deductFrom: "pass1", noshowFee: null }],
  ...overrides,
});
const plenty = () => 5;

test("날짜만 7일 옮긴다 -- 달 · 해 넘김", () => {
  assert.equal(addDaysISO("2026-11-28", 7), "2026-12-05");
  assert.equal(addDaysISO("2026-12-29", 7), "2027-01-05");
  assert.equal(addDaysISO("", 7), "");
});

test("같은 회원 · 시간 · 종류 · 방 · 기구, 상태는 예약으로, 차감 · 확정 · 메모 · 추천은 옮기지 않는다", () => {
  const plan = planNextWeekLesson({ lesson: lesson(), schedule: [lesson()], newId: "N1", remainingOf: plenty });
  assert.equal(plan.block, null);
  assert.deepEqual(plan.lesson, {
    id: "N1", date: "2026-11-22", start: "10:00", end: "10:50", type: "개인레슨", instructor: "강사", room: "A", memo: "",
    equipmentIds: ["reformer"],
    attendees: [{ memberId: "m1", status: "booked", deductFrom: null, noshowFee: null }],
  });
  assert.deepEqual(plan.clashes, []);
});

test("듀엣은 두 회원 모두", () => {
  const duet = lesson({ type: "듀엣", attendees: [{ memberId: "m1", status: "done" }, { memberId: "m2", status: "cancel" }] });
  const plan = planNextWeekLesson({ lesson: duet, newId: "N1", remainingOf: plenty });
  assert.deepEqual(plan.lesson.attendees.map((a) => [a.memberId, a.status]), [["m1", "booked"], ["m2", "booked"]]);
});

test("이미 다음 주 같은 시각에 이 회원 수업이 있으면 만들지 않는다 (두 번 누름)", () => {
  const existing = lesson({ id: "L2", date: "2026-11-22", orgSettledAt: undefined, attendees: [{ memberId: "m1", status: "booked" }] });
  const plan = planNextWeekLesson({ lesson: lesson(), schedule: [existing], newId: "N1", remainingOf: plenty });
  assert.equal(plan.block, REPEAT_BLOCK.ALREADY_BOOKED);
  assert.equal(plan.lesson, null);
});

test("다음 주 그 수업이 전부 취소돼 있으면 다시 등록할 수 있다", () => {
  const cancelled = lesson({ id: "L2", date: "2026-11-22", attendees: [{ memberId: "m1", status: "cancel" }] });
  const plan = planNextWeekLesson({ lesson: lesson(), schedule: [cancelled], newId: "N1", remainingOf: plenty });
  assert.equal(plan.block, null);
  assert.deepEqual(plan.clashes, [], "취소된 수업은 시간을 막지 않는다");
});

test("잔여 0회 회원이 있으면 막는다", () => {
  const plan = planNextWeekLesson({ lesson: lesson(), newId: "N1", remainingOf: () => 0 });
  assert.equal(plan.block, REPEAT_BLOCK.NO_REMAINING);
  assert.deepEqual(plan.blockedMemberIds, ["m1"]);
});

test("다른 수업과 겹치면 막지 않고 알린다", () => {
  const other = lesson({ id: "L9", date: "2026-11-22", start: "10:30", end: "11:20", attendees: [{ memberId: "m7", status: "booked" }] });
  const plan = planNextWeekLesson({ lesson: lesson(), schedule: [other], newId: "N1", remainingOf: plenty });
  assert.equal(plan.block, null);
  assert.deepEqual(plan.clashes.map((item) => item.id), ["L9"]);
  const after = lesson({ id: "L10", date: "2026-11-22", start: "10:50", end: "11:40", attendees: [{ memberId: "m7", status: "booked" }] });
  assert.deepEqual(planNextWeekLesson({ lesson: lesson(), schedule: [after], newId: "N1", remainingOf: plenty }).clashes, [], "끝나는 시각에 시작하면 겹치지 않는다");
});

test("개인 일정 · 회원 없는 수업은 대상이 아니다", () => {
  assert.equal(planNextWeekLesson({ lesson: lesson({ personal: true }), newId: "N1" }).block, REPEAT_BLOCK.NOT_MEMBER_LESSON);
  assert.equal(planNextWeekLesson({ lesson: lesson({ attendees: [] }), newId: "N1" }).block, REPEAT_BLOCK.NOT_MEMBER_LESSON);
  assert.equal(planNextWeekLesson({ lesson: null, newId: "N1" }).block, REPEAT_BLOCK.NOT_MEMBER_LESSON);
});

test("화면: 수업 상세에 버튼, 저장은 일정 등록과 같은 길, 막히면 코드와 함께 말한다", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /<ScheduleForm onRepeatNextWeek=\{repeatNextWeek\}/);
  assert.match(source, /if \(onSave\(lesson, null\) === false\) return;/, "saveSchedule 의 홀딩 검사를 지난다");
  assert.match(source, /다음 주 같은 시간 등록/);
  assert.match(source, /\(코드 repeat_\$\{plan\.block\}\)/);
  assert.match(source, /data-repeat-confirm/);
});
