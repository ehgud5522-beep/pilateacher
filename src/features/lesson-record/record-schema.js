import { LESSON_RECORD_PROVENANCE_SOURCE } from "./failure-diagnostics.js";

export const LESSON_RECORD_FIELDS = Object.freeze(["didToday", "observations", "responses", "nextFocus", "uncertain"]);
/* 제안이 겨냥할 수 있는 칸. uncertain 은 강사가 확인할 것을 모아 두는 칸이라
   제안 대상이 아니다. */
export const LESSON_RECORD_SUGGESTION_FIELDS = Object.freeze(["didToday", "observations", "responses", "nextFocus"]);
export const LESSON_RECORD_SUGGESTION_LIMIT = 2;
/* content: 발화에서 이어지는 생각. term: 기구·동작 이름으로 들렸으나 확신할 수
   없어 강사에게 확인받는 것. 강사가 읽는 문장이 달라야 하므로 구분해 둔다. */
export const LESSON_RECORD_SUGGESTION_KINDS = Object.freeze(["content", "term"]);
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
  const supportedFields = [...LESSON_RECORD_FIELDS, "suggestions", "summary", "summaryStatus"];
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
  /* 추론은 네 칸에 섞이지 않고 여기 담긴다. 강사가 눌러야 칸으로 들어가므로,
     저장된 제안은 기록이 아니다 -- 채택하지 않은 제안은 어디에도 반영되지 않는다.

     제안이 깨져 있어도 기록 전체를 버리지 않는다. 강사가 말한 네 칸이 본체이고
     제안은 부가물이라, 읽을 수 없으면 제안만 비운다. */
  const suggestions = normalizeSuggestions(value.suggestions);
  const summaryValue = value.summary;
  if (summaryValue == null || summaryValue === "") return { ...structuredFields, suggestions, summary: null, ...(value.summaryStatus === "dropped" ? { summaryStatus: "dropped" } : {}) };
  if (typeof summaryValue !== "string") throw summaryValidationError(typeof summaryValue, structuredFields);
  const summary = cleanText(summaryValue, 1200);
  const hasStructuredContent = LESSON_RECORD_FIELDS.some((field) => structuredFields[field].length);
  if (!hasStructuredContent || !isCompleteStructuredPhrase(summary) || LEGACY_SUMMARY_TEMPLATE.test(summary)) {
    throw summaryValidationError("trailing_connective_or_malformed_sentence", structuredFields);
  }
  return { ...structuredFields, suggestions, summary };
}

function normalizeSuggestions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      field: cleanText(item.field, 40),
      text: cleanText(item.text, 200),
      // 종류가 없으면 내용 제안으로 본다. 용어 확인은 명시되어야 한다.
      kind: LESSON_RECORD_SUGGESTION_KINDS.includes(item.kind) ? item.kind : "content",
    }))
    .filter((item) => LESSON_RECORD_SUGGESTION_FIELDS.includes(item.field) && item.text)
    .slice(0, LESSON_RECORD_SUGGESTION_LIMIT);
}

/* 제안을 눌렀을 때. 해당 칸 끝에 한 줄로 붙이고, 그 제안은 목록에서 뺀다.

   강사가 눌러 넣은 것이므로 출처는 instructor 다 -- AI 가 채운 것과 구분되어야
   나중에 무엇을 누가 넣었는지 남는다. */
export function applyLessonRecordSuggestion(draft, index) {
  const list = Array.isArray(draft?.suggestions) ? draft.suggestions : [];
  // Number(null) 은 0 이다. 자리를 가리키지 않은 호출이 첫 제안을 채택해 버리면,
  // 강사가 누르지 않은 문장이 기록에 들어간다.
  if (!Number.isInteger(index) || index < 0) return draft;
  const picked = list[index];
  if (!picked || !LESSON_RECORD_SUGGESTION_FIELDS.includes(picked.field)) return draft;
  const existing = (draft?.[picked.field] || []).map((item) => (typeof item === "string" ? item : item?.text)).filter(Boolean);
  const next = existing.includes(picked.text) ? existing : [...existing, picked.text];
  return {
    ...draft,
    [picked.field]: next.map((text) => normalizeItem({ text, origin: "instructor" }, "instructor")).filter(Boolean).slice(0, 20),
    suggestions: list.filter((_, position) => position !== index),
  };
}

export function editStructuredField(draft, field, value) {
  if (!LESSON_RECORD_FIELDS.includes(field)) return draft;
  const items = String(value || "").split(/\n+/).map((text) => normalizeItem({ text, origin: "instructor" }, "instructor")).filter(Boolean).slice(0, 20);
  return { ...draft, [field]: items };
}

export function structuredFieldText(draft, field) {
  return (draft?.[field] || []).map((item) => typeof item === "string" ? item : item?.text).filter(Boolean).join("\n");
}

/* 칸 이름. 화면과 본문이 같은 것을 보게 한다 -- 문구는 그대로 둔다. */
export const LESSON_RECORD_FIELD_LABELS = Object.freeze({ didToday: "오늘 수업", observations: "변화", responses: "회원 반응", nextFocus: "다음 확인", uncertain: "확인 필요" });

export function structuredRecordBody(draft, rawTranscript = "") {
  const labels = LESSON_RECORD_FIELD_LABELS;
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
