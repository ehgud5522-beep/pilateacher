import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CAPTURE_TIMER_STORAGE_KEY,
  INVALID_READING_TOLERANCE,
  LEVEL_DWELL_MS,
  LEVEL_RELEASE_THRESHOLD_DEG,
  LEVEL_THRESHOLD_DEG,
  READING_STALL_MS,
  SENSOR_STATUSES,
  base64ToBlob,
  computePreviewGeometry,
  correctOrientationForScreen,
  createCaptureCountdown,
  createCaptureGeometryMetadata,
  createIdempotentLifecycle,
  createLevelGate,
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

test("timer preference accepts only 0, 3, 5, or 10 and safely defaults to immediate", () => {
  const storage = memoryStorage();
  assert.equal(normalizeCaptureTimer("5"), 5);
  assert.equal(normalizeCaptureTimer(4), 0);
  assert.equal(readCaptureTimer(storage), 0);
  assert.equal(writeCaptureTimer(storage, 10), 10);
  assert.equal(storage.value(CAPTURE_TIMER_STORAGE_KEY), "10");
  assert.equal(readCaptureTimer(storage), 10);

  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.equal(readCaptureTimer(blocked), 0);
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
  assert.equal(LEVEL_THRESHOLD_DEG, 6);
  assert.equal(LEVEL_RELEASE_THRESHOLD_DEG, 8);
  assert.ok(LEVEL_RELEASE_THRESHOLD_DEG > LEVEL_THRESHOLD_DEG, "releasing green must be looser than entering it");
  assert.equal(resolveSensorStatus({ supported: false }), SENSOR_STATUSES.unavailable);
  assert.equal(resolveSensorStatus({ permission: "prompt" }), SENSOR_STATUSES.permissionRequired);
  assert.equal(resolveSensorStatus({ permission: "denied" }), SENSOR_STATUSES.denied);
  assert.equal(resolveSensorStatus({ hasReading: true }), SENSOR_STATUSES.active);

  assert.equal(evaluateDeviceLevel({ roll: 4, pitch: -4 }).isLevel, true);
  assert.equal(evaluateDeviceLevel({ roll: -5, pitch: 1 }).isLevel, true, "5 deg is inside the widened window");
  const left = evaluateDeviceLevel({ roll: -7, pitch: 1 });
  assert.equal(left.code, "tilted_left");
  assert.match(left.message, /오른쪽/);
  const missing = evaluateDeviceLevel({ status: SENSOR_STATUSES.unavailable });
  assert.equal(missing.isLevel, false);
  assert.match(missing.message, /사용할 수 없습니다/);
});

test("green needs the reading to hold inside the window, not merely touch it", () => {
  const gate = createLevelGate({ smoothing: 0 });
  // A reading that is inside the entry threshold from the first sample still is
  // not green until it has stayed there for the dwell time.
  assert.equal(gate.reading({ roll: 1, pitch: 1, at: 0 }).isLevel, false);
  assert.equal(gate.reading({ roll: 1, pitch: 1, at: LEVEL_DWELL_MS - 1 }).isLevel, false);
  assert.equal(gate.reading({ roll: 1, pitch: 1, at: LEVEL_DWELL_MS }).isLevel, true);
});

test("a reading sweeping through the window never turns green", () => {
  const gate = createLevelGate({ smoothing: 0 });
  gate.reading({ roll: 20, pitch: 0, at: 0 });
  gate.reading({ roll: 1, pitch: 0, at: 100 });
  // Left the window again well before the dwell time elapsed.
  assert.equal(gate.reading({ roll: 20, pitch: 0, at: 200 }).isLevel, false);
  assert.equal(gate.reading({ roll: 1, pitch: 0, at: 300 }).isLevel, false);
  assert.equal(gate.getState().candidateSince, 300, "the dwell timer restarts on re-entry");
});

test("once green, a small excursion holds and a real one releases", () => {
  const gate = createLevelGate({ smoothing: 0 });
  gate.reading({ roll: 0, pitch: 0, at: 0 });
  assert.equal(gate.reading({ roll: 0, pitch: 0, at: LEVEL_DWELL_MS }).isLevel, true);

  const between = (LEVEL_THRESHOLD_DEG + LEVEL_RELEASE_THRESHOLD_DEG) / 2;
  const drifted = gate.reading({ roll: between, pitch: 0, at: LEVEL_DWELL_MS + 100 });
  assert.equal(drifted.isLevel, true, "past the entry threshold but inside the release threshold stays green");
  assert.equal(drifted.code, "level");

  const released = gate.reading({ roll: LEVEL_RELEASE_THRESHOLD_DEG + 1, pitch: 0, at: LEVEL_DWELL_MS + 200 });
  assert.equal(released.isLevel, false);
  assert.notEqual(released.code, "level");

  // Coming back inside has to serve the dwell time again.
  assert.equal(gate.reading({ roll: 0, pitch: 0, at: LEVEL_DWELL_MS + 300 }).isLevel, false);
  assert.equal(gate.reading({ roll: 0, pitch: 0, at: LEVEL_DWELL_MS + 300 + LEVEL_DWELL_MS }).isLevel, true);
});

test("a run of unusable readings shorter than the tolerance changes nothing", () => {
  const gate = createLevelGate({ smoothing: 0 });
  gate.reading({ roll: 0, pitch: 0, at: 0 });
  assert.equal(gate.reading({ roll: 0, pitch: 0, at: LEVEL_DWELL_MS }).isLevel, true);

  for (let attempt = 1; attempt < INVALID_READING_TOLERANCE; attempt += 1) {
    assert.equal(
      gate.invalidReading({ at: LEVEL_DWELL_MS + attempt }),
      null,
      "the caller keeps showing what it already had",
    );
    assert.equal(gate.getState().level, true, "a single junk reading must not wipe a good one");
  }

  const downgraded = gate.invalidReading({ at: LEVEL_DWELL_MS + INVALID_READING_TOLERANCE });
  assert.equal(downgraded.status, SENSOR_STATUSES.unavailable);
  assert.equal(downgraded.isLevel, false);
  assert.equal(downgraded.roll, null);
});

test("one good reading clears the run of unusable ones", () => {
  const gate = createLevelGate({ smoothing: 0 });
  gate.reading({ roll: 0, pitch: 0, at: 0 });
  gate.reading({ roll: 0, pitch: 0, at: LEVEL_DWELL_MS });
  for (let attempt = 1; attempt < INVALID_READING_TOLERANCE; attempt += 1) gate.invalidReading({ at: LEVEL_DWELL_MS + attempt });
  gate.reading({ roll: 0, pitch: 0, at: LEVEL_DWELL_MS + INVALID_READING_TOLERANCE });
  assert.equal(gate.getState().invalidStreak, 0);
  // The tolerance is a run length, so the count starts over.
  assert.equal(gate.invalidReading({ at: LEVEL_DWELL_MS + INVALID_READING_TOLERANCE + 1 }), null);
});

test("a stalled feed stops presenting its last reading as current", () => {
  const gate = createLevelGate({ smoothing: 0 });
  gate.reading({ roll: 0, pitch: 0, at: 0 });
  const green = gate.reading({ roll: 0, pitch: 0, at: LEVEL_DWELL_MS });
  assert.equal(green.isLevel, true);
  assert.match(green.message, /적합합니다/);

  const stalled = gate.stall();
  assert.equal(stalled.status, SENSOR_STATUSES.stale);
  assert.equal(stalled.isLevel, false, "no state may claim the pose is fine from a reading that stopped arriving");
  assert.equal(stalled.roll, null);
  assert.equal(stalled.pitch, null);
  assert.doesNotMatch(stalled.message, /적합합니다/);
  assert.ok(READING_STALL_MS > 0);

  // Recovering re-serves the dwell time rather than snapping back to green.
  assert.equal(gate.reading({ roll: 0, pitch: 0, at: 5000 }).isLevel, false);
  assert.equal(gate.reading({ roll: 0, pitch: 0, at: 5000 + LEVEL_DWELL_MS }).isLevel, true);
});

test("smoothing damps a single outlier instead of following it", () => {
  const gate = createLevelGate();
  gate.reading({ roll: 0, pitch: 0, at: 0 });
  const jolted = gate.reading({ roll: 30, pitch: 0, at: 16 });
  assert.ok(Math.abs(jolted.roll) < 30, "the reported roll trails the raw sample");
  assert.ok(Math.abs(jolted.roll) > 0);
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
