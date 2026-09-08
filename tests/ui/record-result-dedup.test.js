import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { EMPTY_FIELD_MARK, lessonRecordPresentation } from "../../src/features/lesson-record/lesson-record-presentation.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const voiceNote = async () => {
  const source = await appSource();
  const start = source.indexOf("function VoiceNote(");
  return source.slice(start, source.indexOf("\nfunction ", start + 50));
};

const draft = (fields = {}) => ({ didToday: [], observations: [], responses: [], nextFocus: [], uncertain: [], ...fields });

/* ------------------- the same content, three times ---------------------- */

test("the record sentence no longer repeats the four cards", async () => {
  const source = await voiceNote();
  /* ① what was said ② the four cards ③ a paragraph rebuilt from the four
     cards. The third one read as "the app is repeating itself", not as
     "the app organised this". */
  assert.match(source, /\{summaryView\.narrative && summaryView\.cards\.length === 0 && <section/);
});

test("the sentence survives where it is the only content", async () => {
  const source = await voiceNote();
  /* When the AI could not organise anything, the cards are empty and that
     paragraph is all there is. Removing it outright would leave a blank. */
  const raw = lessonRecordPresentation({ provenanceSource: "fallback_raw", rawTranscript: "리포머로 했어요" });
  assert.deepEqual(raw.cards, []);
  assert.equal(raw.narrative, "리포머로 했어요");
  assert.match(source, /summaryView\.cards\.length === 0 &&/);
});

test("what was said is folded away once the cards exist", async () => {
  const source = await voiceNote();
  assert.match(source, /<summary className="cursor-pointer list-none text-\[10px\] font-extrabold"[^>]*>말한 내용 보기<\/summary>/);
  // Folded, not deleted -- it is the only place to check the term corrections.
  assert.match(source, /whitespace-pre-wrap text-xs leading-relaxed" aria-label="말한 수업 내용"/);
});

test("before there are cards it is still shown outright", async () => {
  const source = await voiceNote();
  /* With no summary yet, the transcript is the content, and hiding it behind
     a disclosure would leave the screen looking empty. */
  assert.match(source, /: text && \(summaryDraft/);
  assert.match(source, /: <div className="mt-2 rounded-xl p-3" aria-label="말한 수업 내용"/);
  assert.match(source, /\{summaryError \? "선생님 기록" : "음성 기록"\}/);
});

/* --------------------------- the empty fields --------------------------- */

test("an empty field is a dash, not an instruction", () => {
  /* "추가해 주세요" told the instructor they had left homework undone. They
     had not: they simply did not say anything about it. */
  const view = lessonRecordPresentation(draft({ didToday: [{ text: "풋워크" }] }));
  const byKey = Object.fromEntries(view.cards.map((card) => [card.key, card]));
  assert.equal(byKey.didToday.value, "풋워크");
  assert.equal(byKey.didToday.empty, false);
  for (const key of ["observations", "responses", "nextFocus"]) {
    assert.equal(byKey[key].value, EMPTY_FIELD_MARK);
    assert.equal(byKey[key].empty, true);
  }
});

/* A comment may still discuss the old wording; only rendered text matters. */
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("neither old placeholder survives anywhere", async () => {
  const presentation = await readFile(new URL("../../src/features/lesson-record/lesson-record-presentation.js", import.meta.url), "utf8");
  assert.doesNotMatch(withoutComments(presentation), /추가해 주세요|아직 계획 없음/);
  assert.doesNotMatch(withoutComments(await voiceNote()), /추가해 주세요|아직 계획 없음/);
});

test("the empty look is chosen by the flag, not by matching the text", async () => {
  const source = await voiceNote();
  /* Comparing against the placeholder string meant a real entry that happened
     to read the same way would have been greyed out. */
  assert.match(source, /style=\{\{ color: item\.empty \? FAINT : INK2 \}\}/);
});

/* ------------------------- what must not change ------------------------- */

test("the four labels are untouched", () => {
  const view = lessonRecordPresentation(draft());
  assert.deepEqual(view.cards.map((card) => card.label), ["변화", "오늘 수업", "회원 반응", "다음 확인"]);
});

test("the stored shape is untouched", () => {
  /* Display only: the draft passed in comes back unread and unchanged, and
     nothing new is written into it. */
  const input = draft({ didToday: [{ text: "풋워크", origin: "ai" }] });
  const snapshot = JSON.stringify(input);
  lessonRecordPresentation(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test("the suggestion area still sits between the cards and the rest", async () => {
  const source = await voiceNote();
  const cards = source.indexOf("AI 수업 요약");
  const suggestions = source.indexOf("AI 제안 · 눌러서 추가");
  const narrative = source.indexOf("summaryView.narrative &&");
  assert.ok(cards >= 0 && suggestions > cards, "suggestions come after the cards");
  assert.ok(narrative > suggestions, "and the leftover paragraph after both");
});
