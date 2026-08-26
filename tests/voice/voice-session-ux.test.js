import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BACKGROUND_RECORDING_INTERRUPTED_MESSAGE,
  RECOGNIZER_BUSY_RETRY_MS,
  VOICE_ORGANIZING_TIMEOUT_MS,
  VOICE_SESSION_DIAGNOSTIC_LIMIT,
  VOICE_SILENCE_LIMIT_MS,
  appendVoiceSessionDiagnostic,
  createSilenceGuard,
  isRecognizerBusyError,
  nativeAudioPermissionState,
  readVoiceSessionDiagnostics,
  resolveVoicePhase,
  runVoicePermissionAction,
  shouldInterruptServerRecordingOnPause,
  shouldRestartRecognizer,
  stitchSpeechTranscript,
} from "../../src/features/voice/voice-session.js";

test("server audio permission preserves iOS prompt and logs start failure diagnostics", () => {
  assert.equal(nativeAudioPermissionState({ recordAudio: "prompt" }, "ios"), "prompt");
  assert.equal(nativeAudioPermissionState({ recordAudio: "prompt-with-rationale" }, "ios"), "prompt");
  assert.equal(nativeAudioPermissionState({ recordAudio: "denied" }, "ios"), "permanently_denied");
  assert.equal(nativeAudioPermissionState({ recordAudio: "denied" }, "android"), "denied");
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const entry = appendVoiceSessionDiagnostic("audio_record_start_failed", {
    source: "server_audio", pluginError: "Failed to start recording: AVAudioSession busy",
    permissionState: "granted", audioSessionCategory: "playAndRecord", audioSessionMode: "measurement",
  }, storage, () => new Date("2026-08-26T00:00:00Z"));
  assert.equal(entry.permissionState, "granted");
  assert.equal(entry.audioSessionCategory, "playAndRecord");
  assert.match(entry.pluginError, /AVAudioSession busy/);
});
import { describeLessonRecordFailure } from "../../src/features/lesson-record/failure-diagnostics.js";

test("engine segment transcripts stitch without repeating the overlap", () => {
  assert.equal(stitchSpeechTranscript("오늘 브릿지 안정감이", "브릿지 안정감이 좋아졌어요"), "오늘 브릿지 안정감이 좋아졌어요");
  assert.equal(stitchSpeechTranscript("오른쪽 어깨", "오른쪽 어깨"), "오른쪽 어깨");
  assert.equal(stitchSpeechTranscript("", "다음에는 견갑 안정화"), "다음에는 견갑 안정화");
});

test("silence guard tolerates a 3-5 second pause and ends only after 8 seconds without new speech", () => {
  const timers = [];
  const cleared = new Set();
  let timedOut = 0;
  const guard = createSilenceGuard({
    setTimer: (callback, delay) => { const id = timers.length; timers.push({ callback, delay }); return id; },
    clearTimer: (id) => cleared.add(id),
    onTimeout: () => { timedOut += 1; },
  });
  guard.start();
  assert.equal(timers[0].delay, VOICE_SILENCE_LIMIT_MS);
  guard.heard();
  assert.equal(cleared.has(0), true, "speech at 3-5 seconds must reset the original silence window");
  timers[0].callback();
  assert.equal(timedOut, 0, "a stale pre-speech timer cannot end recording");
  timers[1].callback();
  assert.equal(timedOut, 1, "the renewed 8-second silence window ends recording once");
});

test("voice phase resolver always yields one mutually exclusive visible state", () => {
  const allowed = new Set(["waiting", "listening", "organizing", "result", "failed", "permission_required"]);
  assert.equal(resolveVoicePhase({ availability: "checking", attempted: false, error: "stale" }), "waiting");
  assert.equal(resolveVoicePhase({ listening: true, finishing: true, error: "stale", attempted: true }), "listening");
  assert.equal(resolveVoicePhase({ listening: true, error: "stale", attempted: true }), "listening");
  assert.equal(resolveVoicePhase({ hasResult: true, finishing: true, organizing: true, summaryFailed: true }), "result");
  assert.equal(resolveVoicePhase({ attempted: true, error: "failed" }), "failed");
  assert.equal(resolveVoicePhase({ summaryFailed: true, organizing: true }), "failed");
  assert.equal(resolveVoicePhase({ timedOut: true, organizing: true }), "failed");
  assert.equal(resolveVoicePhase({ availability: "permission_permanently_denied" }), "permission_required");
  [
    {},
    { listening: true },
    { organizing: true },
    { hasResult: true, organizing: true },
    { summaryFailed: true },
    { availability: "permission_required" },
  ].forEach((input) => assert.equal(allowed.has(resolveVoicePhase(input)), true));
  assert.equal(VOICE_ORGANIZING_TIMEOUT_MS, 30_000);
});

test("permanent microphone denial opens app settings without requesting runtime permission", async () => {
  let requests = 0;
  let settingsOpened = 0;
  const events = [];
  const result = await runVoicePermissionAction({
    permissionState: "permanently_denied",
    requestPermission: async () => { requests += 1; return "granted"; },
    openAppSettings: async () => { settingsOpened += 1; },
    onEvent: (event, details) => events.push({ event, ...details }),
  });
  assert.equal(requests, 0);
  assert.equal(settingsOpened, 1);
  assert.equal(result.openedSettings, true);
  assert.deepEqual(events.map((entry) => entry.event), ["permission_state", "open_app_settings"]);
});

test("retryable microphone denial requests once and a granted resume maps back to waiting", async () => {
  let requests = 0;
  const result = await runVoicePermissionAction({
    permissionState: "denied",
    requestPermission: async () => { requests += 1; return "granted"; },
  });
  assert.equal(requests, 1);
  assert.equal(result.permissionState, "granted");
  assert.equal(resolveVoicePhase({ availability: "ready" }), "waiting");
});

test("recognizer busy uses bounded 300ms restarts while unsupported and permission failures never auto retry", () => {
  assert.equal(isRecognizerBusyError(new Error("RecognitionService busy")), true);
  assert.equal(RECOGNIZER_BUSY_RETRY_MS, 300);
  assert.equal(describeLessonRecordFailure({ code: "recognizer_busy" }).category, "TEMPORARY");
  assert.equal(describeLessonRecordFailure({ code: "mic_permission_denied" }).retry, false);
  assert.equal(describeLessonRecordFailure({ code: "recognizer_unavailable" }).retry, false);
});

test("engine ends and repeated busy callbacks cannot finish before 8 seconds of silence or the 90 second cap", () => {
  const startedAt = 1_000;
  assert.equal(shouldRestartRecognizer({ sessionStartedAt: startedAt, lastSpeechAt: 4_000, now: 8_000 }), true, "a second final followed by a 4 second pause stays active");
  assert.equal(shouldRestartRecognizer({ sessionStartedAt: startedAt, lastSpeechAt: 8_000, now: 15_900 }), true, "every final renews the full silence window");
  assert.equal(shouldRestartRecognizer({ sessionStartedAt: startedAt, lastSpeechAt: 8_000, now: 16_000 }), false, "8 seconds of actual silence ends restart attempts");
  assert.equal(shouldRestartRecognizer({ sessionStartedAt: startedAt, lastSpeechAt: 89_500, now: 91_000 }), false, "the 90 second session cap always wins");
  assert.equal(shouldRestartRecognizer({ stopping: true, sessionStartedAt: startedAt, lastSpeechAt: 8_000, now: 8_100 }), false);
});

test("iOS background transition interrupts only an active server recording and exposes continuation copy", () => {
  assert.equal(shouldInterruptServerRecordingOnPause({ engineMode: "server", recording: true, stopping: false }), true);
  assert.equal(shouldInterruptServerRecordingOnPause({ engineMode: "server", recording: false, stopping: false }), false);
  assert.equal(shouldInterruptServerRecordingOnPause({ engineMode: "server", recording: true, stopping: true }), false);
  assert.equal(shouldInterruptServerRecordingOnPause({ engineMode: "native", recording: true, stopping: false }), false);
  assert.equal(BACKGROUND_RECORDING_INTERRUPTED_MESSAGE, "녹음이 중단됐어요 · 이어서 말하기");
});

test("voice diagnostics retain only 30 privacy-safe events with device-local timestamps", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  for (let index = 0; index < VOICE_SESSION_DIAGNOSTIC_LIMIT + 3; index += 1) {
    appendVoiceSessionDiagnostic(index % 2 ? "restart" : "error", {
      source: "native", code: "recognizer_busy", attempt: index, delayMs: 300,
      transcript: "must never be stored",
    }, storage, () => new Date(`2026-08-26T00:${String(index).padStart(2, "0")}:00+09:00`));
  }
  const entries = readVoiceSessionDiagnostics(storage);
  assert.equal(entries.length, VOICE_SESSION_DIAGNOSTIC_LIMIT);
  assert.equal(entries[0].attempt, 32);
  assert.match(entries[0].localTime, /2026/);
  assert.equal(JSON.stringify(entries).includes("must never be stored"), false);
});

test("voice diagnostics expose timing and safety flags without transcript content", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const entry = appendVoiceSessionDiagnostic("trimmed", {
    source: "server_audio", speechSeconds: 2.7, trimmedMs: 3100, captureLatencyMs: 92,
    flags: ["tail_dropped"], transcript: "저장하면 안 되는 원문",
  }, storage, () => new Date("2026-08-26T08:00:00+09:00"));
  assert.equal(entry.speechSeconds, 2.7);
  assert.equal(entry.trimmedMs, 3100);
  assert.equal(entry.captureLatencyMs, 92);
  assert.deepEqual(entry.flags, ["tail_dropped"]);
  assert.equal(JSON.stringify(entry).includes("저장하면 안 되는 원문"), false);
});

test("VoiceNote waits for a user tap, keeps toggle controls, and exposes continuation without overlapping failure UI", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const voice = source.slice(source.indexOf("function VoiceNote("), source.indexOf("function NoteForm("));
  assert.doesNotMatch(voice, /autoStart|autoStartHandledRef/);
  assert.match(voice, /onClick=\{start\}/);
  assert.match(voice, /onClick=\{\(\) => stop\("manual"\)\}/);
  assert.match(voice, /듣고 있어요 · 잠시 생각하며 멈춰도 괜찮아요/);
  assert.match(voice, /이어서 말하기/);
  assert.match(voice, /voicePhase === "failed"/);
  assert.match(voice, /RECOGNIZER_BUSY_RETRY_MS/);
  assert.match(voice, /shouldRestartRecognizer/);
  assert.doesNotMatch(voice, /busyRetry === 0|busyRetryUsed/);
  assert.match(voice, /voiceDiagnostic\("restart"[\s\S]*recognizer_busy/);
  assert.match(voice, /voiceDiagnostic\("start", \{ source: "native", phase: "dispatched", attempt: busyRetry \}\)/);
  assert.match(voice, /silence_timeout/);
  assert.match(voice, /CapacitorApp\.addListener\("pause"/);
  assert.match(voice, /finishServerRecording\("background"\)/);
  assert.match(voice, /BACKGROUND_RECORDING_INTERRUPTED_MESSAGE/);
});

test("native app information is the runtime source of the displayed build label", async () => {
  const [source, gradle] = await Promise.all([
    readFile(new URL("../../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../android/app/build.gradle", import.meta.url), "utf8"),
  ]);
  assert.match(source, /CapacitorApp\.getInfo\(\)/);
  assert.match(source, /<RuntimeBuildLabel\s*\/>/);
  const versionCode = Number(gradle.match(/versionCode\s+(\d+)\b/)?.[1]);
  const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1] || "";
  assert.ok(Number.isSafeInteger(versionCode) && versionCode > 0);
  assert.match(versionName, /^\d+\.\d+\.\d+$/);
});

test("Android permanent denial uses app details settings and resume rechecks permission", async () => {
  const [source, plugin, activity] = await Promise.all([
    readFile(new URL("../../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../android/app/src/main/java/com/pilateacher/app/AppSettingsPlugin.java", import.meta.url), "utf8"),
    readFile(new URL("../../android/app/src/main/java/com/pilateacher/app/MainActivity.java", import.meta.url), "utf8"),
  ]);
  assert.match(plugin, /ACTION_APPLICATION_DETAILS_SETTINGS/);
  assert.match(plugin, /getContext\(\)\.getPackageName\(\)/);
  assert.match(activity, /registerPlugin\(AppSettingsPlugin\.class\)/);
  assert.match(source, /CapacitorApp\.addListener\("resume"/);
  assert.match(source, /NS\.checkPermissions/);
  assert.match(source, /설정에서 마이크 권한을 켜주세요/);
});
