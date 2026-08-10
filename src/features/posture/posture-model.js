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
  return String(record?.completedAt || record?.updatedAt || record?.createdAt || (record?.date ? `${record.date}T00:00:00.000Z` : ""));
}

function newest(current, incoming) {
  if (!current) return incoming;
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

export function selectAutomaticComparison(sets, { scope = "full_body" } = {}) {
  const valid = (sets || [])
    .filter((set) => set?.status === "completed" && set.scope === scope)
    .sort((a, b) => String(a.completedAt || a.at).localeCompare(String(b.completedAt || b.at)));
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

export function correctedPoseSource(source, changed) {
  if (!changed) return source || "ai";
  return String(source || "ai").startsWith("ai") ? "ai_manual_corrected" : "manual";
}
