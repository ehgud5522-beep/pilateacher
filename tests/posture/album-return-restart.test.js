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
  albumPending = false, busy = false, capturesComplete = false, albumReturn = false,
} = {}) {
  if (iosStableCaptureFallback || pendingCapture) return { action: "skip", reason: "not ready" };
  if (cameraStatus !== "idle" && !(albumReturn && cameraStatus === "paused")) return { action: "skip", reason: "not idle" };
  if (albumPending) return { action: "skip", reason: "picker open" };
  if (busy) return { action: "skip", reason: "import running" };
  if (capturesComplete && !albumReturn) return { action: "skip", reason: "shoot finished" };
  return { action: "start", consumed: albumReturn };
}

/* The grant: raised whenever the round trip to the album ends, however it
   ended. */
const grantOnRelease = () => true;

/* ------------- 1. cancelling brings the camera back ---------------------- */

test("cancelling the picker after a finished shoot restarts the preview", () => {
  /* Without the grant this is the case that stranded the instructor on the
     completion screen: capturesComplete blocks the restart outright. */
  assert.equal(autoStart({ capturesComplete: true, albumReturn: grantOnRelease("resume_without_change") }).action, "start");
});

test("a change event that carried no file counts as a cancel", () => {
  // Some pickers fire change with an empty list instead of firing nothing.
  assert.equal(grantOnRelease("change_without_file"), true);
  assert.equal(autoStart({ capturesComplete: true, albumReturn: true }).action, "start");
});

/* ------------- 2. choosing a photo also brings it back ------------------- */

test("choosing a photo brings the preview back once the import has landed", () => {
  /* Opening the album puts the app in the background, which parks the preview
     on "paused". Leaving it there made the instructor press 다시 시도 before
     the next direction could be shot. */
  assert.equal(grantOnRelease("change_with_file"), true);
  assert.equal(autoStart({ cameraStatus: "paused", albumReturn: true }).action, "start");
});

test("the preview waits while the chosen photo is being read", () => {
  /* Starting on top of the import is what loses the picker's result. The
     import raises busy in the same event that releases the album hold, so
     there is no gap between the two where a restart could slip through. */
  const duringImport = autoStart({ cameraStatus: "paused", albumReturn: true, busy: true });
  assert.equal(duringImport.action, "skip");
  assert.equal(duringImport.reason, "import running");
  assert.equal(duringImport.consumed, undefined, "and the grant is still unspent");
  // busy falls in the import's finally, whether it succeeded or failed.
  assert.equal(autoStart({ cameraStatus: "paused", albumReturn: true, busy: false }).action, "start");
});

test("an unfinished shoot still restarts after a selection, as it always did", () => {
  assert.equal(autoStart({ capturesComplete: false, albumReturn: false }).action, "start");
});

/* ------------- 3. a plain background return stays paused ----------------- */

test("coming back from the home screen leaves the preview stopped", () => {
  /* This is the line the fix must not cross. Nothing granted a restart, so the
     paused screen and its instruction stay exactly as they were. */
  const home = autoStart({ cameraStatus: "paused", albumReturn: false });
  assert.equal(home.action, "skip");
  assert.equal(home.reason, "not idle");
  assert.equal(autoStart({ cameraStatus: "paused", albumReturn: false, capturesComplete: true }).action, "skip");
});

test("paused is woken only by the album, and only that once", () => {
  const woken = autoStart({ cameraStatus: "paused", albumReturn: true });
  assert.equal(woken.action, "start");
  assert.equal(woken.consumed, true);
  // Spent: the same paused screen no longer wakes itself.
  assert.equal(autoStart({ cameraStatus: "paused", albumReturn: false }).action, "skip");
});

test("no other stopped state is woken, grant or not", () => {
  for (const cameraStatus of ["active", "starting", "capturing", "error", "confirming"]) {
    assert.equal(autoStart({ cameraStatus, albumReturn: true }).action, "skip", `${cameraStatus} must not auto-start`);
    assert.equal(autoStart({ cameraStatus, albumReturn: false }).action, "skip");
  }
});

/* ------------------ 4. when the grant is spent --------------------------- */

test("the grant is consumed by the attempt that uses it", () => {
  const first = autoStart({ capturesComplete: true, albumReturn: true });
  assert.equal(first.action, "start");
  assert.equal(first.consumed, true, "spent at the moment the start is attempted");
  assert.equal(autoStart({ capturesComplete: true, albumReturn: false }).action, "skip");
});

test("a cancel before the shoot is finished does not leave a grant behind", () => {
  /* The dangerous shape: cancel early, grant stays true, and much later a
     plain background return wakes the camera on its own. The grant is spent by
     the next start whatever triggered it, and mid-shoot there is always one. */
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
  assert.equal(autoStart({ albumPending: true, albumReturn: true, cameraStatus: "paused" }).reason, "picker open");
});

test("a photo awaiting confirmation still blocks", () => {
  assert.equal(autoStart({ pendingCapture: true, albumReturn: true }).action, "skip");
  assert.equal(autoStart({ pendingCapture: true, albumReturn: true, cameraStatus: "paused" }).action, "skip");
});

test("the iOS fallback never auto-starts a preview", () => {
  assert.equal(autoStart({ iosStableCaptureFallback: true, albumReturn: true }).action, "skip");
  assert.equal(autoStart({ iosStableCaptureFallback: true, albumReturn: true, cameraStatus: "paused" }).action, "skip");
});

/* ------------------------------ the wiring ------------------------------ */

test("the screen's rule is the rule tested here, in this order", async () => {
  const screen = await captureScreen();
  const effect = screen.slice(screen.indexOf("if (iosStableCaptureFallback || pendingCapture) return;"));
  const body = effect.slice(0, effect.indexOf("void startCamera();") + 20);

  const wake = body.indexOf('if (cameraStatus !== "idle" && !(albumReturn && cameraStatus === "paused")) return;');
  const picker = body.indexOf("if (albumPending) return;");
  const importing = body.indexOf("if (busy) return;");
  const finished = body.indexOf("if (capturesComplete && !albumReturn) return;");
  const consumeAt = body.indexOf("if (albumReturn) onAlbumReturnUsed?.();");
  const startAt = body.indexOf("void startCamera();");

  assert.ok(wake >= 0, "paused is woken only with the grant");
  assert.ok(picker > wake, "the picker guard survives, and still comes before the rest");
  assert.ok(importing > picker, "and the import guard sits with it");
  assert.ok(finished > importing);
  /* Spending it before rather than after startCamera is what stops a camera
     that fails to open from being retried on every render for the rest of the
     session: one grant, one attempt, win or lose. */
  assert.ok(consumeAt >= 0 && consumeAt < startAt, "the grant is spent before the start, not after");
  // And the effect can actually see everything it reads change.
  assert.match(screen, /\}, \[albumPending, albumReturn, busy, cameraStatus, capturesComplete, iosStableCaptureFallback, onAlbumReturnUsed, pendingCapture, startCamera\]\);/);
});

test("the grant is raised wherever the round trip ends", async () => {
  const source = await appSource();
  const release = source.slice(source.indexOf("const releaseAlbumPending = (reason)"), source.indexOf("const openCapture = (targetView)"));
  assert.match(release, /setAlbumReturn\(true\);/);
  assert.doesNotMatch(release.replace(/\/\*[\s\S]*?\*\//g, ""), /reason !== "change_with_file"/, "a chosen photo is a return like any other");
});

test("busy is the import's own signal, not a guess at how long it takes", async () => {
  /* A timer here would be a guess. busy is raised at the top of the import and
     dropped in its finally, so it answers the question exactly. */
  const source = await appSource();
  const accept = source.slice(source.indexOf("const acceptCaptureBlob = async"), source.indexOf("const pickFile = async"));
  assert.match(accept, /setBusy\(true\); setBusyKind\(/, "raised as the import begins");
  assert.match(accept, /finally \{ setBusy\(false\); setBusyKind\(null\); \}/, "and dropped however it ends");
  const screen = await captureScreen();
  const effect = screen.slice(screen.indexOf("if (iosStableCaptureFallback || pendingCapture) return;"), screen.indexOf("void startCamera();"));
  assert.doesNotMatch(effect, /setTimeout/);
});

test("the release and the import start in the same breath", async () => {
  /* If the release rendered before the import raised busy, the restart would
     slip into that gap and take the picker's result with it. They are two
     statements of one event handler, so React shows them together. */
  const source = await appSource();
  assert.match(source, /releaseAlbumPending\(f \? "change_with_file" : "change_without_file"\);\r?\n\s*if \(f\) pickFile\(f\);/);
});

test("the consumer has a stable identity", async () => {
  const source = await appSource();
  /* It is a dependency of the auto-start effect. A new arrow each render would
     re-run that effect every render and hammer startCamera. */
  assert.match(source, /const consumeAlbumReturn = useCallback\(\(\) => setAlbumReturn\(false\), \[\]\);/);
  assert.match(source, /onAlbumReturnUsed=\{consumeAlbumReturn\}/);
  assert.doesNotMatch(source, /onAlbumReturnUsed=\{\(\) =>/);
});

test("both props reach the capture screen", async () => {
  const source = await appSource();
  assert.match(source, /albumReturn=\{albumReturn\}/);
  const screen = await captureScreen();
  assert.match(screen, /albumPending = false, albumReturn = false, onAlbumReturnUsed, onSelectView,/);
});
