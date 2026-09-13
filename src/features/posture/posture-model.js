export const POSTURE_RETAKE_DAYS = Object.freeze({
  upcoming: 30,
  recommended: 45,
});

import { validPostureMetrics } from "./measurement-validity.js";

export const POSTURE_VIEW_DEFS = Object.freeze([
  Object.freeze({ key: "front", label: "전면", analysisPlane: "front" }),
  Object.freeze({ key: "leftSide", label: "좌측면", analysisPlane: "side" }),
  Object.freeze({ key: "back", label: "후면", analysisPlane: "front" }),
  Object.freeze({ key: "rightSide", label: "우측면", analysisPlane: "side" }),
]);

export const POSTURE_VIEW_KEYS = Object.freeze(POSTURE_VIEW_DEFS.map(({ key }) => key));
export const POSTURE_STORAGE_KEYS = Object.freeze(["front", "leftSide", "side", "back", "rightSide", "custom"]);

export function normalizePostureView(view) {
  return view === "side" ? "leftSide" : view;
}

export function postureViewLabel(view) {
  const key = normalizePostureView(view);
  if (key === "custom") return "부위";
  return POSTURE_VIEW_DEFS.find((item) => item.key === key)?.label || String(view || "방향 미확인");
}

export function postureAnalysisPlane(view) {
  const key = normalizePostureView(view);
  if (key === "leftSide" || key === "rightSide") return "side";
  if (key === "back") return "front";
  return key;
}

function stampOf(record) {
  return String(record?.completedAt || record?.updatedAt || record?.annotationUpdatedAt || record?.createdAt || record?.at || (record?.date ? `${record.date}T00:00:00.000Z` : ""));
}

function calendarDate(value) {
  return String(value || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || "";
}

function recordAssessmentDate(record) {
  return calendarDate(record?.date) || calendarDate(record?.completedAt) || calendarDate(record?.createdAt) || calendarDate(record?.at);
}

function mediaIdentity(record) {
  return String(record?.id || record?.photoId || record?.blobId || "").trim();
}

function newest(current, incoming) {
  if (!current) return incoming;
  const currentTime = Date.parse(stampOf(current));
  const incomingTime = Date.parse(stampOf(incoming));
  if (Number.isFinite(currentTime) && Number.isFinite(incomingTime)) return incomingTime >= currentTime ? incoming : current;
  return stampOf(incoming) >= stampOf(current) ? incoming : current;
}

function hasMedia(set, view) {
  return Boolean(set.photos[view]);
}

export function normalizeAssessmentSets(photos, { memberId = null } = {}) {
  const groups = new Map();
  const ensure = (id) => {
    const key = String(id || "");
    if (!key) return null;
    const current = groups.get(key) || {
      id: key,
      memberId: memberId || null,
      scope: "full_body",
      selectedViews: [],
      photos: {},
      poses: [],
      role: null,
      method: "ai",
      status: "draft",
      favorite: false,
      at: "",
      date: "",
      completedAt: "",
      mediaIds: [],
    };
    groups.set(key, current);
    return current;
  };

  POSTURE_STORAGE_KEYS.forEach((storageKey) => {
    (photos?.[storageKey] || []).filter(Boolean).forEach((photo) => {
      if (!photo?.assessmentId || (memberId && photo.memberId && photo.memberId !== memberId)) return;
      const group = ensure(photo.assessmentId);
      if (!group) return;
      const view = normalizePostureView(photo.view || storageKey);
      group.memberId = group.memberId || photo.memberId || null;
      group.photos[view] = newest(group.photos[view], { ...photo, view });
      group.scope = photo.scope || group.scope;
      group.role = photo.assessmentRole || group.role;
      group.method = photo.analysisMethod || group.method;
      group.status = photo.assessmentStatus || group.status;
      group.at = [group.at, stampOf(photo)].sort().at(-1) || "";
      group.date = group.date || recordAssessmentDate(photo);
      group.completedAt = [group.completedAt, photo.completedAt || ""].sort().at(-1) || "";
      const identity = mediaIdentity(photo);
      if (identity && !group.mediaIds.includes(identity)) group.mediaIds.push(identity);
      group.favorite = group.favorite || Boolean(photo.favorite);
      const selected = Array.isArray(photo.selectedViews) ? photo.selectedViews : [];
      group.selectedViews = [...new Set([...group.selectedViews, ...selected.map(normalizePostureView), view])];
    });
  });

  (photos?.poses || []).filter(Boolean).forEach((pose) => {
    const id = pose.assessmentId || `legacy_${pose.date || pose.id || "unknown"}`;
    if (memberId && pose.memberId && pose.memberId !== memberId) return;
    const group = ensure(id);
    if (!group) return;
    const view = normalizePostureView(pose.view);
    group.memberId = group.memberId || pose.memberId || null;
    group.poses.push({ ...pose, view });
    group.scope = pose.scope || group.scope;
    group.role = pose.assessmentRole || group.role;
    group.method = pose.analysisSource === "draw" ? "draw" : pose.analysisSource === "manual" ? "manual" : group.method;
    group.status = pose.assessmentStatus || (pose.assessmentComplete ? "completed" : group.status);
    group.at = [group.at, stampOf(pose)].sort().at(-1) || "";
    group.date = group.date || recordAssessmentDate(pose);
    group.completedAt = [group.completedAt, pose.completedAt || (pose.assessmentComplete ? stampOf(pose) : "")].sort().at(-1) || "";
    group.favorite = group.favorite || Boolean(pose.favorite);
    const selected = Array.isArray(pose.selectedViews) ? pose.selectedViews : [];
    group.selectedViews = [...new Set([...group.selectedViews, ...selected.map(normalizePostureView), view])];
  });

  const ascending = [...groups.values()].map((group) => {
    const available = group.selectedViews.filter((view) => view === "custom" || POSTURE_VIEW_KEYS.includes(view));
    const legacyThreeView = available.includes("front") && available.includes("leftSide") && available.includes("back") && !available.includes("rightSide");
    const expected = group.scope === "partial"
      ? (available.length ? available : ["custom"])
      : (available.length ? available : POSTURE_VIEW_KEYS);
    const missingPhotos = expected.filter((view) => !hasMedia(group, view));
    const completeByRecords = missingPhotos.length === 0;
    const explicitlyComplete = group.status === "completed" || group.poses.some((pose) => pose.assessmentComplete);
    const legacyComplete = legacyThreeView && group.poses.length > 0 && explicitlyComplete;
    return {
      ...group,
      selectedViews: expected,
      status: explicitlyComplete && (completeByRecords || legacyComplete) ? "completed" : group.status === "failed" ? "failed" : group.poses.length ? "analyzing" : "draft",
      missingPhotos,
      completedAt: group.completedAt || (explicitlyComplete ? group.at : ""),
    };
  }).sort((a, b) => a.at.localeCompare(b.at));

  ascending.forEach((group, index) => {
    if (!group.role) group.role = index === 0 ? "before" : index === 1 ? "after" : "unassigned";
  });
  return ascending.reverse();
}

function recordActivityKey(record) {
  const values = [record?.updatedAt, record?.annotationUpdatedAt, record?.createdAt, record?.at, record?.date];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const time = Date.parse(text);
    if (Number.isFinite(time)) return time;
  }
  return Number.NEGATIVE_INFINITY;
}

function assessmentRecords(assessment) {
  const photos = assessment?.photos && typeof assessment.photos === "object" ? Object.values(assessment.photos) : [];
  const poses = Array.isArray(assessment?.poses) ? assessment.poses : [];
  return [...photos, ...poses].filter(Boolean);
}

function assessmentActivityKey(assessment) {
  return [assessment, ...assessmentRecords(assessment)]
    .reduce((latest, record) => Math.max(latest, recordActivityKey(record)), Number.NEGATIVE_INFINITY);
}

function recordHasCompletionEvidence(record) {
  return Boolean(record?.assessmentComplete || record?.assessmentStatus === "completed" || record?.completedAt);
}

function hasPersistentAssessmentIdentity(assessment) {
  const hasNormalizedRecords = Boolean(assessment?.photos && typeof assessment.photos === "object") || Array.isArray(assessment?.poses);
  if (!hasNormalizedRecords) return true;
  return assessmentRecords(assessment).some((record) => record?.assessmentId === assessment.id);
}

function hasCompletionEvidence(assessment) {
  return Boolean(assessment?.completedAt) || assessmentRecords(assessment).some(recordHasCompletionEvidence);
}

function compareResumableRecency(left, right) {
  const leftKey = assessmentActivityKey(left);
  const rightKey = assessmentActivityKey(right);
  if (leftKey !== rightKey) return leftKey > rightKey ? 1 : -1;
  const leftId = String(left?.id || "");
  const rightId = String(right?.id || "");
  if (leftId === rightId) return 0;
  return leftId > rightId ? 1 : -1;
}

export function selectResumableAssessment(sets, { memberId = null } = {}) {
  if (!memberId) return null;
  return (sets || []).reduce((selected, assessment) => {
    if (!assessment?.id || assessment.memberId !== memberId || !["draft", "analyzing"].includes(assessment.status)) return selected;
    if (!hasPersistentAssessmentIdentity(assessment) || hasCompletionEvidence(assessment)) return selected;
    if (!selected || compareResumableRecency(assessment, selected) > 0) return assessment;
    return selected;
  }, null);
}

export function completeAssessmentRecords(memberPhotos, {
  memberId = null,
  assessmentId = null,
  role = "unassigned",
  completedAt = new Date().toISOString(),
} = {}) {
  const source = memberPhotos && typeof memberPhotos === "object" ? memberPhotos : {};
  const next = { ...source };
  const updatedRecords = [];
  const safeRole = ["before", "after", "unassigned"].includes(role) ? role : "unassigned";
  if (!memberId || !assessmentId) return { memberPhotos: next, updatedRecords, blockedReason: "invalid_identity" };

  const assessment = normalizeAssessmentSets(source, { memberId }).find((set) => set.id === assessmentId);
  if (!assessment) return { memberPhotos: next, updatedRecords, blockedReason: "not_found" };
  if (assessment.status !== "completed") return { memberPhotos: next, updatedRecords, blockedReason: "incomplete" };

  [...POSTURE_STORAGE_KEYS, "poses"].forEach((storageKey) => {
    const records = Array.isArray(source[storageKey]) ? source[storageKey] : [];
    next[storageKey] = records.map((record) => {
      const owned = record?.assessmentId === assessmentId && (!record.memberId || record.memberId === memberId);
      if (!owned) return record;
      const completed = {
        ...record,
        memberId,
        assessmentRole: safeRole,
        assessmentStatus: "completed",
        assessmentComplete: true,
        completedAt,
        ...(storageKey === "poses" ? {} : { captureStatus: "completed" }),
      };
      updatedRecords.push(completed);
      return completed;
    });
  });

  return {
    memberPhotos: next,
    updatedRecords,
    blockedReason: updatedRecords.length ? null : "not_found",
  };
}

export function removeAssessmentDraftRecords(memberPhotos, { memberId = null, assessmentId = null } = {}) {
  const source = memberPhotos && typeof memberPhotos === "object" ? memberPhotos : {};
  const next = { ...source };
  const removedRecords = [];
  if (!memberId || !assessmentId) return { memberPhotos: next, removedRecords, blockedReason: null };

  const storageKeys = [...POSTURE_STORAGE_KEYS, "poses"];
  const matchingRecords = storageKeys.flatMap((storageKey) => (Array.isArray(source[storageKey]) ? source[storageKey] : []))
    .filter((record) => record?.assessmentId === assessmentId && (!record.memberId || record.memberId === memberId));
  if (matchingRecords.some(recordHasCompletionEvidence)) {
    return { memberPhotos: next, removedRecords, blockedReason: "completed" };
  }

  storageKeys.forEach((storageKey) => {
    const records = Array.isArray(source[storageKey]) ? source[storageKey] : [];
    const kept = records.filter((record) => {
      const owned = record?.assessmentId === assessmentId && (!record.memberId || record.memberId === memberId);
      if (owned) removedRecords.push(record);
      return !owned;
    });
    if (kept.length !== records.length) next[storageKey] = kept;
  });

  return { memberPhotos: next, removedRecords, blockedReason: null };
}

function usablePoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
    ? { x: Number(point.x), y: Number(point.y) }
    : null;
}

function midpoint(left, right) {
  const a = usablePoint(left), b = usablePoint(right);
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a || b;
}

function preferredPoint(points, primary, left, right) {
  const direct = usablePoint(points?.[primary]);
  if (direct) return direct;
  const a = usablePoint(points?.[left]), b = usablePoint(points?.[right]);
  if (!a) return b;
  if (!b) return a;
  return Number(points?.[left]?.score ?? 0) >= Number(points?.[right]?.score ?? 0) ? a : b;
}

export function postureReferenceLines(pose, { view = pose?.view } = {}) {
  const points = pose?.pts && typeof pose.pts === "object" ? pose.pts : {};
  const normalizedView = normalizePostureView(view);
  const lines = [];
  const addSegment = (key, label, left, right) => {
    const a = usablePoint(points[left]), b = usablePoint(points[right]);
    if (a && b) lines.push({ key, label, kind: "segment", points: [a, b] });
  };

  if (normalizedView === "front" || normalizedView === "back") {
    addSegment("head", "머리선", "earL", "earR");
    addSegment("shoulder", "어깨선", "shL", "shR");
    addSegment("pelvis", "골반선", "hipL", "hipR");
    addSegment("knee", "무릎선", "kneeL", "kneeR");
    addSegment("ankle", "발목선", "ankL", "ankR");
    const center = [
      usablePoint(points.nose) || midpoint(points.earL, points.earR),
      midpoint(points.shL, points.shR),
      midpoint(points.hipL, points.hipR),
      midpoint(points.ankL, points.ankR) || midpoint(points.footL, points.footR),
    ].filter(Boolean);
    if (center.length >= 2) lines.push({ key: "center", label: "중심선", kind: "path", points: center });
    return lines;
  }

  const center = [
    preferredPoint(points, "ear", "earL", "earR"),
    preferredPoint(points, "sh", "shL", "shR"),
    preferredPoint(points, "hip", "hipL", "hipR"),
    preferredPoint(points, "knee", "kneeL", "kneeR"),
    preferredPoint(points, "ank", "ankL", "ankR"),
  ].filter(Boolean);
  if (center.length >= 2) lines.push({ key: "center", label: "측면 중심선", kind: "path", points: center });
  return lines;
}

function averagePoint(points) {
  const valid = points.map(usablePoint).filter(Boolean);
  if (!valid.length) return null;
  return {
    x: valid.reduce((sum, point) => sum + point.x, 0) / valid.length,
    y: valid.reduce((sum, point) => sum + point.y, 0) / valid.length,
  };
}

function postureAlignmentAnchors(pose, view) {
  const points = pose?.pts && typeof pose.pts === "object" ? pose.pts : {};
  const normalizedView = normalizePostureView(view || pose?.view);
  if (!["front", "back", "leftSide", "rightSide"].includes(normalizedView)) return null;
  const side = postureAnalysisPlane(normalizedView) === "side";
  const head = side
    ? preferredPoint(points, "ear", "earL", "earR")
    : usablePoint(points.nose) || midpoint(points.earL, points.earR);
  const shoulder = side
    ? preferredPoint(points, "sh", "shL", "shR")
    : midpoint(points.shL, points.shR);
  const pelvis = side
    ? preferredPoint(points, "hip", "hipL", "hipR")
    : midpoint(points.hipL, points.hipR);
  const ankle = side
    ? preferredPoint(points, "ank", "ankL", "ankR")
    : midpoint(points.ankL, points.ankR);
  const foot = side
    ? preferredPoint(points, "foot", "footL", "footR")
    : midpoint(points.footL, points.footR);
  const floor = foot || ankle;
  const center = averagePoint([shoulder, pelvis, floor]);
  if (!head || !floor || !center) return null;
  const height = floor.y - head.y;
  if (!Number.isFinite(height) || height < 0.2) return null;
  const availableAnchors = [head, shoulder, pelvis, floor].filter(Boolean).length;
  return { anchor: { x: center.x, y: floor.y }, height, availableAnchors };
}

export function postureAlignmentTransform(beforePose, afterPose, { view = beforePose?.view || afterPose?.view } = {}) {
  const before = postureAlignmentAnchors(beforePose, view);
  const after = postureAlignmentAnchors(afterPose, view);
  if (!before || !after) return { available: false, reason: "insufficient_landmarks" };
  const scale = before.height / after.height;
  if (!Number.isFinite(scale) || scale < 0.65 || scale > 1.55) return { available: false, reason: "unsafe_scale" };
  const scaledAnchor = {
    x: 0.5 + scale * (after.anchor.x - 0.5),
    y: 0.5 + scale * (after.anchor.y - 0.5),
  };
  return {
    available: true,
    scale: Math.round(scale * 10000) / 10000,
    offsetX: Math.round((before.anchor.x - scaledAnchor.x) * 10000) / 10000,
    offsetY: Math.round((before.anchor.y - scaledAnchor.y) * 10000) / 10000,
    confidence: Math.min(before.availableAnchors, after.availableAnchors) >= 4 ? "high" : "medium",
    basis: "body_height_and_center",
  };
}

/* Math.round breaks ties towards +Infinity, so it rounds 2.5 to 3 but -2.5 to
   -2, which makes an improvement and a deterioration of the same size print
   differently. Ties go away from zero here, so the two stay symmetric. */
export function roundHalfAwayFromZero(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.sign(number) * Math.round(Math.abs(number));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/* The value as the screen shows it: angles print as whole degrees, so a
   comparison delta has to be derived from this rather than from the stored
   tenth-of-a-degree precision. Deriving it from the stored value is what let a
   row read "20 -> 18, 차이 -3": 20.4 and 17.6 each round for display while
   their exact difference, -2.8, rounded separately to -3. This is the one place
   that decides the rule, so the delta and the two numbers beside it cannot
   drift apart. */
export function postureMetricDisplayValue(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return unit === "°" ? roundHalfAwayFromZero(number) : number;
}

/* AFTER 라벨이 남겨 두는 최소 불투명도. 사진이 완전히 사라져도 라벨은 읽혀야
   어느 쪽이 After 인지 알 수 있다. */
export const OVERLAY_LABEL_MIN_OPACITY = 0.35;

/* 겹쳐보기 슬라이더가 After 사진에 주는 불투명도를 AFTER 라벨에도 그대로 준다.
   사진이 거의 사라졌는데 라벨만 또렷하면 무엇을 보고 있는지가 어긋난다. */
export function overlayLabelOpacity(percent) {
  // null 과 "" 는 Number() 를 지나면 0 -- 즉 가장 흐린 값이 된다. 값을 읽지 못한
  // 것과 슬라이더를 0 으로 내린 것은 다르므로, 못 읽었으면 그대로 보여 준다.
  if (percent === null || percent === undefined || percent === "") return 1;
  const value = Number(percent);
  if (!Number.isFinite(value)) return 1;
  const ratio = Math.min(1, Math.max(0, value / 100));
  return OVERLAY_LABEL_MIN_OPACITY + (1 - OVERLAY_LABEL_MIN_OPACITY) * ratio;
}

/* 같은 항목을 두 번 찍었을 때 쓰는 촬영 오차 폭. 이 안쪽 차이는 변화가 아니다. */
export const POSTURE_CHANGE_TOLERANCE_DEG = 2;

/* 두 촬영의 차이를 강사가 읽는 한 줄로.

   방향은 말하지 않는다. 저장된 값에는 각도의 크기만 있고 어느 쪽이 올라갔는지가
   없어서, 좌우를 붙이려면 없는 정보를 지어내야 한다.

   개선·악화도 말하지 않는다. 숫자가 줄었다는 것과 좋아졌다는 것은 다른 말이고,
   뒤쪽은 강사가 판단할 몫이다.

   2° 미만은 변화로 읽지 않는다. 그 폭은 카메라 각도와 서 있는 자세가 조금 달라도
   생기므로, 두 촬영의 차이라고 부를 수 없다. */
/* 이 차이가 촬영 오차 안쪽인가.

   문구와 목록이 같은 판단을 봐야 한다. 예전에는 목록이 "변화 없음"이라는 문구를
   문자열로 비교해 걸렀는데, 그러면 문구를 손대는 순간 목록이 조용히 달라진다. */
export function isWithinShootingTolerance(difference, unit = "°") {
  const number = Number(difference);
  if (!Number.isFinite(number)) return false;
  const size = Math.abs(number);
  const tolerance = unit === "°" ? POSTURE_CHANGE_TOLERANCE_DEG : 0;
  return size === 0 || size < tolerance;
}

export function postureMetricChangeText(difference, unit = "°") {
  // null 과 "" 는 Number() 를 통과하면 0 이 된다. 값이 없는 것을 "변화 없음"이라고
  // 말하면 확인하지 않은 사실을 말하는 셈이라, 아무것도 그리지 않는다.
  if (difference === null || difference === undefined || difference === "") return null;
  const number = Number(difference);
  if (!Number.isFinite(number)) return null;
  const size = Math.abs(number);
  /* "변화 없음"만 적어 두면 위에 3° 와 2° 가 나란히 있는 화면과 어긋나 보인다.
     두 값이 반올림 경계를 사이에 두면 0.2° 차이도 다른 정수로 찍히기 때문이다.
     그래서 차이를 함께 적고, 왜 변화로 읽지 않는지를 밝힌다. */
  if (isWithinShootingTolerance(number, unit)) return `${size}${unit} 차이 · 촬영 오차 범위`;
  return `변화 ${size}${unit} ${number > 0 ? "증가" : "감소"}`;
}

/* 이번 기록 바로 앞의 기록.

   가장 오래된 것이 아니라 직전이다 -- "이번 변화"는 지난 수업과 견준 것이지
   처음과 견준 것이 아니고, 둘은 다른 이야기다. */
export function selectPreviousAssessment(sets, target) {
  const targetId = String(target?.id || "");
  if (!targetId) return null;
  const ordered = (sets || [])
    .filter((set) => set?.status === "completed")
    .filter((set) => !target?.scope || set.scope === target.scope)
    .slice()
    .sort((a, b) => String(stampOf(a) || a?.at || "").localeCompare(String(stampOf(b) || b?.at || "")));
  const index = ordered.findIndex((set) => String(set?.id || "") === targetId);
  return index > 0 ? ordered[index - 1] : null;
}

/* 결과 화면 맨 위에 세울 "이번 변화" 줄들.

   판정하지 않는다. 어느 쪽이 좋아진 것인지는 강사가 정할 몫이고, 여기서는 어떤
   항목이 얼마나 움직였는지만 큰 순으로 고른다.

   촬영 오차 안쪽은 빼고, 남는 것이 없으면 빈 배열이다 -- 빈 카드를 세우지 않기
   위해서다. 걸러내는 기준은 문구가 아니라 규칙이라, 문구가 바뀌어도 목록은
   그대로다. */
export function selectRecentAssessmentChanges(beforeSet, afterSet, { limit = 3 } = {}) {
  return compareAssessmentMetrics(beforeSet, afterSet, { limit: 64 })
    .filter((metric) => Number.isFinite(Number(metric.difference)) && !isWithinShootingTolerance(metric.difference, metric.unit))
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || String(a.id).localeCompare(String(b.id)))
    .slice(0, Math.max(0, Number(limit) || 0));
}

export function compareAssessmentMetrics(beforeSet, afterSet, { view = null, limit = 8 } = {}) {
  if (!beforeSet || !afterSet) return [];
  const normalizedView = view ? normalizePostureView(view) : null;
  const records = (set) => (set?.poses || []).filter((pose) => !normalizedView || normalizePostureView(pose.view) === normalizedView);
  const beforeMetrics = new Map(records(beforeSet).flatMap((pose) => validPostureMetrics(pose).map((metric) => [
    `${normalizePostureView(pose.view)}:${metric.key}`,
    metric,
  ])));
  return records(afterSet).flatMap((pose) => validPostureMetrics(pose).map((metric) => {
    const previous = beforeMetrics.get(`${normalizePostureView(pose.view)}:${metric.key}`);
    const beforeValue = Number(previous?.value), afterValue = Number(metric?.value);
    if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) return null;
    const unit = metric.unit || previous?.unit || "";
    // The delta is the difference between the two numbers the row actually
    // prints. beforeValue and afterValue keep their stored precision.
    const difference = postureMetricDisplayValue(afterValue, unit) - postureMetricDisplayValue(beforeValue, unit);
    return {
      id: `${normalizePostureView(pose.view)}:${metric.key}`,
      key: metric.key,
      view: normalizePostureView(pose.view),
      label: metric.label,
      beforeValue,
      afterValue,
      difference: Object.is(difference, -0) ? 0 : difference,
      unit,
    };
  })).filter(Boolean).slice(0, Math.max(0, Number(limit) || 0));
}


/* ------------------------- 360도 바디뷰 -- 정렬 ------------------------- */

/* 방향을 갈아 끼우며 보는 화면이라, 방향마다 몸이 다른 크기로 다른 자리에 서
   있으면 누를 때마다 몸이 튄다. 촬영이 원래 그렇다 -- 카메라와의 거리도,
   회원이 선 자리도 방향마다 조금씩 다르다.

   한 방향을 기준으로 삼고 나머지를 거기에 맞춘다. 사진을 고치는 것이 아니라
   보여 줄 때 배율과 위치만 옮긴다. */

export const BODY_VIEW_ALIGNMENT = Object.freeze({
  aligned: "aligned",
  missingAnchor: "unaligned_missing_anchor",
  unsafeScale: "unaligned_unsafe_scale",
});

/* 기준을 고르는 차례. 정면이 몸을 가장 온전히 담고, 없으면 같은 평면인 후면이
   다음이다. 측면은 마지막이다 -- 측면을 기준으로 삼으면 정면 쪽이 전부 그
   좁은 폭에 맞춰진다. */
const BODY_VIEW_BASE_ORDER = Object.freeze(["front", "back", "leftSide", "rightSide"]);

/* postureAlignmentTransform 이 쓰는 것과 같은 범위다. 이 밖으로 나가는 배율은
   맞춘 것이 아니라 사진을 왜곡한 것이라 적용하지 않는다. 두 곳이 같은 값을
   본다는 것은 테스트가 지킨다. */
export const POSTURE_ALIGNMENT_SCALE_MIN = 0.65;
export const POSTURE_ALIGNMENT_SCALE_MAX = 1.55;

const BODY_VIEW_IDENTITY_TRANSFORM = Object.freeze({ scale: 1, offsetX: 0, offsetY: 0 });

function bodyViewPose(assessment, view) {
  const normalizedView = normalizePostureView(view);
  return (assessment?.poses || [])
    .filter((pose) => normalizePostureView(pose?.view) === normalizedView)
    .sort((left, right) => recordActivityKey(right) - recordActivityKey(left))[0] || null;
}

/* 방향마다 정렬이 됐는지, 안 됐다면 왜 안 됐는지를 함께 돌려준다.

   상태를 값으로 남기는 이유는 나중에 "왜 이 방향만 크기가 이상한가"를 추측
   없이 확인하기 위해서다. 저장 스키마에는 넣지 않는다 -- 사진과 landmark 에서
   매번 다시 나오는 값이라 보관할 이유가 없다. */
export function composeBodyViewAlignment(assessment) {
  const entries = POSTURE_VIEW_KEYS.map((view) => ({
    view,
    hasPhoto: Boolean(assessmentMediaForView(assessment, view)),
    pose: bodyViewPose(assessment, view),
  })).map((entry) => ({ ...entry, anchors: entry.pose ? postureAlignmentAnchors(entry.pose, entry.view) : null }));

  /* 사진이 있는 것과 기준이 될 수 있는 것은 다르다. 사진은 멀쩡해도 몸이
     화면에 다 담기지 않았으면 anchors 가 없고, 그런 방향에 나머지를 맞추면
     전부 함께 틀어진다. */
  const base = BODY_VIEW_BASE_ORDER
    .map((view) => entries.find((entry) => entry.view === view))
    .find((entry) => entry?.anchors) || null;

  return {
    baseView: base?.view || null,
    views: entries.map(({ view, hasPhoto, pose, anchors }) => {
      const shared = { view, hasPhoto, hasPose: Boolean(pose), isBase: base?.view === view };
      if (!base || !anchors) return { ...shared, status: BODY_VIEW_ALIGNMENT.missingAnchor, transform: null };
      if (base.view === view) return { ...shared, status: BODY_VIEW_ALIGNMENT.aligned, transform: BODY_VIEW_IDENTITY_TRANSFORM };
      const scale = base.anchors.height / anchors.height;
      if (!Number.isFinite(scale) || scale < POSTURE_ALIGNMENT_SCALE_MIN || scale > POSTURE_ALIGNMENT_SCALE_MAX) {
        return { ...shared, status: BODY_VIEW_ALIGNMENT.unsafeScale, transform: null };
      }
      const scaled = {
        x: 0.5 + scale * (anchors.anchor.x - 0.5),
        y: 0.5 + scale * (anchors.anchor.y - 0.5),
      };
      return {
        ...shared,
        status: BODY_VIEW_ALIGNMENT.aligned,
        transform: {
          scale: Math.round(scale * 10000) / 10000,
          offsetX: Math.round((base.anchors.anchor.x - scaled.x) * 10000) / 10000,
          offsetY: Math.round((base.anchors.anchor.y - scaled.y) * 10000) / 10000,
        },
      };
    }),
  };
}


/* 마커가 화면 어디에 오는가 -- 사진 안의 비율로.

   정렬이 사진에 건 배율·이동을 좌표에도 똑같이 걸어야 몸에서 떨어지지 않는다.
   글자까지 함께 커지면 읽기 어려우므로 사진을 늘리는 대신 좌표만 옮긴다. */
export function bodyViewMarkerFraction(point, transform) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const scale = Number(transform?.scale) || 1;
  const offsetX = Number(transform?.offsetX) || 0;
  const offsetY = Number(transform?.offsetY) || 0;
  return { x: 0.5 + scale * (x - 0.5) + offsetX, y: 0.5 + scale * (y - 0.5) + offsetY };
}

/* 가장자리의 landmark 위에 얹은 알약은 절반이 잘려 숫자가 안 읽힌다.

   그렇다고 잰 자리를 옮길 수는 없다. 그래서 점은 그 자리에 두고 알약만 안으로
   밀어 넣는다 -- 둘은 짧은 선으로 이어 어디를 잰 값인지 보이게 한다.

   여유가 있으면 아무것도 하지 않는다. 값의 크기로 자리가 달라지는 일은 없다:
   여기서 보는 것은 좌표와 상자뿐이다. */
export function clampLabelWithin(centre, box, size) {
  const x = Number(centre?.x);
  const y = Number(centre?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const boxWidth = Number(box?.width);
  const boxHeight = Number(box?.height);
  const halfWidth = Number(size?.width) / 2;
  const halfHeight = Number(size?.height) / 2;
  if (![boxWidth, boxHeight, halfWidth, halfHeight].every((value) => Number.isFinite(value) && value >= 0)) return { x, y };
  /* 알약이 상자보다 크면 밀어 넣을 곳이 없다. 그대로 둔다. */
  return {
    x: boxWidth < halfWidth * 2 ? x : Math.min(Math.max(x, halfWidth), boxWidth - halfWidth),
    y: boxHeight < halfHeight * 2 ? y : Math.min(Math.max(y, halfHeight), boxHeight - halfHeight),
  };
}
/* 머리에서 잰 값은 얼굴 위에 떨어진다. 점은 잰 자리에 그대로 두고 알약만
   옆으로 내보낸다 -- 가장자리에서 밀어 넣을 때와 같은 방식이고, 둘이
   떨어지면 같은 선으로 이어져 어디서 잰 값인지 그대로 보인다.

   얼굴은 그 사람이 누구인지가 드러나는 자리다. 수치를 읽으려고 얼굴을
   가려야 한다면 둘 중 하나는 못 보게 된다. */
export const BODY_VIEW_HEAD_METRIC_KEYS = Object.freeze(["head", "fha"]);
/* 사진 폭 기준. 머리 하나를 확실히 비켜날 만큼. */
export const BODY_VIEW_HEAD_LABEL_GAP = 0.17;

export function bodyViewLabelAnchor(key, dot, box) {
  const x = Number(dot?.x);
  const y = Number(dot?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!BODY_VIEW_HEAD_METRIC_KEYS.includes(key)) return { x, y };
  const width = Number(box?.width);
  if (!Number.isFinite(width) || width <= 0) return { x, y };
  /* 가까운 쪽 가장자리로 내보낸다. 반대편으로 보내면 얼굴을 가로지른다. */
  const gap = width * BODY_VIEW_HEAD_LABEL_GAP;
  return { x: x <= width / 2 ? x - gap : x + gap, y };
}

/* 반올림해서 0 이 되는 값은 사진 위에 놓지 않는다. 몸의 한 지점을 가리키며
   0 이라고 적으면 그 자리에 무언가 있다는 말처럼 읽히는데, 실제로는 기운
   정도가 없다는 뜻이다.

   값을 버리는 것이 아니다. 자리를 말할 수 없는 무릎과 같은 처리로, 사진
   아래 목록에 그대로 남고 눌러서 상세도 볼 수 있다. */
export function bodyViewMarkerShows(metric) {
  if (!metric?.at) return false;
  const shown = Number(postureMetricDisplayValue(metric.value, metric.unit));
  return Number.isFinite(shown) && shown !== 0;
}

/* 비율을 지켜 넣은 사진이 틀 안에서 실제로 차지하는 사각형.

   마커 좌표는 사진 안의 비율이다. 틀에 그대로 대면 위아래(또는 좌우) 여백만큼
   어긋나서 몸에서 떠 붙는다. CSS 로 맞추려 해 봤자 높이를 못 박은 상자는
   비율대로 줄어들지 않으므로, 여백을 직접 구한다. */
export function containPhotoRect(frame, natural) {
  const frameWidth = Number(frame?.width);
  const frameHeight = Number(frame?.height);
  const photoWidth = Number(natural?.width);
  const photoHeight = Number(natural?.height);
  if (![frameWidth, frameHeight, photoWidth, photoHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(frameWidth / photoWidth, frameHeight / photoHeight);
  const width = photoWidth * scale;
  const height = photoHeight * scale;
  return { left: (frameWidth - width) / 2, top: (frameHeight - height) / 2, width, height };
}
/* ------------------------ 360도 바디뷰 -- 드래그 ------------------------ */

/* 손가락으로 갈 수 있는 방향. 찍지 않은 방향과 읽을 수 없는 사진은 뛰어넘는다
   -- 밀어서 빈 화면에 도착하면 밀다 만 것처럼 느껴진다.

   버튼은 이 목록을 쓰지 않는다. 버튼은 "저기로 가겠다"는 지목이고 드래그는
   몸을 따라 도는 동작이라, 이미 찍은 방향을 버튼으로는 열고 드래그로는
   지나쳐도 어긋나지 않는다. */
/* 이 방향에서 쓸 사진의 id.

   뼈대 없는 760px 사본은 pose 레코드에 붙어 있다. 촬영 버킷 쪽 레코드에는
   원본 blobId 만 있어서, 그쪽을 먼저 보면 사본이 없다고 답하게 된다 -- 사진은
   멀쩡히 있는데 바디뷰만 "사진이 없어요"라고 말하던 이유가 이것이었다. */
export function bodyViewPhotoId(assessment, view) {
  return bodyViewPose(assessment, view)?.cleanBlobId
    || assessmentMediaForView(assessment, view)?.cleanBlobId
    || null;
}

/* 이 방향에 저장해 둔 인물 마스크. pose 에 붙어 있고, 없으면 아직 만든 적이
   없다는 뜻이다 -- 예전 기록도 여기로 떨어져 원본으로 보인다. */
export function bodyViewMaskId(assessment, view) {
  return bodyViewPose(assessment, view)?.maskBlobId || null;
}

export function reachableBodyViews(assessment, { unreadable = [] } = {}) {
  const skip = new Set((unreadable || []).map(normalizePostureView));
  return POSTURE_VIEW_KEYS.filter((view) => !skip.has(view) && Boolean(bodyViewPhotoId(assessment, view)));
}

/* 한 칸 옆. 감아 돌지 않으므로 양 끝에서는 갈 곳이 없다 -- 정면에서 더 밀면
   우측면이 나오는 것은 몸을 도는 것이 아니라 목록을 도는 것이다. */
export function stepBodyView(reachable, fromView, direction) {
  const at = POSTURE_VIEW_KEYS.indexOf(normalizePostureView(fromView));
  if (at < 0 || !Number.isFinite(Number(direction)) || Number(direction) === 0) return null;
  const forward = Number(direction) > 0;
  const ahead = (reachable || [])
    .map(normalizePostureView)
    .filter((view) => (forward ? POSTURE_VIEW_KEYS.indexOf(view) > at : POSTURE_VIEW_KEYS.indexOf(view) < at));
  return (forward ? ahead[0] : ahead[ahead.length - 1]) || null;
}

/* 절반이 기준이다. 미는 동안 화면이 그만큼 따라오므로, 어디서 넘어가는지는
   손가락이 이미 보고 있다 -- 반을 넘기면 다음 방향의 몸이 서 있다. */
export const BODY_VIEW_DRAG_COMMIT_RATIO = 0.5;
export const BODY_VIEW_DRAG_COMMIT_MIN_PX = 48;

/* 끝에서 더 밀면 따라오기는 하되 거의 움직이지 않고, 아무리 밀어도 절반에
   닿지 않는다. 넘어갈 곳이 없다는 것을 손으로 알려 주는 것이지 넘어가라는
   뜻이 아니다. */
export const BODY_VIEW_DRAG_EDGE_RESISTANCE = 0.22;
export const BODY_VIEW_DRAG_EDGE_LIMIT = 0.12;

/* 도는 것처럼 읽히게 하는 두 가지. 몸이 미는 쪽으로 빠졌다 돌아오고,
   그 사이에 가로로 조금 좁아진다 -- 카드가 돌 때의 느낌이다.

   가로 배율까지만 건드린다. 몸을 휘게 하는 warp 도, 깊이를 흉내 내는
   perspective 도 쓰지 않는다. 없는 각도를 만들어 보여 주는 셈이 된다. */
export const BODY_VIEW_DRAG_TRAVEL = 0.16;
export const BODY_VIEW_DRAG_SQUEEZE = 0.16;

/* 화면 폭의 절반을 1 로 본 값. 부호는 손가락이 간 쪽이다.

   좁은 기기에서 절반이 몇십 px 밖에 안 되는 것을 막으려고 바닥을 두는데,
   그 바닥을 여기 한 곳에만 둔다 -- 넘어가는 지점과 화면이 따라오는 양이
   서로 다른 자를 쓰면, 몸은 이미 다음 방향인데 손을 떼면 되돌아온다. */
function dragSpan(width) {
  const span = Number(width);
  return 2 * Math.max(BODY_VIEW_DRAG_COMMIT_MIN_PX, (Number.isFinite(span) ? span : 0) * BODY_VIEW_DRAG_COMMIT_RATIO);
}

export function bodyViewDragProgress(dx, width, { blocked = false } = {}) {
  const distance = Number(dx);
  if (!Number.isFinite(distance)) return 0;
  const raw = distance / dragSpan(width);
  if (blocked) {
    const damped = raw * BODY_VIEW_DRAG_EDGE_RESISTANCE;
    return Math.max(-BODY_VIEW_DRAG_EDGE_LIMIT, Math.min(BODY_VIEW_DRAG_EDGE_LIMIT, damped));
  }
  return Math.max(-1, Math.min(1, raw));
}

export function bodyViewDragCommits(dx, width) {
  const distance = Math.abs(Number(dx));
  if (!Number.isFinite(distance)) return false;
  return distance >= dragSpan(width) / 2;
}

/* 진행도 하나에서 화면이 할 일이 전부 나온다: 얼마나 밀렸는지, 얼마나
   좁아졌는지, 지금 어느 방향의 몸이 서 있는지.

   빠졌다 돌아오는 모양이라 절반에서 가장 많이 밀리고 가장 좁으며, 얼굴은
   바로 그 순간에 바뀐다. 가장 좁은 자리에서 갈아 끼우므로 두 사람이 한꺼번에
   보이지 않고, 다 밀면 다음 방향이 제자리에 똑바로 서 있다. */
export function bodyViewDragFrame(progress) {
  const value = Number(progress);
  const at = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  const away = Math.abs(at);
  const swing = Math.sin(Math.PI * away);
  return {
    shift: (at < 0 ? -1 : 1) * swing * BODY_VIEW_DRAG_TRAVEL,
    squeeze: 1 - BODY_VIEW_DRAG_SQUEEZE * swing,
    showTarget: away >= BODY_VIEW_DRAG_COMMIT_RATIO,
  };
}

/* 360° 바디뷰: 회전 체감이 나지 않고 인물 분리 품질도 미달이어서
   2026-09 비활성화. 재개하려면 촬영 방향 수를 늘리거나
   인물 분리 품질을 먼저 해결해야 함.

   코드는 지우지 않는다. 이 파일의 바디뷰 함수들, BodyViewSheet.jsx,
   body-segmenter.js 는 그대로 있고 이 플래그 하나로 꺼진다. 저장된
   maskBlobId 도 지우지 않으며, blob 정리 목록(photo-blob-fields.js)에
   그대로 남는다 -- 쓰지 않더라도 삭제 대상에서 빠지면 기기에 남는다. */
export const BODY_VIEW_ENABLED = false;

/* ------------------------ 360도 바디뷰 -- 마커 -------------------------- */

/* 마커가 앉을 자리. 측정할 때 쓴 지점을 저장하지 않기 때문에 -- 저장되는 것은
   key, label, value, unit, validity 뿐이다 -- 저장된 landmark 에서 같은 규칙
   으로 다시 구한다. 변화량이 아니라 landmark 가 자리를 정하므로, 수치가
   어떻든 마커는 몸의 같은 곳에 붙는다. */
function postureMetricAnchorPoint(pose, key) {
  const points = pose?.pts && typeof pose.pts === "object" ? pose.pts : {};
  const plane = postureAnalysisPlane(pose?.view);
  if (plane === "front") {
    const shoulder = midpoint(points.shL, points.shR);
    const pelvis = midpoint(points.hipL, points.hipR);
    if (key === "shoulder") return shoulder;
    if (key === "pelvis") return pelvis;
    if (key === "head") return midpoint(points.earL, points.earR);
    /* 무릎은 좌우 중 더 굽은 쪽에서 잰 값인데, 어느 쪽이었는지가 저장돼 있지
       않다. 두 무릎 사이에 찍으면 재지 않은 자리에 수치를 놓는 셈이라 자리를
       주지 않는다. 값은 사진 밖에서 그대로 보여 준다. */
    if (key === "knee") return null;
    if (key === "twist") return shoulder && pelvis ? { x: (shoulder.x + pelvis.x) / 2, y: (shoulder.y + pelvis.y) / 2 } : null;
    return null;
  }
  const ear = preferredPoint(points, "ear", "earL", "earR");
  const shoulder = preferredPoint(points, "sh", "shL", "shR");
  const hip = preferredPoint(points, "hip", "hipL", "hipR");
  const knee = preferredPoint(points, "knee", "kneeL", "kneeR");
  const ankle = preferredPoint(points, "ank", "ankL", "ankR");
  const between = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null);
  if (key === "fha") return between(ear, shoulder);
  if (key === "trunk") return between(hip, shoulder);
  if (key === "kneeSide") return knee;
  if (key === "align") return ankle;
  return null;
}

/* 이 방향에서 잰 값만. front 와 back 은 어깨선이라는 같은 이름을 쓰지만 각자
   자기 사진에서 잰 것이고, 한쪽 값을 다른 쪽에 옮기면 그것은 다른 방향의
   몸을 이 방향의 것이라고 말하는 셈이다.

   표시할 것이 하나도 없는 방향도 있다 -- 그것은 고장이 아니다. 사진은 그대로
   보여 주고 마커만 없다. */
export function bodyViewMetrics(assessment, view, { previousAssessment = null } = {}) {
  const normalizedView = normalizePostureView(view);
  const pose = bodyViewPose(assessment, normalizedView);
  if (!pose) return [];
  /* 이전 값과 변화는 비교 화면이 쓰는 그 함수에서 그대로 가져온다. 반올림
     규칙이 한 곳에 있어야 두 화면이 다른 숫자를 말하지 않는다. */
  const changes = new Map(
    (previousAssessment ? compareAssessmentMetrics(previousAssessment, assessment, { view: normalizedView, limit: 64 }) : [])
      .map((row) => [row.key, row]),
  );
  return validPostureMetrics(pose).flatMap((metric) => {
    /* 자리를 모르는 값도 버리지 않는다. 사진 위에는 얹지 않고 목록으로만
       내보낸다 -- 잰 값이 있는데 화면에서 사라지면 안 재진 것이 된다. */
    const at = postureMetricAnchorPoint(pose, metric.key);
    const value = Number(metric?.value);
    if (!Number.isFinite(value)) return [];
    const change = changes.get(metric.key) || null;
    return [{
      id: `${normalizedView}:${metric.key}`,
      view: normalizedView,
      key: metric.key,
      label: metric.label,
      value,
      unit: metric.unit || "",
      at: at || null,
      previousValue: change ? change.beforeValue : null,
      difference: change ? change.difference : null,
      measuredAt: assessmentDisplayDate(assessment),
    }];
  });
}

/* Put the joint the last step touched back the way it was found.

   The button under the correction prompt used to delete the point outright
   and step back. For a joint the instructor had just placed that is exactly
   right -- before the placement there was nothing. For a joint the pose found
   and the instructor then dragged, it destroyed the AI's own reading, so a
   mis-drag had no way back and pressing "undo" made it worse.

   The AI reading is kept: originalPts is cloned the moment the pose resolves.
   So both cases are one concept -- return this joint to the state it was in
   before the instructor touched it -- and only the starting state differs.

   The confidence classification has to come back with the point: a restored
   reading below the threshold was flagged low, and it is flagged low again. */
export function revertManualJoint({ manual, points, originalPoints, quality, editedJoints, confidenceMin = 0.5 } = {}) {
  if (!manual || !Array.isArray(manual.seq)) return null;
  const index = Number(manual.i);
  if (!Number.isInteger(index) || index <= 0 || index > manual.seq.length) return null;
  const key = manual.seq[index - 1];
  if (!key) return null;

  const original = originalPoints && originalPoints[key] ? originalPoints[key] : null;
  const nextPoints = { ...(points || {}) };
  if (original) nextPoints[key] = { ...original };
  else delete nextPoints[key];

  const missing = new Set(Array.isArray(quality?.missing) ? quality.missing : []);
  const low = new Set(Array.isArray(quality?.low) ? quality.low : []);
  if (original) {
    missing.delete(key);
    if (Number(original.score ?? 1) < confidenceMin) low.add(key); else low.delete(key);
  } else {
    missing.add(key);
    low.delete(key);
  }

  return {
    key,
    restored: Boolean(original),
    points: nextPoints,
    manual: { ...manual, i: index - 1 },
    quality: { ...(quality || {}), missing: [...missing], low: [...low] },
    // Nothing the instructor did to this joint survives, so the "edited" mark
    // must not survive either -- it would be saved as a correction that is no
    // longer there.
    editedJoints: (Array.isArray(editedJoints) ? editedJoints : []).filter((item) => item !== key),
  };
}

/* Which joint, if any, an empty-space tap is allowed to place.

   Tapping empty canvas used to teleport whichever joint the prompt was asking
   for to the finger, so a stray touch threw an already-correct point across the
   photo. A joint that exists is adjusted by dragging it and nothing else.

   A joint the pose never found has no point to drag, so a tap is the only way
   to give it one -- that is the single case this still allows. */
export function manualTapTarget(manual, points) {
  if (!manual || !Array.isArray(manual.seq)) return null;
  const index = Number(manual.i);
  if (!Number.isInteger(index) || index < 0 || index >= manual.seq.length) return null;
  const key = manual.seq[index];
  if (!key) return null;
  return points && points[key] ? null : key;
}

/* Which joint the correction prompt should ask for next.

   The prompt only ever moved on when a point was placed on empty canvas. But
   correction opens on a pose whose points all exist, so every touch landed on
   an existing joint and the prompt never advanced past its first entry --
   leaving the second half of the pair unasked. Finishing an adjustment on the
   joint being asked for is what advances it now.

   Adjusting any other joint leaves the prompt where it is, so nothing advances
   by accident, and re-adjusting a joint already passed stays possible: only the
   prompt moves forward, never the ability to edit. */
export function advanceManualCorrection(manual, adjustedKey) {
  if (!manual || !Array.isArray(manual.seq)) return manual;
  const index = Number(manual.i);
  if (!Number.isInteger(index) || index < 0 || index >= manual.seq.length) return manual;
  if (!adjustedKey || manual.seq[index] !== adjustedKey) return manual;
  return { ...manual, i: index + 1 };
}

export function postureMilestoneTemplate({ role = "unassigned", beforeSet = null, afterSet = null } = {}) {
  if (role !== "after") return { text: role === "before" ? "비포 촬영" : "체형 촬영", details: [], metricIds: [] };
  return { text: "애프터 촬영", details: [], metricIds: [] };
}

export function postureAfterReminder(sets, now = new Date()) {
  const completed = (sets || []).filter((set) => set?.status === "completed");
  if (!completed.length) return { show: false, recommended: false, days: null, lastDate: "", label: "" };
  const dated = [...completed].sort((a, b) => String(b.completedAt || b.at || "").localeCompare(String(a.completedAt || a.at || "")));
  const last = dated[0];
  const lastDate = String(last?.completedAt || last?.at || "").slice(0, 10);
  const hasAfter = completed.some((set) => set?.role === "after");
  const parsed = lastDate ? new Date(`${lastDate}T00:00:00`) : null;
  const current = new Date(now);
  current.setHours(0, 0, 0, 0);
  if (!parsed || Number.isNaN(parsed.getTime())) return { show: false, recommended: false, days: null, lastDate, label: "" };
  const days = Math.max(0, Math.floor((current.getTime() - parsed.getTime()) / 86400000));
  const recommended = !hasAfter && days >= 28;
  return {
    show: recommended,
    recommended,
    days,
    lastDate,
    label: recommended ? "애프터 촬영 추천 시점" : "",
  };
}

export function selectAutomaticComparison(sets, { scope = "full_body" } = {}) {
  const eligible = (sets || []).filter((set) => set?.status === "completed" && set.scope === scope)
    .filter((set) => calendarDateOfAssessment(set))
    .sort(compareAssessmentDates);
  for (let beforeIndex = 0; beforeIndex < eligible.length - 1; beforeIndex += 1) {
    for (let afterIndex = eligible.length - 1; afterIndex > beforeIndex; afterIndex -= 1) {
      const before = eligible[beforeIndex], after = eligible[afterIndex];
      if (calendarDateOfAssessment(before) === calendarDateOfAssessment(after)) continue;
      const view = commonCanonicalView(before, after);
      if (view) return { before, after, view };
    }
  }
  return { before: eligible[0] || null, after: null, view: null };
}

function calendarDateIndex(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000;
}

export function postureCalendarDays(from, to) {
  const start = calendarDateIndex(from);
  const end = calendarDateIndex(to);
  return start === null || end === null ? null : Math.max(0, Math.round(end - start));
}

function calendarDateOfAssessment(assessment) {
  return calendarDate(assessment?.date) || calendarDate(assessment?.completedAt) || calendarDate(assessment?.at);
}

export function assessmentDisplayDate(assessment) {
  return calendarDateOfAssessment(assessment);
}

export function selectComparisonAssessmentOptions(sets, { excludeId = null } = {}) {
  const seenMediaSets = new Set();
  return (sets || []).filter((set) => set?.status === "completed" && set.id !== excludeId)
    .filter((set) => calendarDateOfAssessment(set) && POSTURE_VIEW_KEYS.some((view) => assessmentMediaForView(set, view)))
    .filter((set) => {
      const identities = [...new Set((set.mediaIds || []).filter(Boolean))].sort();
      if (!identities.length) return true;
      const key = identities.join("|");
      if (seenMediaSets.has(key)) return false;
      seenMediaSets.add(key);
      return true;
    });
}

function compareAssessmentDates(left, right) {
  const byDate = calendarDateOfAssessment(left).localeCompare(calendarDateOfAssessment(right));
  return byDate || String(left?.id || "").localeCompare(String(right?.id || ""));
}

export function assessmentMediaForView(assessment, view) {
  const normalizedView = normalizePostureView(view);
  if (!POSTURE_VIEW_KEYS.includes(normalizedView) && normalizedView !== "custom") return null;
  const photo = assessment?.photos?.[normalizedView];
  if (photo) return photo;
  return (assessment?.poses || []).filter((pose) => normalizePostureView(pose?.view) === normalizedView && pose?.src)
    .sort((left, right) => recordActivityKey(right) - recordActivityKey(left))[0] || null;
}

export function commonPostureComparisonViews(before, after) {
  return ["front", ...POSTURE_VIEW_KEYS.filter((view) => view !== "front")]
    .filter((view) => assessmentMediaForView(before, view) && assessmentMediaForView(after, view));
}

function commonCanonicalView(before, after) {
  return commonPostureComparisonViews(before, after)[0] || null;
}

export function countPosturePhotoRecords(photos) {
  const seen = new Set();
  POSTURE_STORAGE_KEYS.forEach((storageKey) => {
    (photos?.[storageKey] || []).filter(Boolean).forEach((photo, index) => {
      const identity = String(photo.id || photo.photoId || photo.blobId || `${storageKey}:${index}`);
      seen.add(identity);
    });
  });
  return seen.size;
}

export function selectMemberBodyPhotoSurface(assessments, { now = new Date(), photoCount = 0 } = {}) {
  const ordered = [...(assessments || [])].filter(Boolean).sort(compareAssessmentDates);
  const latestAssessment = ordered.at(-1) || null;
  const automatic = selectAutomaticComparison(ordered, { scope: latestAssessment?.scope || "full_body" });
  const pair = automatic.before && automatic.after && automatic.view ? automatic : null;
  const latestView = pair?.view || ["front", ...POSTURE_VIEW_KEYS.filter((view) => view !== "front"), "custom"]
    .find((view) => assessmentMediaForView(latestAssessment, view)) || null;
  const latestMedia = pair ? assessmentMediaForView(pair.after, pair.view) : assessmentMediaForView(latestAssessment, latestView);
  const beforeMedia = pair ? assessmentMediaForView(pair.before, pair.view) : null;

  const today = now instanceof Date && !Number.isNaN(now.getTime())
    ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    : "";
  const beforeDate = pair ? calendarDateOfAssessment(pair.before) : "";
  const latestDate = calendarDateOfAssessment(pair?.after || latestAssessment);
  const completed = ordered.filter((assessment) => assessment.status === "completed");
  const sameDayOnly = !pair && completed.length >= 2 && completed.some((before, index) => completed.slice(index + 1)
    .some((after) => calendarDateOfAssessment(before) && calendarDateOfAssessment(before) === calendarDateOfAssessment(after)
      && commonCanonicalView(before, after)));
  return {
    state: pair ? "comparison" : ordered.length ? "single" : "empty",
    assessmentCount: ordered.length,
    photoCount,
    comparisonPairAvailable: Boolean(pair),
    sameDayOnly,
    view: pair?.view || latestView,
    before: beforeMedia,
    latest: latestMedia,
    beforeDate,
    latestDate,
    comparisonElapsedDays: pair ? postureCalendarDays(beforeDate, latestDate) : null,
    daysSinceLatest: latestDate && today ? postureCalendarDays(latestDate, today) : null,
    latestAssessmentId: latestAssessment?.id || null,
    beforeAssessmentId: pair?.before?.id || null,
    afterAssessmentId: pair?.after?.id || null,
  };
}

export function postureRetakeStatus(lastCompletedAt, now = new Date()) {
  if (!lastCompletedAt) return { days: null, tone: "empty", label: "아직 완료된 분석이 없습니다", recommended: false };
  const value = String(lastCompletedAt).slice(0, 10);
  const parsed = new Date(`${value}T00:00:00`);
  const current = new Date(now);
  current.setHours(0, 0, 0, 0);
  if (Number.isNaN(parsed.getTime())) return { days: null, tone: "unknown", label: "마지막 분석일 확인 필요", recommended: false };
  const days = Math.max(0, Math.floor((current.getTime() - parsed.getTime()) / 86400000));
  if (days >= POSTURE_RETAKE_DAYS.recommended) return { days, tone: "recommended", label: "재촬영을 권장합니다", recommended: true };
  if (days >= POSTURE_RETAKE_DAYS.upcoming) return { days, tone: "upcoming", label: "곧 재평가를 권장합니다", recommended: false };
  return { days, tone: "recent", label: "최근 분석 완료", recommended: false };
}

export function getPostureRetakeStatus(assessments, now = new Date()) {
  const completed = (Array.isArray(assessments) ? assessments : [])
    .filter((assessment) => assessment?.status === "completed")
    .filter((assessment) => Number.isFinite(Date.parse(assessment.completedAt || assessment.at || "")))
    .sort((left, right) => Date.parse(right.completedAt || right.at) - Date.parse(left.completedAt || left.at));
  if (!completed.length) return null;
  return postureRetakeStatus(completed[0].completedAt || completed[0].at, now);
}

export function correctedPoseSource(source, changed) {
  if (!changed) return source || "ai";
  return String(source || "ai").startsWith("ai") ? "ai_manual_corrected" : "manual";
}
