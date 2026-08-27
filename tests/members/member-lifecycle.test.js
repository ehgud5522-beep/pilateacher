import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deactivateMemberRecord, deleteMemberData, visibleMembers } from "../../src/features/members/member-lifecycle.js";

test("member deletion removes member data, preserves past lessons, and unlinks future lessons", () => {
  const now = Date.parse("2026-08-27T12:00:00");
  const db = {
    members: [{ id: "member-a", name: "김강사", notes: [{ id: "record-1" }] }, { id: "member-b", name: "다른회원" }],
    schedule: [
      { id: "past", date: "2026-08-26", start: "10:00", attendees: [{ memberId: "member-a" }] },
      { id: "future", date: "2026-08-28", start: "10:00", memberId: "member-a", memberIds: ["member-a"], attendees: [{ memberId: "member-a" }] },
      { id: "other", date: "2026-08-28", start: "11:00", attendees: [{ memberId: "member-b" }] },
    ],
  };
  const result = deleteMemberData(db, "member-a", now);
  assert.equal(result.db.members.some((member) => member.id === "member-a"), false);
  assert.equal(result.db.schedule.find((lesson) => lesson.id === "past").attendees[0].memberId, "member-a");
  const future = result.db.schedule.find((lesson) => lesson.id === "future");
  assert.equal(future.attendees.length, 0);
  assert.equal(future.memberId, undefined);
  assert.equal(future.unlinkedMemberDeleted, true);
  assert.deepEqual(result.pastLessonIds, ["past"]);
  assert.deepEqual(result.futureLessonIds, ["future"]);
});

test("inactive member is hidden while records remain intact", () => {
  const member = { id: "member-a", name: "김강사", notes: [{ id: "record-1" }], status: "active" };
  const inactive = deactivateMemberRecord(member, "2026-08-27T00:00:00.000Z");
  assert.equal(inactive.status, "inactive");
  assert.deepEqual(inactive.notes, member.notes);
  assert.deepEqual(visibleMembers([inactive, { id: "member-b", status: "active" }]).map((item) => item.id), ["member-b"]);
});

test("member detail requires exact name and exposes inactive alternative", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /님과 수업기록·체형분석·사진이 모두 삭제됩니다\. 되돌릴 수 없어요\./);
  assert.match(source, /deleteName !== member\.name/);
  assert.match(source, />비활성으로 두기</);
  assert.match(source, /unlinkedMemberDeleted/);
});
