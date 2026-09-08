import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isFirstConfirmation, isStructuredLessonRecord, selectNextLessonReflection } from "../../src/features/lesson-record/next-lesson-reflection.js";
import { memberMemorySummary } from "../../src/features/member-memory/briefing.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const componentSource = () => readFile(new URL("../../src/features/lesson-record/NextLessonReflection.jsx", import.meta.url), "utf8");

const NOW = new Date("2026-09-08T10:00:00");

const draft = (fields = {}) => ({
  didToday: [], observations: [], responses: [], nextFocus: [], uncertain: [], ...fields,
});
const record = (fields = {}, overrides = {}) => ({
  stage: "structured_draft",
  provenanceSource: "openai",
  structuredDraft: draft(fields),
  recordedAt: "2026-09-08T09:00:00.000Z",
  ...overrides,
});
const member = { id: "m1", name: "정다은" };
const booked = (date, start) => ({
  id: `l_${date}`, date, start,
  attendees: [{ memberId: "m1", status: "booked" }],
});
const call = (options) => selectNextLessonReflection({ member, now: NOW, ...options });

/* ------------------------- when it appears at all ----------------------- */

test("a record being confirmed for the first time shows the screen", () => {
  const result = call({ record: record({ nextFocus: ["왼쪽 골반 확인"] }), stageBeforeSave: "structured_draft", schedule: [booked("2026-09-11", "14:00")] });
  assert.ok(result);
});

test("re-editing an already confirmed record shows nothing", () => {
  /* The screen is about what a new record will do next time. Re-opening an old
     one and saving again is not that moment. */
  assert.equal(call({ record: record({ nextFocus: ["x"] }, { stage: "confirmed_record" }), stageBeforeSave: "confirmed_record", schedule: [booked("2026-09-11", "14:00")] }), null);
  assert.equal(isFirstConfirmation("confirmed_record"), false);
  assert.equal(isFirstConfirmation("structured_draft"), true);
  assert.equal(isFirstConfirmation(""), true, "a note with no record stage yet");
});

test("a record the AI could not organise shows nothing", () => {
  /* Building a card out of an unstructured transcript would show the
     instructor a shape they never produced. */
  const raw = record({ nextFocus: ["x"] }, { provenanceSource: "fallback_raw" });
  assert.equal(call({ record: raw, stageBeforeSave: "raw_transcript", schedule: [booked("2026-09-11", "14:00")] }), null);
  assert.equal(isStructuredLessonRecord(raw), false);
});

test("a record with no structured draft shows nothing", () => {
  for (const structuredDraft of [null, undefined]) {
    assert.equal(call({ record: record({}, { structuredDraft }), stageBeforeSave: "raw_transcript", schedule: [] }), null);
  }
  assert.equal(isStructuredLessonRecord(null), false);
  assert.equal(isStructuredLessonRecord({ provenanceSource: "openai" }), false);
});

/* ------------------------------ A / B / C ------------------------------ */

test("A: a next lesson and a 다음 확인 entry", () => {
  const result = call({
    record: record({ nextFocus: ["왼쪽 골반 확인", "런지 각도"] }),
    stageBeforeSave: "structured_draft",
    schedule: [booked("2026-09-11", "14:00")],
    recordDate: "2026-09-08",
  });
  assert.equal(result.layout, "A");
  assert.equal(result.focus, "왼쪽 골반 확인 · 런지 각도");
  assert.equal(result.memberName, "정다은");
  assert.equal(result.lessonDate, "09.11 (금)");
  assert.equal(result.lessonTime, "14:00");
  assert.equal(result.basisDate, "09.08", "the record's own date, shown as the basis");
  assert.equal(result.lastLesson, null, "B's block is not built when A applies");
});

test("B: a next lesson but 다음 확인 is empty", () => {
  const result = call({
    record: record({ didToday: ["리포머 풋워크"], observations: ["어깨 긴장 줄어듦"] }),
    stageBeforeSave: "structured_draft",
    schedule: [booked("2026-09-11", "14:00")],
    recordDate: "2026-09-08",
  });
  assert.equal(result.layout, "B");
  assert.equal(result.focus, null);
  assert.equal(result.lastLesson, "리포머 풋워크 / 어깨 긴장 줄어듦");
});

test("B falls back to whichever of the two fields has content", () => {
  const onlyToday = call({ record: record({ didToday: ["리포머"] }), stageBeforeSave: "s", schedule: [booked("2026-09-11", "14:00")] });
  assert.equal(onlyToday.lastLesson, "리포머");
  const onlyObserved = call({ record: record({ observations: ["긴장 줄어듦"] }), stageBeforeSave: "s", schedule: [booked("2026-09-11", "14:00")] });
  assert.equal(onlyObserved.lastLesson, "긴장 줄어듦");
});

test("B with every field empty invents nothing", () => {
  const result = call({ record: record({}), stageBeforeSave: "s", schedule: [booked("2026-09-11", "14:00")] });
  assert.equal(result.layout, "B");
  assert.equal(result.lastLesson, null, "no text is better than made-up text");
});

test("C: no next lesson", () => {
  const result = call({ record: record({ nextFocus: ["왼쪽 골반"] }), stageBeforeSave: "structured_draft", schedule: [] });
  assert.equal(result.layout, "C");
  assert.equal(result.memberName, "정다은");
  // A is not reachable without a lesson to show it on, even with a focus line.
  assert.ok(!("focus" in result));
});

test("a lesson already past is not a next lesson", () => {
  const result = call({ record: record({ nextFocus: ["x"] }), stageBeforeSave: "s", schedule: [booked("2026-09-01", "14:00")] });
  assert.equal(result.layout, "C");
});

test("a cancelled booking is not a next lesson", () => {
  const cancelled = { id: "l1", date: "2026-09-11", start: "14:00", attendees: [{ memberId: "m1", status: "cancelled" }] };
  assert.equal(call({ record: record({ nextFocus: ["x"] }), stageBeforeSave: "s", schedule: [cancelled] }).layout, "C");
});

test("the soonest upcoming lesson is the one shown", () => {
  const result = call({
    record: record({ nextFocus: ["x"] }), stageBeforeSave: "s",
    schedule: [booked("2026-09-20", "10:00"), booked("2026-09-11", "14:00"), booked("2026-09-15", "09:00")],
  });
  assert.equal(result.lessonDate, "09.11 (금)");
});

/* --------------------- C's repeated line, by object --------------------- */

test("C omits the repeated line when there is no repeated memory", () => {
  /* memberMemorySummary returns "반복 기록 없음" as a string, so asking the
     string would print that sentence instead of dropping the row. */
  const summary = memberMemorySummary({ memories: [], sessions: [] });
  assert.equal(summary.repeated, "반복 기록 없음");
  assert.equal(summary.repeatedMemory, null, "the object is what says there is none");

  const result = call({ record: record({}), stageBeforeSave: "s", schedule: [], member: { id: "m1", name: "정다은", aiMemory: [] } });
  assert.equal(result.repeated, null);
});

test("the component renders nothing for an absent repeated line", async () => {
  const source = await componentSource();
  assert.match(source, /\{reflection\.repeated && \(/);
  // The sentence may be discussed in a comment, but never drawn.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /반복 기록 없음/);
});

/* ------------------------------ the wiring ------------------------------ */

test("the stage is read before the save overwrites it", async () => {
  const source = await appSource();
  const start = source.indexOf("const saveNote = async (id, note) => {");
  const body = source.slice(start, source.indexOf("const deleteNote", start));
  const captured = body.indexOf("const stageBeforeSave = String(note.lessonRecord?.stage || \"\");");
  const overwritten = body.indexOf("stage: \"confirmed_record\",");
  assert.ok(captured >= 0, "the pre-save stage has to be captured");
  assert.ok(captured < overwritten, "and captured before it is overwritten, or the check is always false");
});

test("the screen is decided after the record is actually stored", async () => {
  const source = await appSource();
  const start = source.indexOf("const saveNote = async (id, note) => {");
  const body = source.slice(start, source.indexOf("const deleteNote", start));
  const stored = body.indexOf("if (stored === false) return false;");
  const dequeued = body.indexOf("removePendingLessonRecord(id, noteSid);");
  const decided = body.indexOf("const nextReflection = selectNextLessonReflection({");
  assert.ok(stored < decided && dequeued < decided, "what the screen says has to match what was saved");
});

test("both save paths reach it", async () => {
  const source = await appSource();
  const start = source.indexOf("const saveNote = async (id, note) => {");
  const body = source.slice(start, source.indexOf("const deleteNote", start));
  /* noteBack sends the instructor back to the schedule; the other path stays
     put. The screen is decided before that fork, so neither misses it. */
  assert.ok(body.indexOf("if (nextReflection) setReflection(nextReflection);") < body.indexOf("if (noteBack) {"));
});

test("the component lives outside App.jsx", async () => {
  const source = await appSource();
  // App.jsx is the shell of screens not yet moved out; new code does not go in it.
  assert.match(source, /import NextLessonReflection from "\.\/features\/lesson-record\/NextLessonReflection\.jsx";/);
  assert.match(source, /import \{ selectNextLessonReflection \} from "\.\/features\/lesson-record\/next-lesson-reflection\.js";/);
  assert.match(source, /\{reflection && <NextLessonReflection\s*\r?\n\s*reflection=\{reflection\}\s*\r?\n\s*onConfirm=\{\(\) => setReflection\(null\)\}/);
});

test("the queue button is optional and off by itself", async () => {
  const source = await componentSource();
  /* Wired now, but the component still stands without it: a screen with
     nothing left to record shows only 확인. */
  assert.match(source, /onNextPending = null,\s*\r?\n\s*pendingCount = 0,/);
  assert.match(source, /const showNext = Boolean\(onNextPending\) && Number\(pendingCount\) > 0;/);
  const app = await appSource();
  assert.match(app, /onNextPending=\{reflectionPending\.sessions\[0\]\?\.lessonId/, "and the app supplies it");
});

test("the basis date is always stated", async () => {
  const source = await componentSource();
  // Required: a sentence with no source cannot be checked by the instructor.
  assert.equal((source.match(/근거: \{reflection\.basisDate\} 기록/g) || []).length, 2, "on both A and B");
});

test("the four field labels are the ones already in the code", async () => {
  const source = await componentSource();
  /* didToday and observations feed B's line; the labels themselves are not
     restated here, and no new wording is introduced. */
  assert.match(source, /오늘 확인/);
  assert.match(source, /지난 수업/);
  assert.match(source, /다음 수업에 이 내용이 뜹니다/);
  assert.match(source, /기록했습니다/);
});
