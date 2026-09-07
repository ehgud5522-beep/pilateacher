import { postureMetricValidity } from "./measurement-validity.js";

export const POSTURE_RESULT_STATUSES = Object.freeze([
  "좌우 비슷함",
  "오른쪽 약간 높음",
  "왼쪽 약간 높음",
  "오른쪽 기울어짐",
  "왼쪽 기울어짐",
  "좌우 정렬 차이 있음",
  "측정 재확인",
]);

// Reuse the former measurement display boundaries; this selector only replaces
// numeric presentation with neutral wording and does not change measurement math.
const CORE_RESULT_METRICS = Object.freeze([
  { key: "shoulder", label: "어깨", threshold: 2, left: "shL", right: "shR", directional: "height" },
  { key: "pelvis", label: "골반", threshold: 2, left: "hipL", right: "hipR", directional: "height" },
  { key: "knee", label: "무릎", threshold: 3, directional: "alignment" },
  { key: "head", label: "머리", threshold: 2, left: "earL", right: "earR", directional: "tilt" },
]);

const sideFromPoints = (points, leftKey, rightKey) => {
  const left = points?.[leftKey];
  const right = points?.[rightKey];
  if (!left || !right || !Number.isFinite(Number(left.y)) || !Number.isFinite(Number(right.y))) return null;
  return Number(left.y) < Number(right.y) ? "left" : "right";
};

const validStatus = (definition, metric, points) => {
  if (!Number.isFinite(Number(metric?.value))) return "측정 재확인";
  if (Math.abs(Number(metric?.value)) <= definition.threshold) return "좌우 비슷함";
  if (definition.directional === "alignment") return "좌우 정렬 차이 있음";
  const side = sideFromPoints(points, definition.left, definition.right);
  if (!side) return "측정 재확인";
  if (definition.directional === "height") return side === "left" ? "왼쪽 약간 높음" : "오른쪽 약간 높음";
  return side === "left" ? "왼쪽 기울어짐" : "오른쪽 기울어짐";
};

export function selectPostureResultStates({ metrics = [], invalidMeasurements = [], points = {} } = {}) {
  const metricByKey = new Map((metrics || []).map((metric) => [metric?.key, metric]));
  const invalidKeys = new Set((invalidMeasurements || []).map((entry) => entry?.key));
  return CORE_RESULT_METRICS.flatMap((definition) => {
    if (invalidKeys.has(definition.key)) return [{ key: definition.key, label: definition.label, status: "측정 재확인" }];
    const metric = metricByKey.get(definition.key);
    if (!metric) return [];
    return [{ key: definition.key, label: definition.label, status: validStatus(definition, metric, points) }];
  }).slice(0, 4);
}

export function selectStoredPostureResultStates(pose) {
  const metrics = pose?.metrics || [];
  const invalidMeasurements = metrics.flatMap((metric) => {
    const validity = postureMetricValidity(metric, pose);
    return validity.valid ? [] : [{ key: metric?.key, reason: validity.reason }];
  });
  return selectPostureResultStates({ metrics, invalidMeasurements, points: pose?.pts || {} });
}
