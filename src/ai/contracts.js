export const AI_PROVIDERS = Object.freeze({
  OPENAI: "openai",
  GEMINI: "gemini",
  ANTHROPIC: "anthropic",
});

export const AI_OPERATIONS = Object.freeze({
  ANALYZE_BODY: "analyzeBody",
  SUMMARIZE_VOICE: "summarizeVoice",
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

const cleanText = (value, max = 4000) => String(value ?? "").trim().slice(0, max);
const cleanList = (value, maxItems = 20) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, maxItems);
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
  if (operation === AI_OPERATIONS.RECOMMEND_SEQUENCE) return normalizeSequenceRecommendation(value);
  if (operation === AI_OPERATIONS.GENERATE_REPORT) return normalizeReport(value);
  throw new TypeError(`unsupported AI operation: ${operation}`);
}

export const bodyAnalysisFields = Object.freeze({ text: BODY_TEXT_FIELDS, list: BODY_LIST_FIELDS });
export const voiceSummaryFields = Object.freeze({ list: VOICE_LIST_FIELDS });
