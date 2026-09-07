import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MEMBERSHIP_STATUSES,
  deactivateMemberRecord,
  inactiveMembers,
  reactivateMemberRecord,
  visibleMembers,
} from "../../src/features/members/member-lifecycle.js";
import { selectPendingLessonSessions } from "../../src/features/lesson-record/member-detail-selectors.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

test("deactivating parks the membership state instead of losing it", () => {
  for (const status of MEMBERSHIP_STATUSES) {
    const off = deactivateMemberRecord({ id: "m1", name: "김회원", status }, "2026-09-08T00:00:00.000Z");
    assert.equal(off.status, "inactive");
    assert.equal(off.statusBeforeInactive, status, `${status} must survive deactivation`);
    assert.equal(off.inactiveAt, "2026-09-08T00:00:00.000Z");
  }
});

test("reactivating restores the state the member had, not just active", () => {
  // An ended or held member must not be quietly promoted back to active.
  for (const status of MEMBERSHIP_STATUSES) {
    const restored = reactivateMemberRecord(deactivateMemberRecord({ id: "m1", status }));
    assert.equal(restored.status, status);
    assert.equal(restored.statusBeforeInactive, "");
    assert.equal(restored.inactiveAt, "");
  }
});

test("a member with no parked state falls back to active", () => {
  assert.equal(reactivateMemberRecord({ id: "m1", status: "inactive" }).status, "active");
  assert.equal(reactivateMemberRecord({ id: "m1", status: "inactive", statusBeforeInactive: "nonsense" }).status, "active");
});

test("deactivating twice does not park inactive as the membership state", () => {
  const once = deactivateMemberRecord({ id: "m1", status: "hold" });
  const twice = deactivateMemberRecord(once);
  assert.equal(twice.statusBeforeInactive, "active", "inactive is not a membership state");
  assert.notEqual(twice.statusBeforeInactive, "inactive");
});

test("nothing about the member record is dropped either way", () => {
  const member = { id: "m1", name: "김회원", status: "hold", notes: [{ id: "n1" }], aiMemory: ["x"], inbody: [{ date: "2026-01-01" }] };
  const round = reactivateMemberRecord(deactivateMemberRecord(member));
  assert.deepEqual(round.notes, member.notes);
  assert.deepEqual(round.aiMemory, member.aiMemory);
  assert.deepEqual(round.inbody, member.inbody);
  assert.equal(round.status, "hold");
});

test("the two member pools are complementary", () => {
  const members = [
    { id: "a", status: "active" },
    { id: "b", status: "hold" },
    { id: "c", status: "inactive" },
    { id: "d" },
  ];
  assert.deepEqual(visibleMembers(members).map((m) => m.id), ["a", "b", "d"]);
  assert.deepEqual(inactiveMembers(members).map((m) => m.id), ["c"]);
});

test("the member list offers an inactive view that uses the inactive pool", async () => {
  const source = await appSource();
  assert.match(source, /\{ k: "inactive", l: "비활성" \}/);
  assert.match(source, /filter === "inactive" \? inactiveMembers\(nonDraftMembers\) : visibleMembers\(nonDraftMembers\)/);
  // The count chip has to read the same pool, or it shows 0 next to a full list.
  assert.match(source, /k === "inactive" \? inactiveMembers\(nonDraftMembers\) : visibleMembers\(nonDraftMembers\)/);
});

test("the detail offers the restore action only while the member is inactive", async () => {
  const source = await appSource();
  assert.match(source, /isInactive\(member\) && <button type="button" onClick=\{async \(\) => \{ const saved = await onReactivate\?\.\(member\.id\)/);
  assert.match(source, />활성으로 되돌리기</);
  assert.match(source, /const reactivateMember = async \(id\) => \{/);
  assert.match(source, /onReactivate=\{reactivateMember\}/);
});

/* ------------------- interaction with the pending queue ----------------- */

test("an inactive member's unresolved lessons are paused, not lost", () => {
  const lesson = {
    id: "lesson-1", date: "2026-09-01", start: "10:00", end: "11:00", type: "개인레슨",
    attendees: [{ memberId: "m1", status: "booked" }],
  };
  const now = new Date("2026-09-08T12:00:00.000Z");
  const active = { id: "m1", name: "김회원", status: "active", notes: [] };
  const off = deactivateMemberRecord(active);

  const whileActive = selectPendingLessonSessions({ members: [active], schedule: [lesson], now });
  assert.ok(whileActive.count > 0, "the lesson is unresolved to begin with");

  // Deactivating hides it everywhere the queue is read, including the member's
  // own detail, which passes a single member through the same selector.
  assert.equal(selectPendingLessonSessions({ members: [off], schedule: [lesson], now }).count, 0);

  // And reactivating brings it straight back: nothing was deleted.
  const back = reactivateMemberRecord(off);
  assert.equal(selectPendingLessonSessions({ members: [back], schedule: [lesson], now }).count, whileActive.count);
});
