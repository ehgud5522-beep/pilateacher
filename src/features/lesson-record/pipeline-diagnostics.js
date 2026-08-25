const STORAGE_KEY = "pilateacher_lesson_record_diagnostics_v1";
const MAX_EVENTS = 20;

const safeToken = (value, max = 80) => String(value || "unknown")
  .replace(/[^A-Za-z0-9._:/-]/g, "_")
  .slice(0, max);
const safeText = (value, max = 500) => String(value || "")
  .replace(/[\r\n\t]+/g, " ")
  .replace(/Bearer\s+\S+/gi, "Bearer_[redacted]")
  .replace(/sk-[A-Za-z0-9_-]+/g, "sk_[redacted]")
  .slice(0, max);

export function readLessonRecordDiagnostics(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_EVENTS) : [];
  } catch (_error) {
    return [];
  }
}

export function appendLessonRecordDiagnostic(event, storage = globalThis.localStorage) {
  const next = [{
    code: safeToken(event?.code),
    stage: safeToken(event?.stage),
    category: safeToken(event?.category),
    model: event?.model ? safeToken(event.model, 120) : "",
    requestId: event?.requestId ? safeToken(event.requestId, 160) : "",
    transportCode: event?.transportCode ? safeToken(event.transportCode, 40) : "",
    httpStatus: Number(event?.httpStatus) || 0,
    gatewayUrl: event?.gatewayUrl ? safeText(event.gatewayUrl) : "",
    causeName: event?.causeName ? safeToken(event.causeName, 80) : "",
    causeMessage: event?.causeMessage ? safeText(event.causeMessage, 180) : "",
    at: String(event?.at || new Date().toISOString()),
  }, ...readLessonRecordDiagnostics(storage)].slice(0, MAX_EVENTS);
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_error) {}
  return next[0];
}

export const LESSON_RECORD_DIAGNOSTICS_STORAGE_KEY = STORAGE_KEY;
