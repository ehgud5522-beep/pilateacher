import { LESSON_RECORD_PROVENANCE_SOURCE } from "./failure-diagnostics.js";

export const LESSON_RECORD_FIELDS = Object.freeze(["didToday", "observations", "responses", "nextFocus", "uncertain"]);
export const LESSON_RECORD_SCHEMA_VERSION = 2;

const cleanText = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const isOrigin = (value) => value === "ai" || value === "instructor" || value === "raw";
const TRAILING_CONNECTIVE = /(?:고|며|서)\s*[.!?…]*$/u;
const LEGACY_SUMMARY_TEMPLATE = /회원의 변화는|오늘 수업에서는|진행했습니다\s*:|(?:습니다|입니다){2,}/u;

function normalizeItem(value, defaultOrigin = "ai") {
  const text = cleanText(typeof value === "string" ? value : value?.text);
  if (!text) return null;
  return { text, origin: isOrigin(value?.origin) ? value.origin : defaultOrigin };
}

function validationError(path, expected, received) {
  const error = new TypeError(`${path || "root"} must be ${expected}`);
  Object.assign(error, { code: "invalid_output", path: path || "root", expected, received });
  return error;
}

function summaryValidationError(received, partialOutput) {
  const error = validationError("summary", "complete Korean summary or null", received);
  Object.assign(error, { summaryOnly: true, partialOutput });
  return error;
}

export function isCompleteStructuredPhrase(value) {
  const text = cleanText(value);
  return Boolean(text) && !TRAILING_CONNECTIVE.test(text) && !/(?:습니다|입니다){2,}|진행했습니다\s*:/u.test(text);
}

export function validateStructuredOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw validationError("root", "object", Array.isArray(value) ? "array" : typeof value);
  const supportedFields = [...LESSON_RECORD_FIELDS, "summary", "summaryStatus"];
  const extra = Object.keys(value).find((field) => !supportedFields.includes(field));
  if (extra) throw validationError(extra, supportedFields.join("|"), "unsupported_field");
  const structuredFields = Object.fromEntries(LESSON_RECORD_FIELDS.map((field) => {
    const rawItems = value[field] == null ? [] : value[field];
    if (!Array.isArray(rawItems) || rawItems.length > 20) throw validationError(field, "array(max 20)", Array.isArray(rawItems) ? `array(${rawItems.length})` : typeof rawItems);
    const items = rawItems.map((item, index) => {
      const normalized = normalizeItem(item, "ai");
      if (!normalized && item != null && item !== "") throw validationError(`${field}[${index}]`, "string or {text:string}", Array.isArray(item) ? "array" : typeof item);
      if (normalized && !isCompleteStructuredPhrase(normalized.text)) throw validationError(`${field}[${index}]`, "complete Korean phrase", "trailing_connective_or_malformed_sentence");
      return normalized;
    }).filter(Boolean);
    return [field, items];
  }));
  const summaryValue = value.summary;
  if (summaryValue == null || summaryValue === "") return { ...structuredFields, summary: null, ...(value.summaryStatus === "dropped" ? { summaryStatus: "dropped" } : {}) };
  if (typeof summaryValue !== "string") throw summaryValidationError(typeof summaryValue, structuredFields);
  const summary = cleanText(summaryValue, 1200);
  const hasStructuredContent = LESSON_RECORD_FIELDS.some((field) => structuredFields[field].length);
  if (!hasStructuredContent || !isCompleteStructuredPhrase(summary) || LEGACY_SUMMARY_TEMPLATE.test(summary)) {
    throw summaryValidationError("trailing_connective_or_malformed_sentence", structuredFields);
  }
  return { ...structuredFields, summary };
}

export function editStructuredField(draft, field, value) {
  if (!LESSON_RECORD_FIELDS.includes(field)) return draft;
  const items = String(value || "").split(/\n+/).map((text) => normalizeItem({ text, origin: "instructor" }, "instructor")).filter(Boolean).slice(0, 20);
  return { ...draft, [field]: items };
}

export function structuredFieldText(draft, field) {
  return (draft?.[field] || []).map((item) => typeof item === "string" ? item : item?.text).filter(Boolean).join("\n");
}

export function structuredRecordBody(draft, rawTranscript = "") {
  const labels = { didToday: "오늘 수업", observations: "변화", responses: "회원 반응", nextFocus: "다음 확인", uncertain: "확인 필요" };
  const lines = LESSON_RECORD_FIELDS.flatMap((field) => {
    const values = (draft?.[field] || []).map((item) => cleanText(typeof item === "string" ? item : item?.text)).filter(Boolean);
    return values.length ? [`${labels[field]}: ${values.join(" · ")}`] : [];
  });
  return lines.join("\n") || cleanText(rawTranscript, 12000);
}

export function createLessonRecordMeta({ rawTranscript, termMap, structuredDraft = null, status = "pending", source = "unknown", recordedAt, audioBlobId = null, aiMeta = null, usage = null }) {
  const transcript = cleanText(rawTranscript, 12000);
  const normalizedDraft = structuredDraft ? validateStructuredOutput(structuredDraft) : null;
  const provenanceSource = normalizedDraft
    ? LESSON_RECORD_PROVENANCE_SOURCE.OPENAI
    : LESSON_RECORD_PROVENANCE_SOURCE.FALLBACK_RAW;
  return {
    schemaVersion: LESSON_RECORD_SCHEMA_VERSION,
    stage: status === "confirmed" ? "confirmed_record" : status === "structured" ? "structured_draft" : "raw_transcript",
    status,
    rawTranscript: transcript,
    termMap: termMap || { version: 1, rawTranscript: transcript, mapped: [], uncertain: [] },
    structuredDraft: normalizedDraft,
    provenanceSource,
    source,
    recordedAt: recordedAt || new Date().toISOString(),
    audioBlobId,
    aiMeta,
    usage,
  };
}
