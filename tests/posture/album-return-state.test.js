import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const captureScreen = async () => {
  const source = await appSource();
  const start = source.indexOf("function PostureCaptureScreen(");
  return source.slice(start, source.indexOf("\nfunction ", start + 50));
};

/* Lifted from App.jsx. The capture screen calls itself "finished" here, and
   the footer swaps its whole control set on the answer. */
const captureCompleteIdle = ({ capturesComplete = false, pendingCapture = false, albumPending = false, cameraStatus = "idle" } = {}) =>
  capturesComplete && !pendingCapture && !albumPending && !["active", "capturing", "starting"].includes(cameraStatus);

/* 20. Every photo is taken; the instructor taps 다시 촬영, which starts the
   camera, then taps 앨범, which stops it again to open the picker. */
const reshooting = { capturesComplete: true, cameraStatus: "active" };

test("a stopped camera alone no longer means the shoot is over", () => {
  /* Opening the album stops the preview. That is a step in the middle of a
     task, not the end of one. */
  assert.equal(captureCompleteIdle({ ...reshooting, cameraStatus: "idle", albumPending: true }), false);
});

test("the footer does not swap under an open picker", () => {
  // Before: idle + complete flipped the footer to 다음 분석 단계 / 다시 촬영,
  // so cancelling the picker landed the instructor on a retake button.
  const beforeTap = captureCompleteIdle(reshooting);
  const whilePicking = captureCompleteIdle({ ...reshooting, cameraStatus: "idle", albumPending: true });
  assert.equal(beforeTap, whilePicking, "the same controls stay on screen across the tap");
});

test("a genuinely finished shoot still reads as finished", () => {
  // The completion state has to survive: this is the resting state after the
  // last photo is confirmed.
  assert.equal(captureCompleteIdle({ capturesComplete: true, cameraStatus: "idle" }), true);
  assert.equal(captureCompleteIdle({ capturesComplete: true, cameraStatus: "paused" }), true);
  assert.equal(captureCompleteIdle({ capturesComplete: true, cameraStatus: "error" }), true);
});

test("an unfinished shoot is never called finished", () => {
  for (const cameraStatus of ["idle", "active", "paused", "error"]) {
    assert.equal(captureCompleteIdle({ capturesComplete: false, cameraStatus, albumPending: true }), false);
    assert.equal(captureCompleteIdle({ capturesComplete: false, cameraStatus }), false);
  }
});

test("a live or starting camera is never a finished shoot", () => {
  for (const cameraStatus of ["active", "capturing", "starting"]) {
    assert.equal(captureCompleteIdle({ capturesComplete: true, cameraStatus }), false);
  }
});

test("a photo waiting for confirmation outranks completion", () => {
  assert.equal(captureCompleteIdle({ capturesComplete: true, pendingCapture: true, cameraStatus: "idle" }), false);
});

/* ------------------------------ the wiring ------------------------------ */

test("the screen computes completion the same way", async () => {
  const screen = await captureScreen();
  assert.match(screen, /const captureCompleteIdle = capturesComplete && !pendingCapture && !albumPending && !\["active", "capturing", "starting"\]\.includes\(cameraStatus\);/);
});

test("the footer's retake branch is the one that was appearing early", async () => {
  const screen = await captureScreen();
  /* This is the "재촬영하기" from the report: it belongs to the finished
     state and to nothing else. */
  assert.match(screen, /\) : captureCompleteIdle \? \(/);
  assert.match(screen, /\{postureViewLabel\(activeView\)\} 다시 촬영<\/button>/);
  // And the album button lives in the branch after it, so the two never swap
  // while the picker is open.
  const retake = screen.indexOf("다시 촬영</button>");
  const album = screen.indexOf(">앨범</button>");
  assert.ok(retake >= 0 && album > retake, "album button sits in the later branch");
});
