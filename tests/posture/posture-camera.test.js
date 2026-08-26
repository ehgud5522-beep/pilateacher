import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CAPTURE_TIMER_STORAGE_KEY,
  LEVEL_THRESHOLD_DEG,
  SENSOR_STATUSES,
  base64ToBlob,
  computePreviewGeometry,
  correctOrientationForScreen,
  createCaptureCountdown,
  createCaptureGeometryMetadata,
  createIdempotentLifecycle,
  evaluateDeviceLevel,
  mapPreviewPointToCapture,
  normalizeCaptureTimer,
  normalizeCameraPermissionState,
  normalizeScreenAngle,
  readCaptureTimer,
  resolveSensorStatus,
  writeCaptureTimer,
} from "../../src/features/posture/posture-camera.js";

test("camera permission prompt is distinct from denial so the first iOS tap requests once", () => {
  assert.equal(normalizeCameraPermissionState({ camera: "prompt" }), "prompt");
  assert.equal(normalizeCameraPermissionState({ camera: "prompt-with-rationale" }), "prompt");
  assert.equal(normalizeCameraPermissionState({ camera: "granted" }), "granted");
  assert.equal(normalizeCameraPermissionState({ camera: "denied" }), "denied");
});

test("iOS camera preview failure has an official native capture fallback", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /CapacitorCamera\.getPhoto/);
  assert.match(source, /CameraSource\.Camera/);
  assert.match(source, /captureWithSystemCamera\("preview_start_failed"\)/);
  assert.match(source, /camera_preview_start_failed/);
  assert.match(source, /permissionState,\s*x: box\?\.x, y: box\?\.y, width: box\?\.width, height: box\?\.height/);
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    value: (key) => values.get(key),
  };
}

function fakeTimers() {
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimer(callback) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, callback);
      return id;
    },
    clearTimer(id) {
      tasks.delete(id);
    },
    tick() {
      const entries = [...tasks.entries()];
      tasks.clear();
      entries.forEach(([, callback]) => callback());
    },
    size: () => tasks.size,
  };
}

test("timer preference accepts only 0, 3, 5, or 10 and safely defaults to 3", () => {
  const storage = memoryStorage();
  assert.equal(normalizeCaptureTimer("5"), 5);
  assert.equal(normalizeCaptureTimer(4), 3);
  assert.equal(readCaptureTimer(storage), 3);
  assert.equal(writeCaptureTimer(storage, 10), 10);
  assert.equal(storage.value(CAPTURE_TIMER_STORAGE_KEY), "10");
  assert.equal(readCaptureTimer(storage), 10);

  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.equal(readCaptureTimer(blocked), 3);
  assert.equal(writeCaptureTimer(blocked, 5), 5);
});

test("base64 camera output becomes a typed Blob without retaining the source string", async () => {
  const raw = "cGlsYXRlYWNoZXI=";
  const blob = base64ToBlob(`data:image/jpeg;base64,${raw}`);
  assert.equal(blob.type, "image/jpeg");
  assert.equal(await blob.text(), "pilateacher");
  const png = base64ToBlob(raw, { defaultMimeType: "image/png" });
  assert.equal(png.type, "image/png");
  assert.rejects(async () => base64ToBlob("data:text/plain,not-base64"), /base64/);
});

test("contain geometry preserves the full camera frame and exposes letterboxing", () => {
  const geometry = computePreviewGeometry({
    containerWidth: 360,
    containerHeight: 640,
    sourceWidth: 1200,
    sourceHeight: 1600,
    mode: "contain",
  });
  assert.deepEqual(geometry.normalizedCrop, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(geometry.visibleRect.width, 360);
  assert.equal(geometry.visibleRect.height, 480);
  assert.equal(geometry.visibleRect.y, 80);
});

test("cover geometry records the exact normalized crop and maps preview points", () => {
  const geometry = computePreviewGeometry({
    containerWidth: 360,
    containerHeight: 640,
    sourceWidth: 1200,
    sourceHeight: 1600,
    mode: "cover",
  });
  assert.equal(geometry.normalizedCrop.x, 0.125);
  assert.equal(geometry.normalizedCrop.width, 0.75);
  assert.equal(geometry.normalizedCrop.height, 1);

  const metadata = createCaptureGeometryMetadata({
    geometry,
    captureWidth: 1200,
    captureHeight: 1600,
    orientationDegrees: -90,
    measuredAt: "2026-08-03T00:00:00.000Z",
  });
  assert.equal(metadata.capture.orientationDegrees, 270);
  assert.deepEqual(metadata.crop.pixels, { x: 150, y: 0, width: 900, height: 1600 });
  assert.deepEqual(mapPreviewPointToCapture({ x: 180, y: 320 }, metadata), {
    x: 600,
    y: 800,
    normalizedX: 0.5,
    normalizedY: 0.5,
  });
});

test("preview and captured mirror flags keep coordinate mapping explicit", () => {
  const geometry = computePreviewGeometry({
    containerWidth: 400,
    containerHeight: 300,
    sourceWidth: 400,
    sourceHeight: 300,
  });
  const previewOnlyMirror = createCaptureGeometryMetadata({
    geometry,
    captureWidth: 400,
    captureHeight: 300,
    previewMirrored: true,
  });
  assert.equal(mapPreviewPointToCapture({ x: 100, y: 150 }, previewOnlyMirror).x, 300);

  const bothMirrored = createCaptureGeometryMetadata({
    geometry,
    captureWidth: 400,
    captureHeight: 300,
    previewMirrored: true,
    captureMirrored: true,
  });
  assert.equal(mapPreviewPointToCapture({ x: 100, y: 150 }, bothMirrored).x, 100);
});

test("screen orientation correction yields zero roll and pitch for canonical upright poses", () => {
  assert.deepEqual(correctOrientationForScreen({ beta: 90, gamma: 0, screenAngle: 0 }), {
    roll: 0,
    pitch: 0,
    screenAngle: 0,
  });
  assert.deepEqual(correctOrientationForScreen({ beta: 0, gamma: 90, screenAngle: 90 }), {
    roll: 0,
    pitch: 0,
    screenAngle: 90,
  });
  assert.deepEqual(correctOrientationForScreen({ beta: -90, gamma: 0, screenAngle: 180 }), {
    roll: 0,
    pitch: 0,
    screenAngle: 180,
  });
  assert.deepEqual(correctOrientationForScreen({ beta: 0, gamma: -90, screenAngle: 270 }), {
    roll: 0,
    pitch: 0,
    screenAngle: 270,
  });
  assert.equal(normalizeScreenAngle(-90), 270);
});

test("sensor state and level guidance distinguish permission, support, and real tilt", () => {
  assert.equal(LEVEL_THRESHOLD_DEG, 4);
  assert.equal(resolveSensorStatus({ supported: false }), SENSOR_STATUSES.unavailable);
  assert.equal(resolveSensorStatus({ permission: "prompt" }), SENSOR_STATUSES.permissionRequired);
  assert.equal(resolveSensorStatus({ permission: "denied" }), SENSOR_STATUSES.denied);
  assert.equal(resolveSensorStatus({ hasReading: true }), SENSOR_STATUSES.active);

  assert.equal(evaluateDeviceLevel({ roll: 4, pitch: -4 }).isLevel, true);
  const left = evaluateDeviceLevel({ roll: -5, pitch: 1 });
  assert.equal(left.code, "tilted_left");
  assert.match(left.message, /오른쪽/);
  const missing = evaluateDeviceLevel({ status: SENSOR_STATUSES.unavailable });
  assert.equal(missing.isLevel, false);
  assert.match(missing.message, /사용할 수 없습니다/);
});

test("countdown supports immediate, 3/5/10 second modes, cancellation, and duplicate prevention", () => {
  const timers = fakeTimers();
  const ticks = [];
  let completions = 0;
  const countdown = createCaptureCountdown({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onTick: (value) => ticks.push(value),
    onComplete: () => { completions += 1; },
  });

  assert.equal(countdown.start(3), true);
  assert.equal(countdown.start(5), false);
  assert.deepEqual(ticks, [3]);
  timers.tick();
  timers.tick();
  timers.tick();
  assert.deepEqual(ticks, [3, 2, 1]);
  assert.equal(completions, 1);
  assert.equal(countdown.isRunning(), false);

  assert.equal(countdown.start(10), true);
  assert.equal(countdown.cancel(), true);
  assert.equal(timers.size(), 0);
  assert.equal(countdown.start(0), true);
  assert.equal(completions, 2);
});

test("camera-style lifecycle serializes start/stop and prevents duplicate native sessions", async () => {
  let starts = 0;
  let stops = 0;
  let releaseStart;
  const startGate = new Promise((resolve) => { releaseStart = resolve; });
  const lifecycle = createIdempotentLifecycle({
    startResource: async () => {
      starts += 1;
      await startGate;
    },
    stopResource: async () => { stops += 1; },
  });

  const firstStart = lifecycle.start({ position: "rear" });
  const duplicateStart = lifecycle.start({ position: "rear" });
  assert.equal(starts, 1);
  releaseStart();
  assert.equal((await firstStart).started, true);
  assert.equal((await duplicateStart).started, true);
  assert.equal((await lifecycle.start()).started, false);

  const firstStop = lifecycle.stop("background");
  const duplicateStop = lifecycle.stop("background");
  assert.equal((await firstStop).stopped, true);
  assert.equal((await duplicateStop).stopped, true);
  assert.equal(stops, 1);
  assert.equal(lifecycle.getState(), "idle");

  await lifecycle.dispose();
  await assert.rejects(lifecycle.start(), /disposed/);
});

test("an idle stop does not poison a later start and stop cycle", async () => {
  let starts = 0;
  let stops = 0;
  const lifecycle = createIdempotentLifecycle({
    startResource: async () => { starts += 1; },
    stopResource: async () => { stops += 1; },
  });

  assert.equal((await lifecycle.stop()).stopped, false);
  assert.equal((await lifecycle.start()).started, true);
  assert.equal((await lifecycle.stop()).stopped, true);
  assert.equal(starts, 1);
  assert.equal(stops, 1);
});

test("background stop requested during startup releases the resource after startup resolves", async () => {
  let releaseStart;
  let stops = 0;
  const gate = new Promise((resolve) => { releaseStart = resolve; });
  const lifecycle = createIdempotentLifecycle({
    startResource: async () => gate,
    stopResource: async () => { stops += 1; },
  });

  const starting = lifecycle.start();
  const stopping = lifecycle.stop("background");
  releaseStart();
  assert.equal((await starting).started, true);
  assert.equal((await stopping).stopped, true);
  assert.equal(stops, 1);
  assert.equal(lifecycle.getState(), "idle");
});
