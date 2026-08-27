import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AI_STATUSES } from "../../src/ai/contracts.js";
import { GatewayLlmProvider } from "../../src/features/lesson-record/llm-provider.js";
import { clearQueuedLessonRecordAudio, clearQueuedLessonRecords, LESSON_RECORD_DRAFT_STATE, listPendingLessonRecords, listQueuedLessonRecords, loadPendingLessonRecord, pendingLessonRecordLabel, removePendingLessonRecord, savePendingLessonRecord } from "../../src/features/lesson-record/draft-queue.js";
import { runLessonRecordRetryCycle, scheduleLessonRecordRetry } from "../../src/features/lesson-record/retry-queue.js";
import { readAIRecordingStatus, writeAIRecordingStatus } from "../../src/features/lesson-record/ai-recording-status.js";
import { appendLessonRecordDiagnostic, readLessonRecordDiagnostics } from "../../src/features/lesson-record/pipeline-diagnostics.js";
import { createLessonRecordMeta, editStructuredField, structuredRecordBody, validateStructuredOutput } from "../../src/features/lesson-record/record-schema.js";
import { mapPilatesTerms, PILATES_TERMS } from "../../src/features/lesson-record/term-mapper.js";
import { readLessonRecordUsage, trackLessonRecordUsage } from "../../src/features/lesson-record/usage-telemetry.js";

const memoryStorage = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key), dump: () => [...data.values()].join("\n") };
};

const structured = { didToday: ["리포머 풋워크"], observations: ["흉추 가동성 관찰"], responses: ["편안하다고 말함"], nextFocus: ["브릿지 확인"], uncertain: [], summary: "리포머 풋워크를 진행했고 흉추 가동성을 확인했습니다." };

test("term mapping preserves raw transcript and keeps uncertain candidates separate", () => {
  const raw = "리포머에서 브리지 후 고관절 가동성을 확인했다. 캐딜락크도 사용했다.";
  const result = mapPilatesTerms(raw);
  assert.equal(result.rawTranscript, raw);
  assert.ok(result.mapped.some((item) => item.canonical === "브릿지" && item.bodyKey === "exercise.bridge"));
  assert.ok(result.mapped.some((item) => item.canonical === "고관절" && item.category === "anatomy"));
  assert.ok(result.uncertain.some((item) => item.raw === "캐딜락크" && item.canonical === "캐딜락"));
  assert.ok(PILATES_TERMS.length >= 20);
});

test("structured records validate exact fields and instructor edits retain origin", () => {
  const draft = validateStructuredOutput(structured);
  assert.equal(draft.didToday[0].origin, "ai");
  const edited = editStructuredField(draft, "didToday", "체어 풋워크\n브릿지");
  assert.deepEqual(edited.didToday.map((item) => item.origin), ["instructor", "instructor"]);
  assert.match(structuredRecordBody(edited), /오늘 수업: 체어 풋워크 · 브릿지/);
  assert.match(structuredRecordBody(edited), /변화: 흉추 가동성 관찰/);
  assert.throws(() => validateStructuredOutput({ ...structured, diagnosis: [] }));
  const missingNormalized = validateStructuredOutput({ didToday: ["브릿지"], responses: [{ text: "편안함" }] });
  assert.deepEqual(missingNormalized.observations, []);
  assert.equal(missingNormalized.responses[0].text, "편안함");
  assert.throws(() => validateStructuredOutput({ ...structured, responses: ["운동할 때 힘들었고"] }), (error) => error.code === "invalid_output" && error.path === "responses[0]");
  assert.throws(() => validateStructuredOutput({ ...structured, observations: ["오른쪽 허리가 좋아졌습니다입니다"] }), (error) => error.code === "invalid_output" && error.path === "observations[0]");
  assert.throws(() => validateStructuredOutput({ ...structured, summary: "오늘 수업에서는 다음 내용을 진행했습니다: 브릿지." }), (error) => error.code === "invalid_output" && error.path === "summary" && error.summaryOnly === true);
  assert.equal(validateStructuredOutput({ didToday: [], observations: [], responses: [], nextFocus: [], uncertain: [], summary: null }).summary, null);
});

test("summary-only validation retries once then keeps four fields with a dropped marker", async () => {
  let calls = 0;
  const provider = new GatewayLlmProvider({
    gatewayProvider: { async structureLessonRecord() {
      calls += 1;
      return { status: AI_STATUSES.DRAFT, output: { ...structured, summary: calls === 1 ? "오른쪽 허리가 좋아졌고" : "오른쪽 허리가 좋아졌습니다입니다" } };
    } },
    retryDelayMs: 0,
  });
  const result = await provider.structureLessonRecord({ rawTranscript: "원문" });
  assert.equal(calls, 2);
  assert.equal(result.status, "structured");
  assert.equal(result.provenanceSource, "openai");
  assert.equal(result.output.didToday[0].text, "리포머 풋워크");
  assert.equal(result.output.summary, null);
  assert.equal(result.output.summaryStatus, "dropped");
  assert.equal(result.meta.summaryStatus, "dropped");
});

test("invalid four-field output still retries once and downgrades the entire record to raw", async () => {
  let calls = 0;
  const provider = new GatewayLlmProvider({
    gatewayProvider: { async structureLessonRecord() { calls += 1; return { status: AI_STATUSES.DRAFT, output: { ...structured, responses: ["운동할 때 힘들었고"] } }; } },
    retryDelayMs: 0,
  });
  const result = await provider.structureLessonRecord({ rawTranscript: "원문" });
  assert.equal(calls, 2);
  assert.equal(result.status, "unstructured");
  assert.equal(result.output, null);
  assert.equal(result.provenanceSource, "fallback_raw");
});

test("LlmProvider repairs once, validates output, and downgrades to raw after failure", async () => {
  let calls = 0;
  const provider = new GatewayLlmProvider({
    gatewayProvider: { async structureLessonRecord() { calls += 1; if (calls < 2) throw Object.assign(new Error("temporary"), { code: "invalid_output" }); return { status: AI_STATUSES.DRAFT, output: structured, usage: { totalTokens: 42 } }; } },
    retryDelayMs: 0,
  });
  const result = await provider.structureLessonRecord({ rawTranscript: "원문" });
  assert.equal(result.status, "structured");
  assert.equal(result.attempts, 2);
  assert.equal(result.output.didToday[0].origin, "ai");

  const failed = new GatewayLlmProvider({ gatewayProvider: { async structureLessonRecord() { throw Object.assign(new Error("down"), { code: "provider_unavailable", retryable: true }); } }, retryDelayMs: 0 });
  const rawFallback = await failed.structureLessonRecord({ rawTranscript: "그대로" });
  assert.equal(rawFallback.status, "unstructured");
  assert.equal(rawFallback.provenanceSource, "fallback_raw");
  assert.equal(rawFallback.output, null);
  const rawMeta = createLessonRecordMeta({ rawTranscript: "그대로", structuredDraft: null, status: "unstructured" });
  assert.equal(rawMeta.provenanceSource, "fallback_raw");
  assert.equal(rawMeta.structuredDraft, null);
  const offline = new GatewayLlmProvider({ gatewayProvider: {}, online: () => false });
  assert.equal((await offline.structureLessonRecord({ rawTranscript: "대기" })).status, "queued");

  let quotaCalls = 0;
  const quota = new GatewayLlmProvider({ gatewayProvider: { async structureLessonRecord() {
    quotaCalls += 1;
    throw Object.assign(new Error("quota"), { code: "provider_quota_exhausted", retryable: false, failureStage: "provider_http", providerStatus: 429, providerCode: "insufficient_quota" });
  } }, retryDelayMs: 0 });
  const quotaResult = await quota.structureLessonRecord({ rawTranscript: "그대로" });
  assert.equal(quotaCalls, 1);
  assert.equal(quotaResult.failureStage, "provider_http");
  assert.equal(quotaResult.providerStatus, 429);
  assert.equal(quotaResult.providerCode, "insufficient_quota");
});

test("pending queue survives exit and usage telemetry stores counters without transcript", () => {
  const storage = memoryStorage();
  savePendingLessonRecord("m1", "l1", { rawTranscript: "민감한 원문", status: "queued" }, storage);
  const restored = loadPendingLessonRecord("m1", "l1", storage);
  assert.equal(restored.rawTranscript, "민감한 원문");
  assert.equal(restored.state, LESSON_RECORD_DRAFT_STATE.RAW);
  assert.equal(pendingLessonRecordLabel(restored), "정리 전(원문 있음)");
  assert.equal(listPendingLessonRecords(storage).length, 1);
  removePendingLessonRecord("m1", "l1", storage);
  assert.equal(listPendingLessonRecords(storage).length, 0);

  trackLessonRecordUsage("stt_complete", { seconds: 12, transcript: "저장 금지 원문" }, storage);
  trackLessonRecordUsage("llm_complete", { attempts: 1, latencyMs: 320, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, transcript: "저장 금지 원문" }, storage);
  trackLessonRecordUsage("record_confirmed", {}, storage);
  const usage = readLessonRecordUsage(storage);
  assert.equal(usage.sttSeconds, 12);
  assert.equal(usage.totalTokens, 15);
  assert.equal(usage.completedRecords, 1);
  assert.doesNotMatch(storage.dump(), /저장 금지 원문/);
});

test("hidden diagnostics retain safe request model metadata without lesson content", () => {
  const storage = memoryStorage();
  appendLessonRecordDiagnostic({
    code: "success",
    stage: "ai_gateway",
    category: "SUCCESS",
    model: "gpt-5-mini-2026-08-07",
    requestId: "ai_openai_structureLessonRecord_safe12345678",
    transportCode: "E-NETWORK",
    gatewayUrl: "https://asia-northeast3-pilateacher.cloudfunctions.net/aiGateway/v1/ai/execute",
    causeName: "TypeError",
    causeMessage: "Failed to fetch",
    transcript: "저장하면 안 되는 회원 원문",
  }, storage);
  const [event] = readLessonRecordDiagnostics(storage);
  assert.equal(event.model, "gpt-5-mini-2026-08-07");
  assert.equal(event.requestId, "ai_openai_structureLessonRecord_safe12345678");
  assert.equal(event.transportCode, "E-NETWORK");
  assert.equal(event.gatewayUrl, "https://asia-northeast3-pilateacher.cloudfunctions.net/aiGateway/v1/ai/execute");
  assert.equal(event.causeMessage, "Failed to fetch");
  assert.doesNotMatch(storage.dump(), /저장하면 안 되는 회원 원문|transcript/);
});

test("temporary failures back off and background success promotes raw to structured without confirming", async () => {
  const storage = memoryStorage();
  savePendingLessonRecord("m1", "l1", { rawTranscript: "오늘 브릿지", status: "raw" }, storage);
  const scheduled = scheduleLessonRecordRetry("m1", "l1", { code: "network_offline" }, storage, 1000);
  assert.equal(scheduled.retry.nextRetryAt, 31000);
  let calls = 0;
  const diagnostics = [];
  const result = await runLessonRecordRetryCycle({
    storage,
    now: 31000,
    aiStatus: "normal",
    llmProvider: { async structureLessonRecord() { calls += 1; return { status: "structured", output: validateStructuredOutput(structured), meta: { requestId: "safe", model: "gpt-5-mini" } }; } },
    onDiagnostic: (event) => diagnostics.push(event),
  });
  assert.deepEqual(result, { processed: 1, promoted: 1, failed: 0 });
  assert.equal(calls, 1);
  const promoted = loadPendingLessonRecord("m1", "l1", storage);
  assert.equal(promoted.state, LESSON_RECORD_DRAFT_STATE.STRUCTURED);
  assert.equal(promoted.status, "structured");
  assert.equal(pendingLessonRecordLabel(promoted), "확인 대기(정리됨)");
  assert.notEqual(promoted.status, "confirmed");
  assert.deepEqual(diagnostics, [{ code: "success", stage: "background_retry", category: "SUCCESS", model: "gpt-5-mini", requestId: "safe", gatewayUrl: undefined, httpStatus: 200 }]);
});

test("quota failures preserve raw and enter bounded backoff while remote status cache survives reload", () => {
  const storage = memoryStorage();
  savePendingLessonRecord("m1", "l1", { rawTranscript: "안전한 기록", status: "raw" }, storage);
  const draft = scheduleLessonRecordRetry("m1", "l1", { code: "provider_quota_exhausted" }, storage, 1000);
  assert.equal(draft.status, "queued");
  assert.equal(draft.structuredDraft, undefined);
  assert.deepEqual(draft.retry, { state: "waiting", attempts: 0, nextRetryAt: 31000 });
  writeAIRecordingStatus({ status: "degraded", reasonCode: "provider_quota_exhausted", updatedAt: "2026-08-24T00:00:00.000Z" }, storage);
  assert.equal(readAIRecordingStatus(storage).status, "degraded");
});

test("client invocation defects are never placed in the automatic retry loop", () => {
  const storage = memoryStorage();
  savePendingLessonRecord("m1", "l1", { rawTranscript: "안전한 기록", status: "raw" }, storage);
  const draft = scheduleLessonRecordRetry("m1", "l1", {
    code: "client_invocation_error",
    failureStage: "fetch_internal",
    transportCode: "E-INTERNAL",
  }, storage, 1000);
  assert.equal(draft.failure.code, "client_internal");
  assert.equal(draft.retry, null);
});

test("consent and no-speech failures are excluded from retry count and queue clear preserves typed text", () => {
  const storage = memoryStorage();
  savePendingLessonRecord("m1", "consent", {
    status: "audio_pending",
    rawTranscript: "",
    audioClips: [{ blobId: "consent-audio", state: "pending" }],
    retry: { state: "waiting", attempts: 0, nextRetryAt: 0 },
  }, storage);
  scheduleLessonRecordRetry("m1", "consent", { code: "consent_required" }, storage, 1);
  savePendingLessonRecord("m1", "silent", { status: "raw", rawTranscript: "", retry: null, failure: { code: "stt_no_speech", category: "INPUT" } }, storage);
  savePendingLessonRecord("m1", "network", {
    status: "audio_pending",
    rawTranscript: "강사가 입력한 원문",
    audioClips: [{ blobId: "network-audio", state: "pending" }],
    retry: { state: "waiting", attempts: 0, nextRetryAt: 0 },
  }, storage);
  assert.deepEqual(listQueuedLessonRecords(storage).map((item) => item.lessonId), ["network"]);
  const cleared = clearQueuedLessonRecords(storage);
  assert.deepEqual(cleared, { cleared: 1, blobIds: ["network-audio"] });
  const preserved = loadPendingLessonRecord("m1", "network", storage);
  assert.equal(preserved.rawTranscript, "강사가 입력한 원문");
  assert.equal(preserved.retry, null);
  assert.deepEqual(preserved.audioClips, []);
  assert.equal(listQueuedLessonRecords(storage).length, 0);
});

test("legacy nonretryable failures stay out of the queue and partial clear removes only deleted blob references", () => {
  const storage = memoryStorage();
  savePendingLessonRecord("m1", "legacy-consent", {
    status: "audio_pending",
    rawTranscript: "",
    audioBlobId: "legacy-consent-audio",
    retry: { state: "waiting", attempts: 0, nextRetryAt: 0 },
    failure: { code: "consent_missing" },
  }, storage);
  assert.equal(listQueuedLessonRecords(storage).length, 0);
  assert.equal(pendingLessonRecordLabel(loadPendingLessonRecord("m1", "legacy-consent", storage)), "동의 필요");

  savePendingLessonRecord("m1", "partial", {
    status: "audio_pending",
    rawTranscript: "보존할 원문",
    audioBlobId: "first",
    audioClips: [{ blobId: "first", state: "pending" }, { blobId: "second", state: "pending" }],
    retry: { state: "waiting", attempts: 0, nextRetryAt: 0 },
  }, storage);
  clearQueuedLessonRecordAudio([{ memberId: "m1", lessonId: "partial", blobIds: ["first"] }], storage);
  const partial = loadPendingLessonRecord("m1", "partial", storage);
  assert.equal(partial.rawTranscript, "보존할 원문");
  assert.equal(partial.audioBlobId, null);
  assert.deepEqual(partial.audioClips.map((clip) => clip.blobId), ["second"]);
  assert.equal(partial.retry.state, "waiting");
});

test("App exposes four post-attendance choices, 90-second cap, pending save and post-confirm audio deletion", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /말하기<\/button>/);
  assert.match(source, /직접입력<\/button>/);
  assert.match(source, />노코멘트<\/button>/);
  assert.match(source, />나중에<\/button>/);
  assert.match(source, /elapsed >= MAX_STT_SECONDS/);
  assert.match(source, /savePendingLessonRecord/);
  const saveIndex = source.indexOf("const stored = await saveDb", source.indexOf("const saveScheduleComment"));
  const deleteIndex = source.indexOf("await blobDel(voiceMeta.audioBlobId)", saveIndex);
  assert.ok(saveIndex >= 0 && deleteIndex > saveIndex, "temporary audio must be deleted only after persistence succeeds");
  assert.match(source, /stage: "confirmed_record"/);
  assert.match(source, /status: voiceMeta\.lessonRecord\.structuredDraft \? "confirmed" : "confirmed_unstructured"/);
  assert.match(source, /ignored_pre_start_stopped/);
  assert.match(source, /startRequestRef\.current/);
  assert.match(source, /대기 중…/);
  assert.match(source, /듣고 있어요/);
  assert.match(source, /이어서 말하기/);
  assert.match(source, /VOICE_SILENCE_LIMIT_MS/);
  assert.match(source, /pendingLessonRecordLabel/);
  assert.match(source, /recordQueueLabel/);
  assert.match(source, /AI 수업 요약/);
  assert.match(source, /무엇을 말하면 되나요\?/);
  assert.doesNotMatch(source, />미구조화|입력한 내용 그대로 저장</);
});
