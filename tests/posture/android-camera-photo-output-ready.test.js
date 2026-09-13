import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createIdempotentLifecycle,
  resolveNativePhotoOutputReadiness,
} from "../../src/features/posture/posture-camera.js";
import {
  appendVoiceSessionDiagnostic,
  readVoiceSessionDiagnostics,
} from "../../src/features/voice/voice-session.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

test("Android readiness is not published before native start resolves", () => {
  const pending = resolveNativePhotoOutputReadiness({ platform: "android", startResolved: false });
  assert.equal(pending.ready, false);
  assert.equal(pending.readinessSource, "camera_start_pending");
});

test("Android start resolution is the photo-output readiness signal while iOS keeps its probe", () => {
  const android = resolveNativePhotoOutputReadiness({ platform: "android", startResolved: true });
  assert.equal(android.ready, true);
  assert.equal(android.photoOutputAvailable, true);
  assert.equal(android.sessionRunning, true);
  assert.equal(android.readinessSource, "android_camera_start_resolved");

  const iosNotReady = resolveNativePhotoOutputReadiness({ platform: "ios", startResolved: true, probeState: { ready: false } });
  assert.equal(iosNotReady.ready, false);
  assert.equal(iosNotReady.readinessSource, "native_camera_state_probe");
  const iosReady = resolveNativePhotoOutputReadiness({ platform: "ios", startResolved: true, probeState: { ready: true, photoOutputAvailable: true } });
  assert.equal(iosReady.ready, true);
  assert.equal(iosReady.photoOutputAvailable, true);
});

test("duplicate starts share one native prepare and stop-restart performs a fresh prepare", async () => {
  let starts = 0;
  let stops = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const lifecycle = createIdempotentLifecycle({
    startResource: async () => {
      starts += 1;
      if (starts === 1) await firstGate;
    },
    stopResource: async () => { stops += 1; },
  });

  const first = lifecycle.start();
  const duplicate = lifecycle.start();
  assert.equal(starts, 1);
  releaseFirst();
  await Promise.all([first, duplicate]);
  assert.equal(starts, 1);
  assert.equal((await lifecycle.start()).started, false);

  await lifecycle.stop("exit");
  assert.equal(stops, 1);
  assert.equal((await lifecycle.start()).started, true);
  assert.equal(starts, 2);
});

test("CameraX binds Preview and ImageCapture before resolving Android CameraPreview.start", async () => {
  const cameraX = await readFile(new URL("../../node_modules/@capgo/camera-preview/android/src/main/java/app/capgo/capacitor/camera/preview/CameraXView.java", import.meta.url), "utf8");
  const plugin = await readFile(new URL("../../node_modules/@capgo/camera-preview/android/src/main/java/app/capgo/capacitor/camera/preview/CameraPreview.java", import.meta.url), "utf8");
  const imageCaptureBuilt = cameraX.indexOf("imageCapture = new ImageCapture.Builder()") ;
  const useCasesBound = cameraX.indexOf("bindConfiguredUseCases(bindingPlan, preview)", imageCaptureBuilt);
  const running = cameraX.indexOf("isRunning = true", useCasesBound);
  const startedCallback = cameraX.indexOf("listener.onCameraStarted", running);
  assert.ok(imageCaptureBuilt >= 0);
  assert.ok(useCasesBound > imageCaptureBuilt);
  assert.ok(running > useCasesBound);
  assert.ok(startedCallback > running);
  assert.match(cameraX, /bindToLifecycle\(this, bindingPlan\.selector, preview, imageCapture\)/);
  assert.match(plugin, /void onCameraStarted[\s\S]*resolveCameraStartCall\(call, result\)/);
  assert.doesNotMatch(plugin, /getPilaTeacherCameraState/);
});

test("App bypasses the iOS-only state probe on Android and logs the ready sequence", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const helperStart = source.indexOf("const waitForCameraPhotoOutput");
  const androidReady = source.indexOf('platform === "android"', helperStart);
  const iosProbe = source.indexOf("CameraPreview.getPilaTeacherCameraState", helperStart);
  const appStart = source.indexOf("const startCamera");
  const appStop = source.indexOf("const stopCamera");
  assert.ok(helperStart >= 0 && androidReady > helperStart && iosProbe > androidReady);
  assert.match(source, /await CameraPreview\.start\([\s\S]*await waitForCameraPhotoOutput\(\{ platform: cameraPlatform/);
  assert.match(source.slice(appStart, source.indexOf("const captureBrowserFrame", appStart)), /cameraRunning\.current \|\| cameraStarting\.current/);
  assert.match(source.slice(appStart, source.indexOf("const captureBrowserFrame", appStart)), /cameraStarting\.current = true;[\s\S]*await CameraPreview\.start/);
  assert.match(source.slice(appStop, appStart), /cameraGeneration\.current \+= 1;[\s\S]*cameraPhotoReadyRef\.current = false;[\s\S]*await CameraPreview\.stop/);
  [
    "camera_prepare_started",
    "camera_permission_ready",
    "camera_photo_output_ready",
    "camera_preview_start_requested",
    "camera_preview_started",
    "camera_preview_start_failed",
  ].forEach((event) => assert.match(source, new RegExp(event)));
  assert.doesNotMatch(source.slice(source.indexOf("const startCamera"), source.indexOf("const captureBrowserFrame")), /setTimeout\(\s*500/);
});

test("camera readiness diagnostics retain platform and lifecycle without sensitive content", () => {
  const storage = new MemoryStorage();
  const events = [
    ["camera_prepare_started", "preparing"],
    ["camera_permission_ready", "ready"],
    ["camera_preview_start_requested", "starting"],
    ["camera_photo_output_ready", "ready"],
    ["camera_preview_started", "running"],
    ["camera_preview_start_failed", "error"],
  ];
  events.forEach(([event, lifecycleState], index) => appendVoiceSessionDiagnostic(event, {
    source: "native_preview",
    platform: "android",
    lifecycleState,
    reason: event === "camera_preview_start_failed" ? "camera_start_failed" : "",
    memberName: "김회원",
    photo: "data:image/jpeg;base64,private",
    token: "secret-token",
  }, storage, () => new Date(Date.UTC(2026, 8, 6, 3, 0, index))));
  const records = readVoiceSessionDiagnostics(storage);
  assert.equal(records.length, 6);
  assert.equal(records[0].platform, "android");
  assert.equal(records[0].lifecycleState, "error");
  const serialized = JSON.stringify(records);
  assert.equal(serialized.includes("김회원"), false);
  assert.equal(serialized.includes("data:image"), false);
  assert.equal(serialized.includes("secret-token"), false);
});
