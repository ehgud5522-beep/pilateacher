export const POSTURE_RETAKE_DAYS = Object.freeze({
  upcoming: 30,
  recommended: 45,
});

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
      completedAt: "",
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
      group.completedAt = [group.completedAt, photo.completedAt || ""].sort().at(-1) || "";
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

const ZERO_CENTERED_METRICS = new Set(["shoulder", "pelvis", "twist", "knee", "head", "fha", "trunk", "kneeSide", "align"]);

export function compareAssessmentMetrics(beforeSet, afterSet, { view = null, limit = 8 } = {}) {
  if (!beforeSet || !afterSet) return [];
  const normalizedView = view ? normalizePostureView(view) : null;
  const records = (set) => (set?.poses || []).filter((pose) => !normalizedView || normalizePostureView(pose.view) === normalizedView);
  const beforeMetrics = new Map(records(beforeSet).flatMap((pose) => (pose.metrics || []).map((metric) => [
    `${normalizePostureView(pose.view)}:${metric.key}`,
    metric,
  ])));
  return records(afterSet).flatMap((pose) => (pose.metrics || []).map((metric) => {
    const previous = beforeMetrics.get(`${normalizePostureView(pose.view)}:${metric.key}`);
    const beforeValue = Number(previous?.value), afterValue = Number(metric?.value);
    if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) return null;
    const difference = Math.round((afterValue - beforeValue) * 10) / 10;
    const absoluteDifference = Math.round((Math.abs(afterValue) - Math.abs(beforeValue)) * 10) / 10;
    const threshold = metric.unit === "°" ? 0.5 : 0.1;
    const summary = Math.abs(difference) < threshold
      ? "변화 폭 작음"
      : ZERO_CENTERED_METRICS.has(metric.key)
        ? absoluteDifference < 0 ? "0° 기준에 가까워짐" : absoluteDifference > 0 ? "0° 기준에서 멀어짐" : "변화 없음"
        : difference > 0 ? "수치 증가" : "수치 감소";
    return {
      id: `${normalizePostureView(pose.view)}:${metric.key}`,
      key: metric.key,
      view: normalizePostureView(pose.view),
      label: metric.label,
      beforeValue,
      afterValue,
      difference,
      unit: metric.unit || previous?.unit || "",
      summary,
    };
  })).filter(Boolean).slice(0, Math.max(0, Number(limit) || 0));
}

export function postureMilestoneTemplate({ role = "unassigned", beforeSet = null, afterSet = null } = {}) {
  if (role !== "after") return { text: role === "before" ? "비포 촬영" : "체형 촬영", details: [], metricIds: [] };
  const changes = compareAssessmentMetrics(beforeSet, afterSet, { limit: 2 });
  const details = changes.map((change) => {
    const values = `${change.beforeValue}${change.unit} → ${change.afterValue}${change.unit}`;
    return `${postureViewLabel(change.view)} ${change.label}: ${values} (${change.summary})`;
  });
  return {
    text: details.length ? `애프터 촬영 · ${details.join(" · ")}` : "애프터 촬영",
    details,
    metricIds: changes.map((change) => change.id),
  };
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
  const eligible = (sets || []).filter((set) => set?.status === "completed" && set.scope === scope);
  const dated = eligible.filter((set) => Number.isFinite(Date.parse(set.completedAt || set.at || "")));
  const valid = (dated.length >= 2 ? dated : eligible)
    .sort((a, b) => {
      const left = Date.parse(a.completedAt || a.at || ""), right = Date.parse(b.completedAt || b.at || "");
      if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
      if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  if (valid.length < 2) return { before: valid[0] || null, after: null };
  return { before: valid[0], after: valid[valid.length - 1] };
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
