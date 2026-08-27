import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("H-6 recreates camera outputs and exposes native preview/photo readiness", async () => {
  const [controller, plugin, app] = await Promise.all([
    read("../../node_modules/@capgo/camera-preview/ios/Sources/CapgoCameraPreviewPlugin/CameraController.swift"),
    read("../../node_modules/@capgo/camera-preview/ios/Sources/CapgoCameraPreviewPlugin/Plugin.swift"),
    read("../../src/App.jsx"),
  ]);
  assert.match(controller, /PILATEACHER_H6_PHOTO_OUTPUT_READINESS/);
  const safeCleanup = controller.slice(controller.indexOf("performPilaTeacherSafeCleanupIfNeeded"), controller.indexOf("func cleanup()"));
  assert.match(safeCleanup, /self\.photoOutput = nil[\s\S]*self\.outputsPrepared = false[\s\S]*self\.hasReceivedFirstFrame = false/);
  assert.match(controller, /func pilaTeacherPhotoOutputState\(\)/);
  assert.match(plugin, /CAPPluginMethod\(name: "getPilaTeacherCameraState"/);
  for (const field of ["photoOutputAttached", "photoConnectionEnabled", "previewLayerAttached", "previewAttached", "firstFrameReceived"]) {
    assert.match(plugin, new RegExp(field));
  }
  assert.match(app, /waitForCameraPhotoOutput\(\{ timeoutMs: 1500, pollMs: 100 \}\)/);
  assert.match(app, /videoQuality: "4:3", enableVideoMode: false/);
  assert.match(app, /captureWithSystemCamera\("photo_output_failed"\)/);
  assert.match(app, /CameraResultType\.Base64[\s\S]*CameraSource\.Camera/);
});

test("H-6 waits for an input route and validates 1.5-second recordings by file bytes", async () => {
  const native = await read("../../node_modules/@capgo/capacitor-audio-recorder/ios/Sources/CapacitorAudioRecorderPlugin/CapacitorAudioRecorderPlugin.swift");
  assert.match(native, /PILATEACHER_H6_INPUT_FILE_GUARDS/);
  assert.match(native, /waitForInputRoute\(timeout: self\.inputRouteWaitTimeout\)/);
  assert.match(native, /input_route_before_record/);
  assert.match(native, /input_route_before_test/);
  assert.match(native, /microphoneTestDuration: TimeInterval = 1\.5/);
  assert.equal((native.match(/stage: "input_level_sample"/g) || []).length, 1);
  assert.match(native, /recorder\.updateMeters\(\)/);
  assert.match(native, /averagePower\(forChannel: 0\)/);
  assert.match(native, /let durationMilliseconds = recorder\.currentTime \* 1000\s+recorder\.stop\(\)/);
  assert.match(native, /let durationMs = Int\(max\(0, recorder\.currentTime\) \* 1_000\)\s+recorder\.stop\(\)/);
  assert.match(native, /"fileExists": fileState\.exists/);
  assert.match(native, /"fileBytes": fileState\.bytes/);
});

test("voice result remains visible and only deferred processing closes after ten seconds", async () => {
  const [app, session] = await Promise.all([
    read("../../src/App.jsx"),
    read("../../src/features/voice/server-audio-session.js"),
  ]);
  assert.match(session, /SERVER_AUDIO_FOREGROUND_WAIT_MS = 10000/);
  assert.match(app, /waitBeforeDeferredClose/);
  assert.match(app, /기록 저장됨 · AI가 정리 중/);
  assert.match(app, /summaryDraft &&[\s\S]*AI 수업 요약[\s\S]*summaryView\.cards/);
  assert.match(app, /typeof onClose === "function"[\s\S]*>확인<\/button>/);
  assert.doesNotMatch(app, /onApply=\{async \(text, meta\)[^\n]*onClose\(\)/);
});

test("capture timer defaults to immediate while retaining all four persisted choices", async () => {
  const camera = await read("../../src/features/posture/posture-camera.js");
  assert.match(camera, /CAPTURE_TIMER_OPTIONS = Object\.freeze\(\[0, 3, 5, 10\]\)/);
  assert.match(camera, /DEFAULT_CAPTURE_TIMER_SECONDS = 0/);
});

test("postinstall runs H-6 after the H-5 native patches", async () => {
  const pkg = JSON.parse(await read("../../package.json"));
  const script = pkg.scripts.postinstall;
  assert.ok(script.indexOf("patch-camera-preview-ios-h6.mjs") > script.indexOf("patch-camera-preview-ios-session-safety.mjs"));
  assert.ok(script.indexOf("patch-audio-recorder-h6.mjs") > script.indexOf("patch-audio-recorder-h5.mjs"));
});
