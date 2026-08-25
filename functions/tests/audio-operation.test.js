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
    fields: { didToday: ["브릿지"], observations: [], responses: [], nextFocus: [] },
    summary: "브릿지를 진행했습니다.",
    provenance: { stt: "openai", llm: "openai" },
  };
  assert.deepEqual(validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, value), value);
  assert.deepEqual(
    OUTPUT_SCHEMAS[OPERATIONS.LESSON_RECORD_FROM_AUDIO].required,
    ["transcript", "fields", "summary", "provenance"],
  );
  assert.throws(
    () => validateOperationOutput(OPERATIONS.LESSON_RECORD_FROM_AUDIO, { ...value, audio: "forbidden" }),
    (error) => error.code === "invalid_output",
  );
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
