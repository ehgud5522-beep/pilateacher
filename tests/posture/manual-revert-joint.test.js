import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { revertManualJoint } from "../../src/features/posture/posture-model.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

const MIN = 0.5;
const ai = (x, y, score = 0.9) => ({ x, y, score, source: "ai" });
const dragged = (x, y) => ({ x, y, score: 1, source: "manual-corrected" });

/* One joint the pose found and the instructor then dragged, one the pose
   missed and the instructor placed by tapping. */
const scene = () => ({
  manual: { seq: ["hipL", "ankL"], i: 1, focused: "pelvis" },
  points: { hipL: dragged(0.9, 0.1), ankL: ai(0.45, 0.95) },
  originalPoints: { hipL: ai(0.42, 0.61), ankL: ai(0.45, 0.95) },
  quality: { missing: [], low: [] },
  editedJoints: ["hipL"],
  confidenceMin: MIN,
});

/* ---------------------- 1. restore vs. delete -------------------------- */

test("a joint the AI found comes back at the AI's coordinates", () => {
  const next = revertManualJoint(scene());
  assert.equal(next.key, "hipL");
  assert.equal(next.restored, true);
  assert.deepEqual(next.points.hipL, { x: 0.42, y: 0.61, score: 0.9, source: "ai" });
  assert.equal(next.manual.i, 0, "and the prompt steps back to that joint");
  assert.equal(next.manual.focused, "pelvis", "the rest of the prompt state is carried through");
});

test("the restored point is a copy, not the stored original", () => {
  /* Sharing the object would let the next drag mutate the AI reading itself,
     leaving nothing to restore a second time. */
  const state = scene();
  const next = revertManualJoint(state);
  assert.notEqual(next.points.hipL, state.originalPoints.hipL);
  next.points.hipL.x = 0.01;
  assert.equal(state.originalPoints.hipL.x, 0.42, "the original is untouched");
});

test("a joint the AI never found is deleted, as before", () => {
  const state = { ...scene(), manual: { seq: ["ankR"], i: 1 }, points: { ankR: dragged(0.5, 0.9) }, originalPoints: { hipL: ai(0.4, 0.6) } };
  const next = revertManualJoint(state);
  assert.equal(next.key, "ankR");
  assert.equal(next.restored, false);
  assert.ok(!("ankR" in next.points), "there is nothing to restore it to");
  assert.equal(next.manual.i, 0);
});

test("an empty or absent original store falls back to deleting", () => {
  for (const originalPoints of [null, undefined, {}, { hipL: null }]) {
    const next = revertManualJoint({ ...scene(), originalPoints });
    assert.equal(next.restored, false);
    assert.ok(!("hipL" in next.points));
  }
});

test("the other joints are left exactly as they were", () => {
  const state = scene();
  const next = revertManualJoint(state);
  assert.deepEqual(next.points.ankL, state.points.ankL);
  assert.notEqual(next.points, state.points, "and the input is not mutated");
  assert.deepEqual(state.points.hipL, dragged(0.9, 0.1));
});

/* ------------------- the confidence classification --------------------- */

test("restoring puts the joint back out of the missing list", () => {
  const state = { ...scene(), quality: { missing: ["hipL", "kneeR"], low: [] } };
  const next = revertManualJoint(state);
  assert.deepEqual(next.quality.missing, ["kneeR"]);
});

test("a restored low-confidence reading is flagged low again", () => {
  /* It was flagged low when the pose resolved; hiding that after a revert
     would present a weak reading as a solid one. */
  const state = { ...scene(), originalPoints: { hipL: ai(0.42, 0.61, 0.3) } };
  const next = revertManualJoint(state);
  assert.ok(next.quality.low.includes("hipL"));
  assert.ok(!next.quality.missing.includes("hipL"));
});

test("a restored confident reading is not flagged low", () => {
  const state = { ...scene(), quality: { missing: [], low: ["hipL"] } };
  const next = revertManualJoint(state);
  assert.ok(!next.quality.low.includes("hipL"));
});

test("the threshold is the boundary, not a range", () => {
  const at = revertManualJoint({ ...scene(), originalPoints: { hipL: ai(0.4, 0.6, MIN) } });
  assert.ok(!at.quality.low.includes("hipL"), "exactly at the threshold is not low");
  const below = revertManualJoint({ ...scene(), originalPoints: { hipL: ai(0.4, 0.6, MIN - 0.0001) } });
  assert.ok(below.quality.low.includes("hipL"));
});

test("a reading with no score at all counts as confident", () => {
  const next = revertManualJoint({ ...scene(), originalPoints: { hipL: { x: 0.42, y: 0.61 } } });
  assert.equal(next.restored, true);
  assert.ok(!next.quality.low.includes("hipL"));
});

test("deleting marks the joint missing and clears any low flag", () => {
  const state = { ...scene(), originalPoints: {}, quality: { missing: [], low: ["hipL"] } };
  const next = revertManualJoint(state);
  assert.ok(next.quality.missing.includes("hipL"));
  assert.ok(!next.quality.low.includes("hipL"));
});

test("a joint is never listed twice", () => {
  const state = { ...scene(), originalPoints: {}, quality: { missing: ["hipL"], low: [] } };
  const next = revertManualJoint(state);
  assert.deepEqual(next.quality.missing, ["hipL"]);
});

/* ----------------------- 2. the edited mark ---------------------------- */

test("a reverted joint is no longer counted as edited", () => {
  // Otherwise the save records a correction that is not there any more.
  const next = revertManualJoint({ ...scene(), editedJoints: ["hipL", "shR"] });
  assert.deepEqual(next.editedJoints, ["shR"]);
});

test("the mark is dropped whether the joint was restored or deleted", () => {
  const deleted = revertManualJoint({ ...scene(), originalPoints: {}, editedJoints: ["hipL"] });
  assert.deepEqual(deleted.editedJoints, []);
});

test("a missing or malformed edited list is handled", () => {
  for (const editedJoints of [null, undefined, "hipL"]) {
    assert.deepEqual(revertManualJoint({ ...scene(), editedJoints }).editedJoints, []);
  }
});

/* --------------------------- the boundaries ---------------------------- */

test("there is nothing to revert before the first step", () => {
  assert.equal(revertManualJoint({ ...scene(), manual: { seq: ["hipL"], i: 0 } }), null);
});

test("the last step can be reverted, and then the one before it", () => {
  const state = { ...scene(), manual: { seq: ["hipL", "ankL"], i: 2 } };
  const first = revertManualJoint(state);
  assert.equal(first.key, "ankL", "finished means the last joint is the one to undo");
  assert.equal(first.manual.i, 1);
  const second = revertManualJoint({ ...state, manual: first.manual, points: first.points, originalPoints: state.originalPoints });
  assert.equal(second.key, "hipL");
  assert.equal(second.manual.i, 0);
});

test("a missing or malformed state reverts nothing", () => {
  assert.equal(revertManualJoint(), null);
  assert.equal(revertManualJoint({}), null);
  assert.equal(revertManualJoint({ manual: null }), null);
  assert.equal(revertManualJoint({ manual: { i: 1 } }), null, "no sequence");
  assert.equal(revertManualJoint({ manual: { seq: ["hipL"], i: 2 } }), null, "past the end");
  assert.equal(revertManualJoint({ manual: { seq: ["hipL"], i: -1 } }), null);
  assert.equal(revertManualJoint({ manual: { seq: ["hipL"], i: 1.5 } }), null);
  assert.equal(revertManualJoint({ manual: { seq: [""], i: 1 } }), null);
});

/* ------------------------------ the wiring ----------------------------- */

test("the screen applies every part of the result", async () => {
  const source = await appSource();
  const undo = source.slice(source.indexOf("const undoPoint = () =>"), source.indexOf("const download = () =>"));
  for (const setter of ["setPts(next.points)", "setManual(next.manual)", "setPoseQuality(next.quality)", "setEditedJoints(next.editedJoints)"]) {
    assert.ok(undo.includes(setter), `${setter} must be applied`);
  }
  // The real threshold, not a second copy of the number.
  assert.match(undo, /confidenceMin: POSE_CONFIDENCE_MIN/);
  assert.match(undo, /originalPoints: originalPts/);
});

test("the button keeps one label and says afterwards what it did", async () => {
  const source = await appSource();
  /* A label that flips between two actions makes the instructor predict, from
     state they cannot see, which of the two a press will do. The label names
     the one intent; the toast reports the outcome once it is settled. */
  assert.match(source, /onClick=\{undoPoint\}[^>]*>되돌리기<\/button>/);
  assert.doesNotMatch(source, /onClick=\{undoPoint\}[^>]*>이전<\/button>/);
  const undo = source.slice(source.indexOf("const undoPoint = () =>"), source.indexOf("const download = () =>"));
  assert.match(undo, /next\.restored/);
  assert.match(undo, /AI가 찾은 위치로 되돌렸습니다/);
  assert.match(undo, /찍은 점을 지웠습니다/);
  assert.match(undo, /jointName\(next\.key, poseView\)/, "the toast names the joint it acted on");
});

test("the side-view prompt no longer tells the instructor to tap", async () => {
  const source = await appSource();
  /* Only an undetected joint can be tapped now, so a prompt that always says
     "눌러주세요" asks for something the screen refuses to do. */
  assert.doesNotMatch(source, /를 눌러주세요/);
  assert.match(source, /if \(view !== "front"\) return `\$\{PART_KO\[key\] \|\| key\} 위치`;/);
});
