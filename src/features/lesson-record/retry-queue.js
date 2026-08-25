import { buildLessonRecordInput } from "../../ai/input-builders.js";
import { mapPilatesTerms } from "./term-mapper.js";
import { listPendingLessonRecords, patchPendingLessonRecord, savePendingLessonRecord } from "./draft-queue.js";
import { canAutoRetryLessonRecordFailure, describeLessonRecordFailure } from "./failure-diagnostics.js";

export const LESSON_RECORD_RETRY_DELAYS_MS = Object.freeze([30000, 120000, 600000, 600000, 600000]);
const inFlight = new Set();

export function scheduleLessonRecordRetry(memberId, lessonId, failure, storage = globalThis.localStorage, now = Date.now()) {
  const descriptor = describeLessonRecordFailure(failure);
  if (!canAutoRetryLessonRecordFailure(failure)) return patchPendingLessonRecord(memberId, lessonId, {
    failure: { code: descriptor.internalCode, category: descriptor.category, at: new Date(now).toISOString() },
    retry: null,
  }, storage);
  const current = listPendingLessonRecords(storage).find((item) => String(item.memberId) === String(memberId) && String(item.lessonId) === String(lessonId));
  const attempts = Math.max(0, Number(current?.retry?.attempts) || 0);
  return patchPendingLessonRecord(memberId, lessonId, {
    status: "queued",
    failure: { code: descriptor.internalCode, category: descriptor.category, at: new Date(now).toISOString() },
    retry: { state: attempts >= 5 ? "sleeping" : "waiting", attempts, nextRetryAt: now + LESSON_RECORD_RETRY_DELAYS_MS[Math.min(attempts, 4)] },
  }, storage);
}

export async function runLessonRecordRetryCycle({ llmProvider, storage = globalThis.localStorage, now = Date.now(), online = globalThis.navigator?.onLine !== false, aiStatus = "normal", onDiagnostic = () => {}, onPromoted = () => {} } = {}) {
  if (!online || aiStatus !== "normal" || !llmProvider) return { processed: 0, promoted: 0, failed: 0 };
  let processed = 0;
  let promoted = 0;
  let failed = 0;
  for (const draft of listPendingLessonRecords(storage)) {
    if (!draft?.rawTranscript || draft?.structuredDraft || draft?.retry?.state !== "waiting" || Number(draft.retry.nextRetryAt) > now) continue;
    const key = `${draft.memberId}:${draft.lessonId}`;
    if (inFlight.has(key)) continue;
    inFlight.add(key);
    processed += 1;
    const attempts = Math.max(0, Number(draft.retry.attempts) || 0) + 1;
    try {
      const termMap = draft.termMap || mapPilatesTerms(draft.rawTranscript);
      const result = await llmProvider.structureLessonRecord(buildLessonRecordInput({ rawTranscript: draft.rawTranscript, termMap, memberId: draft.memberId, lessonId: draft.lessonId }));
      if (result.status === "structured") {
        savePendingLessonRecord(draft.memberId, draft.lessonId, { ...draft, status: "structured", structuredDraft: result.output, aiMeta: result.meta || null, retry: null, failure: null }, storage);
        promoted += 1;
        onDiagnostic({ code: "success", stage: "background_retry", category: "SUCCESS", model: result.meta?.model, requestId: result.meta?.requestId });
        onPromoted({ memberId: draft.memberId, lessonId: draft.lessonId });
      } else {
        const failure = { code: result.reason || result.error?.code, status: result.error?.status, failureStage: result.failureStage };
        const descriptor = describeLessonRecordFailure(failure);
        const retryable = canAutoRetryLessonRecordFailure(failure) && attempts < 5;
        patchPendingLessonRecord(draft.memberId, draft.lessonId, {
          status: "queued",
          failure: { code: descriptor.internalCode, category: descriptor.category, at: new Date(now).toISOString() },
          retry: retryable ? { state: "waiting", attempts, nextRetryAt: now + LESSON_RECORD_RETRY_DELAYS_MS[Math.min(attempts, 4)] } : { state: "sleeping", attempts, nextRetryAt: null },
        }, storage);
        failed += 1;
        onDiagnostic({ code: descriptor.internalCode, stage: "background_retry", category: descriptor.category });
      }
    } catch (error) {
      const descriptor = describeLessonRecordFailure({ code: error?.code, status: error?.status, failureStage: error?.failureStage });
      patchPendingLessonRecord(draft.memberId, draft.lessonId, {
        status: "queued",
        failure: { code: descriptor.internalCode, category: descriptor.category, at: new Date(now).toISOString() },
        retry: canAutoRetryLessonRecordFailure(error) && attempts < 5 ? { state: "waiting", attempts, nextRetryAt: now + LESSON_RECORD_RETRY_DELAYS_MS[Math.min(attempts, 4)] } : { state: "sleeping", attempts, nextRetryAt: null },
      }, storage);
      failed += 1;
      onDiagnostic({ code: descriptor.internalCode, stage: "background_retry", category: descriptor.category });
    } finally {
      inFlight.delete(key);
    }
  }
  return { processed, promoted, failed };
}
