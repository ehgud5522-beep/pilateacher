import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PREVIEW_BOUNDS_STATES, resolvePreviewBoundsAction } from "../../src/features/posture/posture-camera.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const { idle, pending, ready } = PREVIEW_BOUNDS_STATES;

/* ------------------ the crash: a call queued during a stop --------------- */

test("nothing touches the preview while it is stopping", () => {
  /* The plugin defers setPreviewSize onto the main looper, so a call made
     during a stop runs after the native view is destroyed and throws an NPE
     that kills the process. Every combination has to come back "skip". */
  for (const state of [idle, pending, ready]) {
    for (const previewing of [true, false]) {
      assert.equal(
        resolvePreviewBoundsAction({ previewing, stopping: true, state }),
        "skip",
        `stopping with previewing=${previewing} state=${state} must not call out`,
      );
    }
  }
});

test("the exact state stopCamera passes through cannot start a retry", () => {
  /* This was the crash: stopCamera flipped the readiness flag to false while
     cameraRunning was still true, and the retry branch read that as "bounds
     have not landed yet" and called setPreviewSize into a dying view. */
  assert.equal(resolvePreviewBoundsAction({ previewing: true, stopping: true, state: pending }), "skip");
  // Even if the stopping flag were missed, an idle state must not retry.
  assert.equal(resolvePreviewBoundsAction({ previewing: true, stopping: false, state: idle }), "skip");
});

test("a stopped preview is left alone", () => {
  for (const state of [idle, pending, ready]) {
    assert.equal(resolvePreviewBoundsAction({ previewing: false, stopping: false, state }), "skip");
  }
});

/* ---------------- the point of the retry, still intact ------------------- */

test("a running preview whose bounds never landed keeps retrying", () => {
  // An unmeasurable stage rect is the normal case the retry exists for.
  assert.equal(resolvePreviewBoundsAction({ previewing: true, stopping: false, state: pending }), "retry");
});

test("a placed preview re-syncs rather than retries", () => {
  assert.equal(resolvePreviewBoundsAction({ previewing: true, stopping: false, state: ready }), "resync");
});

test("the three states are distinct and exhaustive", () => {
  assert.deepEqual(Object.keys(PREVIEW_BOUNDS_STATES).sort(), ["idle", "pending", "ready"]);
  assert.equal(new Set([idle, pending, ready]).size, 3);
  const actions = new Set([
    resolvePreviewBoundsAction({ previewing: true, stopping: false, state: idle }),
    resolvePreviewBoundsAction({ previewing: true, stopping: false, state: pending }),
    resolvePreviewBoundsAction({ previewing: true, stopping: false, state: ready }),
  ]);
  assert.deepEqual([...actions].sort(), ["resync", "retry", "skip"]);
});

test("an unknown state is treated as nothing to do", () => {
  assert.equal(resolvePreviewBoundsAction({ previewing: true, stopping: false, state: "garbage" }), "skip");
  assert.equal(resolvePreviewBoundsAction(), "skip");
});

/* ------------------------ the wiring in the screen ---------------------- */

test("both the effect and syncPreviewBounds consult the same rule", async () => {
  const source = await appSource();

  // One rule, asked in both places, so a caller cannot bypass it.
  assert.match(source, /const previewBoundsAction = useCallback\(\(\) => resolvePreviewBoundsAction\(\{/);
  assert.match(source, /previewing: cameraRunning\.current,\s*\r?\n\s*stopping: cameraStopping\.current,/);
  assert.match(source, /if \(previewBoundsAction\(\) === "skip"\) return null;/, "syncPreviewBounds must bail early");
  assert.match(source, /const action = previewBoundsAction\(\);\s*\r?\n\s*if \(action === "skip"\) return undefined;/, "the effect must bail too");

  // And the native call carries its own guard as a last line of defence.
  assert.match(source, /if \(nativePreviewAvailable && cameraRunning\.current && !cameraStopping\.current\) \{/);
});

test("stopCamera closes the door before it awaits the native stop", async () => {
  const source = await appSource();
  const start = source.indexOf("const stopCamera = useCallback(async (reason");
  const body = source.slice(start, source.indexOf("}, [activeView, assessmentId, clearCountdown", start));

  const stopping = body.indexOf("cameraStopping.current = true;");
  const running = body.indexOf("cameraRunning.current = false;");
  const await_ = body.indexOf("await CameraPreview.stop(");
  assert.ok(stopping >= 0 && running >= 0 && await_ >= 0, "stopCamera is not shaped as expected");
  assert.ok(stopping < await_, "the stopping flag must be set before the await");
  assert.ok(running < await_, "cameraRunning must be cleared before the await, not after");

  // The flag is only released once the teardown is done.
  const released = body.indexOf("cameraStopping.current = false;");
  assert.ok(released > await_, "the stopping flag must outlive the native stop");
});

test("the shutter stays disabled unless the bounds are actually placed", async () => {
  const source = await appSource();
  // "not idle" would let a stopping preview through; it has to be "ready".
  assert.match(source, /previewBoundsState !== PREVIEW_BOUNDS_STATES\.ready/);
  assert.match(source, /previewBoundsStateRef\.current !== PREVIEW_BOUNDS_STATES\.ready/);
});
