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
    summary: "브릿지를 진행했습니다.",
    speechSeconds: 2.4,
    confidence: 0.91,
    flags: [],
    provenance: { stt: "openai", llm: "openai" },
  };
  assert.deepEqual(validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, value), value);
  assert.deepEqual(
    OUTPUT_SCHEMAS[OPERATIONS.LESSON_RECORD_FROM_AUDIO].required,
    ["transcript", "result", "fields", "summary", "speechSeconds", "confidence", "flags", "provenance"],
  );
  assert.throws(
    () => validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, { ...value, audio: "forbidden" }),
    (error) => error.code === "invalid_output",
  );
  const noSpeech = {
    transcript: "", result: "no_speech", fields: null, summary: null,
    speechSeconds: 0.4, confidence: 0.02, flags: ["no_speech"], provenance: { stt: null, llm: null },
  };
  assert.deepEqual(validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, noSpeech), noSpeech);
  const lowConfidence = {
    transcript: "리포머 캐딜락 체어 바렐", result: "low_confidence", fields: null, summary: null,
    speechSeconds: 5, confidence: 0.5, flags: ["low_confidence"], provenance: { stt: "openai", llm: null },
  };
  assert.deepEqual(validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, lowConfidence), lowConfidence);
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
