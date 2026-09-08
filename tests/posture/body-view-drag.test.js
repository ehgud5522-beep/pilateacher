import assert from "node:assert/strict";
import test from "node:test";

import {
  BODY_VIEW_DRAG_COMMIT_MIN_PX, BODY_VIEW_DRAG_COMMIT_RATIO, POSTURE_VIEW_KEYS,
  bodyViewDragCommits, reachableBodyViews, stepBodyView,
} from "../../src/features/posture/posture-model.js";

const assessment = (views, { withoutImage = [] } = {}) => ({
  id: "a1", status: "completed", scope: "full_body", date: "2026-09-01",
  poses: views.map((view) => ({
    id: `p_${view}`, view, blobId: `raw_${view}`,
    ...(withoutImage.includes(view) ? {} : { cleanBlobId: `clean_${view}` }),
  })),
  photos: Object.fromEntries(views.map((view) => [view, {
    id: `p_${view}`, blobId: `raw_${view}`,
    ...(withoutImage.includes(view) ? {} : { cleanBlobId: `clean_${view}` }),
  }])),
});

const ALL = ["front", "leftSide", "back", "rightSide"];

/* --------------------- which directions the finger reaches --------------- */

test("the finger reaches the directions that were shot, in shooting order", () => {
  assert.deepEqual(reachableBodyViews(assessment(ALL)), [...POSTURE_VIEW_KEYS]);
});

test("a direction that was never shot is not on the path", () => {
  assert.deepEqual(reachableBodyViews(assessment(["front", "back"])), ["front", "back"]);
});

test("a direction whose photo cannot be shown is not on the path either", () => {
  /* Sliding to a frame that can only say "no photo here" feels like the drag
     failed halfway. The button still opens it; the finger goes past. */
  assert.deepEqual(reachableBodyViews(assessment(ALL, { withoutImage: ["leftSide"] })), ["front", "back", "rightSide"]);
});

test("a photo that turned out to be unreadable drops off the path", () => {
  assert.deepEqual(reachableBodyViews(assessment(ALL), { unreadable: ["back"] }), ["front", "leftSide", "rightSide"]);
  assert.deepEqual(reachableBodyViews(assessment(ALL), { unreadable: ["side"] }), ["front", "back", "rightSide"], "the old key names the same direction");
});

test("an assessment with nothing to show has nowhere to drag", () => {
  assert.deepEqual(reachableBodyViews(assessment([])), []);
  assert.deepEqual(reachableBodyViews(null), []);
});

/* ------------------------------ one step ------------------------------- */

test("a drag moves one direction, to the neighbour", () => {
  assert.equal(stepBodyView(ALL, "front", 1), "leftSide");
  assert.equal(stepBodyView(ALL, "leftSide", 1), "back");
  assert.equal(stepBodyView(ALL, "back", -1), "leftSide");
  assert.equal(stepBodyView(ALL, "rightSide", -1), "back");
});

test("the ends are ends, not a loop", () => {
  /* Pushing past the front to reach the right side would be turning the list,
     not the body. */
  assert.equal(stepBodyView(ALL, "front", -1), null);
  assert.equal(stepBodyView(ALL, "rightSide", 1), null);
});

test("a missing direction is stepped over, not stopped at", () => {
  const path = ["front", "back", "rightSide"];
  assert.equal(stepBodyView(path, "front", 1), "back", "the left side was never shot");
  assert.equal(stepBodyView(path, "back", -1), "front");
});

test("two missing directions in a row are stepped over together", () => {
  assert.equal(stepBodyView(["front", "rightSide"], "front", 1), "rightSide");
  assert.equal(stepBodyView(["front", "rightSide"], "rightSide", -1), "front");
});

test("a direction reachable only by button still knows its neighbours", () => {
  /* The instructor can press through to a photoless direction. Dragging out of
     it should work rather than trapping them there. */
  const path = ["front", "back"];
  assert.equal(stepBodyView(path, "leftSide", 1), "back");
  assert.equal(stepBodyView(path, "leftSide", -1), "front");
});

test("a step of nowhere is nowhere", () => {
  assert.equal(stepBodyView(ALL, "front", 0), null);
  assert.equal(stepBodyView(ALL, "custom", 1), null);
  assert.equal(stepBodyView(null, "front", 1), null);
  assert.equal(stepBodyView(ALL, null, 1), null);
});

test("the old side key is the left side on both ends of a step", () => {
  assert.equal(stepBodyView(["front", "side", "back"], "side", 1), "back");
  assert.equal(stepBodyView(ALL, "side", 1), "back");
});

/* ---------------------------- far enough to count ------------------------ */

test("a nudge is not a decision", () => {
  /* A finger resting on a photo drifts a few pixels. Turning that into a
     direction change would make the screen move on its own. */
  assert.equal(bodyViewDragCommits(10, 400), false);
  assert.equal(bodyViewDragCommits(-10, 400), false);
});

test("a push across a fifth of the frame counts, either way", () => {
  const width = 400;
  const enough = width * BODY_VIEW_DRAG_COMMIT_RATIO;
  assert.equal(bodyViewDragCommits(enough, width), true);
  assert.equal(bodyViewDragCommits(-enough, width), true);
  assert.equal(bodyViewDragCommits(enough - 1, width), false, "just short is short");
});

test("a narrow frame still asks for a real push", () => {
  /* A fifth of a small frame is a few pixels, and everything would commit. */
  const narrow = 100;
  assert.equal(bodyViewDragCommits(narrow * BODY_VIEW_DRAG_COMMIT_RATIO, narrow), false);
  assert.equal(bodyViewDragCommits(BODY_VIEW_DRAG_COMMIT_MIN_PX, narrow), true);
});

test("an unmeasurable frame falls back to the floor rather than to zero", () => {
  /* Otherwise a frame of unknown width would commit on the first pixel. */
  for (const width of [0, null, undefined, NaN]) {
    assert.equal(bodyViewDragCommits(5, width), false);
    assert.equal(bodyViewDragCommits(BODY_VIEW_DRAG_COMMIT_MIN_PX, width), true);
  }
});

test("a distance that is not a number never commits", () => {
  for (const dx of [null, undefined, NaN, "abc"]) assert.equal(bodyViewDragCommits(dx, 400), false);
});
