import assert from "node:assert/strict";
import test from "node:test";

import {
  POSTURE_MEASUREMENT_INVALID_REASONS,
  postureMetricValidity,
  validatePostureMeasurement,
  validPostureMetrics,
} from "../../src/features/posture/measurement-validity.js";
import { compareAssessmentMetrics, postureMilestoneTemplate } from "../../src/features/posture/posture-model.js";

const transform = { coordinateSpace: "normalized", width: 1080, height: 1440 };
const shoulders = { shL: { x: 0.35, y: 0.3, score: 0.9 }, shR: { x: 0.65, y: 0.31, score: 0.9 } };

test("all four invalid reasons reject measurements, including a 42.3-degree near-coincident ear fixture", () => {
  const cases = [
    [{ metricKey: "shoulder", points: { shL: shoulders.shL }, transform }, "MISSING_LANDMARK"],
    [{ metricKey: "shoulder", points: { ...shoulders, shR: { ...shoulders.shR, score: 0.2 } }, transform }, "LOW_CONFIDENCE"],
    [{ metricKey: "head", points: { earL: { x: 0.45, y: 0.2, score: 0.9 }, earR: { x: 0.46, y: 0.2091, score: 0.9 } }, transform }, "INVALID_GEOMETRY"],
    [{ metricKey: "shoulder", points: shoulders, transform: { ...transform, width: 0 } }, "INVALID_TRANSFORM"],
  ];
  for (const [input, reason] of cases) assert.deepEqual(validatePostureMeasurement(input), { valid: false, reason });
  assert.deepEqual(Object.values(POSTURE_MEASUREMENT_INVALID_REASONS).sort(), cases.map(([, reason]) => reason).sort());
});

test("valid landmarks and transform keep an existing measurement", () => {
  assert.deepEqual(validatePostureMeasurement({ metricKey: "shoulder", points: shoulders, transform }), { valid: true, reason: null });
  const pose = { pts: shoulders, measurementTransform: transform, metrics: [{ key: "shoulder", value: 2.1 }] };
  assert.equal(validPostureMetrics(pose).length, 1);
});

test("invalid measurements cannot create comparison or milestone descriptions", () => {
  const before = { poses: [{ view: "front", metrics: [{ key: "shoulder", label: "어깨", value: 2, unit: "°", validity: { valid: false, reason: "LOW_CONFIDENCE" } }] }] };
  const after = { poses: [{ view: "front", metrics: [{ key: "shoulder", label: "어깨", value: 42.3, unit: "°", validity: { valid: false, reason: "INVALID_GEOMETRY" } }] }] };
  assert.deepEqual(compareAssessmentMetrics(before, after), []);
  assert.deepEqual(postureMilestoneTemplate({ role: "after", beforeSet: before, afterSet: after }), { text: "애프터 촬영", details: [], metricIds: [] });
});

test("legacy pose points are revalidated while unverifiable legacy values stay hidden", () => {
  const legacyValid = { pts: shoulders, metrics: [{ key: "shoulder", value: 3 }] };
  const legacyUnknown = { metrics: [{ key: "shoulder", value: 3 }] };
  assert.equal(postureMetricValidity(legacyValid.metrics[0], legacyValid).legacy, true);
  assert.equal(validPostureMetrics(legacyValid).length, 1);
  assert.equal(validPostureMetrics(legacyUnknown).length, 0);
});
