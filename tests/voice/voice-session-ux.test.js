import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RECOGNIZER_BUSY_RETRY_MS,
  VOICE_SESSION_DIAGNOSTIC_LIMIT,
  VOICE_SILENCE_LIMIT_MS,
  appendVoiceSessionDiagnostic,
  createSilenceGuard,
  isRecognizerBusyError,
  readVoiceSessionDiagnostics,
  resolveVoicePhase,
  shouldRestartRecognizer,
  stitchSpeechTranscript,
} from "../../src/features/voice/voice-session.js";
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
  assert.equal(resolveVoicePhase({ availability: "checking", attempted: false, error: "stale" }), "preparing");
  assert.equal(resolveVoicePhase({ listening: true, finishing: true, error: "stale", attempted: true }), "organizing");
  assert.equal(resolveVoicePhase({ listening: true, error: "stale", attempted: true }), "listening");
  assert.equal(resolveVoicePhase({ hasResult: true }), "result");
  assert.equal(resolveVoicePhase({ attempted: true, error: "failed" }), "failed");
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
});

test("native app information is the runtime source of the displayed build label", async () => {
  const [source, gradle] = await Promise.all([
    readFile(new URL("../../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../android/app/build.gradle", import.meta.url), "utf8"),
  ]);
  assert.match(source, /CapacitorApp\.getInfo\(\)/);
  assert.match(source, /<RuntimeBuildLabel\s*\/>/);
  assert.match(gradle, /versionCode\s+30\b/);
  assert.match(gradle, /versionName\s+"1\.1\.22"/);
});
