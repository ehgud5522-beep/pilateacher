export const LESSON_RECORD_FIELDS = Object.freeze(["didToday", "observations", "responses", "nextFocus", "uncertain"]);
export const LESSON_RECORD_SCHEMA_VERSION = 2;

const cleanText = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const isOrigin = (value) => value === "ai" || value === "instructor" || value === "raw";

function normalizeItem(value, defaultOrigin = "ai") {
  const text = cleanText(typeof value === "string" ? value : value?.text);
  if (!text) return null;
  return { text, origin: isOrigin(value?.origin) ? value.origin : defaultOrigin };
}

export function validateStructuredOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("structured lesson record must be an object");
  const keys = Object.keys(value).sort();
  const expected = [...LESSON_RECORD_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new TypeError("structured lesson record fields are invalid");
  return Object.fromEntries(LESSON_RECORD_FIELDS.map((field) => {
    if (!Array.isArray(value[field]) || value[field].length > 20) throw new TypeError(`${field} must be an array`);
    const items = value[field].map((item) => normalizeItem(item, "ai")).filter(Boolean);
    return [field, items];
  }));
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
  const labels = { didToday: "오늘 한 내용", observations: "관찰", responses: "회원 반응", nextFocus: "다음 초점", uncertain: "확인 필요" };
  const lines = LESSON_RECORD_FIELDS.flatMap((field) => {
    const values = (draft?.[field] || []).map((item) => cleanText(typeof item === "string" ? item : item?.text)).filter(Boolean);
    return values.length ? [`${labels[field]}: ${values.join(" · ")}`] : [];
  });
  return lines.join("\n") || cleanText(rawTranscript, 12000);
}

export function createLessonRecordMeta({ rawTranscript, termMap, structuredDraft = null, status = "pending", source = "unknown", recordedAt, audioBlobId = null, aiMeta = null, usage = null }) {
  const transcript = cleanText(rawTranscript, 12000);
  return {
    schemaVersion: LESSON_RECORD_SCHEMA_VERSION,
    stage: status === "confirmed" ? "confirmed_record" : status === "structured" ? "structured_draft" : "raw_transcript",
    status,
    rawTranscript: transcript,
    termMap: termMap || { version: 1, rawTranscript: transcript, mapped: [], uncertain: [] },
    structuredDraft: structuredDraft ? validateStructuredOutput(structuredDraft) : null,
    source,
    recordedAt: recordedAt || new Date().toISOString(),
    audioBlobId,
    aiMeta,
    usage,
  };
}
