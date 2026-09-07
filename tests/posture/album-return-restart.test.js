import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const captureScreen = async () => {
  const source = await appSource();
  const start = source.indexOf("function PostureCaptureScreen(");
  return source.slice(start, source.indexOf("\nfunction ", start + 50));
};

/* The auto-start rule, lifted from App.jsx. It answers one question: with the
   screen in this state, should the preview come back on its own?

   Returns "start" (and consumes the one-shot grant), or the reason it did not. */
function autoStart({
  iosStableCaptureFallback = false, pendingCapture = false, cameraStatus = "idle",
  albumPending = false, capturesComplete = false, albumReturn = false,
} = {}) {
  if (iosStableCaptureFallback || pendingCapture || cameraStatus !== "idle") return { action: "skip", reason: "not idle" };
  if (albumPending) return { action: "skip", reason: "picker open" };
  if (capturesComplete && !albumReturn) return { action: "skip", reason: "shoot finished" };
  return { action: "start", consumed: albumReturn };
}

/* The grant itself: raised on release, and only when no file came back. */
const grantOnRelease = (reason) => reason !== "change_with_file";

/* ------------- 1. cancelling brings the camera back ---------------------- */

test("cancelling the picker after a finished shoot restarts the preview", () => {
  /* Without the grant this is the case that stranded the instructor on the
     completion screen: capturesComplete blocks the restart outright. */
  const state = { capturesComplete: true, cameraStatus: "idle", albumReturn: grantOnRelease("resume_without_change") };
  assert.equal(autoStart(state).action, "start");
});

test("a change event that carried no file counts as a cancel", () => {
  // Some pickers fire change with an empty list instead of firing nothing.
  assert.equal(grantOnRelease("change_without_file"), true);
  assert.equal(autoStart({ capturesComplete: true, albumReturn: true }).action, "start");
});

/* --------------- 2. choosing a photo must NOT restart -------------------- */

test("choosing a photo does not bring the preview back", () => {
  /* Asked directly: after a selection the screen moves to the next direction
     or finishes, and a preview coming up there is in the way. */
  assert.equal(grantOnRelease("change_with_file"), false);
  const state = { capturesComplete: true, cameraStatus: "idle", albumReturn: false };
  assert.equal(autoStart(state).action, "skip");
  assert.equal(autoStart(state).reason, "shoot finished");
});

test("an unfinished shoot still restarts after a selection, as it always did", () => {
  /* This is the existing behaviour for the middle of a shoot -- the next
     direction needs its preview -- and the grant does not change it. */
  assert.equal(autoStart({ capturesComplete: false, albumReturn: false }).action, "start");
});

/* ------------------ 3. when the grant is spent --------------------------- */

test("the grant is consumed by the attempt that uses it", () => {
  const first = autoStart({ capturesComplete: true, albumReturn: true });
  assert.equal(first.action, "start");
  assert.equal(first.consumed, true, "spent at the moment the start is attempted");
  // With it spent, the very next evaluation falls back to the normal rule.
  assert.equal(autoStart({ capturesComplete: true, albumReturn: false }).action, "skip");
});

test("a cancel before the shoot is finished does not leave a grant behind", () => {
  /* The dangerous shape: cancel early, grant stays true, and much later the
     finished shoot restarts the camera on its own. The grant is spent by the
     next start whatever triggered it, and mid-shoot there is always one. */
  const midShoot = autoStart({ capturesComplete: false, albumReturn: true });
  assert.equal(midShoot.action, "start");
  assert.equal(midShoot.consumed, true, "spent even though capturesComplete did not need it");
});

test("opening the album again clears any grant first", async () => {
  const source = await appSource();
  const start = source.indexOf("const openCapture = (targetView)");
  const body = source.slice(start, source.indexOf("albumRef.current?.click()", start));
  assert.match(body, /setAlbumReturn\(false\);/, "a new round trip invalidates the previous one");
});

/* ---------------- the guards that must not have moved ------------------- */

test("an open picker still outranks the grant", () => {
  // Restarting the preview on top of the picker is what lost the first
  // selection in the first place; that guard comes first and stays first.
  assert.equal(autoStart({ albumPending: true, albumReturn: true }).action, "skip");
  assert.equal(autoStart({ albumPending: true, albumReturn: true, capturesComplete: true }).reason, "picker open");
});

test("a photo awaiting confirmation and a non-idle camera still block", () => {
  assert.equal(autoStart({ pendingCapture: true, albumReturn: true }).action, "skip");
  for (const cameraStatus of ["active", "starting", "capturing", "paused", "error", "confirming"]) {
    assert.equal(autoStart({ cameraStatus, albumReturn: true }).action, "skip", `${cameraStatus} must not auto-start`);
  }
});

test("the iOS fallback never auto-starts a preview", () => {
  assert.equal(autoStart({ iosStableCaptureFallback: true, albumReturn: true }).action, "skip");
});

/* ------------------------------ the wiring ------------------------------ */

test("the screen's rule is the rule tested here, in this order", async () => {
  const screen = await captureScreen();
  const effect = screen.slice(screen.indexOf("if (iosStableCaptureFallback || pendingCapture || cameraStatus !== \"idle\") return;"));
  const body = effect.slice(0, effect.indexOf("void startCamera();") + 20);

  assert.ok(body.indexOf("if (albumPending) return;") >= 0, "the picker guard survives");
  assert.ok(body.indexOf("if (capturesComplete && !albumReturn) return;") > body.indexOf("if (albumPending) return;"));
  const consumeAt = body.indexOf("if (albumReturn) onAlbumReturnUsed?.();");
  const startAt = body.indexOf("void startCamera();");
  /* Spending it before rather than after startCamera is what stops a camera
     that fails to open from being retried on every render for the rest of the
     session: one grant, one attempt, win or lose. */
  assert.ok(consumeAt >= 0 && consumeAt < startAt, "the grant is spent before the start, not after");
  // And the effect can actually see it change.
  assert.match(screen, /\}, \[albumPending, albumReturn, cameraStatus, capturesComplete, iosStableCaptureFallback, onAlbumReturnUsed, pendingCapture, startCamera\]\);/);
});

test("the grant is raised only when no file came back", async () => {
  const source = await appSource();
  assert.match(source, /setAlbumReturn\(reason !== "change_with_file"\);/);
  // It is raised in the one place that knows how the picker ended.
  const release = source.slice(source.indexOf("const releaseAlbumPending = (reason)"), source.indexOf("const openCapture = (targetView)"));
  assert.match(release, /setAlbumReturn\(reason !== "change_with_file"\);/);
});

test("the consumer has a stable identity", async () => {
  const source = await appSource();
  /* It is a dependency of the auto-start effect. A new arrow each render would
     re-run that effect every render and hammer startCamera. */
  assert.match(source, /const consumeAlbumReturn = useCallback\(\(\) => setAlbumReturn\(false\), \[\]\);/);
  assert.match(source, /onAlbumReturnUsed=\{consumeAlbumReturn\}/);
  assert.doesNotMatch(source, /onAlbumReturnUsed=\{\(\) =>/);
});

test("both new props reach the capture screen", async () => {
  const source = await appSource();
  assert.match(source, /albumReturn=\{albumReturn\}/);
  const screen = await captureScreen();
  assert.match(screen, /albumPending = false, albumReturn = false, onAlbumReturnUsed, onSelectView,/);
});
