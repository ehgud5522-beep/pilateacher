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
  suggestions: [{ field: "nextFocus", text: "리포머로 운동 진행", kind: "term", replaces: "운동 진행" }],
  summary: "운동을 힘들어했고, 다음 수업에 운동을 진행합니다.",
};

/* What the gateway sent before the sentence-and-replaces rule: a bare word
   and nothing to put it in. The app still has to handle it, because the
   gateway is deployed separately from the app. */
const bareWord = { ...utterance, suggestions: [{ field: "nextFocus", text: "리포머", kind: "term" }] };

test("the term question belongs to the field the word was spoken in", () => {
  const output = validateStructuredOutput(utterance);
  assert.equal(output.suggestions[0].field, "nextFocus");
  assert.notEqual(output.suggestions[0].field, "didToday", "오늘 수업 is not where a next-lesson plan goes");
  assert.equal(output.suggestions[0].kind, "term");
});

test("pressing it lands in 다음 확인, not 오늘 수업", () => {
  const next = applyLessonRecordSuggestion(validateStructuredOutput(utterance), 0);
  assert.deepEqual(next.nextFocus.map((item) => item.text), ["리포머로 운동 진행"]);
  assert.deepEqual(next.didToday, [], "nothing was done today, and confirming a word does not change that");
});

test("the confirmed word mends the line it was taken out of", () => {
  /* The AI leaves the apparatus out of the sentence while it is unsure, so
     the sentence is already in the field. Adding the word as a second line
     -- "운동 진행 · 리포머" -- reads as the same thing written twice. */
  const next = applyLessonRecordSuggestion(validateStructuredOutput(utterance), 0);
  assert.equal(next.nextFocus.length, 1, "one line in, one line out");
  assert.equal(next.nextFocus[0].text, "리포머로 운동 진행");
  assert.equal(next.nextFocus[0].origin, "instructor", "the instructor put it there");
  assert.deepEqual(next.suggestions, [], "and the chip is gone");
});

test("a gateway that has not been updated yet still behaves as it did", () => {
  /* The app ships before the gateway. Until the new prompt is live the
     suggestion arrives as a bare word with nothing to replace, and it has
     to keep working the way it does today rather than dropping the word. */
  const next = applyLessonRecordSuggestion(validateStructuredOutput(bareWord), 0);
  assert.deepEqual(next.nextFocus.map((item) => item.text), ["운동 진행", "리포머"]);
});

test("a line that is not there is added rather than lost", () => {
  /* If the AI names a line that the instructor has since edited away, the
     safe move is the old one: put it at the end. Dropping it would lose a
     word the instructor just confirmed. */
  const edited = { ...utterance, nextFocus: ["브릿지 진행"] };
  const next = applyLessonRecordSuggestion(validateStructuredOutput(edited), 0);
  assert.deepEqual(next.nextFocus.map((item) => item.text), ["브릿지 진행", "리포머로 운동 진행"]);
});

test("mending a line onto one that already says it leaves one line", () => {
  const doubled = { ...utterance, nextFocus: ["운동 진행", "리포머로 운동 진행"] };
  const next = applyLessonRecordSuggestion(validateStructuredOutput(doubled), 0);
  assert.deepEqual(next.nextFocus.map((item) => item.text), ["리포머로 운동 진행"]);
});

test("a content suggestion is still added, not swapped in", () => {
  /* Only a term question stands in for a line. A thought that follows from
     what was said is a new line. */
  const content = { ...utterance, suggestions: [{ field: "nextFocus", text: "다음 수업 강도 조절 확인", kind: "content", replaces: "" }] };
  const next = applyLessonRecordSuggestion(validateStructuredOutput(content), 0);
  assert.deepEqual(next.nextFocus.map((item) => item.text), ["운동 진행", "다음 수업 강도 조절 확인"]);
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
    const output = validateStructuredOutput({ ...bareWord, suggestions: [{ field, text: "리포머", kind: "term" }] });
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
  assert.match(prompt, /suggestions=\[\{field:'didToday', text:'리포머 풋워크', kind:'term', replaces:'풋워크'\}\]/);
  assert.match(prompt, /suggestions=\[\{field:'nextFocus', text:'리포머로 운동 진행', kind:'term', replaces:'운동 진행'\}\]/);
});

test("the test utterance is the future-tense example", async () => {
  const prompt = await promptSource();
  assert.match(prompt, /운동을 힘들어했고, 다음 수업에는 리폼으로 운동하겠습니다/);
  assert.match(prompt, /field는 nextFocus 이고 didToday가 아닙니다/);
  // And the example keeps 오늘 수업 empty, as the reported case requires.
  assert.match(prompt, /운동하겠습니다'는 didToday=\[\]/);
});

test("the prompt asks for a sentence and the line it stands in for", async () => {
  const prompt = await promptSource();
  assert.match(prompt, /명칭 하나만 적으면 강사가 눌렀을 때 그 낱말이 문장 옆에 따로 서서/,
    "the reason is in the prompt, not only in the example");
  assert.match(prompt, /replaces에 그 구가 대신할 기존 줄을 그 칸에 적은 그대로 적으세요/);
  assert.match(prompt, /kind:'content' 의 replaces는 빈 문자열입니다/);
  assert.match(prompt, /대신할 줄을 특정할 수 없으면 replaces를 빈 문자열로 두세요/);
});

test("the version moved with the rule", async () => {
  const prompt = await promptSource();
  assert.match(prompt, /promptVersion: "lesson_record_v8"/);
});
