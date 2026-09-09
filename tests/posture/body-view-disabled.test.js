import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BODY_VIEW_ENABLED } from "../../src/features/posture/posture-model.js";
import { loadBodySegmenter, personMaskPng } from "../../src/features/posture/body-segmenter.js";
import { PHOTO_BLOB_ID_FIELDS } from "../../src/data/photo-blob-fields.js";

/* The 360° body view is off. Four photographs never read as a turn, and the
   cutout underneath it was not good enough to build on, so it was switched off
   in September 2026 rather than left half-working on the result screen.

   The code stays. This file is what holds the off state in place: the door is
   shut, no model is fetched, and -- the part that would quietly cost a user
   storage -- the masks already saved are still swept up when an account or a
   record is deleted, even though nothing makes new ones. */

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const voiceSource = () => readFile(new URL("../../src/features/voice/voice-session.js", import.meta.url), "utf8");

test("the body view is off", () => {
  assert.equal(BODY_VIEW_ENABLED, false);
});

test("the one door into it is shut, and it was the only one", async () => {
  const source = await appSource();
  assert.match(source, /const canOpenBodyView = BODY_VIEW_ENABLED &&/, "the gate reads the flag first");
  const doors = source.match(/setBodyViewOpen\(true\)/g) || [];
  assert.equal(doors.length, 1, "there is one way in");
  const at = source.indexOf("const bodyViewButton =");
  const button = source.slice(at, at + 400);
  assert.ok(button.includes("canOpenBodyView ?"), "and the button behind it is gated by the same value");
  assert.match(source, /\{bodyViewOpen && canOpenBodyView && <BodyViewSheet/, "so is the sheet itself");
});

test("the 이번 변화 card does not depend on the body view", async () => {
  /* The card is the reason the result screen is worth opening. It was never
     part of the body view -- only the button at its foot was, and that button
     disappears on its own once the gate is shut. */
  const source = await appSource();
  const marker = source.indexOf("이번 변화</h2>");
  assert.ok(marker > 0, "the card is on the result screen");
  const card = source.slice(source.lastIndexOf("{!selectedIsManualResult", marker), source.indexOf("방향별로 보기", marker));
  assert.ok(card.includes("!selectedIsManualResult && selected?.status === \"completed\" && !!recentChanges.length"),
    "it renders on its own condition");
  assert.equal(card.includes("canOpenBodyView"), false, "which says nothing about the body view");
  assert.ok(card.includes("recentChanges.map"), "and the readings are still listed");
  assert.ok(card.includes("{bodyViewButton}"), "the only body-view thing in it is the button, which is now null");
});

test("no segmentation model is fetched and no mask is made", async () => {
  /* Not a source check. The two entry points are called, and neither reaches
     the network -- a request going out is the one thing that cannot be undone
     by a flag somewhere else. */
  await assert.rejects(() => loadBodySegmenter(), (error) => error?.message === "body_view_disabled");
  assert.equal(await personMaskPng({ naturalWidth: 516, naturalHeight: 760 }), null);
});

test("the masks already on the device are still swept up when a record goes", () => {
  /* Nothing makes new ones. The ones already saved are body photographs, and
     dropping them from the sweep would leave them on the phone after the
     member is deleted. */
  assert.ok(PHOTO_BLOB_ID_FIELDS.includes("maskBlobId"));
});

test("the body view's own diagnostic events went with it", async () => {
  /* An unregistered name is dropped in silence, so leaving them registered
     would be harmless -- but it would also read as if something still sends
     them. */
  const voice = await voiceSource();
  for (const event of ["segmenter_library_loaded", "segmenter_ready", "segmenter_gpu_fallback", "segmenter_failed", "segmenter_cutout"]) {
    assert.equal(voice.includes(`"${event}"`), false, `${event} is still registered`);
  }
  assert.ok(voice.includes('"album_picker_opened"'), "the camera's own events stay");
});

test("the code is still here, so turning it back on is one line", async () => {
  /* The instruction was to disable, not to delete. If a later cleanup removes
     these, re-enabling stops being a flag flip and this test says so. */
  const model = await readFile(new URL("../../src/features/posture/posture-model.js", import.meta.url), "utf8");
  for (const kept of ["composeBodyViewAlignment", "bodyViewMetrics", "bodyViewDragFrame", "bodyViewLabelAnchor", "bodyViewMarkerShows"]) {
    assert.ok(model.includes(`export function ${kept}`), `${kept} was removed rather than disabled`);
  }
  const app = await appSource();
  assert.ok(app.includes('import BodyViewSheet from "./features/posture/BodyViewSheet.jsx";'));
});
