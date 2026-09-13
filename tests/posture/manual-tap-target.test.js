import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { manualTapTarget } from "../../src/features/posture/posture-model.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

const pt = (x, y) => ({ x, y, score: 0.9 });

/* 23. Tapping empty canvas used to teleport whichever joint the prompt was
   asking for to the finger, so a stray touch threw an already-correct point
   across the photo. */

test("a joint that already exists is never placed by a tap", () => {
  const manual = { seq: ["hipL", "hipR"], i: 0, focused: "pelvis" };
  const points = { hipL: pt(0.4, 0.6), hipR: pt(0.6, 0.6) };
  assert.equal(manualTapTarget(manual, points), null, "hipL exists, so a tap does nothing");
  assert.equal(manualTapTarget({ ...manual, i: 1 }, points), null, "and so does the second step");
});

test("a joint the pose never found can still be placed by a tap", () => {
  // Without this there would be no way at all to give an undetected joint a
  // point: there is nothing on screen to drag.
  const manual = { seq: ["ankL", "ankR"], i: 0 };
  assert.equal(manualTapTarget(manual, { hipL: pt(0.4, 0.6) }), "ankL");
  assert.equal(manualTapTarget(manual, {}), "ankL");
  assert.equal(manualTapTarget(manual, null), "ankL");
  assert.equal(manualTapTarget(manual, undefined), "ankL");
});

test("the two cases are decided per step, not per session", () => {
  /* startManual sends only the missing joints when any are missing, but the
     rule has to hold for a mixed sequence too. */
  const manual = { seq: ["shL", "shR", "ankL"], i: 0 };
  const points = { shL: pt(0.4, 0.3), shR: pt(0.6, 0.3) };
  assert.equal(manualTapTarget(manual, points), null, "shL exists");
  assert.equal(manualTapTarget({ ...manual, i: 1 }, points), null, "shR exists");
  assert.equal(manualTapTarget({ ...manual, i: 2 }, points), "ankL", "ankL does not");
});

test("a placed point immediately stops accepting taps", () => {
  // Even if the step did not advance on placement, the joint is drag-only from
  // that moment on -- a second tap cannot move it.
  const manual = { seq: ["ankL"], i: 0 };
  assert.equal(manualTapTarget(manual, {}), "ankL");
  assert.equal(manualTapTarget(manual, { ankL: pt(0.5, 0.9) }), null);
});

test("undoing a step hands the tap back", () => {
  /* undoPoint deletes the point and steps back, so the joint is undetected
     again and tapping is the way to redo it. */
  const manual = { seq: ["ankL", "ankR"], i: 1 };
  assert.equal(manualTapTarget({ ...manual, i: 0 }, {}), "ankL");
});

test("no live step means no tap target", () => {
  assert.equal(manualTapTarget(null, {}), null);
  assert.equal(manualTapTarget(undefined, {}), null);
  assert.equal(manualTapTarget({ i: 0 }, {}), null, "no sequence");
  assert.equal(manualTapTarget({ seq: ["hipL"], i: 1 }, {}), null, "finished");
  assert.equal(manualTapTarget({ seq: ["hipL"], i: -1 }, {}), null);
  assert.equal(manualTapTarget({ seq: ["hipL"], i: 1.5 }, {}), null);
  assert.equal(manualTapTarget({ seq: [], i: 0 }, {}), null);
  assert.equal(manualTapTarget({ seq: [""], i: 0 }, {}), null);
});

/* --------------------------- the wiring -------------------------------- */

test("dragging is untouched by the tap rule", async () => {
  const source = await appSource();
  /* The "near an existing joint" branch returns before the tap path, so every
     point on screen -- including ones already passed -- stays draggable. */
  const onDown = source.slice(source.indexOf("const onDown = (e) =>"), source.indexOf("const onMove = (e) =>"));
  const nearAt = onDown.indexOf("if (near) { dragRef.current = near;");
  const tapAt = onDown.indexOf("const key = manualTapTarget(manual, pts);");
  assert.ok(nearAt >= 0, "the drag branch must exist");
  assert.ok(tapAt > nearAt, "and must come before the tap path");
  assert.match(onDown.slice(nearAt, tapAt), /return; \}/, "the drag branch returns rather than falling through");
});

test("the tap path is the only writer of a new point", async () => {
  const source = await appSource();
  const onDown = source.slice(source.indexOf("const onDown = (e) =>"), source.indexOf("const onMove = (e) =>"));
  // One setPts in onDown, and it is behind the rule.
  assert.equal((onDown.match(/setPts\(/g) || []).length, 1);
  assert.match(onDown, /const key = manualTapTarget\(manual, pts\);\s*\r?\n\s*if \(key\) \{\s*\r?\n\s*setPts\(/);
});

test("the prompt tells the user which of the two it is", async () => {
  const source = await appSource();
  // Telling someone to tap a point that cannot be tapped is the same defect,
  // in words.
  assert.match(source, /pts\?\.\[manual\.seq\[manual\.i\]\] \? "점을 끌어서 미세 조정" : "찍은 뒤 끌어서 미세 조정"/);
});
