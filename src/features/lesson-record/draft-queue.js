const STORAGE_KEY = "pilateacher_lesson_record_queue_v1";
export const lessonRecordSessionKey = (memberId, lessonId) => `${String(memberId || "unknown")}:${String(lessonId || "general")}`;

export const LESSON_RECORD_DRAFT_STATE = Object.freeze({
  RAW: "draft_raw",
  STRUCTURED: "draft_structured",
});

export const LESSON_RECORD_QUEUE_LABEL = Object.freeze({
  MISSING: "미기록",
  CONSENT: "동의 필요",
  AUDIO: "음성 정리 대기",
  RAW: "정리 전(원문 있음)",
  STRUCTURED: "확인 대기(정리됨)",
});

const readAll = (storage) => {
  try { const value = JSON.parse(storage?.getItem(STORAGE_KEY) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch (_error) { return {}; }
};

export function savePendingLessonRecord(memberId, lessonId, draft, storage = globalThis.localStorage) {
  const all = readAll(storage);
  const key = lessonRecordSessionKey(memberId, lessonId);
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
  const draft = readAll(storage)[lessonRecordSessionKey(memberId, lessonId)] || null;
  if (!draft) return null;
  return String(draft.memberId || "") === String(memberId || "")
    && String(draft.lessonId || "") === String(lessonId || "") ? draft : null;
}

export function removePendingLessonRecord(memberId, lessonId, storage = globalThis.localStorage) {
  const all = readAll(storage);
  delete all[lessonRecordSessionKey(memberId, lessonId)];
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_error) {}
}

export function listPendingLessonRecords(storage = globalThis.localStorage) {
  return Object.values(readAll(storage));
}

const NON_RETRYABLE_FAILURE_CODES = new Set(["consent_required", "consent_missing", "member_session_unresolved", "link_review_required", "request_rejected", "invalid-argument", "invalid_request", "stt_no_speech", "no_speech"]);
const pendingBlobIdsOf = (draft) => [...new Set([
  draft?.audioBlobId,
  ...(draft?.audioClips || []).filter((clip) => clip?.state !== "uploaded").map((clip) => clip?.blobId),
].filter(Boolean))];

export function isQueuedLessonRecord(draft) {
  const retryState = String(draft?.retry?.state || "");
  const failureCode = String(draft?.failure?.code || "").toLowerCase();
  const retryableFailure = !NON_RETRYABLE_FAILURE_CODES.has(failureCode)
    && (!draft?.failure?.category || draft.failure.category === "TEMPORARY");
  const hasPendingAudio = pendingBlobIdsOf(draft).length > 0;
  return retryableFailure
    && ["waiting", "sleeping"].includes(retryState)
    && (Boolean(String(draft?.rawTranscript || "").trim()) || hasPendingAudio)
    && !draft?.structuredDraft;
}

export function listQueuedLessonRecords(storage = globalThis.localStorage) {
  return Object.values(readAll(storage)).filter(isQueuedLessonRecord);
}

export function clearQueuedLessonRecordAudio(targets, storage = globalThis.localStorage) {
  const all = readAll(storage);
  const blobIds = [];
  let cleared = 0;
  (targets || []).forEach((target) => {
    const key = lessonRecordSessionKey(target?.memberId, target?.lessonId);
    const draft = all[key];
    if (!draft) return;
    const removedBlobIds = [...new Set((target?.blobIds || []).filter(Boolean))];
    const pendingBefore = pendingBlobIdsOf(draft);
    const removable = removedBlobIds.filter((blobId) => pendingBefore.includes(blobId));
    blobIds.push(...removable);
    const remainingClips = (draft.audioClips || []).filter((clip) => !removable.includes(clip?.blobId));
    const remainingTopBlobId = removable.includes(draft.audioBlobId) ? null : (draft.audioBlobId || null);
    const remainingPending = [...new Set([
      remainingTopBlobId,
      ...remainingClips.filter((clip) => clip?.state !== "uploaded").map((clip) => clip?.blobId),
    ].filter(Boolean))];
    if (remainingPending.length) {
      all[key] = { ...draft, audioBlobId: remainingTopBlobId, audioClips: remainingClips, updatedAt: new Date().toISOString() };
      return;
    }
    cleared += 1;
    const rawTranscript = String(draft?.rawTranscript || "").trim();
    if (!rawTranscript && !draft?.structuredDraft && !remainingPending.length) {
      delete all[key];
      return;
    }
    all[key] = {
      ...draft,
      status: draft?.structuredDraft ? "structured" : "raw",
      audioBlobId: remainingTopBlobId,
      audioClips: remainingClips,
      retry: null,
      failure: null,
      updatedAt: new Date().toISOString(),
    };
  });
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_error) {}
  return { cleared, blobIds: [...new Set(blobIds)] };
}

export function clearQueuedLessonRecords(storage = globalThis.localStorage) {
  const queued = listQueuedLessonRecords(storage);
  return clearQueuedLessonRecordAudio(queued.map((draft) => ({
    memberId: draft.memberId,
    lessonId: draft.lessonId,
    blobIds: pendingBlobIdsOf(draft),
    clearRetry: true,
  })), storage);
}

export function removePendingLessonRecordsForMember(memberId, storage = globalThis.localStorage) {
  const target = String(memberId || "");
  const all = readAll(storage);
  const blobIds = [];
  let removed = 0;
  Object.entries(all).forEach(([key, draft]) => {
    if (String(draft?.memberId || "") !== target) return;
    blobIds.push(...pendingBlobIdsOf(draft));
    delete all[key];
    removed += 1;
  });
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_error) {}
  return { removed, blobIds: [...new Set(blobIds)] };
}

export function patchPendingLessonRecord(memberId, lessonId, patch, storage = globalThis.localStorage) {
  const current = loadPendingLessonRecord(memberId, lessonId, storage);
  if (!current) return null;
  return savePendingLessonRecord(memberId, lessonId, { ...current, ...patch }, storage);
}

export function pendingLessonRecordLabel(draft) {
  const failureCode = String(draft?.failure?.code || "").toLowerCase();
  if (["consent_required", "consent_missing"].includes(failureCode)) return LESSON_RECORD_QUEUE_LABEL.CONSENT;
  if (["stt_no_speech", "no_speech"].includes(failureCode)) return LESSON_RECORD_QUEUE_LABEL.MISSING;
  if (pendingBlobIdsOf(draft).length) return LESSON_RECORD_QUEUE_LABEL.AUDIO;
  if (!draft?.rawTranscript) return LESSON_RECORD_QUEUE_LABEL.MISSING;
  return draft?.structuredDraft || draft?.state === LESSON_RECORD_DRAFT_STATE.STRUCTURED
    ? LESSON_RECORD_QUEUE_LABEL.STRUCTURED
    : LESSON_RECORD_QUEUE_LABEL.RAW;
}

export function wakeDormantLessonRecordRetries(storage = globalThis.localStorage, now = Date.now()) {
  const all = readAll(storage);
  let changed = false;
  Object.entries(all).forEach(([key, draft]) => {
    const hasPendingAudio = pendingBlobIdsOf(draft).length > 0;
    if (!isQueuedLessonRecord(draft) || draft?.retry?.state !== "sleeping" || (!draft?.rawTranscript && !hasPendingAudio) || draft?.structuredDraft) return;
    all[key] = { ...draft, retry: { ...draft.retry, state: "waiting", attempts: 0, nextRetryAt: now } };
    changed = true;
  });
  if (changed) {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_error) {}
  }
  return changed;
}

export const LESSON_RECORD_QUEUE_STORAGE_KEY = STORAGE_KEY;
