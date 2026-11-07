/**
 * 노쇼 차감 / 미차감과 고른 사람을 서버에 남기기 (2026-11-07, noshow-record.js).
 * 고른 사람이 지금 쓰는 사람일 때만 싣는다 -- 규칙이 둘을 대조하고, 어긋나면 그 배치의
 * 차감까지 거절된다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  noshowChoiceFields, noshowChoiceOf, noshowRecordFor, uncoveredChoiceClients,
} from "../../src/features/schedule/noshow-record.js";
import { recordLessonAttendance } from "../../src/data/repositories/pass-repository.js";

const ME = "u-me";
const AT = "2026-11-07T01:00:00.000Z";
const members = [
  { id: "m1", orgClientId: "c1" }, { id: "m2", orgClientId: "c2" }, { id: "m3", orgClientId: "c3" },
];

test("선택은 노쇼 · 고른 값 · 고른 사람이 나일 때만", () => {
  assert.deepEqual(noshowChoiceOf({ status: "noshow", noshowFee: false, noshowFeeBy: ME, noshowFeeAt: AT }, ME),
    { charge: false, by: ME, at: new Date(AT) });
  assert.equal(noshowChoiceOf({ status: "done", noshowFee: false, noshowFeeBy: ME, noshowFeeAt: AT }, ME), null);
  assert.equal(noshowChoiceOf({ status: "noshow", noshowFeeBy: ME, noshowFeeAt: AT }, ME), null, "안 고름");
  assert.equal(noshowChoiceOf({ status: "noshow", noshowFee: true, noshowFeeBy: "u-other", noshowFeeAt: AT }, ME), null, "다른 계정");
  assert.equal(noshowChoiceOf({ status: "noshow", noshowFee: true, noshowFeeBy: ME, noshowFeeAt: "x" }, ME), null, "시각 못 읽음");
});

test("한 수업: 참석 상태는 clientId 로, 선택은 내 것만, 남이 고른 것은 센다", () => {
  const lesson = { attendees: [
    { memberId: "m1", status: "done" },
    { memberId: "m2", status: "noshow", noshowFee: false, noshowFeeBy: ME, noshowFeeAt: AT },
    { memberId: "m3", status: "noshow", noshowFee: true, noshowFeeBy: "u-other", noshowFeeAt: AT },
    { memberId: "m-unknown", status: "noshow", noshowFee: true, noshowFeeBy: ME, noshowFeeAt: AT },
  ] };
  const record = noshowRecordFor(lesson, members, { userId: ME });
  assert.deepEqual(record.attendance, { c1: "attended", c2: "noshow", c3: "noshow" });
  assert.deepEqual(Object.keys(record.choices), ["c2"]);
  assert.equal(record.skippedOtherChooser, 1);
  assert.deepEqual(uncoveredChoiceClients(record.choices, ["c1"]), ["c2"]);
  assert.deepEqual(uncoveredChoiceClients(record.choices, ["c1", "c2"]), []);
  assert.deepEqual(noshowChoiceFields(record.choices.c2), { noshowCharge: false, noshowChosenBy: ME, noshowChosenAt: new Date(AT) });
  assert.deepEqual(noshowChoiceFields(null), {});
});

function memoryStore() {
  const writes = [];
  return { writes, commit: async (list) => { writes.push(...list); }, serverTimestamp: async () => "SERVER_TIME" };
}

test("차감할 회차가 없던 수업: 참석 문서 + 수업을 원장 없이 닫는다", async () => {
  const store = memoryStore();
  const result = await recordLessonAttendance("org-a", {
    lessonId: "l1", createdBy: ME, close: true,
    attendance: { c1: "noshow", c2: "cancelled" },
    choices: { c1: { charge: false, by: ME, at: new Date(AT) } },
    lesson: { clientIds: ["c1", "c2"], locationId: "loc-a", instructorId: ME, startsAt: new Date(AT) },
  }, { store });
  assert.deepEqual(result, { written: 2, closed: true });
  const [lesson, p1, p2] = store.writes;
  assert.match(lesson.path, /lessons\/l1$/);
  assert.equal(lesson.operation, "merge");
  assert.equal(lesson.data.status, "completed");
  assert.equal(lesson.data.settledWithoutDeduction, true);
  assert.ok(!("settledPassId" in lesson.data), "원장 없이 닫는다");
  assert.deepEqual(lesson.data.clientIds, ["c1", "c2"]);
  assert.equal(p1.data.noshowCharge, false);
  assert.equal(p1.data.noshowChosenBy, ME);
  assert.equal(p2.data.attendanceStatus, "cancelled");
  assert.ok(!("noshowCharge" in p2.data), "취소에는 선택이 없다");
});

test("차감이 나간 수업의 남은 노쇼: 참석 문서만 쓰고 수업은 건드리지 않는다", async () => {
  const store = memoryStore();
  await recordLessonAttendance("org-a", {
    lessonId: "l1", createdBy: ME, clientIds: ["c2"],
    attendance: { c1: "attended", c2: "noshow" },
    choices: { c2: { charge: false, by: ME, at: new Date(AT) } },
  }, { store });
  assert.equal(store.writes.length, 1);
  assert.match(store.writes[0].path, /participants\/c2$/);
  assert.ok(!store.writes.some((write) => /lessons\/l1$/.test(write.path)));
});

test("고른 사람이 쓰는 사람과 다르면 선택은 싣지 않는다 (규칙이 막기 전에)", async () => {
  const store = memoryStore();
  await recordLessonAttendance("org-a", {
    lessonId: "l1", createdBy: ME, attendance: { c1: "noshow" },
    choices: { c1: { charge: false, by: "u-other", at: new Date(AT) } },
  }, { store });
  assert.deepEqual(store.writes[0].data, { organizationId: "org-a", lessonId: "l1", clientId: "c1", attendanceStatus: "noshow" });
});

test("쓸 참석이 없으면 아무것도 쓰지 않는다", async () => {
  const store = memoryStore();
  assert.deepEqual(await recordLessonAttendance("org-a", { lessonId: "l1", createdBy: ME, attendance: {} }, { store }), { written: 0, closed: false });
  assert.equal(store.writes.length, 0);
});
