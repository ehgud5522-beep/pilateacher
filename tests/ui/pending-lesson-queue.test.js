import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { selectPendingLessonSessions } from "../../src/features/lesson-record/member-detail-selectors.js";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

/* A lesson that has already ended, with the member marked as attended, so the
   only thing that can keep it in the queue is the record's confirmation state. */
const lesson = (overrides = {}) => ({
  id: "lesson-1", date: "2026-09-01", start: "10:00", end: "11:00", type: "개인레슨",
  attendees: [{ memberId: "m1", status: "done" }],
  ...overrides,
});

const member = (notes, overrides = {}) => ({ id: "m1", name: "김회원", status: "active", notes, ...overrides });

const queueFor = (members, schedule, pendingDrafts = []) =>
  selectPendingLessonSessions({ members, schedule, pendingDrafts, now: NOW });

/* ---------------------------------------------------------------- A ------ */

test("a lesson whose only record is an unconfirmed draft stays in the queue", () => {
  // The state the user is in before saving: this is what the fix has to clear.
  const notes = [{ id: "n1", sid: "lesson-1", date: "2026-09-01", type: "개인레슨", body: "음성 초안", lessonRecord: { stage: "structured_draft", structuredDraft: { didToday: ["리포머"] } } }];
  const queue = queueFor([member(notes)], [lesson()]);
  assert.equal(queue.count, 1);
  assert.deepEqual(queue.sessions[0].reasons, ["confirmation"]);
});

test("a manually typed record clears the lesson, including an older draft on it", () => {
  /* Shape produced by saveScheduleComment after the fix: the new note carries
     the confirmation stamp, and the pre-existing draft is confirmed alongside
     it. Either one left unconfirmed puts the lesson back in the queue. */
  const notes = [
    { id: "n2", sid: "lesson-1", date: "2026-09-01", type: "개인레슨", body: "직접 입력한 기록", lessonRecord: { stage: "confirmed_record", status: "confirmed_manual", confirmationStatus: "confirmed" } },
    { id: "n1", sid: "lesson-1", date: "2026-09-01", type: "개인레슨", body: "음성 초안", lessonRecord: { stage: "confirmed_record", status: "confirmed", confirmationStatus: "confirmed", confirmedRecord: { didToday: ["리포머"] } } },
  ];
  assert.equal(queueFor([member(notes)], [lesson()]).count, 0);
});

test("stamping only the new note would leave the lesson in the queue", () => {
  // Why the fix also has to confirm the sibling: a session is clear only when
  // every confirmable note on it is confirmed.
  const notes = [
    { id: "n2", sid: "lesson-1", date: "2026-09-01", type: "개인레슨", body: "직접 입력한 기록", lessonRecord: { stage: "confirmed_record", status: "confirmed_manual", confirmationStatus: "confirmed" } },
    { id: "n1", sid: "lesson-1", date: "2026-09-01", type: "개인레슨", body: "음성 초안", lessonRecord: { stage: "structured_draft", structuredDraft: { didToday: ["리포머"] } } },
  ];
  const queue = queueFor([member(notes)], [lesson()]);
  assert.equal(queue.count, 1, "an unconfirmed sibling keeps the lesson pending");
  assert.equal(queue.sessions[0].session.confirmationState, "partial");
});

test("노코멘트 clears the lesson the same way a typed record does", () => {
  const notes = [{ id: "n3", sid: "lesson-1", date: "2026-09-01", type: "개인레슨", body: "특이사항 없음", lessonRecord: { stage: "confirmed_record", status: "confirmed_manual", confirmationStatus: "confirmed" } }];
  assert.equal(queueFor([member(notes)], [lesson()]).count, 0);
});

test("a manual record is not mistaken for an AI record", async () => {
  // confirmedRecord is what marks a note as AI-sourced, so the manual stamp
  // must not set it.
  const source = await appSource();
  const block = /stage: "confirmed_record",[\s\S]{0,120}?status: "confirmed_manual",[\s\S]{0,200}?reconcileStatus,/.exec(source);
  assert.ok(block, "the manual confirmation stamp is not where the test expects it");
  assert.doesNotMatch(block[0], /confirmedRecord/, "a manual record must not carry confirmedRecord");
  assert.match(block[0], /stage: "confirmed_record"/);
});

/* ---------------------------------------------------------------- C ------ */

test("the local draft queue no longer holds a lesson open on its own", async () => {
  const notes = [{ id: "n2", sid: "lesson-1", date: "2026-09-01", type: "개인레슨", body: "기록", lessonRecord: { stage: "confirmed_record", status: "confirmed_manual", confirmationStatus: "confirmed" } }];
  const drafts = [{ memberId: "m1", lessonId: "lesson-1" }];
  // A leftover draft is its own reason, which is why it has to be removed.
  assert.equal(queueFor([member(notes)], [lesson()], drafts).count, 1);

  const source = await appSource();
  // The removal must not be gated on the voice path any more.
  assert.match(source, /if \(shouldConfirm && sid\) removePendingLessonRecord\(id, sid\);/);
  assert.doesNotMatch(source, /if \(voiceMeta && shouldConfirm\) \{\s*\r?\n\s*removePendingLessonRecord/);
});

/* ---------------------------------------------------------------- D ------ */

test("an inactive member's past lessons are not counted", () => {
  const notes = [];
  const active = queueFor([member(notes)], [lesson()]);
  assert.ok(active.count > 0, "the same lesson counts while the member is active");
  assert.equal(queueFor([member(notes, { status: "inactive" })], [lesson()]).count, 0);
});

test("a deleted member's lessons stop producing rows labelled only 회원", () => {
  // The schedule keeps the attendee entry after the member record is gone.
  const orphan = lesson({ id: "lesson-2", attendees: [{ memberId: "gone", status: "booked" }] });
  assert.equal(queueFor([member([])], [orphan]).count, 0);
});

test("a draft left behind by a removed member is not counted", () => {
  // A lesson with nothing else pending, so the draft is the only possible reason.
  const settled = lesson({ attendees: [{ memberId: "m1", status: "done" }] });
  const notes = [{ id: "n2", sid: "lesson-1", date: "2026-09-01", type: "개인레슨", body: "기록", lessonRecord: { stage: "confirmed_record", status: "confirmed_manual", confirmationStatus: "confirmed" } }];
  assert.equal(queueFor([member(notes)], [settled]).count, 0, "baseline is clear");
  assert.equal(queueFor([member(notes)], [settled], [{ memberId: "gone", lessonId: "lesson-9" }]).count, 0);
  // A draft for a member who still exists is still counted.
  assert.equal(queueFor([member(notes)], [settled], [{ memberId: "m1", lessonId: "lesson-9" }]).count, 1);
});

test("an unresolved attendance still counts, because B was deliberately left alone", () => {
  // Writing a record does not settle attendance; that decision is separate.
  const booked = lesson({ attendees: [{ memberId: "m1", status: "booked" }] });
  const notes = [{ id: "n2", sid: "lesson-1", date: "2026-09-01", type: "개인레슨", body: "기록", lessonRecord: { stage: "confirmed_record", status: "confirmed_manual", confirmationStatus: "confirmed" } }];
  const queue = queueFor([member(notes)], [booked]);
  assert.equal(queue.count, 1);
  assert.deepEqual(queue.sessions[0].reasons, ["attendance"]);
});

test("sample data is still excluded", () => {
  assert.equal(queueFor([member([], { isSample: true })], [lesson()]).count, 0);
});
