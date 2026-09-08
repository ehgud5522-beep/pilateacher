import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { selectPendingLessonSessions } from "../../src/features/lesson-record/member-detail-selectors.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const componentSource = () => readFile(new URL("../../src/features/lesson-record/NextLessonReflection.jsx", import.meta.url), "utf8");

/* After saving one record, the lessons still unwritten today are one tap away
   instead of a trip back through the schedule. */

const member = (id) => ({ id, name: `회원${id}`, status: "active" });
const lesson = (id, memberId, date) => ({
  id, date, start: "10:00", type: "개인",
  attendees: [{ memberId, status: "attended" }],
});

const NOW = new Date("2026-09-08T21:00:00");

test("the count comes from the existing selector, unchanged", () => {
  const summary = selectPendingLessonSessions({
    members: [member("m1"), member("m2")],
    schedule: [lesson("l1", "m1", "2026-09-08"), lesson("l2", "m2", "2026-09-08")],
    now: NOW,
  });
  assert.equal(summary.count, summary.sessions.length);
  assert.ok(summary.sessions.every((item) => item.lessonId), "each entry names the lesson to open");
});

test("nothing pending means no count to show", () => {
  const summary = selectPendingLessonSessions({ members: [], schedule: [], now: NOW });
  assert.equal(summary.count, 0);
  assert.deepEqual(summary.sessions, []);
});

/* -------------------------- what the screen shows ----------------------- */

test("the button only appears when there is somewhere to go", () => {
  /* Both halves matter: a count with no handler, or a handler with nothing
     left, would draw a button that does nothing. */
  const showNext = (onNextPending, pendingCount) => Boolean(onNextPending) && Number(pendingCount) > 0;
  assert.equal(showNext(() => {}, 2), true);
  assert.equal(showNext(() => {}, 0), false, "the last record leaves only 확인");
  assert.equal(showNext(null, 2), false);
  assert.equal(showNext(null, 0), false);
});

test("the component renders and labels it with the remaining count", async () => {
  const source = await componentSource();
  assert.match(source, /다음 기록 \(\{pendingCount\}건\)/);
  assert.match(source, /const showNext = Boolean\(onNextPending\) && Number\(pendingCount\) > 0;/);
  // Two buttons when there is a next one, otherwise 확인 fills the row.
  assert.match(source, /grid-cols-2" : "grid-cols-1"/);
});

/* ------------------------------ the wiring ------------------------------ */

test("the screen is given the queue now", async () => {
  const source = await appSource();
  assert.match(source, /pendingCount=\{reflectionPending\.count\}/);
  assert.match(source, /onNextPending=\{reflectionPending\.sessions\[0\]\?\.lessonId/);
});

test("with nothing left the handler is not passed at all", async () => {
  const source = await appSource();
  /* Rather than passing a function that would open nothing. */
  assert.match(source, /\? \(\) => openLessonRecord\(reflectionPending\.sessions\[0\]\.lessonId\)\s*\r?\n\s*: null\} \/>\}/);
});

test("opening a lesson goes through the sheet that already exists", async () => {
  const source = await appSource();
  /* The lesson id alone opens its sheet, and the sheet decides the member and
     the recording screen -- no second route to keep in step. */
  assert.match(source, /const openLessonRecord = \(lessonId\) => \{\s*\r?\n\s*if \(!lessonId\) return;\s*\r?\n\s*setReflection\(null\);\s*\r?\n\s*setScheduleOpenLessonId\(String\(lessonId\)\);\s*\r?\n\s*setTab\("schedule"\);/);
  assert.match(source, /openLessonId=\{scheduleOpenLessonId\}/, "the sheet reads it");
  assert.match(source, /onConsumeOpenLesson=\{\(\) => setScheduleOpenLessonId\(null\)\}/);
});

test("the reflection closes on the way out", async () => {
  const source = await appSource();
  // Leaving it up over the schedule tab would cover the sheet it just opened.
  const body = source.slice(source.indexOf("const openLessonRecord"), source.indexOf("const openLessonRecord") + 400);
  assert.ok(body.indexOf("setReflection(null)") < body.indexOf("setTab(\"schedule\")"));
});

test("the queue judgement is not re-implemented", async () => {
  const source = await appSource();
  assert.match(source, /const reflectionPending = useMemo\(\(\) => selectPendingLessonSessions\(\{/);
  assert.match(source, /pendingDrafts: listPendingLessonRecords\(\),/);
});

/* ------------------------- what must not have moved --------------------- */

test("the dead onVoiceNote route is still dead, and NextClassCard untouched", async () => {
  const source = await appSource();
  /* Reviving it would have meant wiring through a dashboard card that has
     nothing to do with this. */
  // Nothing passes it, so the call inside the card is still unreachable.
  assert.doesNotMatch(source, /onVoiceNote=\{/);
  assert.match(source, /function NextClassCard\(\{[^}]*onVoiceNote \}\)/, "its parameter is untouched");
  assert.match(source, /onVoiceNote && onVoiceNote\(held\.m\.id, held\.s\.id\)/, "and so is the guarded call");
});

test("noteSid is left exactly as it was", async () => {
  const source = await appSource();
  /* It is only ever read and only ever set to null -- a separate problem, and
     not this change's to touch. */
  assert.equal((source.match(/setNoteSid\(/g) || []).length, 1);
  assert.match(source, /setNoteSid\(null\);/);
});

test("goRecord still opens the member tab the way it did", async () => {
  const source = await appSource();
  assert.match(source, /const goRecord = \(sec\) => \{ setNoteBack\(false\); setSection\(sec\); setDetailTab\("record"\); setTab\("members"\); setMobileView\("detail"\); \};/);
});
