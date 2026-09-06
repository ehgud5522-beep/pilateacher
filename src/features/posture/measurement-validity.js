export const POSTURE_MEASUREMENT_INVALID_REASONS = Object.freeze({
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
  INVALID_GEOMETRY: "INVALID_GEOMETRY",
  MISSING_LANDMARK: "MISSING_LANDMARK",
  INVALID_TRANSFORM: "INVALID_TRANSFORM",
});

const REQUIREMENTS = Object.freeze({
  shoulder: { required: ["shL", "shR"], pairs: [["shL", "shR"]] },
  pelvis: { required: ["hipL", "hipR"], pairs: [["hipL", "hipR"]] },
  twist: { required: ["shL", "shR", "hipL", "hipR"], pairs: [["shL", "shR"], ["hipL", "hipR"]] },
  knee: { required: ["hipL", "kneeL", "ankL", "hipR", "kneeR", "ankR"], pairs: [["hipL", "kneeL"], ["kneeL", "ankL"], ["hipR", "kneeR"], ["kneeR", "ankR"]] },
  head: { required: ["earL", "earR"], pairs: [["earL", "earR"]] },
  fha: { required: ["ear", "sh"], pairs: [["ear", "sh"]] },
  trunk: { required: ["hip", "sh"], pairs: [["hip", "sh"]] },
  kneeSide: { required: ["hip", "knee", "ank"], pairs: [["hip", "knee"], ["knee", "ank"]] },
  align: { required: ["ank", "ear"], pairs: [["ank", "ear"]] },
});

function finitePoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

export function validatePostureMeasurement({
  metricKey,
  points,
  transform = { coordinateSpace: "normalized", width: 1, height: 1 },
  minConfidence = 0.5,
  minimumPairDistance = 0.02,
} = {}) {
  const spec = REQUIREMENTS[metricKey];
  const source = points && typeof points === "object" ? points : {};
  const width = Number(transform?.width), height = Number(transform?.height);
  if (transform?.coordinateSpace !== "normalized" || !(width > 0) || !(height > 0) || transform?.referenceValid === false) {
    return { valid: false, reason: POSTURE_MEASUREMENT_INVALID_REASONS.INVALID_TRANSFORM };
  }
  if (!spec || spec.required.some((key) => !finitePoint(source[key]))) {
    return { valid: false, reason: POSTURE_MEASUREMENT_INVALID_REASONS.MISSING_LANDMARK };
  }
  if (spec.required.some((key) => Number(source[key].x) < 0 || Number(source[key].x) > 1 || Number(source[key].y) < 0 || Number(source[key].y) > 1)) {
    return { valid: false, reason: POSTURE_MEASUREMENT_INVALID_REASONS.INVALID_TRANSFORM };
  }
  if (spec.required.some((key) => Number(source[key].score ?? 1) < minConfidence)) {
    return { valid: false, reason: POSTURE_MEASUREMENT_INVALID_REASONS.LOW_CONFIDENCE };
  }
  if (spec.pairs.some(([left, right]) => Math.hypot(Number(source[left].x) - Number(source[right].x), Number(source[left].y) - Number(source[right].y)) < minimumPairDistance)) {
    return { valid: false, reason: POSTURE_MEASUREMENT_INVALID_REASONS.INVALID_GEOMETRY };
  }
  return { valid: true, reason: null };
}

export function postureMetricValidity(metric, pose) {
  if (metric?.validity?.valid === true) return metric.validity;
  if (metric?.validity?.valid === false) return metric.validity;
  if (!pose?.pts) return { valid: false, reason: POSTURE_MEASUREMENT_INVALID_REASONS.MISSING_LANDMARK, legacy: true };
  return { ...validatePostureMeasurement({
    metricKey: metric?.key,
    points: pose.pts,
    transform: pose.measurementTransform || { coordinateSpace: "normalized", width: 1, height: 1 },
    minConfidence: Number(pose?.confidence?.threshold) || 0.5,
  }), legacy: true };
}

export function validPostureMetrics(pose) {
  return (pose?.metrics || []).filter((metric) => postureMetricValidity(metric, pose).valid);
}

export function postureRecordHasInvalidMeasurements(pose) {
  return (pose?.metrics || []).some((metric) => !postureMetricValidity(metric, pose).valid);
}
