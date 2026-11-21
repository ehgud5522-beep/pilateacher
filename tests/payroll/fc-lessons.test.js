/**
 * 강사 FC 복지 수업료 (2026-11-21 대표 결정): 진행 25,000 · 캔슬 15,000 · FC 1명당 한 달 진행 + 캔슬 8회 · 지정 강사만.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  FC_LESSON_PROBLEM_TEXT, fcCapCheck, fcLessonAmount, fcLessonProblems, fcLessonTotals, fcLessonsConfirmedNotice, isDesignated,
} from "../../functions/shared/fc-lessons.mjs";

const lesson = (id, extra = {}) => ({ id, instructorId: "t1", fcUserId: "fc1", month: "2026-11", lessonDate: "2026-11-05", outcome: "done", ...extra });

test("단가: 진행 25,000 · 캔슬 15,000, 강사 합계", () => {
  assert.equal(fcLessonAmount(lesson("a")), 25000);
  assert.equal(fcLessonAmount(lesson("b", { outcome: "cancel" })), 15000);
  assert.deepEqual(fcLessonTotals([lesson("a"), lesson("b"), lesson("c", { outcome: "cancel" })]), { done: 2, cancel: 1, count: 3, amount: 65000 });
});

test("한도: FC 한 명당 진행 + 캔슬 8회, 어느 강사에게 받았든 -- 9번째부터 넘침 (수업일 순)", () => {
  const entries = [
    ...Array.from({ length: 5 }, (_, index) => lesson(`t1-${index}`, { lessonDate: `2026-11-0${index + 1}` })),
    ...Array.from({ length: 4 }, (_, index) => lesson(`t2-${index}`, { instructorId: "t2", outcome: index % 2 ? "cancel" : "done", lessonDate: `2026-11-1${index}` })),
    lesson("other-fc", { fcUserId: "fc2" }),
  ];
  const { byFc, overIds } = fcCapCheck(entries);
  assert.deepEqual([...overIds], ["t2-3"], "fc1 의 9번째 (11/13)");
  assert.deepEqual(byFc.get("fc1"), { count: 9, remaining: 0 });
  assert.deepEqual(byFc.get("fc2"), { count: 1, remaining: 7 });
});

test("저장 전 막기: 지정 강사 · FC · 자기 자신 · 수업일 · 한도 (고치는 줄은 자신을 빼고 셈)", () => {
  const designation = { instructorIds: ["t1"], fcUserIds: ["fc1"] };
  assert.equal(isDesignated(designation, "t1"), true);
  assert.equal(isDesignated(null, "t1"), false);
  assert.deepEqual(fcLessonProblems(lesson("a"), { designation, monthEntries: [] }), []);
  assert.deepEqual(fcLessonProblems(lesson("a", { instructorId: "t9" }), { designation }), ["not_designated"]);
  assert.deepEqual(fcLessonProblems(lesson("a", { fcUserId: "fc9" }), { designation }), ["fc_unknown"]);
  assert.deepEqual(fcLessonProblems({ month: "2026-11", lessonDate: "2026-10-31", outcome: "", fcUserId: "", instructorId: "t1" }), ["lesson_date_invalid", "outcome_required", "fc_required"]);
  assert.deepEqual(fcLessonProblems(lesson("a", { fcUserId: "t1" })), ["fc_is_instructor"]);
  const eight = Array.from({ length: 8 }, (_, index) => lesson(`x${index}`));
  assert.deepEqual(fcLessonProblems(lesson("new"), { designation, monthEntries: eight }), ["fc_cap_reached"]);
  assert.deepEqual(fcLessonProblems(eight[3], { designation, monthEntries: eight }), [], "이미 넣은 8번째 안의 줄을 고칠 때는 막지 않는다");
  for (const code of ["not_designated", "fc_cap_reached", "fc_is_instructor"]) assert.ok(FC_LESSON_PROBLEM_TEXT[code]);
});

test("대표 알림 문구", () => {
  assert.deepEqual(fcLessonsConfirmedNotice({ confirmerName: "박에프씨", instructorName: "정예진", month: "2026-11", snapshot: { done: 3, cancel: 1, amount: 90000 } }), {
    title: "[FC 수업료 확정]",
    body: "박에프씨 님이 정예진 강사의 2026년 11월 FC 복지 수업료를 확정했어요 · 90,000원 (진행 3회 · 캔슬 1회)",
  });
});

test("화면: 내 FC 수업 칸 -- 지정 여부 · 합계 · 넘친 줄 · FC 별 남은 횟수 · 확정 거절 문구", async () => {
  const { myFcLessonView, fcConfirmFailureText, blankFcLesson, fcLessonErrors } = await import("../../src/features/sales/fc-lesson-view.js");
  const all = [
    ...Array.from({ length: 8 }, (_, index) => lesson(`o${index}`, { instructorId: "t2", lessonDate: `2026-11-0${index + 1}` })),
    lesson("mine", { lessonDate: "2026-11-20" }),
    lesson("mine2", { fcUserId: "fc2", outcome: "cancel" }),
  ];
  const view = myFcLessonView({ instructorId: "t1", monthEntries: all, designation: { instructorIds: ["t1"] }, monthDoc: null });
  assert.equal(view.designated, true);
  assert.deepEqual(view.totals, { done: 1, cancel: 1, count: 2, amount: 40000 });
  assert.deepEqual(view.rows.map((row) => [row.id, row.overCap]), [["mine", true], ["mine2", false]]);
  assert.equal(view.remainingOf("fc1"), 0);
  assert.equal(view.remainingOf("fc2"), 7);
  assert.equal(view.remainingOf("nobody"), 8);
  assert.equal(myFcLessonView({ instructorId: "t1", monthEntries: [], designation: null, monthDoc: { status: "confirmed", snapshot: { done: 2, cancel: 0, count: 2, amount: 50000 } } }).totals.amount, 50000);
  assert.match(fcConfirmFailureText({ details: { reason: "fc_cap_exceeded", overCap: 2 } }).text, /넘친 줄이 2건/);
  assert.equal(fcConfirmFailureText({ details: { reason: "received_by_confirmer" } }).kind, "permission");
  assert.deepEqual(fcLessonErrors(blankFcLesson({ instructorId: "t1", month: "2026-11" }), { designation: { instructorIds: ["t1"], fcUserIds: ["fc1"] } }).map((item) => item.code), ["fc_required"]);
});
