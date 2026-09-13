import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { OVERLAY_LABEL_MIN_OPACITY, overlayLabelOpacity } from "../../src/features/posture/posture-model.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const rowSource = () => readFile(new URL("../../src/features/lesson-record/LessonHistorySessionRow.jsx", import.meta.url), "utf8");

/* ------------- P2-8. the AFTER label follows the slider ---------------- */

test("the label fades as the After photo fades", () => {
  /* The slider is what the instructor is watching; a label that ignores it
     says the After photo is there when it has been faded away. */
  assert.ok(overlayLabelOpacity(100) > overlayLabelOpacity(50));
  assert.ok(overlayLabelOpacity(50) > overlayLabelOpacity(0));
});

test("the label is fully opaque when the After photo is", () => {
  assert.equal(overlayLabelOpacity(100), 1);
});

test("the label never disappears completely", () => {
  /* At 0% the After photo is gone, but the instructor still has to be able to
     tell which side of the frame is After. */
  assert.equal(overlayLabelOpacity(0), OVERLAY_LABEL_MIN_OPACITY);
  assert.ok(OVERLAY_LABEL_MIN_OPACITY > 0);
  for (const percent of [0, 1, 10, 50, 100]) {
    assert.ok(overlayLabelOpacity(percent) >= OVERLAY_LABEL_MIN_OPACITY, `${percent}% must stay readable`);
  }
});

test("the mapping is proportional between the two ends", () => {
  const midpoint = OVERLAY_LABEL_MIN_OPACITY + (1 - OVERLAY_LABEL_MIN_OPACITY) / 2;
  assert.ok(Math.abs(overlayLabelOpacity(50) - midpoint) < 1e-9);
});

test("a slider value outside its range cannot push the label out of range", () => {
  assert.equal(overlayLabelOpacity(-40), OVERLAY_LABEL_MIN_OPACITY);
  assert.equal(overlayLabelOpacity(400), 1);
});

test("a missing value leaves the label alone", () => {
  // Better a fully visible label than an invisible one from a bad read.
  for (const value of [null, undefined, NaN, "abc"]) {
    assert.equal(overlayLabelOpacity(value), 1);
  }
});

test("the overlay wires the slider value into the label", async () => {
  const source = await appSource();
  assert.match(source, /border: `1px solid \$\{BRAND\}`, opacity: overlayLabelOpacity\(opacity\) \}\}>AFTER<\/span>/);
  // The BEFORE label is untouched: the slider does not change that photo.
  assert.match(source, /border: `1px solid \$\{INK2\}` \}\}>BEFORE<\/span>/);
  assert.doesNotMatch(source, /BEFORE<\/span>[\s\S]{0,80}overlayLabelOpacity/);
});

/* -------------- P2-9. the example card looks like an example ------------ */

test("the example card carries the app's existing 예시 badge", async () => {
  const row = await rowSource();
  const preview = row.slice(row.indexOf("if (variant === \"preview\")"), row.indexOf("const detailsProps"));
  assert.match(preview, />예시<\/span>/);
  // The same badge treatment the member list already uses, not a new one.
  assert.match(preview, /backgroundColor: "var\(--tint\)", color: "var\(--brand\)", border: "1px solid var\(--ring\)"/);
  const app = await appSource();
  assert.match(app, /backgroundColor: TINT, color: BRAND_D, border: `1px solid \$\{RING\}` \}\}>예시<\/span>/,
    "the pattern being reused must still exist");
});

test("the example card is outlined differently from a real one", async () => {
  const row = await rowSource();
  const preview = row.slice(row.indexOf("if (variant === \"preview\")"), row.indexOf("const detailsProps"));
  const interactive = row.slice(row.indexOf("const detailsProps"));
  assert.match(preview, /border: "1px dashed var\(--faint\)"/);
  assert.doesNotMatch(interactive, /border: "1px dashed/, "a real record keeps its solid card");
});

test("the card itself is kept", async () => {
  const row = await rowSource();
  const preview = row.slice(row.indexOf("if (variant === \"preview\")"), row.indexOf("const detailsProps"));
  /* It exists to show a first-time instructor the shape of a finished record,
     so the fix is to mark it, not to remove it. */
  assert.match(preview, /<FieldRows session=\{session\} \/>/);
  assert.match(preview, /formatMemberLessonHeader\(session, sessions\)/);
  assert.match(preview, /data-variant="preview"/);
});

test("it is still shown only where there is nothing real to show", async () => {
  const app = await appSource();
  assert.match(app, /historySessions\.length === 0 \?[\s\S]{0,400}?<LessonHistorySessionRow session=\{ONBOARD_SAMPLE_SESSION\} variant="preview" \/>/);
});

test("a real record row is not marked as an example", async () => {
  const row = await rowSource();
  const interactive = row.slice(row.indexOf("const detailsProps"));
  assert.doesNotMatch(interactive, />예시<\/span>/);
  assert.match(interactive, /data-variant="interactive"/);
});
