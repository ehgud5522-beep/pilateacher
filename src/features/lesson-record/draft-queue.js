const STORAGE_KEY = "pilateacher_lesson_record_queue_v1";
const keyOf = (memberId, lessonId) => `${String(memberId || "unknown")}:${String(lessonId || "general")}`;

const readAll = (storage) => {
  try { const value = JSON.parse(storage?.getItem(STORAGE_KEY) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch (_error) { return {}; }
};

export function savePendingLessonRecord(memberId, lessonId, draft, storage = globalThis.localStorage) {
  const all = readAll(storage);
  all[keyOf(memberId, lessonId)] = { ...draft, memberId, lessonId, pendingAt: new Date().toISOString() };
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_error) {}
  return all[keyOf(memberId, lessonId)];
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

export const LESSON_RECORD_QUEUE_STORAGE_KEY = STORAGE_KEY;
