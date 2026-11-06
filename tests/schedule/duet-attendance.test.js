/**
 * 듀엣 출석 — 확정 전 전원 정하기와, 이미 확정된 수업의 대표 확인 목록 (2026-11-06).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  settledDuetsWithUnmarked, unmarkedAttendeeIds, unmarkedSettleMessage,
} from "../../src/features/schedule/duet-attendance.js";
import { canSettleLesson } from "../../src/features/schedule/lesson-settlement.js";

const duet = (a, b) => ({
  id: "l1", type: "듀엣", date: "2026-11-05", start: "10:00",
  attendees: [{ memberId: "m-a", status: a }, { memberId: "m-b", status: b }],
});
const names = { "m-a": "회원가", "m-b": "회원나" };
const nameOf = (id) => names[id] || "";

test("듀엣에서 한 명이 아직 안 정해졌으면 막고, 누구인지 말한다", () => {
  assert.deepEqual(unmarkedAttendeeIds(duet("done", "booked")), ["m-b"]);
  assert.equal(unmarkedSettleMessage(duet("done", "booked"), nameOf), "회원나님 출석을 표시해 주세요");
  assert.equal(unmarkedSettleMessage(duet("booked", "booked"), nameOf), "회원가 · 회원나님 출석을 표시해 주세요");
  // 이름을 모르면 "회원" 으로 -- 빈 이름으로 "님" 만 나가지 않는다.
  assert.equal(unmarkedSettleMessage(duet("done", "booked")), "회원님 출석을 표시해 주세요");
});

test("둘 다 정해지면(출석 · 노쇼 · 취소 아무거나) 막지 않는다", () => {
  for (const [a, b] of [["done", "done"], ["done", "noshow"], ["noshow", "cancel"], ["cancel", "done"]]) {
    assert.deepEqual(unmarkedAttendeeIds(duet(a, b)), [], `${a}+${b}`);
    assert.equal(unmarkedSettleMessage(duet(a, b), nameOf), "", `${a}+${b}`);
  }
});

test("1:1 은 전과 같다 -- 이 판정이 막지 않고, 확정 가능 여부도 그대로", () => {
  const solo = { id: "s1", type: "1:1", attendees: [{ memberId: "m-a", status: "booked" }] };
  assert.deepEqual(unmarkedAttendeeIds(solo), []);
  assert.equal(canSettleLesson(solo), false, "출석을 안 정한 1:1 은 원래도 확정 대상이 아니다");
  assert.equal(canSettleLesson({ ...solo, attendees: [{ memberId: "m-a", status: "done" }] }), true);
});

test("확정 가능 판정(canSettleLesson)은 바꾸지 않았다 -- 막는 것은 이 판정이 따로 한다", () => {
  assert.equal(canSettleLesson(duet("done", "booked")), true);
  assert.notEqual(unmarkedSettleMessage(duet("done", "booked"), nameOf), "");
});

const NOW = new Date(2026, 10, 6, 12, 0);
const SINCE = new Date(NOW.getTime() - 60 * 86400000);
const lesson = (id, overrides = {}) => ({
  id, clientIds: ["c-a", "c-b"], status: "completed", startsAt: new Date(2026, 9, 21, 10, 0),
  locationId: "loc-1", instructorId: "u1", ...overrides,
});
const parts = (a, b) => [
  { id: "c-a", clientId: "c-a", attendanceStatus: a },
  { id: "c-b", clientId: "c-b", attendanceStatus: b },
];

test("대표 확인 목록: 확정된 듀엣 중 참석 문서에 '예약' 이 남은 것만", () => {
  const lessons = [
    lesson("half", {}),
    lesson("both", {}),
    lesson("noshow", {}),
    lesson("scheduled", { status: "scheduled" }),
    lesson("old", { startsAt: new Date(2026, 6, 1) }),
    lesson("solo", { clientIds: ["c-a"] }),
    lesson("deleted", { deletedAt: new Date() }),
  ];
  const byLesson = new Map([
    ["half", parts("attended", "booked")],
    ["both", parts("attended", "attended")],
    ["noshow", parts("attended", "noshow")],
    ["scheduled", parts("booked", "booked")],
    ["old", parts("attended", "booked")],
    ["solo", [{ id: "c-a", clientId: "c-a", attendanceStatus: "booked" }]],
    ["deleted", parts("attended", "booked")],
  ]);
  const rows = settledDuetsWithUnmarked(lessons, byLesson, { since: SINCE });
  assert.deepEqual(rows.map((row) => row.lessonId), ["half"]);
  assert.deepEqual(
    { members: rows[0].members, unmarked: rows[0].unmarked, locationId: rows[0].locationId, instructorId: rows[0].instructorId },
    { members: 2, unmarked: 1, locationId: "loc-1", instructorId: "u1" },
  );
});

test("대표 확인 목록은 최근 것이 위, 회원 id 도 이름도 싣지 않는다", () => {
  const rows = settledDuetsWithUnmarked([
    lesson("older", { startsAt: new Date(2026, 9, 1) }),
    lesson("newer", { startsAt: new Date(2026, 10, 1) }),
  ], new Map([["older", parts("attended", "booked")], ["newer", parts("booked", "attended")]]), { since: SINCE });
  assert.deepEqual(rows.map((row) => row.lessonId), ["newer", "older"]);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ["instructorId", "lessonId", "locationId", "members", "startsAt", "unmarked"]);
});
