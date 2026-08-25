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
  assert.equal(prompt.promptVersion, "lesson_record_v3");
  assert.equal(
    prompt.instructions.split("\n")[0],
    "당신은 범용 운동·의료 추론 AI가 아닙니다. 강사가 수업 직후 말한 내용을 네 칸으로 최소 변환하는 기록 도구이며, 새 의미를 해석하지 않고 발화에 실제로 있는 내용만 옮깁니다.",
  );
  assert.match(prompt.instructions, /새로 만들어내지/);
  assert.match(prompt.instructions, /의료 진단/);
  assert.match(prompt.instructions, /전문용어로 격상 금지/);
  assert.match(prompt.instructions, /신체 부위 명칭과 좌·우는 강사가 말한 그대로/);
  assert.match(prompt.instructions, /모르는 운동명을 다른 운동으로 교정하지/);
  assert.match(prompt.instructions, /didToday와 summary에서 그 표현만 생략/);
  assert.match(prompt.instructions, /STT 오류로 보이는 단어를 정리 단계에서 임의 교정하지/);
  assert.match(prompt.instructions, /실제로 낮춘 수업 강도는 didToday/);
  assert.match(prompt.instructions, /강도 낮춰 진행/);
  assert.match(prompt.instructions, /정보가 없는 칸은 빈 배열/);
  assert.match(prompt.instructions, /단순한 표현은 단순하게/);
  assert.match(prompt.instructions, /⑤를 위해 ①~③을 희생하지/);
  assert.match(prompt.instructions, /사전은 전사 단계에서만 사용/);
  assert.match(prompt.instructions, /흉추 회전 시 전보다 부드러움/);
  assert.match(prompt.instructions, /responses=\[\]/);
  assert.match(prompt.instructions, /summary/);
  assert.equal((prompt.instructions.match(/summary='/g) || []).length, 8);
});
