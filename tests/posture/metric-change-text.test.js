import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { POSTURE_CHANGE_TOLERANCE_DEG, compareAssessmentMetrics, postureMetricChangeText } from "../../src/features/posture/posture-model.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

/* ---------------------- what the line is allowed to say ----------------- */

test("a real change is stated as a size and a direction of the number", () => {
  assert.equal(postureMetricChangeText(-2), "변화 2° 감소");
  assert.equal(postureMetricChangeText(3), "변화 3° 증가");
  assert.equal(postureMetricChangeText(-11), "변화 11° 감소");
});

test("nothing in the line claims improvement or deterioration", () => {
  /* A smaller angle is not the same thing as a better posture, and that call
     belongs to the instructor. */
  for (const value of [-9, -2, 0, 2, 9]) {
    const text = postureMetricChangeText(value);
    for (const word of ["개선", "악화", "좋", "나빠", "호전", "정상", "비정상"]) {
      assert.ok(!text.includes(word), `"${text}" must not contain ${word}`);
    }
  }
});

test("nothing in the line claims a side", () => {
  /* The stored metric is the size of an angle. Which side rose is not in it,
     so the sentence cannot say. */
  for (const value of [-7, -2, 0, 2, 7]) {
    const text = postureMetricChangeText(value);
    for (const word of ["왼", "오른", "좌", "우"]) {
      assert.ok(!text.includes(word), `"${text}" must not contain ${word}`);
    }
  }
});

/* --------------------- the shooting-tolerance floor --------------------- */

test("a difference inside the shooting tolerance is not a change", () => {
  // Camera angle and how the member happens to stand move it this much.
  assert.equal(POSTURE_CHANGE_TOLERANCE_DEG, 2);
  /* Saying only "변화 없음" reads as a contradiction of the 3° and 2° printed
     right above it: two readings 0.2° apart land on different integers when a
     rounding boundary falls between them. The line states the difference and
     why it is not read as a change. */
  assert.equal(postureMetricChangeText(0), "0° 차이 · 촬영 오차 범위");
  assert.equal(postureMetricChangeText(1), "1° 차이 · 촬영 오차 범위");
  assert.equal(postureMetricChangeText(-1), "1° 차이 · 촬영 오차 범위", "the sign is not shown");
});

test("the tolerance is a floor, not a window that swallows it", () => {
  // Exactly at the tolerance is already a change.
  assert.equal(postureMetricChangeText(2), "변화 2° 증가");
  assert.equal(postureMetricChangeText(-2), "변화 2° 감소");
});

test("a signed zero reads as no change, not as a decrease", () => {
  assert.equal(postureMetricChangeText(-0), "0° 차이 · 촬영 오차 범위");
});

test("a non-angle unit gets no degree tolerance", () => {
  /* The tolerance is about photographing an angle. Applying it to some other
     unit would silently hide a real difference. */
  assert.equal(postureMetricChangeText(1, "kg"), "변화 1kg 증가");
  assert.equal(postureMetricChangeText(-1, "kg"), "변화 1kg 감소");
  assert.equal(postureMetricChangeText(0, "kg"), "0kg 차이 · 촬영 오차 범위");
});

test("a value that is not a number produces no line at all", () => {
  for (const value of [null, undefined, NaN, "", "abc", Infinity]) {
    assert.equal(postureMetricChangeText(value), null, `${String(value)} must not be rendered`);
  }
});

/* ------------- it reads the same numbers the row prints ----------------- */

test("the line agrees with the two values shown above it", () => {
  /* compareAssessmentMetrics already takes its difference from the rounded
     values, so the line can never contradict the pair beside it. */
  const pose = (view, value) => ({ view, metrics: [{ key: "shoulder", label: "어깨선 각도", value, unit: "°", validity: { valid: true } }] });
  const before = { poses: [pose("front", 20.4)] };
  const after = { poses: [pose("front", 18.4)] };
  const [metric] = compareAssessmentMetrics(before, after, { view: "front" });
  assert.equal(metric.beforeValue, 20.4);
  assert.equal(metric.afterValue, 18.4);
  assert.equal(metric.difference, -2, "20 - 18, the numbers on screen");
  assert.equal(postureMetricChangeText(metric.difference, metric.unit), "변화 2° 감소");
});

test("two readings that print the same never read as a change", () => {
  const pose = (view, value) => ({ view, metrics: [{ key: "fha", label: "귀-어깨", value, unit: "°", validity: { valid: true } }] });
  const [metric] = compareAssessmentMetrics({ poses: [pose("front", 1.4)] }, { poses: [pose("front", 0.6)] }, { view: "front" });
  assert.equal(metric.difference, 0, "both print 1");
  assert.equal(postureMetricChangeText(metric.difference, metric.unit), "0° 차이 · 촬영 오차 범위");
});

/* ------------------------------ the layout ------------------------------ */

test("Before and After are split into halves with the label above", async () => {
  const source = await appSource();
  const start = source.indexOf("<div className=\"mt-2 space-y-2\">{metrics.map(");
  const block = source.slice(start, start + 1400);
  assert.match(block, /\{metric\.label\}/);
  assert.match(block, /grid grid-cols-2 gap-2/);
  assert.match(block, />BEFORE<\/span>/);
  assert.match(block, />AFTER<\/span>/);
  assert.match(block, /\{memberMetricValue\(metric\.beforeValue, metric\.unit\)\}\{metric\.unit\}/);
  assert.match(block, /\{memberMetricValue\(metric\.afterValue, metric\.unit\)\}\{metric\.unit\}/);
});

test("the summary is one centred line under the pair", async () => {
  const source = await appSource();
  assert.match(source, /<p className="mt-1 text-center text-\[11px\] font-bold" style=\{\{ color: SUB \}\}>\{postureMetricChangeText\(metric\.difference, metric\.unit\)\}<\/p>/);
});

test("the run-on row with a signed difference is gone", async () => {
  const source = await appSource();
  /* "Before 20° · After 18° · 차이 -3°" was one line of five numbers, and the
     signed difference is what made -3 next to 20 and 18 look wrong. */
  assert.doesNotMatch(source, /차이 \{metric\.difference > 0 \? "\+" : ""\}/);
  assert.doesNotMatch(source, /Before \{memberMetricValue\(metric\.beforeValue/);
});

test("the wording lives in one place", async () => {
  const source = await appSource();
  // The screen never assembles the sentence itself.
  assert.equal((source.match(/postureMetricChangeText\(/g) || []).length, 1);
  const start = source.indexOf("<div className=\"mt-2 space-y-2\">{metrics.map(");
  const block = source.slice(start, start + 1400);
  assert.doesNotMatch(block, /증가|감소|변화 없음/, "the comparison screen holds no copy of the wording");
});
