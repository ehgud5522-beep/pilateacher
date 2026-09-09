import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { appendVoiceSessionDiagnostic } from "../../src/features/voice/voice-session.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

function memoryStorage() {
  const cells = new Map();
  return { getItem: (k) => (cells.has(k) ? cells.get(k) : null), setItem: (k, v) => cells.set(k, String(v)) };
}

test("the camera cannot restart while the photo picker is open", async () => {
  const source = await appSource();
  /* Opening the picker backgrounds the app, which stops the camera. Restarting
     the preview on top of the picker is what dropped the first selection, so
     the hold returns outright before anything else is weighed -- including the
     grant that lets an album return wake a paused preview. */
  const wake = source.indexOf('if (cameraStatus !== "idle" && !(albumReturn && cameraStatus === "paused")) return;');
  const hold = source.indexOf("if (albumPending) return;");
  const start = source.indexOf("void startCamera();");
  assert.ok(wake >= 0 && hold > wake && start > hold, "the hold sits between waking and starting");
  /* The guard has to be a dependency, or the effect never re-runs when it
     lifts. capturesComplete moved below this line -- it is now weighed against
     the one-shot album return -- but the picker guard still comes first and
     still returns outright. */
  assert.match(source, /\}, \[albumPending, albumReturn, busy, cameraStatus, capturesComplete, iosStableCaptureFallback, onAlbumReturnUsed, pendingCapture, startCamera\]\);/);
  assert.match(source, /albumPending=\{albumHold\}/, "the hold must reach the capture screen");
});

test("the hold is raised before the picker is opened", async () => {
  const source = await appSource();
  const start = source.indexOf("const openCapture = (targetView)");
  const body = source.slice(start, source.indexOf("albumRef.current?.click()", start));
  assert.ok(body.indexOf("albumPending.current = true;") >= 0, "the ref is raised");
  assert.ok(body.indexOf("setAlbumHold(true);") >= 0, "and mirrored into state so the effect sees it");
});

test("every way out of the picker releases the hold", async () => {
  const source = await appSource();

  // A file was chosen.
  assert.match(source, /releaseAlbumPending\(f \? "change_with_file" : "change_without_file"\)/);
  /* Dismissing the picker fires no change event at all, so returning to the
     app releases the hold too -- otherwise the camera would never come back. */
  assert.match(source, /if \(document\.visibilityState !== "visible" \|\| !albumPending\.current\) return;/);
  assert.match(source, /releaseAlbumPending\("resume_without_change"\)/);
  // A change arriving on resume wins the race by clearing that timer.
  assert.match(source, /const releaseAlbumPending = \(reason\) => \{\s*\r?\n\s*if \(albumReleaseTimer\.current\) window\.clearTimeout\(albumReleaseTimer\.current\);/);
  // And the timer never outlives the screen.
  assert.match(source, /return \(\) => \{\s*\r?\n\s*document\.removeEventListener\("visibilitychange", onVisible\);\s*\r?\n\s*if \(albumReleaseTimer\.current\) window\.clearTimeout\(albumReleaseTimer\.current\);/);
});

test("releasing twice is harmless", async () => {
  const source = await appSource();
  // The guard makes a second release a no-op rather than a duplicate log.
  assert.match(source, /if \(!albumPending\.current\) return;\s*\r?\n\s*albumPending\.current = false;/);
});

test("the change event says whether it arrived and what it carried", async () => {
  const source = await appSource();
  /* This is what separates "the event never fired" from "it fired and the
     handler rejected the file" -- the open question from the logcat trace. */
  assert.match(source, /cameraPipelineLog\("album_picker_change", \{/);
  assert.match(source, /state: f \? "file_received" : "no_file"/);
  assert.match(source, /bytes: f \? f\.size : 0/);
  assert.match(source, /cameraPipelineLog\("album_picker_opened", \{/);
  assert.match(source, /cameraPipelineLog\("album_picker_released", \{/);
});

test("every album stage actually reaches the device diagnostics", () => {
  // Unregistered stages are dropped by appendVoiceSessionDiagnostic, which is
  // the only sink the on-device screen reads.
  for (const stage of ["album_picker_opened", "album_picker_change", "album_picker_released", "album_picker_away"]) {
    const entry = appendVoiceSessionDiagnostic(stage, { source: "system_photo_picker", state: "opened" }, memoryStorage());
    assert.ok(entry, `${stage} is dropped before it reaches diagnostics`);
    assert.equal(entry.event, stage);
  }
});

test("the grace window is bounded and named", async () => {
  const source = await appSource();
  assert.match(source, /const ALBUM_RESUME_GRACE_MS = 1200;/);
  assert.match(source, /window\.setTimeout\(\(\) => releaseAlbumPending\("resume_without_change"\), ALBUM_RESUME_GRACE_MS\)/);
});

/* -------------- the hold releases even when no signal arrives ------------ */

/* The one signal the release used to have -- visibilitychange -- did not fire
   on this device when the photo picker covered the app, so the screen sat on
   "앨범에서 돌아오는 중" until the instructor went to the home screen and back.

   Adding a second signal does not prove a third will not go missing too, so
   the hold also watches the state directly. */

const holdWatch = async () => {
  const source = await appSource();
  const start = source.indexOf("if (!albumHold) return undefined;");
  return source.slice(start, source.indexOf("}, [albumHold]);", start));
};

test("the watch runs only while the album is held, and stops with it", async () => {
  const source = await appSource();
  const body = await holdWatch();
  assert.ok(body.length > 0, "the watch exists");
  assert.ok(source.includes("if (!albumHold) return undefined;"), "nothing runs when no album is open");
  assert.ok(source.includes("return () => window.clearInterval(timer);"), "and it is torn down with the hold");
  assert.match(source, /const ALBUM_HOLD_POLL_MS = 400;/);
});

test("a return only counts after the app has been seen to leave", async () => {
  /* Without this order the very first look -- taken before the picker has had
     time to cover the app -- reads as "we are back", releases the hold, and
     the preview comes up on top of the picker. That is the failure the hold
     was built to prevent. */
  const body = await holdWatch();
  const away = body.indexOf("sawAway = true;");
  const gate = body.indexOf("if (!sawAway) return;");
  const release = body.indexOf('releaseAlbumPending("foreground_poll");');
  assert.ok(away >= 0 && gate > away && release > gate, "leaving is recorded before returning is believed");
});

test("both leaving and returning are read from the state, not from an event", async () => {
  const body = await holdWatch();
  assert.ok(body.includes('const visible = document.visibilityState === "visible";'));
  assert.ok(body.includes('const focused = typeof document.hasFocus === "function" ? document.hasFocus() : true;'));
  assert.ok(body.includes("if (!visible || !focused) {"), "either signal losing is enough to count as away");
});

test("a browser with no focus reporting is not treated as permanently away", async () => {
  /* hasFocus is optional. Reading a missing one as false would leave the hold
     up for the whole shoot. */
  const body = await holdWatch();
  assert.ok(body.includes('typeof document.hasFocus === "function" ? document.hasFocus() : true'));
});

test("the extra signals arm the same grace, and cannot release twice", async () => {
  const source = await appSource();
  const listeners = source.slice(source.indexOf('const armRelease = (reason) => {'), source.indexOf("const openCapture = (targetView)"));
  assert.ok(listeners.includes("if (!albumPending.current) return;"), "an already released hold is left alone");
  assert.ok(listeners.includes("window.setTimeout(() => releaseAlbumPending(reason), ALBUM_RESUME_GRACE_MS)"), "the same grace as before");
  assert.ok(listeners.includes('window.addEventListener("focus", onFocus);'));
  assert.ok(listeners.includes('CapacitorApp.addListener("appStateChange"'));
  assert.ok(listeners.includes('window.removeEventListener("focus", onFocus);') && listeners.includes("appState?.remove?.();"), "both are taken down");
  // releaseAlbumPending itself is the single gate, and it is idempotent.
  const release = source.slice(source.indexOf("const releaseAlbumPending = (reason)"), source.indexOf("cameraPipelineLog(\"album_picker_released\""));
  assert.ok(release.includes("if (!albumPending.current) return;"));
  assert.ok(release.includes("albumPending.current = false;"));
});

test("how the hold was released is written down", async () => {
  /* Whether the signals ever arrive is the question this whole change came
     from. The reason has to say which one answered. */
  const source = await appSource();
  for (const reason of ["change_with_file", "change_without_file", "resume_without_change", "focus_without_change", "app_active_without_change", "foreground_poll"]) {
    assert.ok(source.includes(`"${reason}"`), `${reason} must be distinguishable in the diagnostics`);
  }
  assert.match(source, /cameraPipelineLog\("album_picker_released", \{[\s\S]*?state: "released", reason,/);
  assert.match(source, /cameraPipelineLog\("album_picker_away", \{[\s\S]*?state: "away", reason: visible \? "focus_lost" : "document_hidden",/);
});

test("the original visibility handler is left exactly as it was", async () => {
  const source = await appSource();
  assert.match(source, /const onVisible = \(\) => \{\s*\r?\n\s*if \(document\.visibilityState !== "visible" \|\| !albumPending\.current\) return;/);
  assert.match(source, /window\.setTimeout\(\(\) => releaseAlbumPending\("resume_without_change"\), ALBUM_RESUME_GRACE_MS\)/);
});
