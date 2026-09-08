import assert from "node:assert/strict";
import test from "node:test";

import {
  BODY_VIEW_ALIGNMENT, POSTURE_ALIGNMENT_SCALE_MAX, POSTURE_ALIGNMENT_SCALE_MIN,
  POSTURE_VIEW_KEYS, bodyViewMetrics, compareAssessmentMetrics,
  composeBodyViewAlignment, postureAlignmentTransform,
} from "../../src/features/posture/posture-model.js";

/* ------------------------------ fixtures -------------------------------- */

const pt = (x, y) => ({ x, y, score: 1 });

/* A body standing between `top` and `bottom`, centred on `cx`. The alignment
   reads the head, the floor and the centre of the trunk, so those three are
   what these fixtures vary. */
const frontPts = ({ top = 0.08, bottom = 0.92, cx = 0.5 } = {}) => ({
  nose: pt(cx, top),
  earL: pt(cx - 0.03, top + 0.01), earR: pt(cx + 0.03, top + 0.01),
  shL: pt(cx - 0.1, top + 0.15), shR: pt(cx + 0.1, top + 0.15),
  hipL: pt(cx - 0.08, (top + bottom) / 2), hipR: pt(cx + 0.08, (top + bottom) / 2),
  kneeL: pt(cx - 0.07, bottom - 0.15), kneeR: pt(cx + 0.07, bottom - 0.15),
  ankL: pt(cx - 0.06, bottom), ankR: pt(cx + 0.06, bottom),
  footL: pt(cx - 0.06, bottom), footR: pt(cx + 0.06, bottom),
});

const sidePts = ({ top = 0.08, bottom = 0.92, cx = 0.5 } = {}) => ({
  ear: pt(cx, top), sh: pt(cx, top + 0.15), hip: pt(cx, (top + bottom) / 2),
  knee: pt(cx, bottom - 0.15), ank: pt(cx, bottom), foot: pt(cx, bottom),
});

const ptsFor = (view, box) => (view === "front" || view === "back" ? frontPts(box) : sidePts(box));

const pose = (view, { box, metrics = [], pts } = {}) => ({
  id: `p_${view}`, view, src: `blob:${view}`, cleanBlobId: `clean_${view}`, blobId: `raw_${view}`,
  pts: pts === undefined ? ptsFor(view, box) : pts, metrics,
});

const assessment = (poses, { id = "a1", at = "2026-09-01T00:00:00Z" } = {}) => ({
  id, status: "completed", scope: "full_body", at, completedAt: at, date: at.slice(0, 10),
  poses,
  photos: Object.fromEntries(poses.map((item) => [item.view, { id: item.id, blobId: item.blobId, cleanBlobId: item.cleanBlobId }])),
});

const entryOf = (result, view) => result.views.find((entry) => entry.view === view);
const statusOf = (result, view) => entryOf(result, view)?.status;

/* --------------------------- choosing the base --------------------------- */

test("the base is the front when the front is there", () => {
  const result = composeBodyViewAlignment(assessment(POSTURE_VIEW_KEYS.map((view) => pose(view))));
  assert.equal(result.baseView, "front");
  assert.equal(entryOf(result, "front").isBase, true);
});

test("without a front the back is the base, not the nearer side", () => {
  /* front and back are the same plane, so fitting the sides to a back asks
     less than fitting the back to a side. */
  const result = composeBodyViewAlignment(assessment([pose("leftSide"), pose("back"), pose("rightSide")]));
  assert.equal(result.baseView, "back");
});

test("with neither front nor back the left side is the base", () => {
  const result = composeBodyViewAlignment(assessment([pose("rightSide"), pose("leftSide")]));
  assert.equal(result.baseView, "leftSide");
});

test("a right side on its own is still a base", () => {
  const result = composeBodyViewAlignment(assessment([pose("rightSide")]));
  assert.equal(result.baseView, "rightSide");
  assert.equal(statusOf(result, "rightSide"), BODY_VIEW_ALIGNMENT.aligned);
});

test("a photo without usable landmarks is not a base candidate", () => {
  /* The photo is there and shows fine. It just cannot say where the body is,
     and every other direction would then be fitted to that guess. */
  const result = composeBodyViewAlignment(assessment([pose("front", { pts: {} }), pose("back")]));
  assert.equal(result.baseView, "back");
  assert.equal(entryOf(result, "front").hasPhoto, true, "the photo still counts as present");
  assert.equal(statusOf(result, "front"), BODY_VIEW_ALIGNMENT.missingAnchor);
});

test("a body too small in the frame is not a base candidate either", () => {
  // 0.15 of the frame is not a standing body; it is a mis-framed shot.
  const result = composeBodyViewAlignment(assessment([pose("front", { box: { top: 0.7, bottom: 0.85 } }), pose("back")]));
  assert.equal(result.baseView, "back");
  assert.equal(statusOf(result, "front"), BODY_VIEW_ALIGNMENT.missingAnchor);
});

test("when no direction can anchor, nothing is aligned and nothing throws", () => {
  const result = composeBodyViewAlignment(assessment([pose("front", { pts: {} }), pose("back", { pts: {} })]));
  assert.equal(result.baseView, null);
  assert.equal(result.views.length, POSTURE_VIEW_KEYS.length);
  for (const entry of result.views) {
    assert.equal(entry.status, BODY_VIEW_ALIGNMENT.missingAnchor);
    assert.equal(entry.transform, null);
  }
});

test("an empty assessment answers instead of failing", () => {
  for (const input of [null, undefined, {}, { poses: [] }]) {
    const result = composeBodyViewAlignment(input);
    assert.equal(result.baseView, null);
    assert.deepEqual(result.views.map((entry) => entry.view), [...POSTURE_VIEW_KEYS]);
    assert.ok(result.views.every((entry) => entry.hasPhoto === false && entry.hasPose === false));
  }
});

/* ---------------------------- what it returns ---------------------------- */

test("every direction is reported, in the order they are shot", () => {
  const result = composeBodyViewAlignment(assessment([pose("front")]));
  assert.deepEqual(result.views.map((entry) => entry.view), ["front", "leftSide", "back", "rightSide"]);
});

test("a direction never shot is told apart from one that failed to anchor", () => {
  /* The screen greys out the first and quietly skips aligning the second. If
     both read the same, an unshot direction would look broken. */
  const result = composeBodyViewAlignment(assessment([pose("front"), pose("back", { pts: {} })]));
  assert.equal(entryOf(result, "leftSide").hasPhoto, false);
  assert.equal(entryOf(result, "leftSide").hasPose, false);
  assert.equal(entryOf(result, "back").hasPhoto, true);
  assert.equal(entryOf(result, "back").hasPose, true);
});

test("the base sits where it already is", () => {
  const result = composeBodyViewAlignment(assessment([pose("front"), pose("back")]));
  assert.deepEqual(entryOf(result, "front").transform, { scale: 1, offsetX: 0, offsetY: 0 });
});

test("an aligned direction lands the body where the base has it", () => {
  /* This is the whole point: after the transform the two bodies are the same
     height and stand on the same spot, so switching does not make them jump. */
  const base = { top: 0.08, bottom: 0.88, cx: 0.5 };
  const other = { top: 0.2, bottom: 0.8, cx: 0.4 };
  const result = composeBodyViewAlignment(assessment([pose("front", { box: base }), pose("back", { box: other })]));
  const { scale, offsetX, offsetY } = entryOf(result, "back").transform;
  const place = (value) => 0.5 + scale * (value - 0.5);
  assert.ok(Math.abs(scale * (other.bottom - other.top) - (base.bottom - base.top)) < 1e-3, "same height");
  assert.ok(Math.abs(place(other.cx) + offsetX - base.cx) < 1e-3, "the same standing spot across");
  assert.ok(Math.abs(place(other.bottom) + offsetY - base.bottom) < 1e-3, "feet on the same line");
});

test("a scale that would distort the photo is refused, and only for that direction", () => {
  /* 0.8 of the frame against 0.3 is not one person shot from two sides;
     something is wrong with one of them. Stretching it would invent a body. */
  const result = composeBodyViewAlignment(assessment([
    pose("front", { box: { top: 0.1, bottom: 0.9 } }),
    pose("back", { box: { top: 0.55, bottom: 0.85 } }),
    pose("leftSide", { box: { top: 0.12, bottom: 0.9 } }),
  ]));
  assert.equal(statusOf(result, "back"), BODY_VIEW_ALIGNMENT.unsafeScale);
  assert.equal(entryOf(result, "back").transform, null);
  assert.equal(statusOf(result, "leftSide"), BODY_VIEW_ALIGNMENT.aligned, "one bad shot does not spoil the rest");
});

test("the refusal boundary is the one the comparison view already uses", () => {
  /* Two places decide the same thing. If one moved and the other did not, the
     body view and the comparison screen would disagree about the same pair. */
  const box = (height) => ({ top: 0.9 - height, bottom: 0.9 });
  for (const [scale, allowed] of [[POSTURE_ALIGNMENT_SCALE_MIN * 0.95, false], [1, true], [POSTURE_ALIGNMENT_SCALE_MAX * 1.05, false]]) {
    const basePose = pose("front", { box: box(0.8) });
    const otherPose = pose("back", { box: box(0.8 / scale) });
    const composed = statusOf(composeBodyViewAlignment(assessment([basePose, otherPose])), "back");
    const pairwise = postureAlignmentTransform(basePose, otherPose, { view: "front" });
    assert.equal(composed === BODY_VIEW_ALIGNMENT.aligned, allowed, `scale ${scale}`);
    assert.equal(pairwise.available, allowed, `the pairwise transform agrees at ${scale}`);
  }
});

test("the alignment is worked out, never stored on the record", () => {
  /* It comes back the same from the photos every time, so keeping a copy would
     only give the saved record a second answer that can go stale. */
  const input = assessment([pose("front"), pose("back")]);
  const snapshot = JSON.stringify(input);
  composeBodyViewAlignment(input);
  assert.equal(JSON.stringify(input), snapshot, "the assessment is untouched");
  assert.ok(!snapshot.includes("alignment"), "nothing named alignment was on it to begin with");
});

/* ------------------------------ the markers ------------------------------ */

const valid = { valid: true };
const m = (key, label, value) => ({ key, label, value, unit: "°", validity: valid });

test("a direction shows the numbers measured on its own photo", () => {
  /* front and back both have a 어깨선. Reading one off the other would put a
     body the instructor is not looking at under the label of one they are. */
  const set = assessment([
    pose("front", { metrics: [m("shoulder", "어깨선 각도", 3.2)] }),
    pose("back", { metrics: [m("shoulder", "어깨선 각도", 7.1)] }),
  ]);
  assert.equal(bodyViewMetrics(set, "front")[0].value, 3.2);
  assert.equal(bodyViewMetrics(set, "back")[0].value, 7.1);
});

test("a direction with no readings shows none, and that is not an error", () => {
  const set = assessment([pose("front", { metrics: [m("shoulder", "어깨선 각도", 3)] }), pose("back", { metrics: [] })]);
  assert.deepEqual(bodyViewMetrics(set, "back"), []);
  assert.equal(bodyViewMetrics(set, "front").length, 1, "the other direction is unaffected");
});

test("a direction that was never shot yields nothing rather than borrowing", () => {
  const set = assessment([pose("front", { metrics: [m("shoulder", "어깨선 각도", 3)] })]);
  assert.deepEqual(bodyViewMetrics(set, "leftSide"), []);
});

test("each marker sits on the landmark it was measured from", () => {
  const set = assessment([pose("front", {
    box: { top: 0.1, bottom: 0.9, cx: 0.5 },
    metrics: [m("shoulder", "어깨선 각도", 3), m("pelvis", "골반선 각도", 2), m("head", "귀선 각도", 1)],
  })]);
  const at = Object.fromEntries(bodyViewMetrics(set, "front").map((row) => [row.key, row.at]));
  assert.deepEqual(at.shoulder, { x: 0.5, y: 0.25 }, "between the two shoulders");
  assert.deepEqual(at.pelvis, { x: 0.5, y: 0.5 }, "between the two hips");
  assert.deepEqual(at.head, { x: 0.5, y: 0.11 }, "between the two ears");
});

test("the marker does not move when the reading moves", () => {
  /* A marker that drifted with the number would read as the body having moved
     somewhere else, which is not what was measured. */
  const box = { top: 0.1, bottom: 0.9, cx: 0.5 };
  const small = assessment([pose("front", { box, metrics: [m("shoulder", "어깨선 각도", 1)] })]);
  const large = assessment([pose("front", { box, metrics: [m("shoulder", "어깨선 각도", 14)] })]);
  assert.deepEqual(bodyViewMetrics(small, "front")[0].at, bodyViewMetrics(large, "front")[0].at);
});

test("a side photo carries the side readings", () => {
  const set = assessment([pose("leftSide", {
    metrics: [m("fha", "귀-어깨 수직선 각도", 12), m("trunk", "골반-어깨 수직선 각도", 4)],
  })]);
  const rows = bodyViewMetrics(set, "leftSide");
  assert.deepEqual(rows.map((row) => row.key).sort(), ["fha", "trunk"]);
  assert.ok(rows.every((row) => row.at && Number.isFinite(row.at.x) && Number.isFinite(row.at.y)));
});

test("the knee reading keeps its number but is given no place on the body", () => {
  /* It is the more bent of the two knees, and which one that was is not in the
     record. Dropping it between them would put a number on a joint that was
     not the one measured. */
  const set = assessment([pose("front", {
    metrics: [m("shoulder", "어깨선 각도", 3), m("knee", "무릎선 각도", 6.4)],
  })]);
  const rows = bodyViewMetrics(set, "front");
  const knee = rows.find((row) => row.key === "knee");
  assert.ok(knee, "the reading is still reported");
  assert.equal(knee.value, 6.4, "the stored number is untouched");
  assert.equal(knee.at, null, "and it claims no spot");
  assert.ok(rows.find((row) => row.key === "shoulder").at, "the ones that do know stay placed");
});

test("a reading whose landmark is unknown is reported without a place", () => {
  /* Losing it would say it was never measured. */
  const set = assessment([pose("front", { metrics: [m("mystery", "알 수 없음", 9)] })]);
  const [row] = bodyViewMetrics(set, "front");
  assert.equal(row.key, "mystery");
  assert.equal(row.at, null);
});

/* ------------------------- the reading before it ------------------------- */

const previousSet = assessment([
  pose("front", { metrics: [m("shoulder", "어깨선 각도", 8.2)] }),
  pose("back", { metrics: [m("shoulder", "어깨선 각도", 2.1)] }),
], { id: "a0", at: "2026-08-01T00:00:00Z" });

const currentSet = assessment([
  pose("front", { metrics: [m("shoulder", "어깨선 각도", 3.4)] }),
  pose("back", { metrics: [m("shoulder", "어깨선 각도", 2.4)] }),
]);

test("with no earlier record there is no earlier reading to show", () => {
  const [row] = bodyViewMetrics(currentSet, "front");
  assert.equal(row.previousValue, null);
  assert.equal(row.difference, null);
});

test("the earlier reading and the change follow the comparison view's rule", () => {
  const [row] = bodyViewMetrics(currentSet, "front", { previousAssessment: previousSet });
  const [reference] = compareAssessmentMetrics(previousSet, currentSet, { view: "front" });
  assert.equal(row.previousValue, reference.beforeValue);
  assert.equal(row.difference, reference.difference);
});

test("the earlier reading is taken from the same direction", () => {
  /* Otherwise the back's 2.1 would be offered as the front's previous value,
     and the change shown would be between two different photographs. */
  assert.equal(bodyViewMetrics(currentSet, "back", { previousAssessment: previousSet })[0].previousValue, 2.1);
  assert.equal(bodyViewMetrics(currentSet, "front", { previousAssessment: previousSet })[0].previousValue, 8.2);
});

test("a marker row states no verdict", () => {
  const serialized = JSON.stringify(bodyViewMetrics(currentSet, "front", { previousAssessment: previousSet }));
  for (const word of ["개선", "악화", "좋", "나빠", "호전", "정상"]) {
    assert.ok(!serialized.includes(word), `a marker must not carry "${word}"`);
  }
});

test("the row carries the date the reading was taken", () => {
  const [row] = bodyViewMetrics(currentSet, "front", { previousAssessment: previousSet });
  assert.match(String(row.measuredAt), /^2026-09-01/);
});
