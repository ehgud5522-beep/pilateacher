export const AI_PROVIDERS = Object.freeze({
  OPENAI: "openai",
  GEMINI: "gemini",
  ANTHROPIC: "anthropic",
});

export const AI_OPERATIONS = Object.freeze({
  ANALYZE_BODY: "analyzeBody",
  SUMMARIZE_VOICE: "summarizeVoice",
  STRUCTURE_LESSON_RECORD: "structureLessonRecord",
  LESSON_RECORD_FROM_AUDIO: "lesson_record_from_audio",
  RECOMMEND_SEQUENCE: "recommendSequence",
  GENERATE_REPORT: "generateReport",
});

export const AI_STATUSES = Object.freeze({
  NOT_CONNECTED: "not_connected",
  DRAFT: "draft",
  CONFIRMED: "confirmed",
  ERROR: "error",
});

export const BODY_VIEWS = Object.freeze(["front", "leftSide", "back", "rightSide"]);

const BODY_TEXT_FIELDS = Object.freeze(["pelvis", "thorax", "scapula", "head", "knees", "feet"]);
const BODY_LIST_FIELDS = Object.freeze(["bodyCharacteristics", "asymmetries", "recommendedExercises", "precautions"]);
const VOICE_LIST_FIELDS = Object.freeze(["todayExercises", "pain", "improvements", "nextGoals", "homework", "precautions"]);
const LESSON_RECORD_LIST_FIELDS = Object.freeze(["didToday", "observations", "responses", "nextFocus", "uncertain"]);

const cleanText = (value, max = 4000) => String(value ?? "").trim().slice(0, max);
const cleanList = (value, maxItems = 20) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, maxItems);
};
const cleanLessonList = (value, field, maxItems = 20) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    const error = new TypeError(`${field} must be an array`);
    Object.assign(error, { code: "invalid_output", path: field, expected: "string[]", received: typeof value });
    throw error;
  }
  return value.map((item, index) => {
    const raw = typeof item === "string" ? item : item?.text;
    if (typeof raw !== "string") {
      const error = new TypeError(`${field}[${index}] must be a string`);
      Object.assign(error, { code: "invalid_output", path: `${field}[${index}]`, expected: "string", received: Array.isArray(item) ? "array" : typeof item });
      throw error;
    }
    return cleanText(raw, 500);
  }).filter(Boolean).slice(0, maxItems);
};

const requireObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
};
const requireFields = (source, fields, label) => {
  const missing = fields.filter((field) => !Object.prototype.hasOwnProperty.call(source, field));
  if (missing.length) throw new TypeError(`${label} is missing fields: ${missing.join(", ")}`);
};

export function normalizeBodyAnalysis(value) {
  const source = requireObject(value, "body analysis output");
  requireFields(source, [...BODY_LIST_FIELDS, ...BODY_TEXT_FIELDS], "body analysis output");
  const output = {};
  BODY_LIST_FIELDS.forEach((field) => { output[field] = cleanList(source[field]); });
  BODY_TEXT_FIELDS.forEach((field) => { output[field] = cleanText(source[field]); });
  if (!BODY_LIST_FIELDS.some((field) => output[field].length) && !BODY_TEXT_FIELDS.some((field) => output[field])) {
    throw new TypeError("body analysis output is empty");
  }
  return output;
}

export function normalizeVoiceSummary(value) {
  const source = requireObject(value, "voice summary output");
  requireFields(source, ["memberCondition", ...VOICE_LIST_FIELDS], "voice summary output");
  const output = { memberCondition: cleanText(source.memberCondition) };
  VOICE_LIST_FIELDS.forEach((field) => { output[field] = cleanList(source[field]); });
  return output;
}

export function normalizeLessonRecord(value) {
  const source = requireObject(value, "lesson record output");
  const supported = [...LESSON_RECORD_LIST_FIELDS, "summary"];
  const extra = Object.keys(source).find((field) => !supported.includes(field));
  if (extra) {
    const error = new TypeError(`lesson record output has unsupported field: ${extra}`);
    Object.assign(error, { code: "invalid_output", path: extra, expected: supported.join("|"), received: extra });
    throw error;
  }
  return {
    ...Object.fromEntries(LESSON_RECORD_LIST_FIELDS.map((field) => [field, cleanLessonList(source[field], field)])),
    summary: source.summary == null ? null : cleanText(source.summary, 1200),
  };
}

export function normalizeAudioLessonRecord(value) {
  const source = requireObject(value, "audio lesson record output");
  const audioFields = ["transcript", "result", "fields", "summary", "speechSeconds", "confidence", "flags", "provenance"];
  requireFields(source, audioFields, "audio lesson record output");
  if (Object.keys(source).some((field) => !audioFields.includes(field))) throw new TypeError("audio lesson record output has unsupported fields");
  const result = String(source.result || "");
  if (!["ok", "no_speech", "low_confidence"].includes(result)) throw new TypeError("audio lesson record result is invalid");
  const speechSeconds = Number(source.speechSeconds);
  const confidence = Number(source.confidence);
  if (!Number.isFinite(speechSeconds) || speechSeconds < 0) throw new TypeError("audio lesson record speechSeconds is invalid");
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new TypeError("audio lesson record confidence is invalid");
  const flags = Array.isArray(source.flags) ? source.flags.map((flag) => cleanText(flag, 80)).filter(Boolean) : null;
  if (!flags) throw new TypeError("audio lesson record flags are invalid");
  const transcript = cleanText(source.transcript, 12000);
  if (result === "no_speech") {
    if (transcript || source.fields != null || source.summary != null || !flags.includes("no_speech") || source.provenance?.stt != null || source.provenance?.llm != null) {
      throw new TypeError("audio lesson record no_speech output is invalid");
    }
    return { transcript: "", result, fields: null, summary: null, speechSeconds, confidence, flags, provenance: { stt: null, llm: null } };
  }
  const provenance = requireObject(source.provenance, "audio lesson record provenance");
  if (provenance.stt !== "openai") throw new TypeError("audio lesson record stt provenance is invalid");
  if (result === "low_confidence") {
    const rejectedHallucination = flags.includes("hallucination_phrase") && !transcript;
    if (source.fields != null || source.summary != null || (!flags.includes("low_confidence") && !rejectedHallucination) || provenance.llm != null) {
      throw new TypeError("audio lesson record low_confidence output is invalid");
    }
    return { transcript, result, fields: null, summary: null, speechSeconds, confidence, flags, provenance: { stt: "openai", llm: null } };
  }
  if (!transcript) throw new TypeError("audio lesson record transcript is empty");
  const fields = requireObject(source.fields, "audio lesson record fields");
  requireFields(fields, ["didToday", "observations", "responses", "nextFocus"], "audio lesson record fields");
  if (provenance.llm !== "openai" || flags.some((flag) => !["tail_dropped", "hallucination_phrase_removed"].includes(flag))) throw new TypeError("audio lesson record ok provenance is invalid");
  return {
    transcript,
    result,
    fields: Object.fromEntries(["didToday", "observations", "responses", "nextFocus"].map((field) => [field, cleanLessonList(fields[field], `fields.${field}`)])),
    summary: source.summary == null ? null : cleanText(source.summary, 1200),
    speechSeconds,
    confidence,
    flags,
    provenance: { stt: "openai", llm: "openai" },
  };
}

export function normalizeSequenceRecommendation(value) {
  const source = requireObject(value, "sequence recommendation output");
  requireFields(source, ["title", "exercises", "rationale", "precautions"], "sequence recommendation output");
  const exercises = Array.isArray(source.exercises) ? source.exercises.map((exercise) => ({
    name: cleanText(exercise?.name, 160),
    purpose: cleanText(exercise?.purpose, 500),
    dosage: cleanText(exercise?.dosage, 160),
  })).filter((exercise) => exercise.name).slice(0, 30) : [];
  const output = {
    title: cleanText(source.title, 200),
    exercises,
    rationale: cleanList(source.rationale),
    precautions: cleanList(source.precautions),
  };
  if (!output.title && !output.exercises.length) throw new TypeError("sequence recommendation output is empty");
  return output;
}

export function normalizeReport(value) {
  const source = requireObject(value, "report output");
  requireFields(source, ["title", "summary", "highlights", "recommendations", "precautions"], "report output");
  const output = {
    title: cleanText(source.title, 200),
    summary: cleanText(source.summary),
    highlights: cleanList(source.highlights),
    recommendations: cleanList(source.recommendations),
    precautions: cleanList(source.precautions),
    disclosure: cleanText(source.disclosure, 500),
  };
  if (!output.title && !output.summary) throw new TypeError("report output is empty");
  return output;
}

export function normalizeAIOutput(operation, value) {
  if (operation === AI_OPERATIONS.ANALYZE_BODY) return normalizeBodyAnalysis(value);
  if (operation === AI_OPERATIONS.SUMMARIZE_VOICE) return normalizeVoiceSummary(value);
  if (operation === AI_OPERATIONS.STRUCTURE_LESSON_RECORD) return normalizeLessonRecord(value);
  if (operation === AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO) return normalizeAudioLessonRecord(value);
  if (operation === AI_OPERATIONS.RECOMMEND_SEQUENCE) return normalizeSequenceRecommendation(value);
  if (operation === AI_OPERATIONS.GENERATE_REPORT) return normalizeReport(value);
  throw new TypeError(`unsupported AI operation: ${operation}`);
}

export const bodyAnalysisFields = Object.freeze({ text: BODY_TEXT_FIELDS, list: BODY_LIST_FIELDS });
export const voiceSummaryFields = Object.freeze({ list: VOICE_LIST_FIELDS });
export const lessonRecordFields = Object.freeze({ list: LESSON_RECORD_LIST_FIELDS });
