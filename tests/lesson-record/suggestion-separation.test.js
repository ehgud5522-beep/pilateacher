import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LESSON_RECORD_FIELDS, LESSON_RECORD_SUGGESTION_FIELDS, LESSON_RECORD_SUGGESTION_LIMIT,
  applyLessonRecordSuggestion, createLessonRecordMeta, structuredRecordBody, validateStructuredOutput,
} from "../../src/features/lesson-record/record-schema.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const promptSource = () => readFile(new URL("../../functions/src/prompts.js", import.meta.url), "utf8");

/* ============ the reported case ============================================

   "운동을 힘들어했고, 다음 수업에는 리포머로 운동하겠습니다"

   didToday came back holding "강도 낮춰 진행". Nothing was done today that the
   instructor described, and lowering the intensity was never said -- it was
   read off "힘들어했고". A record is not the place for that.                */

const reportedCase = {
  didToday: [],
  observations: [],
  responses: ["운동을 힘들어함"],
  nextFocus: ["리포머로 운동 진행"],
  uncertain: [],
  suggestions: [{ field: "nextFocus", text: "다음 수업 강도 조절 확인" }],
  summary: "운동을 힘들어했고, 다음 수업에는 리포머로 진행합니다.",
};

test("the reported utterance leaves 오늘 수업 empty", () => {
  const output = validateStructuredOutput(reportedCase);
  assert.deepEqual(output.didToday, [], "nothing was said about what was done today");
  assert.deepEqual(output.responses.map((item) => item.text), ["운동을 힘들어함"]);
  assert.deepEqual(output.nextFocus.map((item) => item.text), ["리포머로 운동 진행"]);
});

test("a suggestion is allowed to exist, and is allowed not to", () => {
  assert.equal(validateStructuredOutput(reportedCase).suggestions.length, 1);
  assert.deepEqual(validateStructuredOutput({ ...reportedCase, suggestions: [] }).suggestions, []);
  assert.deepEqual(validateStructuredOutput({ ...reportedCase, suggestions: undefined }).suggestions, []);
});

test("the intensity line never lands in a field on its own", () => {
  /* The exact regression: whatever else changes, an inference must not be
     sitting in one of the four when the instructor did not say it. */
  const output = validateStructuredOutput(reportedCase);
  for (const field of LESSON_RECORD_FIELDS) {
    const texts = output[field].map((item) => item.text);
    assert.ok(!texts.some((text) => text.includes("강도 낮춰")), `${field} must not carry the inferred intensity`);
  }
  assert.ok(output.suggestions.some((item) => item.text.includes("강도")), "it belongs in the suggestion list");
});

/* ---------------------- suggestions are not records --------------------- */

test("an unadopted suggestion never reaches the saved body", () => {
  /* The body is what member memory and the briefing are built from. A
     suggestion the instructor never pressed must not travel there. */
  const body = structuredRecordBody(validateStructuredOutput(reportedCase));
  assert.ok(!body.includes("강도 조절"), "the suggestion stays out of the body");
  assert.ok(body.includes("운동을 힘들어함"));
  assert.ok(body.includes("리포머로 운동 진행"));
});

test("the saved record keeps suggestions apart from the four fields", () => {
  const meta = createLessonRecordMeta({ rawTranscript: "운동을 힘들어했고", structuredDraft: reportedCase, status: "structured" });
  assert.equal(meta.structuredDraft.suggestions.length, 1);
  assert.deepEqual(meta.structuredDraft.didToday, []);
});

test("suggestions are capped and can only target a real field", () => {
  assert.equal(LESSON_RECORD_SUGGESTION_LIMIT, 2);
  const many = validateStructuredOutput({
    ...reportedCase,
    suggestions: [
      { field: "nextFocus", text: "a" }, { field: "observations", text: "b" }, { field: "responses", text: "c" },
    ],
  });
  assert.equal(many.suggestions.length, 2);

  const bad = validateStructuredOutput({
    ...reportedCase,
    suggestions: [{ field: "uncertain", text: "x" }, { field: "diagnosis", text: "y" }, { field: "nextFocus", text: "" }, "z", null],
  });
  assert.deepEqual(bad.suggestions, [], "uncertain is not a suggestion target, and neither is an invented field");
  assert.ok(!LESSON_RECORD_SUGGESTION_FIELDS.includes("uncertain"));
});

test("a broken suggestion list costs the suggestions, not the record", () => {
  const output = validateStructuredOutput({ ...reportedCase, suggestions: "nonsense" });
  assert.deepEqual(output.suggestions, []);
  assert.deepEqual(output.responses.map((item) => item.text), ["운동을 힘들어함"], "the record survives");
});

/* --------------------------- pressing a chip ---------------------------- */

test("pressing a suggestion puts it in its field and takes the chip away", () => {
  const draft = validateStructuredOutput(reportedCase);
  const next = applyLessonRecordSuggestion(draft, 0);
  assert.deepEqual(next.nextFocus.map((item) => item.text), ["리포머로 운동 진행", "다음 수업 강도 조절 확인"]);
  assert.deepEqual(next.suggestions, [], "the chip is gone once taken");
});

test("what the instructor pressed is marked as theirs", () => {
  /* AI-written and instructor-accepted have to stay distinguishable in the
     stored record. */
  const next = applyLessonRecordSuggestion(validateStructuredOutput(reportedCase), 0);
  const added = next.nextFocus.find((item) => item.text === "다음 수업 강도 조절 확인");
  assert.equal(added.origin, "instructor");
});

test("pressing the same suggestion twice adds it once", () => {
  const draft = { ...validateStructuredOutput(reportedCase) };
  const withText = { ...draft, nextFocus: [{ text: "다음 수업 강도 조절 확인", origin: "ai" }] };
  const next = applyLessonRecordSuggestion(withText, 0);
  assert.equal(next.nextFocus.filter((item) => item.text === "다음 수업 강도 조절 확인").length, 1);
});

test("an out-of-range or absent suggestion changes nothing", () => {
  const draft = validateStructuredOutput(reportedCase);
  for (const index of [-1, 5, null, undefined, "x"]) {
    assert.equal(applyLessonRecordSuggestion(draft, index), draft);
  }
  assert.deepEqual(applyLessonRecordSuggestion({}, 0), {});
});

test("saving without pressing anything keeps the record clean", () => {
  const draft = validateStructuredOutput(reportedCase);
  assert.deepEqual(draft.didToday, []);
  assert.ok(!structuredRecordBody(draft).includes("강도 조절"));
});

/* ------------------------------ the prompt ------------------------------ */

test("the prompt no longer turns 힘들어했다 into a lowered intensity", async () => {
  const prompt = await promptSource();
  assert.match(prompt, /힘들어했다는 말만으로 강도를 낮췄다고 적지 마세요/);
  assert.match(prompt, /강사가 그렇게 말하지 않았으면 didToday는 비웁니다/);
  // The old unconditional instruction is gone.
  assert.doesNotMatch(prompt, /그에 따라 실제로 낮춘 수업 강도는 didToday에 두세요/);
});

test("the prompt splits the fields by tense", async () => {
  const prompt = await promptSource();
  assert.match(prompt, /이미 일어난 일\(했다, 였다, 좋아졌다\)은 didToday·observations·responses/);
  assert.match(prompt, /앞으로 할 일\(하겠다, 할 예정, 볼게요\)은 nextFocus/);
  assert.match(prompt, /과거인지 미래인지 판단이 서지 않으면 어느 칸에도 넣지 마세요/);
});

test("the prompt sends inference to the suggestion list only", async () => {
  const prompt = await promptSource();
  assert.match(prompt, /네 칸이 아니라 여기에만 담습니다/);
  assert.match(prompt, /최대 2건이며 없으면 빈 배열/);
  // A suggestion is still not a diagnosis.
  assert.match(prompt, /여전히 금지: 의학적 진단, 통증의 원인 추정, 질환명, 치료 효과 표현/);
  assert.match(prompt, /근거가 발화에 없으면 제안도 만들지 말고 빈 배열로/);
  assert.match(prompt, /promptVersion: "lesson_record_v6"/);
});

test("the reported utterance is written into the prompt as its example", async () => {
  const prompt = await promptSource();
  assert.match(prompt, /운동을 힘들어했고, 다음 수업에는 리포머로 운동하겠습니다/);
  assert.match(prompt, /강도를 낮췄다는 말이 없으므로 didToday는 비웁니다/);
});

/* ------------------------------ the screen ------------------------------ */

test("the chips sit apart from the four cards", async () => {
  const source = await appSource();
  assert.match(source, /AI 제안 · 눌러서 추가/);
  assert.match(source, /말한 내용이 아니라 제안입니다\. 누른 것만 기록에 들어갑니다\./);
  // A different ground and a dashed edge, so the two are not read as one list.
  assert.match(source, /backgroundColor: TINT, border: `1px dashed \$\{RING\}`/);
});

test("no chips means no section", async () => {
  const source = await appSource();
  assert.match(source, /\{\(summaryDraft\.suggestions \|\| \[\]\)\.length > 0 && <section/);
});

test("a content chip says which field it will fill", async () => {
  const source = await appSource();
  assert.match(source, /\$\{LESSON_RECORD_FIELD_LABELS\[item\.field\] \|\| item\.field\}/);
});

test("a term chip asks instead of proposing", async () => {
  const source = await appSource();
  /* "이렇게 들렸는데 맞나"와 "이런 게 이어지는데 넣을까"는 강사가 내리는 판단이
     다르다. 같은 칩으로 보이면 무엇을 확인하는지 흐려진다. */
  assert.match(source, /item\.kind === "term" \? <span className="mr-1 font-bold opacity-70">이렇게 들렸어요<\/span> : null/);
  assert.match(source, /item\.kind === "term" \? " 맞나요\?" :/);
});

test("a term suggestion carries its kind through the schema", () => {
  const output = validateStructuredOutput({
    ...reportedCase,
    suggestions: [{ field: "didToday", text: "리포머", kind: "term" }],
  });
  assert.deepEqual(output.suggestions, [{ field: "didToday", text: "리포머", kind: "term" }]);
});

test("a suggestion with no kind is treated as content, not as a term check", () => {
  /* Asking "did I hear this right?" about something the model invented would
     be a different claim entirely. */
  const output = validateStructuredOutput({ ...reportedCase, suggestions: [{ field: "nextFocus", text: "x" }] });
  assert.equal(output.suggestions[0].kind, "content");
  const bogus = validateStructuredOutput({ ...reportedCase, suggestions: [{ field: "nextFocus", text: "x", kind: "diagnosis" }] });
  assert.equal(bogus.suggestions[0].kind, "content", "an unknown kind falls back rather than passing through");
});

test("pressing a term chip puts the corrected word in its field", () => {
  const draft = validateStructuredOutput({
    ...reportedCase,
    didToday: [],
    suggestions: [{ field: "didToday", text: "리포머", kind: "term" }],
  });
  const next = applyLessonRecordSuggestion(draft, 0);
  assert.deepEqual(next.didToday.map((item) => item.text), ["리포머"]);
  assert.equal(next.didToday[0].origin, "instructor", "the instructor confirmed it, so it is theirs");
  assert.deepEqual(next.suggestions, []);
});

test("pressing a chip goes through the shared rule", async () => {
  const source = await appSource();
  assert.match(source, /setSummaryDraft\(\(current\) => applyLessonRecordSuggestion\(current, index\)\)/);
});
