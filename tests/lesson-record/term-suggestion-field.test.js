import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyLessonRecordSuggestion, validateStructuredOutput } from "../../src/features/lesson-record/record-schema.js";

const promptSource = () => readFile(new URL("../../functions/src/prompts.js", import.meta.url), "utf8");

/* A word heard as equipment but not confidently placed is asked about rather
   than recorded. Which field the question belongs to is the same judgement as
   the four fields themselves: it is the field the word was spoken in.

   "다음 수업에는 리폼으로 운동하겠습니다" -- 리포머 belongs to 다음 확인. Putting
   it in 오늘 수업 is the defect commit A fixed, in a new place. */

const utterance = {
  didToday: [],
  observations: [],
  responses: ["운동을 힘들어함"],
  nextFocus: ["운동 진행"],
  uncertain: [],
  suggestions: [{ field: "nextFocus", text: "리포머", kind: "term" }],
  summary: "운동을 힘들어했고, 다음 수업에 운동을 진행합니다.",
};

test("the term question belongs to the field the word was spoken in", () => {
  const output = validateStructuredOutput(utterance);
  assert.equal(output.suggestions[0].field, "nextFocus");
  assert.notEqual(output.suggestions[0].field, "didToday", "오늘 수업 is not where a next-lesson plan goes");
  assert.equal(output.suggestions[0].kind, "term");
});

test("pressing it lands in 다음 확인, not 오늘 수업", () => {
  const next = applyLessonRecordSuggestion(validateStructuredOutput(utterance), 0);
  assert.deepEqual(next.nextFocus.map((item) => item.text), ["운동 진행", "리포머"]);
  assert.deepEqual(next.didToday, [], "nothing was done today, and confirming a word does not change that");
});

test("the screen follows the suggestion's own field, with nothing hardcoded", async () => {
  const source = await readFile(new URL("../../src/features/lesson-record/record-schema.js", import.meta.url), "utf8");
  /* A fixed target would put every confirmed term in the same box regardless
     of when it was said. */
  assert.match(source, /\[picked\.field\]: next\.map\(/);
  assert.match(source, /const existing = \(draft\?\.\[picked\.field\] \|\| \[\]\)/);
  assert.doesNotMatch(source, /kind === "term" \? "didToday"/);
});

test("a term suggestion can target any of the four", () => {
  for (const field of ["didToday", "observations", "responses", "nextFocus"]) {
    const output = validateStructuredOutput({ ...utterance, suggestions: [{ field, text: "리포머", kind: "term" }] });
    assert.equal(output.suggestions[0].field, field);
    const next = applyLessonRecordSuggestion(output, 0);
    assert.ok(next[field].some((item) => item.text === "리포머"), `${field} must receive it`);
  }
});

/* ------------------------------ the prompt ------------------------------ */

test("the prompt says which field a suggestion belongs to", async () => {
  const prompt = await promptSource();
  assert.match(prompt, /field는 그 말이 등장한 문맥의 칸입니다/);
  assert.match(prompt, /이미 일어난 일의 문맥이면 didToday·observations·responses, 앞으로 할 일의 문맥이면 nextFocus/);
});

test("an unplaceable suggestion is not made at all", async () => {
  const prompt = await promptSource();
  /* Guessing the field would put a real word in the wrong record. Saying
     nothing loses only the convenience. */
  assert.match(prompt, /어느 칸인지 판단이 서지 않으면 그 제안을 아예 만들지 마세요/);
  assert.match(prompt, /틀린 칸에 넣는 것보다 만들지 않는 편이 낫습니다/);
});

test("both tenses have a worked example, so neither pulls the other", async () => {
  const prompt = await promptSource();
  /* With only the didToday example present, a next-lesson mention would drift
     into 오늘 수업 by imitation. */
  assert.match(prompt, /불확실 기구명 예\(과거 문맥\)/);
  assert.match(prompt, /불확실 기구명 예\(미래 문맥\)/);
  assert.match(prompt, /suggestions=\[\{field:'didToday', text:'리포머', kind:'term'\}\]/);
  assert.match(prompt, /suggestions=\[\{field:'nextFocus', text:'리포머', kind:'term'\}\]/);
});

test("the test utterance is the future-tense example", async () => {
  const prompt = await promptSource();
  assert.match(prompt, /운동을 힘들어했고, 다음 수업에는 리폼으로 운동하겠습니다/);
  assert.match(prompt, /field는 nextFocus 이고 didToday가 아닙니다/);
  // And the example keeps 오늘 수업 empty, as the reported case requires.
  assert.match(prompt, /운동하겠습니다'는 didToday=\[\]/);
});

test("the version moved with the rule", async () => {
  const prompt = await promptSource();
  assert.match(prompt, /promptVersion: "lesson_record_v7"/);
});
