import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PILATES_TERM_CORRECTION_LIMIT, PILATES_TERM_DICTIONARY,
  applyPilatesTermDictionary, correctPilatesTerms, readPilatesTermCorrections, recordPilatesTermCorrections,
} from "../../src/features/lesson-record/pilates-terms.js";
import { buildLessonRecordInput } from "../../src/ai/input-builders.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

function memoryStorage() {
  const cells = new Map();
  return { getItem: (k) => (cells.has(k) ? cells.get(k) : null), setItem: (k, v) => cells.set(k, String(v)) };
}

/* --------------------------- the reported case -------------------------- */

test("the misheard spellings of 리포머 are put back", () => {
  assert.equal(correctPilatesTerms("오늘 리폼화로 풋워크 했어요").transcript, "오늘 리포머로 풋워크 했어요");
  assert.equal(correctPilatesTerms("디포먼트에서 헌드레드").transcript, "리포머에서 헌드레드");
  /* Reported from use in September 2026. It is four syllables away from the
     word it should be, so the fuzzy pass in term-mapper -- which only looks
     one edit out -- was never going to reach it. The dictionary is the only
     thing that catches a mishearing this far off. */
  assert.equal(correctPilatesTerms("래퍼무어로 풋워크 했어요").transcript, "리포머로 풋워크 했어요");
  assert.equal(correctPilatesTerms("래퍼무어를 했고 래퍼무어도 좋았어요").transcript, "리포머를 했고 리포머도 좋았어요",
    "every occurrence, with its particle");
});

test("what was corrected is reported alongside the text", () => {
  const { corrections } = correctPilatesTerms("리폼화로 시작해서 디포먼트로 마무리");
  assert.deepEqual(corrections.map((item) => item.heard).sort(), ["디포먼트", "리폼화"]);
  assert.ok(corrections.every((item) => item.canonical === "리포머"));
});

/* ------------------------ it changes words, not text -------------------- */

test("a word already spelled correctly is left alone", () => {
  const text = "리포머로 풋워크와 헌드레드를 했습니다";
  assert.equal(correctPilatesTerms(text).transcript, text);
  assert.deepEqual(correctPilatesTerms(text).corrections, []);
});

test("correcting twice changes nothing the second time", () => {
  const once = correctPilatesTerms("리폼화 풋워크").transcript;
  const twice = correctPilatesTerms(once);
  assert.equal(twice.transcript, once);
  assert.deepEqual(twice.corrections, [], "a corrected transcript has nothing left to correct");
});

test("a variant buried inside a longer Korean word is not touched", () => {
  /* Korean has no spaces between a word and its particles, so a substring
     match can land in the middle of a different word entirely. */
  const text = "코얼링이라는 말은 여기서 다른 뜻입니다";
  assert.equal(correctPilatesTerms(text).transcript, text);
});

test("a variant followed by a particle is corrected", () => {
  // 리폼화로, 리폼화를 -- the particle is not part of the word.
  assert.equal(correctPilatesTerms("리폼화를 썼어요").transcript, "리포머를 썼어요");
  assert.equal(correctPilatesTerms("리폼화, 캐딜라").transcript, "리포머, 캐딜락");
});

test("the longest variant wins", () => {
  // "스파인 트위스트" must not be half-corrected by a shorter entry.
  assert.equal(correctPilatesTerms("스파인 트위스트 했어요").transcript, "스파인트위스트 했어요");
});

test("the sentence around a correction is untouched", () => {
  const { transcript } = correctPilatesTerms("오늘은 리폼화로 했고 회원이 힘들어했습니다");
  assert.equal(transcript, "오늘은 리포머로 했고 회원이 힘들어했습니다");
});

test("empty and non-string input is returned as-is", () => {
  for (const value of ["", "   ", null, undefined]) {
    const result = correctPilatesTerms(value);
    assert.deepEqual(result.corrections, []);
    assert.equal(typeof result.transcript, "string");
  }
});

/* ----------------------------- the dictionary --------------------------- */

test("every requested term is registered", () => {
  const canonical = PILATES_TERM_DICTIONARY.map((entry) => entry.canonical);
  for (const term of [
    "리포머", "캐딜락", "체어", "바렐", "스프링보드", "타워",
    "풋워크", "헌드레드", "롤업", "티저", "숄더브릿지", "스완", "머메이드", "스파인트위스트", "레그서클", "사이드킥",
    "견갑", "흉추", "요추", "중둔근", "대둔근", "내전근", "복사근", "능형근", "승모근",
    "큐잉", "시퀀스", "얼라인먼트", "코어", "뉴트럴", "임프린트",
  ]) {
    assert.ok(canonical.includes(term), `${term} must be in the dictionary`);
  }
});

test("no variant is short enough to collide by accident", () => {
  /* A two-character fragment appears inside unrelated words; correcting on it
     would rewrite sentences the instructor did not mean. */
  for (const entry of PILATES_TERM_DICTIONARY) {
    for (const variant of entry.variants) {
      assert.ok(variant.length > 2, `"${variant}" (${entry.canonical}) is too short to match safely`);
    }
  }
});

test("no variant is also a canonical term", () => {
  const canonical = new Set(PILATES_TERM_DICTIONARY.map((entry) => entry.canonical));
  for (const entry of PILATES_TERM_DICTIONARY) {
    for (const variant of entry.variants) {
      assert.ok(!canonical.has(variant), `"${variant}" is a term in its own right`);
    }
  }
});

test("no variant is claimed by two terms", () => {
  const seen = new Map();
  for (const entry of PILATES_TERM_DICTIONARY) {
    for (const variant of entry.variants) {
      assert.ok(!seen.has(variant), `"${variant}" is claimed by both ${seen.get(variant)} and ${entry.canonical}`);
      seen.set(variant, entry.canonical);
    }
  }
});

/* --------------------------- collecting misses -------------------------- */

test("a correction is remembered for widening the dictionary later", () => {
  const storage = memoryStorage();
  applyPilatesTermDictionary("리폼화로 했어요", storage);
  const log = readPilatesTermCorrections(storage);
  assert.equal(log.length, 1);
  assert.equal(log[0].heard, "리폼화");
  assert.equal(log[0].canonical, "리포머");
  assert.ok(log[0].at, "when it happened");
});

test("only the words are kept, never the sentence", () => {
  /* The log is for improving the dictionary. What the instructor said about a
     member is not part of that. */
  const storage = memoryStorage();
  applyPilatesTermDictionary("리폼화 하는데 회원이 무릎 아프다고 했어요", storage);
  const serialized = JSON.stringify(readPilatesTermCorrections(storage));
  assert.ok(!serialized.includes("무릎"));
  assert.ok(!serialized.includes("회원"));
  assert.deepEqual(Object.keys(readPilatesTermCorrections(storage)[0]).sort(), ["at", "canonical", "heard"]);
});

test("nothing corrected means nothing written", () => {
  const storage = memoryStorage();
  applyPilatesTermDictionary("리포머로 했어요", storage);
  assert.deepEqual(readPilatesTermCorrections(storage), []);
});

test("the log is bounded and drops the oldest first", () => {
  const storage = memoryStorage();
  assert.equal(PILATES_TERM_CORRECTION_LIMIT, 200);
  for (let index = 0; index < 205; index += 1) {
    recordPilatesTermCorrections([{ heard: `h${index}`, canonical: "리포머" }], storage);
  }
  const log = readPilatesTermCorrections(storage);
  assert.equal(log.length, 200);
  assert.equal(log[0].heard, "h5", "the first five are gone");
  assert.equal(log.at(-1).heard, "h204");
});

test("a corrupt log does not break the correction", () => {
  const storage = memoryStorage();
  storage.setItem("pilateacher_stt_term_corrections_v1", "not json");
  assert.deepEqual(readPilatesTermCorrections(storage), []);
  assert.equal(applyPilatesTermDictionary("리폼화", storage), "리포머");
});

/* ------------------------------ the wiring ------------------------------ */

test("every structuring request is corrected first", () => {
  /* buildLessonRecordInput is the one funnel into the four-field step -- the
     retry queue uses it too -- so nothing reaches the model uncorrected. */
  const input = buildLessonRecordInput({ rawTranscript: "리폼화로 풋워크 했어요", memberId: "m1", lessonId: "l1" });
  assert.equal(input.rawTranscript, "리포머로 풋워크 했어요");
});

test("the transcript on screen is corrected the same way", async () => {
  const source = await appSource();
  /* Showing one thing and sending another would leave the instructor no way
     to see what the dictionary changed. */
  assert.match(source, /const transcript = applyPilatesTermDictionary\(quality\.transcript\);/);
});

test("the correction runs before the four-field step, not after", async () => {
  const builders = await readFile(new URL("../../src/ai/input-builders.js", import.meta.url), "utf8");
  assert.match(builders, /const corrected = applyPilatesTermDictionary\(rawTranscript\);/);
  assert.match(builders, /rawTranscript: text\(corrected, 12000\),/);
  // The structuring prompt still forbids the model doing its own correcting.
  const prompt = await readFile(new URL("../../functions/src/prompts.js", import.meta.url), "utf8");
  assert.match(prompt, /STT 오류로 보이는 단어를 정리 단계에서 임의 교정하지 마세요/);
});
