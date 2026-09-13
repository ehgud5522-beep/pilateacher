import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appendMemberWithoutScheduleMutation, dedupeScheduleByLessonId } from "../../src/features/schedule/schedule-integrity.js";
import { invokeLessonSessionAction } from "../../src/features/lesson-record/session-actions.js";
import { scrollRecordSectionIntoView } from "../../src/features/ui/record-section-scroll.js";

const appSource = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const rowSource = await readFile(new URL("../../src/features/lesson-record/LessonHistorySessionRow.jsx", import.meta.url), "utf8");

test("member registration is user-triggered, consumes a one-shot request, and preserves schedules", () => {
  const schedule = [
    { id: "lesson-a1", memberId: "member-a" },
    { id: "lesson-a2", memberId: "member-a" },
  ];
  const originalLessons = [...schedule];
  const originalScheduleJson = JSON.stringify(schedule);
  let database = { members: [{ id: "member-a" }], schedule };
  for (let index = 0; index < 10; index += 1) {
    assert.equal(database.members.length, 1, "tab entry and rerender do not call the creation helper");
    assert.equal(database.schedule.length, 2, "tab entry must not mutate the raw schedule");
  }
  database = appendMemberWithoutScheduleMutation(database, { id: "member-b" });
  assert.equal(database.members.length, 2);
  assert.equal(database.schedule, schedule, "member creation must not clone or rewrite the schedule");
  assert.equal(JSON.stringify(database.schedule), originalScheduleJson);
  assert.equal(database.schedule[0], originalLessons[0], "existing lesson object identity must be preserved");
  assert.equal(database.schedule[1], originalLessons[1], "existing lesson object identity must be preserved");
  assert.equal(database.schedule.filter((lesson) => lesson.memberId === "member-b").length, 0);
  assert.equal(new Set(database.schedule.map((lesson) => lesson.id)).size, database.schedule.length);

  const reloaded = JSON.parse(JSON.stringify(database));
  assert.equal(reloaded.schedule.length, 2, "serialize and reload must preserve the raw schedule count");
  assert.equal(JSON.stringify(reloaded.schedule), originalScheduleJson);

  let request = 0;
  let sheetOpenCount = 0;
  const explicitRegistrationAction = () => { request += 1; };
  const consumePendingRequest = () => {
    if (!request) return;
    sheetOpenCount += 1;
    request = 0;
  };
  explicitRegistrationAction();
  consumePendingRequest();
  assert.equal(sheetOpenCount, 1, "the first explicit action opens once");
  consumePendingRequest();
  assert.equal(sheetOpenCount, 1, "tab reentry cannot reopen a consumed request");
  explicitRegistrationAction();
  consumePendingRequest();
  assert.equal(sheetOpenCount, 2, "a new explicit action opens the sheet again");

  const memberList = appSource.slice(appSource.indexOf("function ReferenceMemberList"), appSource.indexOf("function MemberRegisterSheet"));
  assert.match(memberList, /if \(!registerRequest\) return;[\s\S]*setRegisterOpen\(true\);[\s\S]*onConsumeRegisterRequest\?\.\(\)/);
  assert.doesNotMatch(memberList, /onAdd\?\.\(|onAdd\([^v]/, "opening or rendering the list must not insert a member");
});

test("duplicate canonical lesson ids render once while independent simultaneous lessons remain", () => {
  const a = { id: "lesson-a", memberId: "member-a", start: "10:00" };
  const duplicate = { ...a, start: "11:00" };
  const b = { id: "lesson-b", memberId: "member-b", start: "10:00" };
  const idlessA = { memberId: "member-a", start: "12:00" };
  const idlessB = { memberId: "member-a", start: "13:00" };
  const result = dedupeScheduleByLessonId([a, duplicate, b, idlessA, idlessB]);
  assert.deepEqual(result, [a, b, idlessA, idlessB]);
  assert.equal(new Set(result.filter((lesson) => lesson.id).map((lesson) => lesson.id)).size, 2);
  assert.equal(result.filter((lesson) => lesson.start === "10:00").length, 2, "real simultaneous lessons with different ids remain separate");
});

test("interactive lesson confirmation invokes exactly once with the exact session", () => {
  const sessionA = { key: "lesson-a", date: "2026-09-05", startTime: "10:00", type: "개인", today: "리포머", next: "호흡", confirmationState: "pending", records: [{ id: "note-a" }] };
  const sessionB = { key: "lesson-b", date: "2026-09-05", startTime: "11:00", type: "개인", today: "캐딜락", next: "흉추", confirmationState: "pending", records: [{ id: "note-b" }] };
  const calls = [];
  assert.equal(invokeLessonSessionAction((selected) => calls.push(selected), sessionA), true);
  assert.equal(invokeLessonSessionAction((selected) => calls.push(selected), sessionB), true);
  assert.deepEqual(calls, [sessionA, sessionB]);
  assert.equal(calls.filter((session) => session === sessionA).length, 1);
  assert.equal(calls.filter((session) => session === sessionB).length, 1);
  assert.equal(invokeLessonSessionAction(undefined, sessionA), false);
  assert.match(rowSource, /data-session-action="confirm"[\s\S]*invokeLessonSessionAction\(onConfirm, session\)/);

  const queue = appSource.slice(appSource.indexOf("function ScheduleQueueSheet"), appSource.indexOf("function coverDraw"));
  assert.match(queue, /onClick=\{\(\) => onOpenLesson\?\.\(task\.s \|\| task\.lesson\)\}/);
  assert.doesNotMatch(queue, /onConfirmSession|confirmQueueSession/, "the queue CTA must open review instead of confirming immediately");
});

test("record entry scrolls into the nearest visible sheet position", () => {
  const calls = [];
  assert.equal(scrollRecordSectionIntoView({ scrollIntoView: (options) => calls.push(options) }), true);
  assert.deepEqual(calls, [{ behavior: "smooth", block: "nearest" }]);
  assert.equal(scrollRecordSectionIntoView(null), false);
  const scheduleForm = appSource.slice(appSource.indexOf("function ScheduleForm"), appSource.indexOf("function ScheduleQueueSheet"));
  assert.match(scheduleForm, /ref=\{recordSectionRef\} data-lesson-record-entry/);
  assert.match(scheduleForm, /requestAnimationFrame\?\.\(scroll\)/);
  assert.doesNotMatch(scheduleForm, /visualViewport|safe-area-inset|--pt-keyboard-inset/);
});
