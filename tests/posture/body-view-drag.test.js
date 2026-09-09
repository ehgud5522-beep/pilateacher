import assert from "node:assert/strict";
import test from "node:test";

import {
  BODY_VIEW_DRAG_COMMIT_MIN_PX, BODY_VIEW_DRAG_COMMIT_RATIO, POSTURE_VIEW_KEYS,
  bodyViewDragCommits, bodyViewMarkerFraction, bodyViewPhotoId, clampLabelWithin,
  containPhotoRect, reachableBodyViews, stepBodyView,
} from "../../src/features/posture/posture-model.js";

/* The two records for one direction are not the same shape. The capture
   bucket keeps the original the camera produced; the 760px copy without the
   skeleton drawn on it is written onto the pose. */
const assessment = (views, { withoutImage = [] } = {}) => ({
  id: "a1", status: "completed", scope: "full_body", date: "2026-09-01",
  poses: views.map((view) => ({
    id: `p_${view}`, view, blobId: `raw_${view}`,
    ...(withoutImage.includes(view) ? {} : { cleanBlobId: `clean_${view}` }),
  })),
  photos: Object.fromEntries(views.map((view) => [view, { id: `p_${view}`, blobId: `raw_${view}` }])),
});

const ALL = ["front", "leftSide", "back", "rightSide"];

/* ------------------------- which photo it reaches for -------------------- */

test("the clean copy is read off the pose, not off the capture record", () => {
  /* The capture record wins every lookup by view and carries only the
     original. Reading the copy from there answers "no photo" for a direction
     whose photo is on screen elsewhere in the app. */
  const set = assessment(["front"]);
  assert.equal(set.photos.front.cleanBlobId, undefined, "the fixture matches how the app saves");
  assert.equal(bodyViewPhotoId(set, "front"), "clean_front");
});

test("a capture record that does carry the copy is still accepted", () => {
  const set = assessment([]);
  set.photos = { front: { id: "x", cleanBlobId: "clean_from_photo" } };
  assert.equal(bodyViewPhotoId(set, "front"), "clean_from_photo");
});

test("without a clean copy anywhere there is no photo to show", () => {
  /* The original has the skeleton drawn into it. Falling back to it would put
     the analysis lines on a screen that is meant to show the body. */
  const set = assessment(["front"], { withoutImage: ["front"] });
  assert.equal(bodyViewPhotoId(set, "front"), null);
  assert.equal(bodyViewPhotoId(set, "back"), null);
  assert.equal(bodyViewPhotoId(null, "front"), null);
});

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


/* ------------------------ where a marker is drawn ------------------------ */

test("the marker follows the same scale and shift the photo was given", () => {
  /* If the photo is moved to line up with the base direction and the marker
     is not, the number drifts off the joint it belongs to. */
  const transform = { scale: 1.2, offsetX: 0.05, offsetY: -0.02 };
  const placed = bodyViewMarkerFraction({ x: 0.5, y: 0.5 }, transform);
  assert.ok(Math.abs(placed.x - 0.55) < 1e-9, "the centre only shifts");
  assert.ok(Math.abs(placed.y - 0.48) < 1e-9);
  const off = bodyViewMarkerFraction({ x: 0.25, y: 0.75 }, transform);
  assert.ok(Math.abs(off.x - (0.5 + 1.2 * -0.25 + 0.05)) < 1e-9, "and scales about the centre");
});

test("an unaligned direction leaves the marker where the photo is", () => {
  assert.deepEqual(bodyViewMarkerFraction({ x: 0.3, y: 0.7 }, null), { x: 0.3, y: 0.7 });
});

test("a point that is not a point has nowhere to go", () => {
  for (const point of [null, undefined, {}, { x: 0.5 }, { x: "a", y: 0.2 }]) {
    assert.equal(bodyViewMarkerFraction(point, null), null);
  }
});

test("a label with room to spare is not moved at all", () => {
  /* Most markers are well inside the body. Nudging them would break the tie
     between the number and the joint for no reason. */
  const centre = { x: 200, y: 400 };
  assert.deepEqual(clampLabelWithin(centre, { width: 600, height: 900 }, { width: 48, height: 24 }), centre);
});

test("a label at the edge slides just inside, and no further", () => {
  const box = { width: 600, height: 900 };
  const size = { width: 48, height: 24 };
  assert.deepEqual(clampLabelWithin({ x: 598, y: 400 }, box, size), { x: 576, y: 400 }, "half a pill in from the right");
  assert.deepEqual(clampLabelWithin({ x: 2, y: 400 }, box, size), { x: 24, y: 400 }, "and from the left");
  assert.deepEqual(clampLabelWithin({ x: 300, y: 0 }, box, size), { x: 300, y: 12 }, "and from the top");
  assert.deepEqual(clampLabelWithin({ x: 300, y: 900 }, box, size), { x: 300, y: 888 }, "and from the bottom");
});

test("a label past the edge is brought back, not left outside", () => {
  assert.deepEqual(clampLabelWithin({ x: -40, y: 1200 }, { width: 600, height: 900 }, { width: 48, height: 24 }), { x: 24, y: 888 });
});

test("a label bigger than the box is left where it is", () => {
  /* Clamping it would push it out the other side, which is worse. */
  assert.deepEqual(clampLabelWithin({ x: 10, y: 10 }, { width: 30, height: 12 }, { width: 48, height: 24 }), { x: 10, y: 10 });
});

test("without a measurable box nothing is moved", () => {
  const centre = { x: 5, y: 6 };
  assert.deepEqual(clampLabelWithin(centre, null, { width: 48, height: 24 }), centre);
  assert.deepEqual(clampLabelWithin(centre, { width: 600, height: 900 }, null), centre);
  assert.equal(clampLabelWithin(null, { width: 600, height: 900 }, { width: 48, height: 24 }), null);
});
/* ---------------------- where the photo actually lands ------------------- */

test("a photo narrower than its frame is centred with bands above and below", () => {
  /* This is the ordinary case: a portrait photo in a taller portrait frame. A
     marker coordinate is a fraction of the photo, so it has to be measured
     from the top of the photo, not the top of the frame. */
  const rect = containPhotoRect({ width: 600, height: 1000 }, { width: 3, height: 4 });
  assert.deepEqual(rect, { left: 0, top: 100, width: 600, height: 800 });
});

test("a photo wider than its frame is centred with bands left and right", () => {
  const rect = containPhotoRect({ width: 600, height: 1000 }, { width: 4, height: 3 });
  assert.deepEqual(rect, { left: 0, top: 275, width: 600, height: 450 });
});

test("a photo of the frame's own shape fills it with no band at all", () => {
  const rect = containPhotoRect({ width: 600, height: 800 }, { width: 300, height: 400 });
  assert.deepEqual(rect, { left: 0, top: 0, width: 600, height: 800 });
});

test("the whole photo is always inside the frame", () => {
  /* Cropping would hide part of the body, and a marker on the hidden part
     would sit against the edge pointing at nothing. */
  for (const photo of [{ width: 9, height: 16 }, { width: 16, height: 9 }, { width: 1, height: 1 }]) {
    const rect = containPhotoRect({ width: 480, height: 900 }, photo);
    assert.ok(rect.width <= 480 + 1e-9 && rect.height <= 900 + 1e-9, "it fits");
    assert.ok(rect.left >= 0 && rect.top >= 0, "and it is not pushed out");
    assert.ok(Math.abs(rect.width / rect.height - photo.width / photo.height) < 1e-9, "the shape is kept");
  }
});

test("without a measurement there is no rectangle to guess at", () => {
  for (const [frame, photo] of [
    [null, { width: 3, height: 4 }],
    [{ width: 600, height: 1000 }, null],
    [{ width: 0, height: 1000 }, { width: 3, height: 4 }],
    [{ width: 600, height: 1000 }, { width: 3, height: 0 }],
    [{ width: NaN, height: 1000 }, { width: 3, height: 4 }],
  ]) {
    assert.equal(containPhotoRect(frame, photo), null);
  }
});
