const STORAGE_KEY = "pilateacher_lesson_record_queue_v1";
const keyOf = (memberId, lessonId) => `${String(memberId || "unknown")}:${String(lessonId || "general")}`;

export const LESSON_RECORD_DRAFT_STATE = Object.freeze({
  RAW: "draft_raw",
  STRUCTURED: "draft_structured",
});

export const LESSON_RECORD_QUEUE_LABEL = Object.freeze({
  MISSING: "미기록",
  RAW: "정리 전(원문 있음)",
  STRUCTURED: "확인 대기(정리됨)",
});

const readAll = (storage) => {
  try { const value = JSON.parse(storage?.getItem(STORAGE_KEY) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch (_error) { return {}; }
};

export function savePendingLessonRecord(memberId, lessonId, draft, storage = globalThis.localStorage) {
  const all = readAll(storage);
  const key = keyOf(memberId, lessonId);
  const previous = all[key] || {};
  const now = new Date().toISOString();
  const structured = Boolean(draft?.structuredDraft);
  const state = structured ? LESSON_RECORD_DRAFT_STATE.STRUCTURED : LESSON_RECORD_DRAFT_STATE.RAW;
  all[key] = {
    ...previous,
    ...draft,
    memberId,
    lessonId,
    state,
    stage: structured ? "structured_draft" : "raw_transcript",
    status: structured ? "structured" : String(draft?.status || previous?.status || "raw"),
    createdAt: previous.createdAt || draft?.createdAt || now,
    updatedAt: now,
    pendingAt: previous.pendingAt || now,
  };
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_error) {}
  return all[key];
}

export function loadPendingLessonRecord(memberId, lessonId, storage = globalThis.localStorage) {
  return readAll(storage)[keyOf(memberId, lessonId)] || null;
}

export function removePendingLessonRecord(memberId, lessonId, storage = globalThis.localStorage) {
  const all = readAll(storage);
  delete all[keyOf(memberId, lessonId)];
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_error) {}
}

export function listPendingLessonRecords(storage = globalThis.localStorage) {
  return Object.values(readAll(storage));
}

export function patchPendingLessonRecord(memberId, lessonId, patch, storage = globalThis.localStorage) {
  const current = loadPendingLessonRecord(memberId, lessonId, storage);
  if (!current) return null;
  return savePendingLessonRecord(memberId, lessonId, { ...current, ...patch }, storage);
}

export function pendingLessonRecordLabel(draft) {
  if (!draft?.rawTranscript) return LESSON_RECORD_QUEUE_LABEL.MISSING;
  return draft?.structuredDraft || draft?.state === LESSON_RECORD_DRAFT_STATE.STRUCTURED
    ? LESSON_RECORD_QUEUE_LABEL.STRUCTURED
    : LESSON_RECORD_QUEUE_LABEL.RAW;
}

export function wakeDormantLessonRecordRetries(storage = globalThis.localStorage, now = Date.now()) {
  const all = readAll(storage);
  let changed = false;
  Object.entries(all).forEach(([key, draft]) => {
    if (draft?.retry?.state !== "sleeping" || !draft?.rawTranscript || draft?.structuredDraft) return;
    all[key] = { ...draft, retry: { ...draft.retry, state: "waiting", attempts: 0, nextRetryAt: now } };
    changed = true;
  });
  if (changed) {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_error) {}
  }
  return changed;
}

export const LESSON_RECORD_QUEUE_STORAGE_KEY = STORAGE_KEY;
