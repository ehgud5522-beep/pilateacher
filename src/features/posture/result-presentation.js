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

/* 상태값을 낼 수 있는 항목. 화면과 결과 카드가 같은 목록을 봐야 한 쪽만 늘어나는
   일이 생기지 않는다. */
export const POSTURE_RESULT_METRIC_KEYS = Object.freeze(CORE_RESULT_METRICS.map(({ key }) => key));

export const MANUAL_ONLY_RESULT_NOTICE = "AI가 사람을 찾지 못해 관절을 모두 직접 지정한 결과입니다";

/* 사람이 없는 사진에서도 각도가 나온다는 신고가 있었다.

   측정 게이트는 항목별 기하만 본다 -- 점이 있는지, 범위 안인지, 신뢰도가 되는지.
   손으로 찍은 점은 신뢰도 1 로 저장되므로 그 검사를 통과한다. 즉 게이트는 사진에
   사람이 있는지 묻지 않는다.

   길 자체는 남겨 둔다. 조명이 나쁘거나 옷이 겹친 사진을 살리려고 만든 길이다.
   대신 그렇게 나온 결과에는 어떻게 나왔는지를 붙인다.

   판정하지 않는다. 점수도 매기지 않는다. 저장된 값이 이미 말하고 있는 사실만
   읽는다 -- AI 가 아무 점도 내놓지 못했고(originalPts 없음), 모든 점이 손으로
   찍혔다(source 가 전부 "manual"). AI 점을 끌어 옮긴 것은 "manual-corrected" 로
   남으므로 여기에 섞이지 않는다. */
export function isFullyManualAfterAiMiss(pose) {
  if (!pose || typeof pose !== "object") return false;
  // 처음부터 직접 찍기를 고른 경우는 AI 가 실패한 것이 아니다.
  if (!String(pose.analysisSource || "").startsWith("ai")) return false;
  const original = pose.originalPts;
  if (original && Object.keys(original).length > 0) return false;
  const points = pose.pts;
  if (!points || typeof points !== "object") return false;
  const entries = Object.values(points).filter(Boolean);
  if (!entries.length) return false;
  return entries.every((point) => point.source === "manual");
}

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
