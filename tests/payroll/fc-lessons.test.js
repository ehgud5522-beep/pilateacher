/**
 * 강사 FC 복지 수업료 (2026-11-21 대표 결정): 진행 25,000 · 캔슬 15,000 · 지점마다 강사 한 명 · 횟수만 · 한 달 진행 + 캔슬 8회.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  FC_LESSON_PROBLEM_TEXT, branchesOf, designatedInstructorIds, fcCountProblems, fcLessonTotals, fcLessonsConfirmedNotice, fcRemaining, isDesignated,
} from "../../functions/shared/fc-lessons.mjs";
import { fcConfirmFailureText, fcCountErrors, myFcLessonView } from "../../src/features/sales/fc-lesson-view.js";

const designation = { branches: { yul: "t1", jwa: "t2", jang: "t1" } };

test("지정: 지점마다 한 명 -- 한 강사가 두 지점을 맡을 수도", () => {
  assert.deepEqual(designatedInstructorIds(designation), ["t1", "t2"]);
  assert.equal(isDesignated(designation, "t1"), true);
  assert.equal(isDesignated(designation, "t9"), false);
  assert.equal(isDesignated(null, "t1"), false);
  assert.deepEqual(branchesOf(designation, "t1"), ["yul", "jang"]);
});

test("횟수만: 진행 25,000 · 캔슬 15,000, 남은 횟수", () => {
  assert.deepEqual(fcLessonTotals({ done: 5, cancel: 2 }), { done: 5, cancel: 2, count: 7, amount: 155000 });
  assert.equal(fcRemaining({ done: 5, cancel: 2 }), 1);
  assert.equal(fcRemaining({}), 8);
});

test("저장 전 막기: 정수 · 8회 상한 · 지정 강사", () => {
  assert.deepEqual(fcCountProblems({ done: 6, cancel: 2 }, { designation, instructorId: "t1" }), []);
  assert.deepEqual(fcCountProblems({ done: 6, cancel: 3 }, { designation, instructorId: "t1" }), ["fc_cap_exceeded"]);
  assert.deepEqual(fcCountProblems({ done: -1, cancel: 0 }), ["count_invalid"]);
  assert.deepEqual(fcCountProblems({ done: 1.5, cancel: 0 }), ["count_invalid"]);
  assert.deepEqual(fcCountProblems({ done: 1, cancel: 0 }, { designation, instructorId: "t9" }), ["not_designated"]);
  assert.equal(fcCountErrors({ done: 9, cancel: 0 }).at(0).text, FC_LESSON_PROBLEM_TEXT.fc_cap_exceeded);
});

test("화면: 내 FC 수업 칸 · 확정된 달은 확정 숫자 · 거절 문구", () => {
  const view = myFcLessonView({ instructorId: "t1", designation, monthDoc: { status: "submitted", done: 3, cancel: 1 } });
  assert.deepEqual({ designated: view.designated, locked: view.locked, amount: view.totals.amount, remaining: view.remaining }, { designated: true, locked: false, amount: 90000, remaining: 4 });
  assert.equal(myFcLessonView({ instructorId: "t1", designation, monthDoc: { status: "confirmed", done: 2, cancel: 0, snapshot: { done: 2, cancel: 0, count: 2, amount: 50000 } } }).totals.amount, 50000);
  assert.equal(myFcLessonView({ instructorId: "t1", designation, monthDoc: null }).hasCounts, false);
  assert.equal(fcConfirmFailureText({ details: { reason: "nothing_to_confirm" } }).kind, "invalid_request");
  assert.equal(fcConfirmFailureText({ details: { reason: "own_lessons" } }).kind, "permission");
});

test("대표 알림 문구", () => {
  assert.deepEqual(fcLessonsConfirmedNotice({ confirmerName: "박에프씨", instructorName: "정예진", month: "2026-11", snapshot: { done: 3, cancel: 1, amount: 90000 } }), {
    title: "[FC 수업료 확정]",
    body: "박에프씨 님이 정예진 강사의 2026년 11월 FC 복지 수업료를 확정했어요 · 90,000원 (진행 3회 · 캔슬 1회)",
  });
});
