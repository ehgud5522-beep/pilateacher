import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const captureScreen = async () => {
  const source = await appSource();
  const start = source.indexOf("function PostureCaptureScreen(");
  return source.slice(start, source.indexOf("\nfunction ", start + 50));
};

/* The label the capture screen shows while a photo is in transit. Lifted from
   App.jsx so the three cases can be exercised as behaviour rather than matched
   as text; the wiring tests below hold the copy in sync. */
const transferLabel = ({ albumPending = false, busyKind = null, cameraStatus = "idle" } = {}) =>
  albumPending ? "앨범에서 돌아오는 중"
    : busyKind === "album" ? "사진 불러오는 중"
      : cameraStatus === "capturing" ? "사진 저장 중"
        : busyKind === "draft" ? "저장 중"
          : null;

/* ------------------ the two paths say different things ------------------ */

test("the album path names the album", () => {
  // Returning from the picker, before its change event has arrived.
  assert.equal(transferLabel({ albumPending: true, cameraStatus: "idle" }), "앨범에서 돌아오는 중");
  // The chosen file is being decoded, resized and written to the draft.
  assert.equal(transferLabel({ busyKind: "album", cameraStatus: "idle" }), "사진 불러오는 중");
});

test("the shutter path names the save", () => {
  assert.equal(transferLabel({ cameraStatus: "capturing" }), "사진 저장 중");
});

test("neither path can borrow the other's wording", () => {
  /* This is the whole point of busyKind: busy alone is raised by three
     different jobs and cannot tell them apart. */
  assert.notEqual(transferLabel({ busyKind: "album" }), transferLabel({ cameraStatus: "capturing" }));
  assert.notEqual(transferLabel({ albumPending: true }), transferLabel({ busyKind: "album" }));
});

test("the draft save has a word of its own", () => {
  /* saveCaptureDraft raises the same busy flag as the import. Labelling it
     "사진 불러오는 중" would tell the instructor something that is not
     happening; leaving it silent repeats the defect on a third path. */
  assert.equal(transferLabel({ busyKind: "draft", cameraStatus: "idle" }), "저장 중");
  assert.equal(transferLabel({ busyKind: "draft", cameraStatus: "active" }), "저장 중", "retrying a draft happens with the camera still running");
  assert.notEqual(transferLabel({ busyKind: "draft" }), transferLabel({ busyKind: "album" }));
  assert.notEqual(transferLabel({ busyKind: "draft" }), transferLabel({ cameraStatus: "capturing" }));
});

test("saving a confirmed photo is not mistaken for an album import", () => {
  assert.equal(transferLabel({ busyKind: "photo", cameraStatus: "idle" }), null);
});

test("a settled screen shows nothing", () => {
  for (const cameraStatus of ["idle", "active", "starting", "error", "paused", "confirming"]) {
    assert.equal(transferLabel({ cameraStatus }), null, `${cameraStatus} is not a transfer`);
  }
});

/* ----------------------- no gap between the phases ---------------------- */

test("the album hold outranks the import it hands over to", () => {
  /* If both were somehow true at once the older phase wins, so the label can
     never run backwards from "불러오는 중" to "돌아오는 중". */
  assert.equal(transferLabel({ albumPending: true, busyKind: "album" }), "앨범에서 돌아오는 중");
});

test("the hand-off happens inside one event handler", async () => {
  const source = await appSource();
  /* Releasing the hold and starting the import are both in the file input's
     change handler, so React commits them in a single render -- the overlay
     never blinks off between the two phases. */
  const change = source.indexOf("cameraPipelineLog(\"album_picker_change\"");
  const start = source.lastIndexOf("<input ref={albumRef}", change);
  const handler = source.slice(start, source.indexOf("}} />", change));
  const release = handler.indexOf("releaseAlbumPending(");
  const importAt = handler.indexOf("pickFile(f)");
  assert.ok(release >= 0 && importAt > release, "release then import, in that order, in one handler");
});

test("the photo is staged before the overlay lifts", async () => {
  const source = await appSource();
  const start = source.indexOf("const acceptCaptureBlob = async (input");
  const body = source.slice(start, source.indexOf("const pickFile = async (file)", start));
  /* busy is cleared in finally, after the capture has been put into state, so
     the overlay hands over to the photo rather than to an empty frame. */
  assert.ok(body.indexOf("setCapturePhotos((previous)") < body.indexOf("finally { setBusy(false); setBusyKind(null); }"));
});

/* ------------------------------ the wiring ------------------------------ */

test("the screen derives the label from the four states", async () => {
  const screen = await captureScreen();
  assert.match(screen, /const transferLabel = albumPending \? "앨범에서 돌아오는 중"\s*\r?\n\s*: busyKind === "album" \? "사진 불러오는 중"\s*\r?\n\s*: cameraStatus === "capturing" \? "사진 저장 중"\s*\r?\n\s*: busyKind === "draft" \? "저장 중"\s*\r?\n\s*: null;/);
  assert.match(screen, /draftSaved, busy, busyKind = null,/, "the kind has to reach the screen");
});

test("every job that raises busy declares what it is", async () => {
  const source = await appSource();
  // An unlabelled busy would fall through to the wrong branch or to silence.
  assert.match(source, /setBusy\(true\); setBusyKind\(metadata\.source === "system_photo_picker" \? "album" : "photo"\); setPts\(null\);/);
  assert.match(source, /setBusy\(true\); setBusyKind\("draft"\);/);
  // And every one of them clears it again.
  assert.equal((source.match(/finally \{ setBusy\(false\); setBusyKind\(null\); \}/g) || []).length, 2);
  assert.match(source, /busyKind=\{busyKind\}/, "and it is passed down");
});

test("the transfer overlay reuses the camera overlay, not a new one", async () => {
  const screen = await captureScreen();
  /* One block, one spinner. A second loading surface would drift from this one
     the first time either is touched. */
  assert.equal((screen.match(/absolute inset-0 flex flex-col items-center justify-center gap-3 bg-\[#0D1016\]\/88/g) || []).length, 1);
  assert.match(screen, /\{\(transferLabel \|\| iosStableCaptureFallback \|\| \["starting", "error", "paused"\]\.includes\(cameraStatus\)\) && !pendingCapture && \(transferLabel \|\| !captureCompleteIdle\) && \(/);
  assert.match(screen, /\{transferLabel \|\| cameraStatus === "starting" \? <Loader2 size=\{30\} className="animate-spin" \/>/);
});

test("a running job is not hidden by the completion panel", async () => {
  const screen = await captureScreen();
  /* Importing the last photo, and the draft save behind "다음 분석 단계", both
     happen once capturesComplete is already true. Gated on !captureCompleteIdle
     alone, those two waits would pass in silence -- the same defect, one screen
     further along. */
  assert.match(screen, /&& \(transferLabel \|\| !captureCompleteIdle\) &&/);
  // The completion panel itself is untouched and still wins when nothing runs.
  assert.match(screen, /\{captureCompleteIdle && <div className="absolute inset-0[^"]*" *>?/);
  assert.match(screen, /촬영이 완료되었습니다/);
});

test("a transfer offers no button to press", async () => {
  const screen = await captureScreen();
  /* "다시 시도" during an import invites a second import on top of the first,
     and there is nothing to retry yet. */
  assert.match(screen, /\{!transferLabel && cameraStatus !== "starting" && \(iosStableCaptureFallback/);
  // The camera's own error text is suppressed too: it belongs to a past failure.
  assert.match(screen, /\{!transferLabel && \(iosStableCaptureFallback \|\| cameraError\)/);
});

test("the buttons behind the overlay are already disabled", async () => {
  const screen = await captureScreen();
  // The overlay explains the disabling that was already happening silently.
  for (const control of ["앨범", "즉시"]) {
    assert.ok(screen.includes(control), `${control} control must exist`);
  }
  assert.match(screen, /disabled=\{countdown != null \|\| busy\}/);
  assert.match(screen, /disabled=\{cameraStatus !== "active" \|\|[^}]*\|\| busy\}/);
});

test("the failure message still has somewhere to land", async () => {
  const screen = await captureScreen();
  // Item 22 asked for failures to be visible; the footer line already is.
  assert.match(screen, /\{\(cameraError \|\| captureImportError\) && <p className="mb-2 rounded-lg/);
});
