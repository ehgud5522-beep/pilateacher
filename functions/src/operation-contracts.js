"use strict";

const { GatewayError } = require("./errors");

const OPERATIONS = Object.freeze({
  ANALYZE_BODY: "analyzeBody",
  SUMMARIZE_VOICE: "summarizeVoice",
  STRUCTURE_LESSON_RECORD: "structureLessonRecord",
  LESSON_RECORD_FROM_AUDIO: "lesson_record_from_audio",
  RECOMMEND_SEQUENCE: "recommendSequence",
  GENERATE_REPORT: "generateReport",
});

// Responses Structured Outputs accepts a deliberately small JSON Schema
// subset. Length/count limits are enforced again by validateOperationOutput.
const stringField = () => ({ type: "string" });
const nullableStringField = () => ({ type: ["string", "null"] });
const stringList = () => ({
  type: "array",
  items: stringField(),
});

const OUTPUT_SCHEMAS = Object.freeze({
  [OPERATIONS.ANALYZE_BODY]: {
    type: "object",
    additionalProperties: false,
    properties: {
      bodyCharacteristics: stringList(),
      asymmetries: stringList(),
      pelvis: stringField(),
      thorax: stringField(),
      scapula: stringField(),
      head: stringField(),
      knees: stringField(),
      feet: stringField(),
      recommendedExercises: stringList(),
      precautions: stringList(),
    },
    required: [
      "bodyCharacteristics", "asymmetries", "pelvis", "thorax", "scapula",
      "head", "knees", "feet", "recommendedExercises", "precautions",
    ],
  },
  [OPERATIONS.SUMMARIZE_VOICE]: {
    type: "object",
    additionalProperties: false,
    properties: {
      memberCondition: stringField(),
      todayExercises: stringList(),
      pain: stringList(),
      improvements: stringList(),
      nextGoals: stringList(),
      homework: stringList(),
      precautions: stringList(),
    },
    required: [
      "memberCondition", "todayExercises", "pain", "improvements",
      "nextGoals", "homework", "precautions",
    ],
  },
  [OPERATIONS.STRUCTURE_LESSON_RECORD]: {
    type: "object",
    additionalProperties: false,
    properties: {
      didToday: stringList(),
      observations: stringList(),
      responses: stringList(),
      nextFocus: stringList(),
      uncertain: stringList(),
      summary: nullableStringField(),
    },
    required: ["didToday", "observations", "responses", "nextFocus", "uncertain", "summary"],
  },
  [OPERATIONS.LESSON_RECORD_FROM_AUDIO]: {
    type: "object",
    additionalProperties: false,
    properties: {
      transcript: stringField(),
      result: { type: "string", enum: ["ok", "no_speech", "low_confidence"] },
      fields: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: {
          didToday: stringList(),
          observations: stringList(),
          responses: stringList(),
          nextFocus: stringList(),
        },
        required: ["didToday", "observations", "responses", "nextFocus"],
      },
      summary: nullableStringField(),
      speechSeconds: { type: "number" },
      confidence: { type: "number" },
      flags: {
        type: "array",
        items: { type: "string", enum: ["no_speech", "low_confidence"] },
      },
      provenance: {
        type: "object",
        additionalProperties: false,
        properties: {
          stt: { type: ["string", "null"], enum: ["openai", null] },
          llm: { type: ["string", "null"], enum: ["openai", null] },
        },
        required: ["stt", "llm"],
      },
    },
    required: ["transcript", "result", "fields", "summary", "speechSeconds", "confidence", "flags", "provenance"],
  },
  [OPERATIONS.RECOMMEND_SEQUENCE]: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: stringField(200),
      exercises: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: stringField(160),
            purpose: stringField(500),
            dosage: stringField(160),
          },
          required: ["name", "purpose", "dosage"],
        },
      },
      rationale: stringList(),
      precautions: stringList(),
    },
    required: ["title", "exercises", "rationale", "precautions"],
  },
  [OPERATIONS.GENERATE_REPORT]: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: stringField(200),
      summary: stringField(),
      highlights: stringList(),
      recommendations: stringList(),
      precautions: stringList(),
      disclosure: stringField(500),
    },
    required: ["title", "summary", "highlights", "recommendations", "precautions", "disclosure"],
  },
});

const OUTPUT_NAMES = Object.freeze({
  [OPERATIONS.ANALYZE_BODY]: "pilateacher_body_analysis",
  [OPERATIONS.SUMMARIZE_VOICE]: "pilateacher_voice_summary",
  [OPERATIONS.STRUCTURE_LESSON_RECORD]: "pilateacher_lesson_record",
  [OPERATIONS.LESSON_RECORD_FROM_AUDIO]: "pilateacher_lesson_record_from_audio",
  [OPERATIONS.RECOMMEND_SEQUENCE]: "pilateacher_sequence_recommendation",
  [OPERATIONS.GENERATE_REPORT]: "pilateacher_report",
});

function cleanString(value, maxLength) {
  if (typeof value !== "string" || value.length > maxLength) throw new GatewayError("invalid_output");
  return value.trim();
}

function cleanList(value, maxItems = 20, maxLength = 500) {
  if (!Array.isArray(value) || value.length > maxItems) throw new GatewayError("invalid_output");
  return value.map((item) => cleanString(item, maxLength)).filter(Boolean);
}

function requireExactObject(value, required) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GatewayError("invalid_output");
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new GatewayError("invalid_output");
  }
  return value;
}

function validateBody(value) {
  const required = OUTPUT_SCHEMAS[OPERATIONS.ANALYZE_BODY].required;
  const source = requireExactObject(value, required);
  const output = {};
  for (const field of ["bodyCharacteristics", "asymmetries", "recommendedExercises", "precautions"]) {
    output[field] = cleanList(source[field]);
  }
  for (const field of ["pelvis", "thorax", "scapula", "head", "knees", "feet"]) {
    output[field] = cleanString(source[field], 4000);
  }
  if (!Object.values(output).some((item) => Array.isArray(item) ? item.length : item)) throw new GatewayError("invalid_output");
  return output;
}

function validateVoice(value) {
  const required = OUTPUT_SCHEMAS[OPERATIONS.SUMMARIZE_VOICE].required;
  const source = requireExactObject(value, required);
  const output = { memberCondition: cleanString(source.memberCondition, 4000) };
  for (const field of ["todayExercises", "pain", "improvements", "nextGoals", "homework", "precautions"]) {
    output[field] = cleanList(source[field]);
  }
  return output;
}

function validateLessonRecordFields(value) {
  const listFields = ["didToday", "observations", "responses", "nextFocus", "uncertain"];
  const required = OUTPUT_SCHEMAS[OPERATIONS.STRUCTURE_LESSON_RECORD].required;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GatewayError("invalid_output");
  if (Object.keys(value).some((field) => !required.includes(field))) throw new GatewayError("invalid_output");
  let failedCoreFields = 0;
  const output = {};
  for (const field of listFields) {
    try {
      if (!Object.prototype.hasOwnProperty.call(value, field)) throw new GatewayError("invalid_output");
      output[field] = cleanList(value[field]);
    } catch (_error) {
      output[field] = [];
      if (field !== "uncertain") failedCoreFields += 1;
    }
  }
  if (failedCoreFields === 4) throw new GatewayError("invalid_output");
  try {
    output.summary = value.summary == null ? null : cleanString(value.summary, 1200);
  } catch (_error) {
    output.summary = null;
  }
  return output;
}

function validateLessonRecord(value) {
  return validateLessonRecordFields(value);
}

function validateAudioLessonRecord(value) {
  const source = requireExactObject(value, OUTPUT_SCHEMAS[OPERATIONS.LESSON_RECORD_FROM_AUDIO].required);
  const provenance = requireExactObject(source.provenance, ["stt", "llm"]);
  const transcript = cleanString(source.transcript, 12000);
  const result = ["ok", "no_speech", "low_confidence"].includes(source.result) ? source.result : null;
  const speechSeconds = Number(source.speechSeconds);
  const confidence = Number(source.confidence);
  if (!result || !Number.isFinite(speechSeconds) || speechSeconds < 0 || speechSeconds > 90 || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new GatewayError("invalid_output");
  const flags = cleanList(source.flags, 2, 40);
  if (flags.some((flag) => !["no_speech", "low_confidence", "tail_dropped"].includes(flag))) throw new GatewayError("invalid_output");
  if (result === "ok") {
    const fields = requireExactObject(source.fields, ["didToday", "observations", "responses", "nextFocus"]);
    if (!transcript || provenance.stt !== "openai" || provenance.llm !== "openai" || flags.some((flag) => flag !== "tail_dropped")) throw new GatewayError("invalid_output");
    return {
      transcript,
      result,
      fields: Object.fromEntries(Object.keys(fields).map((field) => [field, cleanList(fields[field])])),
      summary: source.summary == null ? null : cleanString(source.summary, 1200),
      speechSeconds,
      confidence,
      flags,
      provenance: { stt: "openai", llm: "openai" },
    };
  }
  if (source.fields !== null || source.summary !== null || !flags.includes(result) || provenance.llm !== null) throw new GatewayError("invalid_output");
  if (result === "no_speech" && (transcript || provenance.stt !== null)) throw new GatewayError("invalid_output");
  if (result === "low_confidence" && (!transcript || provenance.stt !== "openai")) throw new GatewayError("invalid_output");
  return {
    transcript,
    result,
    fields: null,
    summary: null,
    speechSeconds,
    confidence,
    flags,
    provenance: { stt: provenance.stt, llm: null },
  };
}

function validateSequence(value) {
  const required = OUTPUT_SCHEMAS[OPERATIONS.RECOMMEND_SEQUENCE].required;
  const source = requireExactObject(value, required);
  if (!Array.isArray(source.exercises) || source.exercises.length > 30) throw new GatewayError("invalid_output");
  const exercises = source.exercises.map((exercise) => {
    const item = requireExactObject(exercise, ["name", "purpose", "dosage"]);
    return {
      name: cleanString(item.name, 160),
      purpose: cleanString(item.purpose, 500),
      dosage: cleanString(item.dosage, 160),
    };
  }).filter((exercise) => exercise.name);
  const output = {
    title: cleanString(source.title, 200),
    exercises,
    rationale: cleanList(source.rationale),
    precautions: cleanList(source.precautions),
  };
  if (!output.title && !output.exercises.length) throw new GatewayError("invalid_output");
  return output;
}

function validateReport(value) {
  const required = OUTPUT_SCHEMAS[OPERATIONS.GENERATE_REPORT].required;
  const source = requireExactObject(value, required);
  const output = {
    title: cleanString(source.title, 200),
    summary: cleanString(source.summary, 4000),
    highlights: cleanList(source.highlights),
    recommendations: cleanList(source.recommendations),
    precautions: cleanList(source.precautions),
    disclosure: cleanString(source.disclosure, 500),
  };
  if (!output.title && !output.summary) throw new GatewayError("invalid_output");
  return output;
}

function validateOperationOutput(operation, value) {
  if (operation === OPERATIONS.ANALYZE_BODY) return validateBody(value);
  if (operation === OPERATIONS.SUMMARIZE_VOICE) return validateVoice(value);
  if (operation === OPERATIONS.STRUCTURE_LESSON_RECORD) return validateLessonRecord(value);
  if (operation === OPERATIONS.LESSON_RECORD_FROM_AUDIO) return validateAudioLessonRecord(value);
  if (operation === OPERATIONS.RECOMMEND_SEQUENCE) return validateSequence(value);
  if (operation === OPERATIONS.GENERATE_REPORT) return validateReport(value);
  throw new GatewayError("invalid_request");
}

module.exports = {
  OPERATIONS,
  OUTPUT_NAMES,
  OUTPUT_SCHEMAS,
  validateLessonRecordFields,
  validateOperationOutput,
};
