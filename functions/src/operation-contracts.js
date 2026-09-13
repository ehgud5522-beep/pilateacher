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
/* 추론은 네 칸에 섞이지 않고 이 자리로 온다. 강사가 눌러야 칸에 들어가므로,
   어느 칸을 겨냥한 제안인지 함께 온다. */
const suggestionList = () => ({
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      field: { type: "string", enum: ["didToday", "observations", "responses", "nextFocus"] },
      text: stringField(),
      kind: { type: "string", enum: ["content", "term"] },
      // 대신할 기존 줄. 해당 없으면 빈 문자열 -- 구조화 출력은 모든 속성을
      // required 로 요구하므로 생략이 아니라 빈 값으로 받는다.
      replaces: stringField(),
    },
    required: ["field", "text", "kind", "replaces"],
  },
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
      suggestions: suggestionList(),
      summary: nullableStringField(),
    },
    required: ["didToday", "observations", "responses", "nextFocus", "uncertain", "suggestions", "summary"],
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
      suggestions: suggestionList(),
      summary: nullableStringField(),
      speechSeconds: { type: "number" },
      confidence: { type: "number" },
      flags: {
        type: "array",
        items: { type: "string", enum: ["no_speech", "low_confidence", "tail_dropped", "hallucination_phrase", "hallucination_phrase_removed"] },
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
    required: ["transcript", "result", "fields", "suggestions", "summary", "speechSeconds", "confidence", "flags", "provenance"],
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

// 제안이 겨냥할 수 있는 칸. uncertain 은 강사 확인용이라 제안 대상이 아니다.
const LESSON_RECORD_SUGGESTION_FIELDS = ["didToday", "observations", "responses", "nextFocus"];
const LESSON_RECORD_SUGGESTION_KINDS = ["content", "term"];

/* 제안 목록을 읽는 한 곳. 텍스트 경로와 음성 경로가 같은 규칙을 봐야 한쪽만
   느슨해지지 않는다. */
function cleanSuggestions(value) {
  const raw = Array.isArray(value) ? value.slice(0, 2) : [];
  return raw
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      field: cleanString(item.field, 40),
      text: cleanString(item.text, 200),
      // 종류가 없으면 내용 제안으로 본다. 용어 확인은 명시해야 한다.
      kind: LESSON_RECORD_SUGGESTION_KINDS.includes(item.kind) ? item.kind : "content",
      replaces: typeof item.replaces === "string" ? cleanString(item.replaces, 200) : "",
    }))
    .filter((item) => LESSON_RECORD_SUGGESTION_FIELDS.includes(item.field) && item.text);
}

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
  /* 제안이 잘못 와도 기록 전체를 버리지 않는다. 제안은 부가물이고, 강사가 말한
     네 칸이 본체다. 읽을 수 없으면 제안만 비운다. */
  output.suggestions = [];
  try {
    output.suggestions = cleanSuggestions(value.suggestions);
  } catch (_error) {
    output.suggestions = [];
  }
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
  /* 제안이 없다고 기록을 통째로 버리지 않는다. 강사가 말한 네 칸이 본체이고 제안은
     부가물이라, 빠져 있으면 빈 목록으로 두고 나머지는 그대로 받는다. */
  const withSuggestions = value && typeof value === "object" && !Array.isArray(value)
    && !Object.prototype.hasOwnProperty.call(value, "suggestions")
    ? { ...value, suggestions: [] }
    : value;
  const source = requireExactObject(withSuggestions, OUTPUT_SCHEMAS[OPERATIONS.LESSON_RECORD_FROM_AUDIO].required);
  const provenance = requireExactObject(source.provenance, ["stt", "llm"]);
  const transcript = cleanString(source.transcript, 12000);
  const result = ["ok", "no_speech", "low_confidence"].includes(source.result) ? source.result : null;
  const speechSeconds = Number(source.speechSeconds);
  const confidence = Number(source.confidence);
  if (!result || !Number.isFinite(speechSeconds) || speechSeconds < 0 || speechSeconds > 90 || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new GatewayError("invalid_output");
  const flags = cleanList(source.flags, 2, 40);
  if (flags.some((flag) => !["no_speech", "low_confidence", "tail_dropped", "hallucination_phrase", "hallucination_phrase_removed"].includes(flag))) throw new GatewayError("invalid_output");
  if (result === "ok") {
    const fields = requireExactObject(source.fields, ["didToday", "observations", "responses", "nextFocus"]);
    if (!transcript || provenance.stt !== "openai" || provenance.llm !== "openai" || flags.some((flag) => !["tail_dropped", "hallucination_phrase_removed"].includes(flag))) throw new GatewayError("invalid_output");
    return {
      transcript,
      result,
      fields: Object.fromEntries(Object.keys(fields).map((field) => [field, cleanList(fields[field])])),
      suggestions: (() => { try { return cleanSuggestions(source.suggestions); } catch (_error) { return []; } })(),
      summary: source.summary == null ? null : cleanString(source.summary, 1200),
      speechSeconds,
      confidence,
      flags,
      provenance: { stt: "openai", llm: "openai" },
    };
  }
  const rejectionFlag = flags.includes(result) || (result === "low_confidence" && flags.includes("hallucination_phrase"));
  // 거부된 응답에는 제안도 없다. 정리되지 않은 것에 붙일 제안이 없기 때문이다.
  if (source.fields !== null || source.summary !== null || !rejectionFlag || provenance.llm !== null) throw new GatewayError("invalid_output");
  if (result === "no_speech" && (transcript || provenance.stt !== null)) throw new GatewayError("invalid_output");
  if (result === "low_confidence" && ((!transcript && !flags.includes("hallucination_phrase")) || provenance.stt !== "openai")) throw new GatewayError("invalid_output");
  return {
    transcript,
    result,
    fields: null,
    suggestions: [],
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
