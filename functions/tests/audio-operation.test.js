"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OPERATIONS,
  OUTPUT_SCHEMAS,
  validateLessonRecordFields,
  validateOperationOutput,
} = require("../src/operation-contracts");

test("audio operation exposes the exact transcript, four fields, summary, and provenance contract", () => {
  const value = {
    transcript: "브릿지를 진행했습니다.",
    result: "ok",
    fields: { didToday: ["브릿지"], observations: [], responses: [], nextFocus: [] },
    // 제안이 없는 응답도 그대로 통과한다 -- 제안은 기록의 조건이 아니다.
    suggestions: [],
    summary: "브릿지를 진행했습니다.",
    speechSeconds: 2.4,
    confidence: 0.91,
    flags: [],
    provenance: { stt: "openai", llm: "openai" },
  };
  assert.deepEqual(validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, value), value);
  const tailDropped = { ...value, flags: ["tail_dropped"] };
  assert.deepEqual(validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, tailDropped), tailDropped);
  const filtered = { ...value, transcript: "브릿지를 진행했습니다.", flags: ["hallucination_phrase_removed"] };
  assert.deepEqual(validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, filtered), filtered);
  assert.deepEqual(
    OUTPUT_SCHEMAS[OPERATIONS.LESSON_RECORD_FROM_AUDIO].required,
    ["transcript", "result", "fields", "suggestions", "summary", "speechSeconds", "confidence", "flags", "provenance"],
  );
  assert.throws(
    () => validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, { ...value, audio: "forbidden" }),
    (error) => error.code === "invalid_output",
  );
  const noSpeech = {
    transcript: "", result: "no_speech", fields: null, suggestions: [], summary: null,
    speechSeconds: 0.4, confidence: 0.02, flags: ["no_speech"], provenance: { stt: null, llm: null },
  };
  assert.deepEqual(validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, noSpeech), noSpeech);
  const lowConfidence = {
    transcript: "리포머 캐딜락 체어 바렐", result: "low_confidence", fields: null, suggestions: [], summary: null,
    speechSeconds: 5, confidence: 0.5, flags: ["low_confidence"], provenance: { stt: "openai", llm: null },
  };
  assert.deepEqual(validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, lowConfidence), lowConfidence);
  const hallucination = {
    ...lowConfidence, transcript: "", flags: ["hallucination_phrase"],
  };
  assert.deepEqual(validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, hallucination), hallucination);
});

test("lesson field validation clears only invalid fields and rejects four invalid fields", () => {
  const partial = validateLessonRecordFields({
    didToday: ["브릿지"],
    observations: "invalid",
    responses: ["힘들다고 말함"],
    nextFocus: [],
    uncertain: null,
    summary: 42,
  });
  assert.deepEqual(partial, {
    didToday: ["브릿지"],
    observations: [],
    responses: ["힘들다고 말함"],
    nextFocus: [],
    uncertain: [],
    // 제안은 부가물이라, 읽히지 않으면 기록을 버리지 않고 제안만 빈다.
    suggestions: [],
    summary: null,
  });
  assert.throws(() => validateLessonRecordFields({
    didToday: null,
    observations: null,
    responses: null,
    nextFocus: null,
    uncertain: [],
    summary: null,
  }), (error) => error.code === "invalid_output");
});
