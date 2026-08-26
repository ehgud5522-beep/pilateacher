import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("H-4 native patch creates a new UUID file and retries record false three times", async () => {
  const patch = await read("../../tools/patch-audio-recorder-h4.mjs");
  assert.match(patch, /UUID\(\)\.uuidString/);
  assert.match(patch, /maxRecordAttempts = 3/);
  assert.match(patch, /recordRetryDelay: TimeInterval = 0\.20/);
  assert.match(patch, /routeStabilizationDelay: TimeInterval = 0\.15/);
  assert.match(patch, /prepareToRecord/);
  assert.match(patch, /guard didRecord else/);
  assert.match(patch, /attempt: attempt \+ 1/);
  assert.match(patch, /returned false after 3 attempts/);
});

test("H-4 configures category once and activates only after stale recorder cleanup", async () => {
  const patch = await read("../../tools/patch-audio-recorder-h4.mjs");
  assert.match(patch, /public override func load\(\)/);
  assert.match(patch, /configureCategoryOnce\(\)/);
  assert.match(patch, /categoryConfigured/);
  const activateStart = patch.indexOf("    private func activateAudioSession() throws {");
  const settingsStart = patch.indexOf("    private func recordingSettings", activateStart);
  assert.ok(activateStart >= 0 && settingsStart > activateStart);
  const activateBody = patch.slice(activateStart, settingsStart);
  assert.match(activateBody, /setActive\(true, options: \.notifyOthersOnDeactivation\)/);
  assert.doesNotMatch(activateBody, /setCategory/);
  assert.match(patch, /forceCleanupPreviousRecorder\(deleteFile: true, deactivate: false\)/);
  assert.match(patch, /audioRecorder = nil[\s\S]*deactivateSessionIfNeeded\(\)/);
});

test("H-4 diagnostics cover recorder, route, file, stop timing, and interruption state", async () => {
  const [app, native] = await Promise.all([
    read("../../src/App.jsx"),
    read("../../node_modules/@capgo/capacitor-audio-recorder/ios/Sources/CapacitorAudioRecorderPlugin/CapacitorAudioRecorderPlugin.swift"),
  ]);
  for (const field of [
    "prepareToRecord",
    "inputAvailable",
    "routeInputs",
    "otherAudioPlaying",
    "recordingSettings",
    "fileURL",
    "fileExistedBefore",
    "previousRecorderAlive",
    "millisecondsSinceLastStop",
    "sessionInterrupted",
  ]) {
    assert.match(native, new RegExp(field));
    assert.match(app, new RegExp(field));
  }
  assert.match(app, /recordingInterruptionBegan/);
  assert.match(app, /recordingInterruptionEnded/);
  assert.match(app, /녹음이 중단됐어요 · 이어서 말하기/);
});

test("every iOS voice path identifies server audio or native fallback in diagnostics", async () => {
  const app = await read("../../src/App.jsx");
  assert.match(app, /source: "server_audio", voiceEngine: "server_audio"/);
  assert.match(app, /source: "native", voiceEngine: "native"/);
  assert.match(app, /voice_engine_fallback[\s\S]*voiceEngine: "native"/);
});

test("postinstall applies H-4 after the base recorder patch", async () => {
  const pkg = JSON.parse(await read("../../package.json"));
  const baseIndex = pkg.scripts.postinstall.indexOf("patch-audio-recorder-edge.mjs");
  const h4Index = pkg.scripts.postinstall.indexOf("patch-audio-recorder-h4.mjs");
  assert.ok(baseIndex >= 0 && h4Index > baseIndex);
});

test("installed iOS recorder contains the H-4 retry implementation", async () => {
  const native = await read("../../node_modules/@capgo/capacitor-audio-recorder/ios/Sources/CapacitorAudioRecorderPlugin/CapacitorAudioRecorderPlugin.swift");
  assert.match(native, /PILATEACHER_H4_RECORD_RETRY/);
  assert.match(native, /appendingPathComponent\("\\\(prefix\)-\\\(UUID\(\)\.uuidString\)\.m4a"\)/);
  assert.match(native, /prefix: "recording-attempt-\\\(attempt\)"/);
  assert.match(native, /let prepared = recorder\.prepareToRecord\(\)/);
  assert.match(native, /attempt < maxRecordAttempts/);
  assert.match(native, /setActive\(false, options: \.notifyOthersOnDeactivation\)/);
});
