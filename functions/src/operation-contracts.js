"use strict";

const { GatewayError } = require("./errors");

const OPERATIONS = Object.freeze({
  ANALYZE_BODY: "analyzeBody",
  SUMMARIZE_VOICE: "summarizeVoice",
  STRUCTURE_LESSON_RECORD: "structureLessonRecord",
  RECOMMEND_SEQUENCE: "recommendSequence",
  GENERATE_REPORT: "generateReport",
});

// Responses Structured Outputs accepts a deliberately small JSON Schema
// subset. Length/count limits are enforced again by validateOperationOutput.
const stringField = () => ({ type: "string" });
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
    },
    required: ["didToday", "observations", "responses", "nextFocus", "uncertain"],
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

function validateLessonRecord(value) {
  const required = OUTPUT_SCHEMAS[OPERATIONS.STRUCTURE_LESSON_RECORD].required;
  const source = requireExactObject(value, required);
  return Object.fromEntries(required.map((field) => [field, cleanList(source[field])]));
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
  if (operation === OPERATIONS.RECOMMEND_SEQUENCE) return validateSequence(value);
  if (operation === OPERATIONS.GENERATE_REPORT) return validateReport(value);
  throw new GatewayError("invalid_request");
}

module.exports = {
  OPERATIONS,
  OUTPUT_NAMES,
  OUTPUT_SCHEMAS,
  validateOperationOutput,
};
