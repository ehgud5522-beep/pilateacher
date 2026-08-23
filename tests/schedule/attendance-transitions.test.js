import test from "node:test";
import assert from "node:assert/strict";
import { transitionAttendance } from "../../src/features/schedule/attendance-transitions.js";

const member = (change = {}) => ({ id: "m1", regular: 3, service: 1, notes: [{ id: "note-1", body: "기존 수업 기록" }], ...change });
const attendee = (change = {}) => ({ memberId: "m1", status: "booked", deductFrom: null, noshowFee: null, ...change });

test("attendance deducts once and duplicate attendance is a no-op", () => {
  const first = transitionAttendance({ members: [member()], attendees: [attendee()], memberIds: ["m1"], status: "done" });
  assert.equal(first.changed, true);
  assert.equal(first.members[0].regular, 2);
  assert.equal(first.attendees[0].deductFrom, "정규");

  const duplicate = transitionAttendance({ members: first.members, attendees: first.attendees, memberIds: ["m1"], status: "done" });
  assert.equal(duplicate.changed, false);
  assert.strictEqual(duplicate.members, first.members);
  assert.strictEqual(duplicate.attendees, first.attendees);
});

test("rollback restores attendance balance and deduction marker without deleting records", () => {
  const existing = member({ regular: 2, notes: [
    { id: "lesson-note", sid: "lesson-1", body: "기존 수업 기록" },
    { id: "no-comment", sid: "lesson-1", body: "특이사항 없음" },
  ] });
  const result = transitionAttendance({
    members: [existing],
    attendees: [attendee({ status: "done", deductFrom: "정규" })],
    memberIds: ["m1"],
    status: "booked",
  });
  assert.equal(result.members[0].regular, 3);
  assert.equal(result.attendees[0].status, "booked");
  assert.equal(result.attendees[0].deductFrom, null);
  assert.deepEqual(result.members[0].notes, existing.notes);
});

test("rollback understands the English deduction marker from existing legacy backups", () => {
  const existing = member({ regular: 2, service: 1 });
  const result = transitionAttendance({
    members: [existing],
    attendees: [attendee({ status: "done", deductFrom: "regular" })],
    memberIds: ["m1"],
    status: "booked",
  });
  assert.equal(result.members[0].regular, 3);
  assert.equal(result.members[0].service, 1);
  assert.equal(result.changes[0].restoredFrom, "정규");
});

test("noshow and cancellation restore a previous attendance deduction", () => {
  for (const status of ["noshow", "cancel"]) {
    const result = transitionAttendance({
      members: [member({ regular: 2 })],
      attendees: [attendee({ status: "done", deductFrom: "정규" })],
      memberIds: ["m1"],
      status,
    });
    assert.equal(result.members[0].regular, 3);
    assert.equal(result.attendees[0].status, status);
    assert.equal(result.attendees[0].deductFrom, null);
  }
});

test("multi-member transition preserves independent balances", () => {
  const result = transitionAttendance({
    members: [member(), { id: "m2", regular: 0, service: 2, notes: [] }],
    attendees: [attendee(), attendee({ memberId: "m2" })],
    memberIds: ["m1", "m2"],
    status: "done",
  });
  assert.equal(result.members[0].regular, 2);
  assert.equal(result.members[1].service, 1);
  assert.deepEqual(result.attendees.map((item) => item.deductFrom), ["정규", "서비스"]);
});
