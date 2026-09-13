import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const scheduleSave = async () => {
  const source = await appSource();
  const start = source.indexOf("const saveScheduleComment = async (id, type, sid, body");
  return source.slice(start, source.indexOf("const noComment = (id, type, sid)", start));
};
const memberSave = async () => {
  const source = await appSource();
  const start = source.indexOf("const saveNote = async (id, note) => {");
  return source.slice(start, source.indexOf("const deleteNote", start));
};

/* A record can be saved from two places: the lesson sheet on the schedule tab,
   and the member's own detail screen. The reflection screen was wired into the
   second only -- which is the one instructors use least. */

test("the schedule sheet shows the reflection too", async () => {
  const body = await scheduleSave();
  assert.match(body, /const nextReflection = selectNextLessonReflection\(\{/);
  assert.match(body, /setReflection\(nextReflection\);/);
});

test("the member detail path still shows it", async () => {
  const body = await memberSave();
  assert.match(body, /const nextReflection = selectNextLessonReflection\(\{/);
  assert.match(body, /setReflection\(nextReflection\);/);
});

/* ------------------ the trap that caught the first path ----------------- */

test("the schedule path reads the stage before the save overwrites it", async () => {
  const body = await scheduleSave();
  /* storedLessonRecord rewrites stage to confirmed_record. Read after that and
     every save looks like a re-confirmation, so the screen never appears. */
  const captured = body.indexOf("const stageBeforeSave = String(voiceMeta?.lessonRecord?.stage || \"\");");
  const overwritten = body.indexOf("stage: \"confirmed_record\",");
  assert.ok(captured >= 0, "the pre-save stage has to be captured");
  assert.ok(captured < overwritten, "and before it is overwritten");
});

test("both paths judge the same way", async () => {
  const schedule = await scheduleSave();
  const member = await memberSave();
  for (const body of [schedule, member]) {
    assert.match(body, /stageBeforeSave/);
    assert.match(body, /record: (voiceMeta\?\.lessonRecord|note\.lessonRecord)/);
  }
});

test("the schedule path decides after the record is stored and dequeued", async () => {
  const body = await scheduleSave();
  const stored = body.indexOf("if (stored === false) return false;");
  const dequeued = body.indexOf("if (shouldConfirm && sid) removePendingLessonRecord(id, sid);");
  const decided = body.indexOf("const nextReflection = selectNextLessonReflection({");
  assert.ok(stored >= 0 && stored < decided, "what the screen says must match what was saved");
  assert.ok(dequeued >= 0 && dequeued < decided, "and the remaining count must be the real one");
});

test("a draft save shows nothing", async () => {
  const body = await scheduleSave();
  /* Saving a draft mid-recording is not a confirmation, and the screen is
     about a record that has just become one. */
  assert.match(body, /if \(shouldConfirm\) \{\s*\r?\n\s*const nextReflection = selectNextLessonReflection\(\{/);
});

/* ------------------------- one shared allowance ------------------------- */

test("both paths spend the same three showings", async () => {
  const source = await appSource();
  /* Counting per path would let the same screen appear six times. To the
     instructor it is one screen. */
  assert.equal((source.match(/shouldShowNextLessonReflection\(globalThis\.localStorage\)/g) || []).length, 2);
  assert.equal((source.match(/markNextLessonReflectionShown\(globalThis\.localStorage\)/g) || []).length, 2);
  // One key, read through the one pair of helpers.
  assert.equal((source.match(/NEXT_LESSON_REFLECTION_COUNT_KEY/g) || []).length, 0, "the key is never touched directly");
});

test("each path spends the allowance only when the screen appears", async () => {
  for (const body of [await scheduleSave(), await memberSave()]) {
    assert.match(body, /if \(nextReflection && shouldShowNextLessonReflection\(globalThis\.localStorage\)\) \{\s*\r?\n\s*markNextLessonReflectionShown\(globalThis\.localStorage\);\s*\r?\n\s*setReflection\(nextReflection\);/);
  }
});

test("the toast each path already gave is untouched", async () => {
  const schedule = await scheduleSave();
  const member = await memberSave();
  assert.match(schedule, /setToast\(\{ ok: true, msg: text === "특이사항 없음"/);
  assert.match(member, /setToast\(\{ ok: true, msg: "코멘트를 저장했습니다\." \}\)/);
});
