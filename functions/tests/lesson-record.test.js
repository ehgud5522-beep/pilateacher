"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { OPERATIONS, OUTPUT_SCHEMAS, validateOperationOutput } = require("../src/operation-contracts");
const { parseOperationInput } = require("../src/request-contracts");
const { getPrompt } = require("../src/prompts");

const input = {
  schemaVersion: 1,
  memberId: "member-1",
  lessonId: "lesson-1",
  rawTranscript: "리포머 풋워크를 했고 편안하다고 말했다.",
  language: "ko-KR",
  termMap: {
    version: 1,
    mapped: [{ raw: "리포머", canonical: "리포머", category: "equipment", bodyKey: "equipment.reformer" }],
    uncertain: [{ raw: "캐딜락크", candidate: "캐딜락", category: "equipment", bodyKey: "equipment.cadillac" }],
  },
};

test("lesson record gateway input keeps raw and mapping stages separate", () => {
  const parsed = parseOperationInput(OPERATIONS.STRUCTURE_LESSON_RECORD, input);
  assert.equal(parsed.rawTranscript, input.rawTranscript);
  assert.equal(parsed.termMap.mapped[0].canonical, "리포머");
  assert.equal(parsed.termMap.uncertain[0].candidate, "캐딜락");
  assert.throws(() => parseOperationInput(OPERATIONS.STRUCTURE_LESSON_RECORD, { ...input, audioBlob: "forbidden" }));
});

test("lesson record output schema is exact and prompt forbids invention and diagnosis", () => {
  const valid = { didToday: ["풋워크"], observations: [], responses: ["편안하다고 말함"], nextFocus: [], uncertain: ["캐딜락크 확인"], summary: "풋워크를 진행했고 회원은 편안하다고 말했습니다." };
  assert.deepEqual(validateOperationOutput(OPERATIONS.STRUCTURE_LESSON_RECORD, valid), valid);
  assert.deepEqual(validateOperationOutput(OPERATIONS.STRUCTURE_LESSON_RECORD, { didToday: ["풋워크"] }), { didToday: ["풋워크"], observations: [], responses: [], nextFocus: [], uncertain: [], summary: null });
  assert.equal(validateOperationOutput(OPERATIONS.STRUCTURE_LESSON_RECORD, { ...valid, summary: null }).summary, null);
  assert.throws(() => validateOperationOutput(OPERATIONS.STRUCTURE_LESSON_RECORD, { ...valid, diagnosis: ["질환"] }));
  assert.deepEqual(OUTPUT_SCHEMAS[OPERATIONS.STRUCTURE_LESSON_RECORD].required, ["didToday", "observations", "responses", "nextFocus", "uncertain", "summary"]);
  assert.deepEqual(
    Object.keys(OUTPUT_SCHEMAS[OPERATIONS.STRUCTURE_LESSON_RECORD].properties).sort(),
    OUTPUT_SCHEMAS[OPERATIONS.STRUCTURE_LESSON_RECORD].required.slice().sort(),
  );
  assert.deepEqual(OUTPUT_SCHEMAS[OPERATIONS.STRUCTURE_LESSON_RECORD].properties.summary.type, ["string", "null"]);
  const prompt = getPrompt(OPERATIONS.STRUCTURE_LESSON_RECORD);
  assert.match(prompt.instructions, /새로 만들어내지/);
  assert.match(prompt.instructions, /의료 진단/);
  assert.match(prompt.instructions, /자동 교정하지 말고/);
  assert.match(prompt.instructions, /summary/);
  assert.equal((prompt.instructions.match(/summary='/g) || []).length, 6);
});
