import assert from "node:assert/strict";
import nodeTest from "node:test";

import {
  BODY_VIEW_DRAG_COMMIT_MIN_PX, BODY_VIEW_DRAG_COMMIT_RATIO, BODY_VIEW_DRAG_EDGE_LIMIT,
  BODY_VIEW_DRAG_SQUEEZE, BODY_VIEW_DRAG_TRAVEL, POSTURE_VIEW_KEYS,
  bodyViewDragCommits, bodyViewDragFrame, bodyViewDragProgress, bodyViewLabelAnchor,
  bodyViewMarkerFraction, bodyViewMarkerShows, bodyViewMetrics, bodyViewPhotoId,
  clampLabelWithin, containPhotoRect, reachableBodyViews, stepBodyView,
  BODY_VIEW_HEAD_LABEL_GAP,
} from "../../src/features/posture/posture-model.js";

/* 360° 바디뷰: 회전 체감이 나지 않고 인물 분리 품질도 미달이어서
   2026-09 비활성화. 기능이 꺼져 있는 동안 이 파일의 검사도 함께 멈춘다.
   지우지 않는 이유는 재개할 때 그대로 다시 켜기 위해서다 -- 아래 네 줄을
   지우고 위의 import 를 되돌리면 그대로 다시 돈다. */
const skipped = { skip: "360° 바디뷰 비활성화 (2026-09) -- posture-model.js 의 BODY_VIEW_ENABLED" };
const test = (name, fn) => nodeTest(name, skipped, fn);
test.before = nodeTest.before;
test.after = nodeTest.after;

/* A front pose with the joints a marker can be hung on, so the readings
   below come out of the same function the screen uses. */
const at = (x, y) => ({ x, y, score: 1 });
const measured = (metrics) => ({
  id: "a1", status: "completed", scope: "full_body", date: "2026-09-01",
  poses: [{
    id: "p_front", view: "front", cleanBlobId: "clean_front", blobId: "raw_front", metrics,
    pts: {
      earL: at(0.47, 0.09), earR: at(0.53, 0.09),
      shL: at(0.40, 0.23), shR: at(0.60, 0.23),
      hipL: at(0.42, 0.50), hipR: at(0.58, 0.50),
      kneeL: at(0.44, 0.70), kneeR: at(0.56, 0.70),
    },
  }],
  photos: { front: { id: "p_front", cleanBlobId: "clean_front", blobId: "raw_front" } },
});
const degrees = (key, label, value) => ({ key, label, value, unit: "°", validity: { valid: true } });
const readingFor = (key, value) => bodyViewMetrics(measured([degrees(key, key, value)]), "front")
  .find((metric) => metric.key === key) || null;

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

test("a push across half the frame counts, either way", () => {
  /* Half is where the next direction is already standing on screen, so
     letting go there keeps what the eye is looking at. */
  const width = 400;
  const enough = width * BODY_VIEW_DRAG_COMMIT_RATIO;
  assert.equal(enough, 200, "half of the frame");
  assert.equal(bodyViewDragCommits(enough, width), true);
  assert.equal(bodyViewDragCommits(-enough, width), true);
  assert.equal(bodyViewDragCommits(enough - 1, width), false, "just short is short");
});

test("a narrow frame still asks for a real push", () => {
  /* Half of a small frame is a few pixels, and everything would commit. */
  const narrow = 60;
  assert.equal(bodyViewDragCommits(narrow * BODY_VIEW_DRAG_COMMIT_RATIO, narrow), false);
  assert.equal(bodyViewDragCommits(BODY_VIEW_DRAG_COMMIT_MIN_PX, narrow), true);
});

test("the follow and the commit are measured with one ruler", () => {
  /* If they disagreed, the next direction could be standing on screen and
     still snap back when the finger lifted. */
  for (const width of [400, 96, 60, 0]) {
    for (const dx of [0, 10, 30, 47, 48, 49, 100, 199, 200, 201, 400]) {
      assert.equal(
        Math.abs(bodyViewDragProgress(dx, width)) >= BODY_VIEW_DRAG_COMMIT_RATIO,
        bodyViewDragCommits(dx, width),
        `${dx}px across ${width}px disagreed`,
      );
    }
  }
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

/* ------------------------- following the finger -------------------------- */

test("the screen is exactly as far along as the finger is", () => {
  const width = 400;
  assert.equal(bodyViewDragProgress(0, width), 0);
  assert.equal(bodyViewDragProgress(100, width), 0.25);
  assert.equal(bodyViewDragProgress(200, width), 0.5, "half the frame is half way over");
  assert.equal(bodyViewDragProgress(-200, width), -0.5, "and the other way is the other sign");
});

test("pushing past the end of the drag does not push past the end of the turn", () => {
  for (const dx of [400, 4000]) assert.equal(bodyViewDragProgress(dx, 400), 1);
  for (const dx of [-400, -4000]) assert.equal(bodyViewDragProgress(dx, 400), -1);
});

test("a distance that is not a number moves nothing", () => {
  for (const dx of [null, undefined, NaN, "abc"]) assert.equal(bodyViewDragProgress(dx, 400), 0);
});

test("at the ends the finger is felt but never obeyed", () => {
  /* Something has to move, or the screen reads as broken. It must never
     reach the halfway point, or the end would turn into a direction. */
  for (const dx of [50, 200, 4000]) {
    const at = bodyViewDragProgress(dx, 400, { blocked: true });
    assert.ok(at > 0, "the push is felt");
    assert.ok(at <= BODY_VIEW_DRAG_EDGE_LIMIT, "and it is capped");
    assert.ok(at < BODY_VIEW_DRAG_COMMIT_RATIO, "so it can never turn");
    assert.equal(bodyViewDragFrame(at).showTarget, false);
  }
  assert.equal(bodyViewDragProgress(-4000, 400, { blocked: true }), -BODY_VIEW_DRAG_EDGE_LIMIT);
});

/* --------------------- what the turn looks like -------------------------- */

test("a body at rest is where it was, at the size it was", () => {
  const still = bodyViewDragFrame(0);
  assert.equal(still.shift, 0);
  assert.equal(still.squeeze, 1);
  assert.equal(still.showTarget, false);
});

test("the body leaves towards the side it was pushed", () => {
  assert.ok(bodyViewDragFrame(0.25).shift > 0, "pushed right, goes right");
  assert.ok(bodyViewDragFrame(-0.25).shift < 0, "pushed left, goes left");
  assert.equal(bodyViewDragFrame(0.25).shift, -bodyViewDragFrame(-0.25).shift, "and by the same amount");
});

test("it is furthest out and narrowest in the middle of the turn", () => {
  const middle = bodyViewDragFrame(0.5);
  assert.equal(middle.shift, BODY_VIEW_DRAG_TRAVEL);
  assert.equal(middle.squeeze, 1 - BODY_VIEW_DRAG_SQUEEZE);
  for (const at of [0.1, 0.3, 0.7, 0.9]) {
    assert.ok(bodyViewDragFrame(at).shift < middle.shift, `${at} is not past the middle`);
    assert.ok(bodyViewDragFrame(at).squeeze > middle.squeeze, `${at} is wider than the middle`);
  }
});

test("a finished turn stands straight again, as the next direction", () => {
  const done = bodyViewDragFrame(1);
  assert.ok(Math.abs(done.shift) < 1e-12, "back in place");
  assert.ok(Math.abs(done.squeeze - 1) < 1e-12, "back to full width");
  assert.equal(done.showTarget, true, "and it is the next direction standing there");
});

test("the two faces swap where the body is narrowest, so only one is ever seen", () => {
  assert.equal(bodyViewDragFrame(0.49).showTarget, false);
  assert.equal(bodyViewDragFrame(0.5).showTarget, true);
  assert.equal(bodyViewDragFrame(-0.5).showTarget, true, "either way round");
});

test("the body is never bent, only moved and narrowed", () => {
  /* Whatever the progress, the squeeze stays a plain horizontal scale and
     never inverts or collapses the body. */
  for (let at = -1; at <= 1; at += 0.05) {
    const frame = bodyViewDragFrame(at);
    assert.ok(frame.squeeze >= 1 - BODY_VIEW_DRAG_SQUEEZE && frame.squeeze <= 1, `squeeze out of range at ${at}`);
    assert.ok(Math.abs(frame.shift) <= BODY_VIEW_DRAG_TRAVEL, `shift out of range at ${at}`);
  }
});

test("a progress that is not a number leaves the body alone", () => {
  for (const at of [null, undefined, NaN, "abc"]) {
    assert.equal(bodyViewDragFrame(at).shift, 0);
    assert.equal(bodyViewDragFrame(at).squeeze, 1);
    assert.equal(bodyViewDragFrame(at).showTarget, false);
  }
});


/* --------------------- keeping the face uncovered ------------------------ */

const box = { width: 400, height: 700 };

test("a head reading leaves its dot on the ear and sends the label aside", () => {
  /* The number has to be readable and the face has to stay visible. Only
     the pill moves; the dot is still where the reading was taken, and the
     line between them says so. */
  const dot = { x: 200, y: 60 };
  const label = bodyViewLabelAnchor("head", dot, box);
  assert.notEqual(label.x, dot.x, "the pill is off the face");
  assert.equal(label.y, dot.y, "at the same height, beside the head");
  assert.equal(Math.abs(label.x - dot.x), box.width * BODY_VIEW_HEAD_LABEL_GAP);
});

test("the side view head reading is moved for the same reason", () => {
  assert.notEqual(bodyViewLabelAnchor("fha", { x: 200, y: 80 }, box).x, 200);
});

test("the label leaves towards the nearer edge, so it never crosses the face", () => {
  /* Sending it the other way would drag the connecting line straight over
     the face it was moved to uncover. */
  assert.ok(bodyViewLabelAnchor("head", { x: 150, y: 60 }, box).x < 150, "left of centre goes left");
  assert.ok(bodyViewLabelAnchor("head", { x: 250, y: 60 }, box).x > 250, "right of centre goes right");
});

test("a reading taken anywhere else is not moved at all", () => {
  for (const key of ["shoulder", "pelvis", "twist", "trunk", "kneeSide", "align"]) {
    assert.deepEqual(bodyViewLabelAnchor(key, { x: 200, y: 300 }, box), { x: 200, y: 300 }, key);
  }
});

test("the gap is a share of the photo, not a fixed number of pixels", () => {
  /* A phone and a tablet show the same body at different sizes. A fixed gap
     would clear the head on one and land on it on the other. */
  const near = bodyViewLabelAnchor("head", { x: 100, y: 60 }, { width: 200, height: 350 });
  const far = bodyViewLabelAnchor("head", { x: 400, y: 240 }, { width: 800, height: 1400 });
  assert.equal(100 - near.x, 200 * BODY_VIEW_HEAD_LABEL_GAP);
  assert.equal(400 - far.x, 800 * BODY_VIEW_HEAD_LABEL_GAP);
});

test("without a photograph to measure there is nowhere to send it", () => {
  for (const bad of [null, undefined, { width: 0 }, { width: NaN }]) {
    assert.deepEqual(bodyViewLabelAnchor("head", { x: 200, y: 60 }, bad), { x: 200, y: 60 });
  }
  for (const bad of [null, undefined, { x: NaN, y: 1 }, { x: 1 }]) {
    assert.equal(bodyViewLabelAnchor("head", bad, box), null);
  }
});

test("the moved label is still pushed inside the frame afterwards", () => {
  /* The two rules stack: past the head first, then back inside the edge. */
  const dot = { x: 20, y: 60 };
  const aside = bodyViewLabelAnchor("head", dot, box);
  assert.ok(aside.x < 0, "the head gap alone would put it outside");
  const inside = clampLabelWithin(aside, box, { width: 60, height: 24 });
  assert.equal(inside.x, 30, "and the edge rule brings it back");
});

/* ------------------- a reading that rounds to nothing -------------------- */

test("a tilt that rounds to zero is kept, but not drawn on the body", () => {
  /* Pointing at a shoulder and writing 0 reads as if something is there.
     What it means is that there is no tilt to point at. */
  const reading = readingFor("shoulder", 0.4);
  assert.ok(reading, "the reading is still produced");
  assert.equal(reading.value, 0.4, "and its value is untouched");
  assert.ok(reading.at, "it even knows where it was taken");
  assert.equal(bodyViewMarkerShows(reading), false, "it is simply not drawn there");
});

test("half a degree still rounds to a tilt, and is drawn", () => {
  assert.equal(bodyViewMarkerShows(readingFor("shoulder", 0.5)), true);
  assert.equal(bodyViewMarkerShows(readingFor("shoulder", -0.5)), true, "either way");
  assert.equal(bodyViewMarkerShows(readingFor("shoulder", -0.4)), false, "and either way round to nothing");
});

test("a knee is still kept off the photo, for its own reason", () => {
  const knee = readingFor("knee", 7.2);
  assert.ok(knee, "the reading exists");
  assert.equal(knee.at, null, "it has no place on the body");
  assert.equal(bodyViewMarkerShows(knee), false);
});

test("every reading falls into one list or the other, and none is lost", () => {
  const readings = bodyViewMetrics(measured([
    degrees("shoulder", "어깨", 0.2),
    degrees("pelvis", "골반", 4.1),
    degrees("head", "머리", 0),
    degrees("knee", "무릎", 7.2),
  ]), "front");
  const drawn = readings.filter(bodyViewMarkerShows);
  const listed = readings.filter((metric) => !bodyViewMarkerShows(metric));
  assert.equal(drawn.length + listed.length, readings.length);
  assert.deepEqual(drawn.map((metric) => metric.key), ["pelvis"]);
  assert.deepEqual(listed.map((metric) => metric.key).sort(), ["head", "knee", "shoulder"]);
  assert.deepEqual(listed.map((metric) => metric.value).sort((a, b) => a - b), [0, 0.2, 7.2], "no value was thrown away");
});

test("nothing at all is nothing to draw", () => {
  for (const bad of [null, undefined, {}, { at: null, value: 5, unit: "°" }, { at: { x: 1, y: 1 }, value: NaN, unit: "°" }]) {
    assert.equal(bodyViewMarkerShows(bad), false);
  }
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
