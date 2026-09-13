import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compareAssessmentMetrics,
  postureMetricDisplayValue,
  roundHalfAwayFromZero,
} from "../../src/features/posture/posture-model.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

/* One reusable pair of sets whose stored values are rewritten between calls, so
   the sweep below can cover the whole range without rebuilding fixtures. */
function comparisonProbe(unit = "°") {
  const metric = (value) => ({ key: "shoulder", label: "어깨선 각도", value, unit, validity: { valid: true } });
  const beforePose = { view: "front", metrics: [metric(0)] };
  const afterPose = { view: "front", metrics: [metric(0)] };
  const beforeSet = { poses: [beforePose] };
  const afterSet = { poses: [afterPose] };
  return (before, after) => {
    beforePose.metrics[0].value = before;
    afterPose.metrics[0].value = after;
    const [row] = compareAssessmentMetrics(beforeSet, afterSet, { view: "front" });
    return row;
  };
}

/* What the row prints, using the same helper the screen uses. */
const printed = (row) => ({
  before: postureMetricDisplayValue(row.beforeValue, row.unit),
  after: postureMetricDisplayValue(row.afterValue, row.unit),
  difference: postureMetricDisplayValue(row.difference, row.unit),
});

test("a comparison row's three numbers agree across the whole value range", () => {
  const compare = comparisonProbe();
  let checked = 0;

  // Stored angles carry one decimal (r1), so every reachable pair in 0-30 deg
  // is covered at that step. A quarter of these used to contradict themselves.
  for (let beforeTenths = 0; beforeTenths <= 300; beforeTenths += 1) {
    for (let afterTenths = 0; afterTenths <= 300; afterTenths += 1) {
      const before = beforeTenths / 10;
      const after = afterTenths / 10;
      const row = compare(before, after);
      const shown = printed(row);
      assert.equal(
        shown.difference,
        shown.after - shown.before,
        `stored ${before} -> ${after} prints ${shown.before} -> ${shown.after} with 차이 ${shown.difference}`,
      );
      checked += 1;
    }
  }

  assert.equal(checked, 301 * 301);
});

test("equal printed values never carry a non-zero delta", () => {
  const compare = comparisonProbe();
  for (let beforeTenths = 0; beforeTenths <= 300; beforeTenths += 1) {
    for (let afterTenths = 0; afterTenths <= 300; afterTenths += 1) {
      const row = compare(beforeTenths / 10, afterTenths / 10);
      const shown = printed(row);
      if (shown.before === shown.after) {
        assert.equal(shown.difference, 0, `${shown.before}° -> ${shown.after}° must not report a change`);
      }
    }
  }
});

test("the cases reported from the device now read consistently", () => {
  const compare = comparisonProbe();
  // Each of these printed a delta that contradicted the two numbers beside it.
  const reported = [
    { label: "귀-어깨", before: 20.4, after: 17.6, prints: [20, 18], was: -3, now: -2 },
    { label: "복사뼈-귀", before: 1.4, after: 0.5, prints: [1, 1], was: -1, now: 0 },
    // These two happened to line up before, and must not regress.
    { label: "골반-어깨", before: 10, after: 6, prints: [10, 6], was: -4, now: -4 },
    { label: "고관절", before: 4, after: 8, prints: [4, 8], was: 4, now: 4 },
  ];

  for (const { label, before, after, prints, now } of reported) {
    const row = compare(before, after);
    const shown = printed(row);
    assert.deepEqual([shown.before, shown.after], prints, `${label} prints the wrong values`);
    assert.equal(shown.difference, now, `${label} reports the wrong delta`);
    assert.equal(shown.difference, shown.after - shown.before, `${label} still contradicts itself`);
  }
});

test("the stored precision survives even though the row prints whole degrees", () => {
  const row = comparisonProbe()(20.4, 17.6);
  assert.equal(row.beforeValue, 20.4, "the precise before value must not be rounded away");
  assert.equal(row.afterValue, 17.6, "the precise after value must not be rounded away");
  assert.notEqual(row.beforeValue, postureMetricDisplayValue(row.beforeValue, row.unit));
});

test("an improvement and a deterioration of the same size round the same way", () => {
  assert.equal(roundHalfAwayFromZero(2.5), 3);
  assert.equal(roundHalfAwayFromZero(-2.5), -3, "Math.round would give -2 here and break the symmetry");
  assert.equal(roundHalfAwayFromZero(0.5), 1);
  assert.equal(roundHalfAwayFromZero(-0.5), -1);

  for (let tenths = 1; tenths <= 300; tenths += 1) {
    const value = tenths / 10;
    const positive = roundHalfAwayFromZero(value);
    const negative = roundHalfAwayFromZero(-value);
    assert.equal(Math.abs(positive), Math.abs(negative), `${value} and ${-value} must round to the same magnitude`);
    if (positive !== 0) {
      assert.ok(positive > 0 && negative < 0, `${value} and ${-value} must keep opposite signs`);
    }
  }

  // No negative zero reaches the screen.
  assert.equal(Object.is(roundHalfAwayFromZero(-0.4), -0), false);
  assert.equal(comparisonProbe()(1.4, 1.4).difference, 0);
});

test("a non-angle unit keeps its exact values rather than being rounded to whole numbers", () => {
  const row = comparisonProbe("cm")(10.25, 12.75);
  assert.equal(postureMetricDisplayValue(row.beforeValue, "cm"), 10.25);
  const shown = printed(row);
  assert.equal(shown.difference, shown.after - shown.before);
});

test("the screen derives its numbers from the shared rounding rule", async () => {
  const source = await appSource();

  // memberMetricValue must delegate, or the row could print one rule while the
  // delta was computed with another — the defect this guards against.
  assert.match(source, /const memberMetricValue = \(value, unit\) => \{[\s\S]{0,200}?postureMetricDisplayValue\(value, unit\)/);
  assert.doesNotMatch(
    source,
    /const memberMetricValue = [\s\S]{0,200}?Math\.round/,
    "memberMetricValue must not round on its own",
  );

  // The two values still print through that one helper.
  assert.match(source, /\{memberMetricValue\(metric\.beforeValue, metric\.unit\)\}\{metric\.unit\}/);
  assert.match(source, /\{memberMetricValue\(metric\.afterValue, metric\.unit\)\}\{metric\.unit\}/);
  /* The difference is no longer printed as a number of its own; it is stated
     in words. It still comes from metric.difference, which compareAssessmentMetrics
     takes from the same rounding rule -- so the sentence cannot disagree with
     the pair above it either. */
  assert.match(source, /\{postureMetricChangeText\(metric\.difference, metric\.unit\)\}/);
  const model = await readFile(new URL("../../src/features/posture/posture-model.js", import.meta.url), "utf8");
  assert.match(model, /const difference = postureMetricDisplayValue\(afterValue, unit\) - postureMetricDisplayValue\(beforeValue, unit\);/,
    "the delta is still the difference of the two printed numbers");
});
