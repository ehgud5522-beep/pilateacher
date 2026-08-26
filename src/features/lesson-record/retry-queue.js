import { buildLessonRecordInput } from "../../ai/input-builders.js";
import { mapPilatesTerms } from "./term-mapper.js";
import { listPendingLessonRecords, patchPendingLessonRecord, savePendingLessonRecord } from "./draft-queue.js";
import { canAutoRetryLessonRecordFailure, describeLessonRecordFailure } from "./failure-diagnostics.js";
import { createStableAudioRequestId, structuredDraftFromAudioOutput, uploadAudioClip } from "../voice/server-audio-session.js";

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
    requestId: current?.requestId || createStableAudioRequestId(memberId, lessonId, "text"),
    status: "queued",
    failure: { code: descriptor.internalCode, category: descriptor.category, at: new Date(now).toISOString() },
    retry: { state: attempts >= 5 ? "sleeping" : "waiting", attempts, nextRetryAt: now + LESSON_RECORD_RETRY_DELAYS_MS[Math.min(attempts, 4)] },
  }, storage);
}

const appendTranscript = (current, incoming) => [String(current || "").trim(), String(incoming || "").trim()].filter(Boolean).join(" ").trim();

export async function runLessonRecordRetryCycle({ llmProvider, audioProvider = null, loadAudio = null, deleteAudio = null, storage = globalThis.localStorage, now = Date.now(), online = globalThis.navigator?.onLine !== false, aiStatus = "normal", onDiagnostic = () => {}, onVoiceEvent = () => {}, onPromoted = () => {} } = {}) {
  if (!online || aiStatus !== "normal" || !llmProvider) return { processed: 0, promoted: 0, failed: 0 };
  let processed = 0;
  let promoted = 0;
  let failed = 0;
  for (const draft of listPendingLessonRecords(storage)) {
    const pendingAudio = (draft?.audioClips || []).find((clip) => clip?.blobId && clip?.state !== "uploaded");
    if ((!draft?.rawTranscript && !pendingAudio) || (draft?.structuredDraft && !pendingAudio) || draft?.retry?.state !== "waiting" || Number(draft.retry.nextRetryAt) > now) continue;
    const key = `${draft.memberId}:${draft.lessonId}`;
    if (inFlight.has(key)) continue;
    inFlight.add(key);
    processed += 1;
    const attempts = Math.max(0, Number(draft.retry.attempts) || 0) + 1;
    try {
      if (pendingAudio) {
        if (!audioProvider || typeof loadAudio !== "function") throw Object.assign(new Error("audio retry dependencies unavailable"), { code: "provider_configuration", retryable: false });
        const blob = await loadAudio(pendingAudio.blobId);
        if (!blob) throw Object.assign(new Error("pending audio is missing"), { code: "audio_missing", retryable: false });
        const result = await uploadAudioClip({
          provider: audioProvider,
          blob,
          memberId: draft.memberId,
          lessonId: draft.lessonId,
          memberName: pendingAudio.memberName || "회원",
          requestId: pendingAudio.requestId,
          clipId: pendingAudio.clipId || pendingAudio.requestId,
          audioMetrics: pendingAudio.audioMetrics || null,
          onEvent: onVoiceEvent,
        });
        const resultKind = String(result?.output?.result || "ok");
        const outputFlags = Array.isArray(result?.output?.flags) ? result.output.flags : [];
        const reviewFlags = outputFlags.filter((flag) => flag === "no_speech" || flag === "low_confidence");
        const rawTranscript = resultKind === "no_speech" ? String(draft.rawTranscript || "").trim() : appendTranscript(draft.rawTranscript, result.output.transcript);
        const audioClips = (draft.audioClips || []).map((clip) => clip.requestId === pendingAudio.requestId ? { ...clip, state: "uploaded", uploadedAt: new Date(now).toISOString(), blobId: null } : clip);
        const hasMoreAudio = audioClips.some((clip) => clip?.blobId && clip?.state !== "uploaded");
        const structuredDraft = structuredDraftFromAudioOutput(result.output);
        savePendingLessonRecord(draft.memberId, draft.lessonId, {
          ...draft,
          status: hasMoreAudio ? "queued" : resultKind === "ok" ? "structured" : resultKind === "low_confidence" ? "review_required" : "raw",
          rawTranscript,
          termMap: mapPilatesTerms(rawTranscript),
          structuredDraft: hasMoreAudio || resultKind !== "ok" ? null : structuredDraft,
          aiMeta: { ...result, output: undefined },
          reviewFlags,
          reviewEdited: false,
          audioClips,
          retry: hasMoreAudio ? { state: "waiting", attempts: 0, nextRetryAt: now } : null,
          failure: null,
        }, storage);
        if (typeof deleteAudio === "function") await deleteAudio(pendingAudio.blobId);
        if (!hasMoreAudio && resultKind === "ok") {
          promoted += 1;
          onPromoted({ memberId: draft.memberId, lessonId: draft.lessonId });
        }
        onDiagnostic({ code: "success", stage: "background_audio_retry", category: "SUCCESS", model: result.model, requestId: result.requestId, gatewayUrl: result.gatewayUrl, httpStatus: 200 });
        continue;
      }
      const termMap = draft.termMap || mapPilatesTerms(draft.rawTranscript);
      const requestId = draft.requestId || createStableAudioRequestId(draft.memberId, draft.lessonId, "text");
      if (!draft.requestId) patchPendingLessonRecord(draft.memberId, draft.lessonId, { requestId }, storage);
      const result = await llmProvider.structureLessonRecord(buildLessonRecordInput({ rawTranscript: draft.rawTranscript, termMap, memberId: draft.memberId, lessonId: draft.lessonId }), { requestId });
      if (result.status === "structured") {
        savePendingLessonRecord(draft.memberId, draft.lessonId, { ...draft, status: "structured", structuredDraft: result.output, aiMeta: result.meta || null, retry: null, failure: null }, storage);
        promoted += 1;
        onDiagnostic({ code: "success", stage: "background_retry", category: "SUCCESS", model: result.meta?.model, requestId: result.meta?.requestId, gatewayUrl: result.meta?.gatewayUrl, httpStatus: 200 });
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
        onDiagnostic({ code: descriptor.internalCode, stage: "background_retry", category: descriptor.category, requestId: result.error?.requestId, transportCode: result.error?.transportCode, httpStatus: result.error?.status, gatewayUrl: result.error?.gatewayUrl, causeName: result.error?.causeName, causeMessage: result.error?.causeMessage });
      }
    } catch (error) {
      const descriptor = describeLessonRecordFailure({ code: error?.code, status: error?.status, failureStage: error?.failureStage });
      patchPendingLessonRecord(draft.memberId, draft.lessonId, {
        status: "queued",
        failure: { code: descriptor.internalCode, category: descriptor.category, at: new Date(now).toISOString() },
        retry: canAutoRetryLessonRecordFailure(error) && attempts < 5 ? { state: "waiting", attempts, nextRetryAt: now + LESSON_RECORD_RETRY_DELAYS_MS[Math.min(attempts, 4)] } : { state: "sleeping", attempts, nextRetryAt: null },
      }, storage);
      failed += 1;
      onDiagnostic({ code: descriptor.internalCode, stage: "background_retry", category: descriptor.category, requestId: error?.requestId, transportCode: error?.transportCode, httpStatus: error?.status, gatewayUrl: error?.gatewayUrl, causeName: error?.causeName, causeMessage: error?.causeMessage });
    } finally {
      inFlight.delete(key);
    }
  }
  return { processed, promoted, failed };
}
