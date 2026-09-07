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
  /* Opening the picker backgrounds the app, which stops the camera and leaves
     cameraStatus "idle" -- the auto-start condition. Restarting the preview on
     top of the picker is what dropped the first selection. */
  assert.match(source, /if \(iosStableCaptureFallback \|\| capturesComplete \|\| pendingCapture \|\| cameraStatus !== "idle"\) return;\s*\r?\n\s*\/\/[^\r\n]*\r?\n\s*if \(albumPending\) return;/);
  // The guard has to be a dependency, or the effect never re-runs when it lifts.
  assert.match(source, /\}, \[albumPending, cameraStatus, capturesComplete, iosStableCaptureFallback, pendingCapture, startCamera\]\);/);
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

test("the three album stages actually reach the device diagnostics", () => {
  // Unregistered stages are dropped by appendVoiceSessionDiagnostic, which is
  // the only sink the on-device screen reads.
  for (const stage of ["album_picker_opened", "album_picker_change", "album_picker_released"]) {
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
