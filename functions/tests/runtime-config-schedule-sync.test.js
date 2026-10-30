"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { scheduleSyncPayload } = require("../src/runtime-config-admin");

/* 일정 동기화 스위치 (2026-10-31). 대표 → 강사 한 명 → 전체 순서로 켠다. */

test("스위치는 off · listed · all 셋뿐이고, 명단은 정리해 담는다", () => {
  assert.deepEqual(scheduleSyncPayload({ mode: "off" }), { mode: "off", userIds: [] });
  assert.deepEqual(
    scheduleSyncPayload({ mode: "listed", userIds: [" uidOwner01 ", "uidOwner01", "", "uidTeacher2"] }),
    { mode: "listed", userIds: ["uidOwner01", "uidTeacher2"] },
  );
  assert.deepEqual(scheduleSyncPayload({ mode: "all", userIds: [] }), { mode: "all", userIds: [] });
});

test("모르는 모드 · 잘못된 uid · 너무 긴 명단은 쓰지 않는다", () => {
  assert.throws(() => scheduleSyncPayload({ mode: "on" }), /schedule_sync_mode_invalid/);
  assert.throws(() => scheduleSyncPayload({}), /schedule_sync_mode_invalid/);
  assert.throws(() => scheduleSyncPayload({ mode: "listed", userIds: ["a/b"] }), /schedule_sync_user_invalid/);
  const many = Array.from({ length: 51 }, (_, index) => `uid-number-${index}`);
  assert.throws(() => scheduleSyncPayload({ mode: "listed", userIds: many }), /schedule_sync_too_many_users/);
});
