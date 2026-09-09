import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const withoutComments = (source) => String(source)
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/* A direction's photo and the reading taken from it are stored apart, with no
   id joining them. Swap the photo and the old reading stays behind, so the
   record ends up showing one photograph next to numbers measured on another.

   Nothing later can tell the two apart, so the moment of the swap is the only
   place that knows. These tests hold that moment. */

const between = (source, from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `missing: ${from}`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `missing: ${to}`);
  return source.slice(start, end);
};

/* ------------------------- every way a photo arrives --------------------- */

test("every photo that arrives for a direction goes through one door", async () => {
  /* Shutter, album, re-shoot, the iOS fallback -- if any of them had its own
     path, the invalidation would have to be repeated there and would be
     forgotten. */
  const source = withoutComments(await appSource());
  assert.equal((source.match(/const acceptCaptureBlob = async/g) || []).length, 1);
  assert.ok(source.includes("onAcceptCapture={(blob, metadata) => acceptCaptureBlob(blob, { ...metadata, preserveResolution: true })}"), "the shutter");
  assert.ok(source.includes("const pickFile = async (file) => acceptCaptureBlob(file, {"), "the album and the file picker");
});

test("a photo swap and a photo deletion both end that direction's analysis", async () => {
  const source = withoutComments(await appSource());
  const swap = between(source, "const acceptCaptureBlob = async", "const pickFile = async");
  assert.ok(swap.includes("await forgetAnalysisForView(capturedView);"), "the swap");
  const remove = between(source, "const deleteCurrentCapture = async", "const beginDrawing = async");
  assert.ok(remove.includes("await forgetAnalysisForView(key);"), "the deletion");
});

test("the swap only counts once the new photo is actually stored", async () => {
  /* A draft that failed to save leaves the old photo in place, and its reading
     with it. Throwing the analysis away then would lose work for nothing. */
  const source = withoutComments(await appSource());
  const swap = between(source, "const acceptCaptureBlob = async", "const pickFile = async");
  const saved = swap.indexOf('setDraftSaved((previous) => ({ ...previous, [capturedView]: true }));');
  const forgot = swap.indexOf("await forgetAnalysisForView(capturedView);");
  assert.ok(saved >= 0 && forgot > saved, "it comes after the draft is confirmed saved");
});

/* --------------------------- what it throws away ------------------------- */

test("only the direction whose photo changed is affected", async () => {
  const source = withoutComments(await appSource());
  const step = between(source, "const forgetAnalysisForView = async (view)", "const acceptCaptureBlob = async");
  assert.ok(step.includes("delete next[view];"), "one key leaves the analysed set");
  assert.ok(!step.includes("setAnalyzedViews({})"), "the others are left alone");
  assert.ok(step.includes("await onDiscardPose?.(assessmentId.current, view);"), "and one direction's reading is discarded");
});

test("the reading discarded is the one for that direction, and nothing else", async () => {
  const source = withoutComments(await appSource());
  const handler = between(source, "const discardPoseForView = async", "const deleteCaptureDraft = async");
  assert.ok(handler.includes("const poseId = `${assessmentId}_${view}_pose`;"));
  assert.ok(handler.includes("(cur.poses || []).filter((pose) => pose?.id !== poseId)"), "every other pose survives");
  assert.ok(!handler.includes("_draw"), "a hand-drawn record is rebuilt from the photo's own marks, so it is left alone");
});

test("the pictures behind a discarded reading are released", async () => {
  /* The pose keeps its own copies in IndexedDB. Dropping the record without
     them leaves files nothing points at. */
  const source = withoutComments(await appSource());
  const handler = between(source, "const discardPoseForView = async", "const deleteCaptureDraft = async");
  assert.ok(handler.includes("forgetBlobs(gone.flatMap((pose) => [pose.blobId, pose.cleanBlobId, pose.thumbnailBlobId]).filter(Boolean));"));
});

test("nothing is written when there was no reading to discard", async () => {
  const source = withoutComments(await appSource());
  const handler = between(source, "const discardPoseForView = async", "const deleteCaptureDraft = async");
  assert.ok(handler.includes("if (!gone.length) return true;"), "a first shoot does not rewrite the store");
});

test("the discard reads the store, not the screen", async () => {
  /* The capture draft was written a moment earlier. Reading React state here
     would hand back the version from before that write and undo it. */
  const source = withoutComments(await appSource());
  const handler = between(source, "const discardPoseForView = async", "const deleteCaptureDraft = async");
  assert.ok(handler.includes("const currentPhotos = photosRef.current;"));
  assert.ok(!handler.includes("photos[target.id] || {};\n    const gone"), "not the rendered copy");
});

/* -------------------------- and it survives a resume --------------------- */

test("resuming a draft still reads the analysed set off the stored readings", async () => {
  /* This is what makes the fix hold. The discarded reading is gone from the
     store, so coming back later the direction is unanalysed again -- without
     this line having to judge anything about photographs. */
  const source = withoutComments(await appSource());
  assert.ok(source.includes("const completed = Object.fromEntries(saved.filter((pose) => pose.assessmentId === resumeDraft.id).map((pose) => [normalizePostureView(pose.view), true]));"));
  assert.ok(source.includes("setAnalyzedViews(completed);"));
});

test("a record cannot complete while a direction is waiting to be re-read", async () => {
  /* Completion is counted from the analysed set, so a swapped photo drops the
     record back to in-progress instead of finishing with a stale number. */
  const source = withoutComments(await appSource());
  assert.ok(source.includes('assessmentStatus: captureViews.every(({ key }) => !!nextAnalyzed[key]) ? "completed" : "analyzing"'));
  assert.ok(source.includes("assessmentComplete: captureViews.every(({ key }) => !!nextAnalyzed[key])"));
});

test("the next step walks to the direction that lost its reading", async () => {
  const source = withoutComments(await appSource());
  assert.ok(source.includes("beginCapturedAnalysis(captureViews.find(({ key }) => !analyzedViews[key])?.key"));
});

/* ------------------------------- the wiring ------------------------------ */

test("the screen that people actually use is the one wired up", async () => {
  /* Two other hosts for the capture screen exist in the file and neither is
     rendered; wiring them would only look like coverage. */
  const source = withoutComments(await appSource());
  assert.equal((source.match(/<LegacyAssessmentWorkspace/g) || []).length, 0);
  assert.equal((source.match(/<Dashboard\b/g) || []).length, 0);
  assert.ok(source.includes("onDiscardPose={(assessmentId, view) => discardPoseForView(id, assessmentId, view)}"), "the app hands it down");
  assert.ok(source.includes("onDeleteCaptureDraft={onDeleteCaptureDraft} onDiscardPose={onDiscardPose}"), "the workspace passes it on");
  const analyzer = between(source, "function PoseAnalyzer({", "}) {");
  assert.ok(analyzer.includes("onDiscardPose"), "and the capture screen takes it");
});
