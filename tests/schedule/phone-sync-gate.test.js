import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_SYNC, initialSyncMode, initialUploadPlan, schedulePublishAllowed,
} from "../../src/features/schedule/sync-gate.js";
import { findDuplicateSettlement, settlementTime } from "../../src/features/schedule/settlement-duplicate.js";

/* 폰 출시 전 (2026-10-31). 폰은 스위치 하나로 보내기 · 받기를 함께, 켠 계정의 첫 실행은
   받은 뒤 중복을 빼고 올리기, 확정 직전 중복 방지. */

test("폰은 스위치가 켜진 계정만 보낸다 — 못 읽었으면 보내지 않는다, 웹은 늘 보낸다", () => {
  assert.equal(schedulePublishAllowed({ native: true, syncOn: false }), false);
  assert.equal(schedulePublishAllowed({ native: true, syncOn: true }), true);
  assert.equal(schedulePublishAllowed({ native: true }), false, "스위치를 아직 못 읽은 폰");
  assert.equal(schedulePublishAllowed({ native: false, syncOn: false }), true, "웹은 3단계부터 늘 보낸다 -- 회원 앱 달력");
});

test("앱을 열 때 맞추기 — 스위치를 읽기 전에는 기다리고, 켠 계정은 받은 뒤에", () => {
  assert.equal(initialSyncMode({ native: true, syncOn: false, configLoaded: false }), INITIAL_SYNC.WAIT);
  assert.equal(initialSyncMode({ native: false, syncOn: false, configLoaded: false }), INITIAL_SYNC.WAIT);
  assert.equal(initialSyncMode({ native: true, syncOn: false, configLoaded: true }), INITIAL_SYNC.SKIP, "폰 · 꺼짐: 아무것도 올리지 않는다");
  assert.equal(initialSyncMode({ native: false, syncOn: false, configLoaded: true }), INITIAL_SYNC.UPLOAD_NOW);
  assert.equal(initialSyncMode({ native: true, syncOn: true, configLoaded: true }), INITIAL_SYNC.AFTER_PULL);
  assert.equal(initialSyncMode({ native: false, syncOn: true, configLoaded: true }), INITIAL_SYNC.AFTER_PULL);
});

test("처음 받은 뒤 올릴 것 — 서버의 다른 수업과 겹치는 기기 일정은 올리지 않고 남긴다", () => {
  const upcoming = [{ id: "phone-twin" }, { id: "phone-only" }];
  const plan = initialUploadPlan({ upcoming, duplicates: [{ serverId: "pc-1", localId: "phone-twin" }] });
  assert.deepEqual(plan.upload.map((entry) => entry.id), ["phone-only"]);
  assert.deepEqual(plan.held.map((entry) => entry.id), ["phone-twin"], "지우지 않는다 -- 중복 의심 시트로 사람이 고른다");
});

const lesson = (extra = {}) => ({
  id: "L-phone", date: "2026-11-03", start: "19:00", attendees: [{ memberId: "m-1", status: "done" }], ...extra,
});
const completed = (extra = {}) => ({
  id: "L-pc", lessonId: "L-pc", status: "completed", instructorId: "teacher-a",
  startsAt: settlementTime(lesson()), clientIds: ["client-1"], clientId: "client-1", ...extra,
});
const check = (extra = {}) => findDuplicateSettlement({
  lesson: lesson(), schedule: [], serverLessons: [completed()], clientIds: ["client-1"], instructorId: "teacher-a", ...extra,
});

test("확정 직전: 같은 강사 · 같은 시각 · 같은 회원으로 이미 확정된 다른 수업이 있으면 막는다", () => {
  assert.deepEqual(check(), { source: "server", lessonId: "L-pc" });
  // 기기 안에 이미 확정된 같은 수업 (다른 기기에서 확정됨 표시 포함)
  const settledTwin = lesson({ id: "L-twin", settledElsewhereAt: "2026-11-03T11:00:00Z" });
  assert.deepEqual(check({ serverLessons: [], schedule: [settledTwin] }), { source: "device", lessonId: "L-twin" });
});

test("정당한 경우는 막지 않는다 — 같은 수업의 두 번째 차감(듀엣) · 다른 강사 · 다른 회원 · 다른 시각", () => {
  assert.equal(check({ serverLessons: [completed({ id: "L-phone", lessonId: "L-phone" })] }), null,
    "같은 수업: 회원권이 둘인 듀엣은 한 수업을 두 번 차감한다");
  assert.equal(check({ serverLessons: [completed({ instructorId: "teacher-b" })] }), null, "다른 강사의 같은 시각 수업");
  assert.equal(check({ serverLessons: [completed({ clientIds: ["client-2"], clientId: "client-2" })] }), null, "다른 회원");
  assert.equal(check({ serverLessons: [completed({ startsAt: new Date(2026, 10, 3, 20, 0) })] }), null, "다른 시각");
  assert.equal(check({ serverLessons: [completed({ status: "scheduled" })] }), null, "아직 확정되지 않은 수업");
  const unsettledTwin = lesson({ id: "L-twin" });
  assert.equal(check({ serverLessons: [], schedule: [unsettledTwin] }), null, "기기의 같은 수업이 아직 확정 전이면 막지 않는다");
});
