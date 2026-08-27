/* global Blob */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_VOICE_ENGINE, SERVER_AUDIO_FOREGROUND_WAIT_MS, blobToBase64,
  analyzeRecordedSpeech, buildAudioMetrics, createAudioTrimPlan, createStableAudioRequestId, recordingResultToBlob, resolveVoiceEngine,
  settleWithin, structuredDraftFromAudioOutput, uploadAudioClip,
} from "../../src/features/voice/server-audio-session.js";
import { runLessonRecordRetryCycle } from "../../src/features/lesson-record/retry-queue.js";
import { LESSON_RECORD_QUEUE_STORAGE_KEY, loadPendingLessonRecord, savePendingLessonRecord } from "../../src/features/lesson-record/draft-queue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.resolve(__dirname, "../../src/App.jsx"), "utf8");

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

const audioOutput = {
  transcript: "브릿지를 했고 오른쪽 어깨 움직임이 좋아졌어요.",
  result: "ok",
  fields: { didToday: ["브릿지"], observations: ["오른쪽 어깨 움직임이 좋아짐"], responses: [], nextFocus: [] },
  summary: "브릿지를 진행했고 오른쪽 어깨 움직임이 좋아졌습니다.",
  speechSeconds: 3,
  confidence: 0.9,
  flags: [],
  provenance: { stt: "openai", llm: "openai" },
};

test("server is the default voice engine and native STT remains an explicit flag", () => {
  assert.equal(DEFAULT_VOICE_ENGINE, "server");
  assert.equal(resolveVoiceEngine(undefined), "server");
  assert.equal(resolveVoiceEngine("native"), "native");
  assert.match(appSource, /VOICE_ENGINE_MODE === "server"/);
});

test("recording result is converted, uploaded once, and keeps the supplied idempotency key", async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/mp4" });
  const requestId = createStableAudioRequestId("member-1", "lesson-1", 0, "fixednonce");
  const calls = [];
  const provider = {
    lessonRecordFromAudio: async (input, options) => {
      calls.push({ input, options });
      return { status: "draft", requestId, output: audioOutput };
    },
  };
  const result = await uploadAudioClip({ provider, blob, memberId: "member-1", lessonId: "lesson-1", memberName: "제이", requestId });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.requestId, requestId);
  assert.equal(calls[0].input.language, "ko");
  assert.equal(calls[0].input.audio, await blobToBase64(blob));
  assert.equal(result.output.transcript, audioOutput.transcript);
  assert.deepEqual(structuredDraftFromAudioOutput(result.output).didToday, ["브릿지"]);
});

test("client energy VAD blocks only an entirely silent recording and keeps quiet short speech", () => {
  assert.equal(analyzeRecordedSpeech(Array(50).fill(0.001)).accepted, false);
  const speech = analyzeRecordedSpeech([...Array(5).fill(0.002), ...Array(20).fill(0.2), ...Array(5).fill(0.002)]);
  assert.equal(speech.accepted, true);
  assert.ok(speech.speechSeconds >= 1.5);
  const quietShort = analyzeRecordedSpeech([...Array(10).fill(0.002), ...Array(5).fill(0.012), ...Array(10).fill(0.002)]);
  assert.equal(quietShort.accepted, true);
  assert.ok(quietShort.speechSeconds < 1.5);
  assert.deepEqual(buildAudioMetrics([0, 0.123456, 2]), { intervalMs: 100, amplitudes: [0, 0.1235, 1], trimmedMs: 0, captureLatencyMs: 0 });
  assert.equal(buildAudioMetrics([]), null, "a failed meter must omit metrics instead of fabricating silence");
  assert.equal(structuredDraftFromAudioOutput({ ...audioOutput, result: "low_confidence", fields: null, flags: ["low_confidence"] }), null);
  assert.deepEqual(structuredDraftFromAudioOutput({ ...audioOutput, flags: ["tail_dropped"] })?.didToday, ["브릿지"]);
});

test("client speech markers keep 500 ms before and 1000 ms after speech without trimming the original", () => {
  const amplitudes = [...Array(10).fill(0.002), ...Array(20).fill(0.22), ...Array(30).fill(0.002)];
  const plan = createAudioTrimPlan(amplitudes, 100, 6000);
  assert.equal(plan.accepted, true);
  assert.equal(plan.startMs, 500);
  assert.equal(plan.endMs, 4000);
  assert.equal(plan.trimmedMs, 0);
  assert.deepEqual(plan.amplitudes, amplitudes);
  assert.deepEqual(buildAudioMetrics(plan.amplitudes, 100, { trimmedMs: plan.trimmedMs, captureLatencyMs: 88 }), {
    intervalMs: 100,
    amplitudes: plan.amplitudes,
    trimmedMs: 0,
    captureLatencyMs: 88,
  });
});

test("recorder is prewarmed and only switches to capture after start with haptic feedback", () => {
  assert.match(appSource, /CapacitorAudioRecorder\.prepareRecording/);
  const startIndex = appSource.indexOf("await CapacitorAudioRecorder.startRecording");
  const listeningIndex = appSource.indexOf("setOn(true)", startIndex);
  const hapticIndex = appSource.indexOf("Haptics.impact", startIndex);
  assert.ok(startIndex >= 0 && hapticIndex > startIndex && listeningIndex > hapticIndex);
  assert.match(appSource, /captureLatencyMsRef\.current/);
  assert.doesNotMatch(appSource, /CapacitorAudioRecorder\.trimRecording/);
  assert.match(appSource, /recordingResultToBlob\(result/);
  assert.doesNotMatch(appSource, /trimPlan\.allSilent\)[\s\S]{0,500}return;/, "metering must not discard the original before server transcription");
});

test("native URI recording data becomes a Blob without persisting a native path", async () => {
  const blob = await recordingResultToBlob({ uri: "file:///private/clip.m4a" }, { readFile: async () => ({ data: "AQIDBA==" }) });
  assert.equal(blob.type, "audio/mp4");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 4]);
});

test("foreground wait returns at 10 seconds without cancelling background work", async () => {
  let resolved = false;
  const pending = new Promise((resolve) => setTimeout(() => { resolved = true; resolve("done"); }, 30));
  const result = await settleWithin(pending, 5);
  assert.equal(result.timedOut, true);
  await pending;
  assert.equal(resolved, true);
  assert.equal(SERVER_AUDIO_FOREGROUND_WAIT_MS, 10000);
});

test("offline audio remains queued and online retry promotes it with the same requestId then deletes the clip", async () => {
  const storage = memoryStorage();
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" });
  const requestId = createStableAudioRequestId("member-1", "lesson-1", 0, "retryfixed");
  savePendingLessonRecord("member-1", "lesson-1", {
    status: "audio_pending",
    rawTranscript: "",
    structuredDraft: null,
    audioClips: [{ blobId: "clip-1", requestId, memberName: "제이", state: "pending" }],
    retry: { state: "waiting", attempts: 0, nextRetryAt: 0 },
  }, storage);
  const offline = await runLessonRecordRetryCycle({ llmProvider: {}, audioProvider: {}, storage, online: false });
  assert.deepEqual(offline, { processed: 0, promoted: 0, failed: 0 });
  const calls = [];
  const deleted = [];
  const online = await runLessonRecordRetryCycle({
    llmProvider: {},
    audioProvider: { lessonRecordFromAudio: async (_input, options) => { calls.push(options.requestId); return { status: "draft", requestId, output: audioOutput }; } },
    loadAudio: async () => blob,
    deleteAudio: async (blobId) => deleted.push(blobId),
    storage,
    online: true,
    now: 1,
  });
  assert.equal(online.promoted, 1);
  assert.deepEqual(calls, [requestId]);
  assert.deepEqual(deleted, ["clip-1"]);
  const restored = loadPendingLessonRecord("member-1", "lesson-1", storage);
  assert.equal(restored.rawTranscript, audioOutput.transcript);
  assert.equal(restored.status, "structured");
  assert.equal(restored.audioClips[0].blobId, null);
  assert.equal(storage.getItem(LESSON_RECORD_QUEUE_STORAGE_KEY).includes("AQID"), false);
});

test("background retry keeps no-speech empty and low-confidence transcript review-only", async () => {
  const cases = [
    {
      lessonId: "lesson-silent",
      output: { transcript: "", result: "no_speech", fields: null, summary: null, speechSeconds: 0, confidence: 0, flags: ["no_speech"], provenance: { stt: null, llm: null } },
      status: "raw",
      transcript: "",
    },
    {
      lessonId: "lesson-review",
      output: { transcript: "브릿지처럼 들립니다", result: "low_confidence", fields: null, summary: null, speechSeconds: 2, confidence: 0.2, flags: ["low_confidence"], provenance: { stt: "openai", llm: null } },
      status: "review_required",
      transcript: "브릿지처럼 들립니다",
    },
  ];
  for (const fixture of cases) {
    const storage = memoryStorage();
    const requestId = createStableAudioRequestId("member-1", fixture.lessonId, 0, "safetycase");
    savePendingLessonRecord("member-1", fixture.lessonId, {
      status: "audio_pending",
      rawTranscript: "",
      structuredDraft: null,
      audioClips: [{ blobId: "clip-safe", clipId: requestId, requestId, memberName: "제이", state: "pending", audioMetrics: buildAudioMetrics(Array(20).fill(0.2)) }],
      retry: { state: "waiting", attempts: 0, nextRetryAt: 0 },
    }, storage);
    const deleted = [];
    const result = await runLessonRecordRetryCycle({
      llmProvider: {},
      audioProvider: { lessonRecordFromAudio: async (_input, options) => ({ status: "draft", requestId: options.requestId, output: fixture.output }) },
      loadAudio: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" }),
      deleteAudio: async (blobId) => deleted.push(blobId),
      storage,
      online: true,
      now: 1,
    });
    const restored = loadPendingLessonRecord("member-1", fixture.lessonId, storage);
    assert.equal(result.promoted, 0);
    assert.equal(restored.status, fixture.status);
    assert.equal(restored.rawTranscript, fixture.transcript);
    assert.equal(restored.structuredDraft, null);
    assert.deepEqual(restored.reviewFlags, fixture.output.flags);
    assert.deepEqual(deleted, ["clip-safe"]);
  }
});

test("cancel uses the recorder discard API rather than saving a partial file", () => {
  assert.match(appSource, /CapacitorAudioRecorder\.cancelRecording\(\)/);
  assert.match(appSource, /voiceDiagnostic\("user_end", \{ source: "server_audio", reason: "cancel" \}\)/);
});
