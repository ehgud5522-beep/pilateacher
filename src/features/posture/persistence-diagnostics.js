import {
  POSTURE_STORAGE_KEYS,
  POSTURE_VIEW_KEYS,
  normalizeAssessmentSets,
  normalizePostureView,
} from "./posture-model.js";

export const POSTURE_PERSISTENCE_DIAGNOSTIC_KEY = "pilateacher_posture_persistence_diagnostics_v1";
export const POSTURE_PERSISTENCE_DIAGNOSTIC_LIMIT = 40;

export const POSTURE_PERSISTENCE_EVENTS = Object.freeze({
  SAVE_COMMITTED: "POSTURE_SAVE_COMMITTED",
  WORKSPACE_ENTER: "POSTURE_WORKSPACE_ENTER",
  STORAGE_RESTORED: "POSTURE_STORAGE_RESTORED",
  FAILURE: "POSTURE_PERSISTENCE_FAILURE",
});

export const POSTURE_PERSISTENCE_FAILURES = Object.freeze({
  PHOTO_METADATA_LOAD_FAILED: "PHOTO_METADATA_LOAD_FAILED",
  PHOTO_METADATA_PARSE_FAILED: "PHOTO_METADATA_PARSE_FAILED",
  IDB_BLOB_READ_FAILED: "IDB_BLOB_READ_FAILED",
  PHOTO_METADATA_SAVE_FAILED: "PHOTO_METADATA_SAVE_FAILED",
  PHOTO_BLOB_SAVE_FAILED: "PHOTO_BLOB_SAVE_FAILED",
  POSE_BLOB_SAVE_FAILED: "POSE_BLOB_SAVE_FAILED",
  CLEAN_BLOB_SAVE_FAILED: "CLEAN_BLOB_SAVE_FAILED",
});

const ALLOWED_VIEWS = new Set([...POSTURE_VIEW_KEYS, "side", "custom"]);
const COUNT_FIELDS = new Set([
  "rawPhotoCount", "poseCount", "normalizedAssessmentCount", "completedAssessmentCount",
  "photoRecords", "poseRecords", "beforeRawPhotoCount", "afterRawPhotoCount",
  "beforePoseCount", "afterPoseCount", "beforeAssessmentCount", "afterAssessmentCount",
  "beforePhotoRecords", "afterPhotoRecords", "beforePoseRecords", "afterPoseRecords",
  "metadataMemberBucketCount", "blobKeyCount", "adoptAttempted", "adoptRestored",
  "adoptMissingBlob", "adoptFailed",
  "excludedRecordCount",
]);
const BOOLEAN_FIELDS = new Set([
  "accountPresent", "photosBucketExists", "memberIdMatches", "assessmentComplete",
  "blobIdPresent", "cleanBlobIdPresent", "ptsPresent", "metadataExists",
  "metadataParsed", "targetMemberBucketExists",
  "metadataWriteSucceeded", "completionPromoted", "memoryPatchSucceeded",
]);
const TOKEN_FIELDS = new Set([
  "event", "reason", "assessmentStatus", "accountIdHash", "memberIdHash",
  "selectedMemberIdHash", "photosBucketMemberIdHash", "recordMemberIdHash",
  "assessmentIdHash", "latestAssessmentIdHash",
  "idbOpen", "failureReason", "errorName",
]);
const ARRAY_FIELDS = new Set(["views", "selectedViews", "rejectReasons", "failureReasons"]);
const LOCAL_TEXT_FIELDS = new Set(["selectedMemberName", "resolvedMemberName"]);
const MAP_FIELDS = new Set(["excludedByReason"]);
const RECORD_ARRAY_FIELDS = new Set(["recordDiagnostics"]);

const safeToken = (value, max = 120) => String(value || "")
  .replace(/[^A-Za-z0-9._:-]/g, "_")
  .slice(0, max);

const safeLocalText = (value, max = 48) => String(value || "")
  .replace(/[\r\n\t]+/g, " ")
  .slice(0, max);

export function postureDiagnosticId(value, prefix = "id") {
  const text = String(value || "");
  if (!text) return "";
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${safeToken(prefix, 12)}_${(hash >>> 0).toString(36).padStart(7, "0")}`;
}

export function postureRecordAssessmentId(record, { kind = "photo" } = {}) {
  if (!record) return "";
  if (kind === "pose") return String(record.assessmentId || `legacy_${record.date || record.id || "unknown"}`);
  return String(record.assessmentId || "");
}

export function postureRecordNormalizationEligibility(record, { memberId = null, kind = "photo" } = {}) {
  if (!record) return { included: false, reason: "invalid_record" };
  const assessmentId = postureRecordAssessmentId(record, { kind });
  if (!assessmentId) return { included: false, reason: "missing_assessment_id" };
  if (memberId && record.memberId && record.memberId !== memberId) return { included: false, reason: "member_id_mismatch" };
  return { included: true, reason: "included", assessmentId };
}

const recordsFor = (memberPhotos = {}) => {
  const photos = POSTURE_STORAGE_KEYS.flatMap((storageKey) => (
    Array.isArray(memberPhotos?.[storageKey])
      ? memberPhotos[storageKey].map((record) => ({ record, storageKey, kind: "photo" }))
      : []
  ));
  const poses = Array.isArray(memberPhotos?.poses)
    ? memberPhotos.poses.map((record) => ({ record, storageKey: "poses", kind: "pose" }))
    : [];
  return { photos, poses, all: [...photos, ...poses] };
};

const diagnosticView = (record, storageKey) => {
  const raw = String(record?.view || storageKey || "");
  if (ALLOWED_VIEWS.has(raw)) return raw;
  const normalized = normalizePostureView(raw);
  return ALLOWED_VIEWS.has(normalized) ? normalized : "";
};

const uniqueViews = (values) => [...new Set(values.filter(Boolean))].slice(0, 6);

const diagnosticRecord = ({ record, storageKey, kind, lookup = {} } = {}) => {
  const assessmentId = postureRecordAssessmentId(record, { kind });
  const blobId = record?.blobId || record?.thumbnailBlobId || "";
  return {
    recordType: kind === "pose" ? "pose" : "photo",
    recordIdHash: postureDiagnosticId(record?.id, "record"),
    assessmentIdHash: postureDiagnosticId(assessmentId, "asmt"),
    recordMemberIdHash: postureDiagnosticId(record?.memberId, "member"),
    blobIdHash: postureDiagnosticId(blobId, "blob"),
    view: diagnosticView(record, storageKey),
    assessmentStatus: safeToken(record?.assessmentStatus, 40),
    captureStatus: safeToken(record?.captureStatus, 40),
    blobIdPresent: Boolean(blobId),
    idbLookupAttempted: Boolean(lookup.idbLookupAttempted),
    idbLookupFound: Boolean(lookup.idbLookupFound),
    idbLookupMissing: Boolean(lookup.idbLookupMissing),
    idbLookupFailed: Boolean(lookup.idbLookupFailed),
  };
};

export function buildPostureRecordDiagnostic(input = {}) {
  return diagnosticRecord(input);
}

const sanitizeRecordDiagnostic = (value = {}) => ({
  recordType: safeToken(value.recordType, 12),
  recordIdHash: safeToken(value.recordIdHash, 40),
  assessmentIdHash: safeToken(value.assessmentIdHash, 40),
  recordMemberIdHash: safeToken(value.recordMemberIdHash, 40),
  blobIdHash: safeToken(value.blobIdHash, 40),
  view: safeToken(value.view, 24),
  assessmentStatus: safeToken(value.assessmentStatus, 40),
  captureStatus: safeToken(value.captureStatus, 40),
  blobIdPresent: Boolean(value.blobIdPresent),
  idbLookupAttempted: Boolean(value.idbLookupAttempted),
  idbLookupFound: Boolean(value.idbLookupFound),
  idbLookupMissing: Boolean(value.idbLookupMissing),
  idbLookupFailed: Boolean(value.idbLookupFailed),
});

export function buildPosturePersistenceSnapshot({
  accountId = null,
  memberId = null,
  selectedMemberId = memberId,
  selectedMemberIdHashOverride = "",
  selectedMemberName = "",
  resolvedMemberName = "",
  photoMap = {},
  photosBucketMemberId = memberId,
  assessmentId = null,
  assessmentIdHashOverride = "",
  recordLookups = [],
} = {}) {
  const source = photoMap && typeof photoMap === "object" ? photoMap : {};
  const bucketKey = String(photosBucketMemberId || "");
  const photosBucketExists = Boolean(bucketKey) && Object.prototype.hasOwnProperty.call(source, bucketKey);
  const memberPhotos = photosBucketExists && source[bucketKey] && typeof source[bucketKey] === "object" ? source[bucketKey] : {};
  const records = recordsFor(memberPhotos);
  const rawPhotos = records.photos.map(({ record }) => record).filter(Boolean);
  const poses = records.poses.map(({ record }) => record).filter(Boolean);
  const normalized = normalizeAssessmentSets(memberPhotos, { memberId });
  const latest = normalized[0] || null;
  const targetId = String(assessmentId || (assessmentIdHashOverride ? "" : latest?.id) || "");
  const targetEntries = records.all.filter(({ record, kind }) => (
    postureRecordAssessmentId(record, { kind }) === targetId
  ));
  const targetPhotos = targetEntries.filter(({ kind }) => kind === "photo");
  const targetPoses = targetEntries.filter(({ kind }) => kind === "pose");
  const targetSet = normalized.find((set) => String(set.id) === targetId) || null;
  const excludedByReason = records.all.reduce((counts, { record, kind }) => {
    if (!record) return counts;
    const eligibility = postureRecordNormalizationEligibility(record, { memberId, kind });
    if (eligibility.included) return counts;
    counts[eligibility.reason] = (counts[eligibility.reason] || 0) + 1;
    return counts;
  }, {});
  const rejectReasons = Object.keys(excludedByReason);
  const allMemberIdsMatch = records.all.filter(({ record }) => record).every(({ record }) => !memberId || !record.memberId || record.memberId === memberId);
  const memberIdMatches = (!memberId || !bucketKey || bucketKey === memberId) && allMemberIdsMatch;
  const recordCount = rawPhotos.length + poses.length;
  const reason = !photosBucketExists
    ? "NO_MEMBER_BUCKET"
    : recordCount === 0
      ? "NO_RAW_RECORDS"
      : !memberIdMatches
        ? "MEMBER_ID_MISMATCH"
        : normalized.length
          ? "ASSESSMENT_PRESENT"
          : "RAW_RECORDS_PRESENT_BUT_ZERO_SETS";
  const rawTargetRecords = targetEntries.map(({ record }) => record);
  const recordMemberId = rawTargetRecords.find((record) => record?.memberId)?.memberId || "";
  const lookupByRecord = new Map((Array.isArray(recordLookups) ? recordLookups : []).map((lookup) => [
    `${lookup?.recordIdHash || ""}:${lookup?.blobIdHash || ""}`,
    lookup,
  ]));
  const recordDiagnostics = targetEntries.map((entry) => {
    const base = diagnosticRecord(entry);
    return diagnosticRecord({
      ...entry,
      lookup: lookupByRecord.get(`${base.recordIdHash}:${base.blobIdHash}`) || {},
    });
  });
  const selectedViews = targetSet?.selectedViews || rawTargetRecords.flatMap((record) => Array.isArray(record?.selectedViews) ? record.selectedViews : []);

  return {
    accountPresent: Boolean(accountId),
    accountIdHash: postureDiagnosticId(accountId, "acct"),
    memberIdHash: postureDiagnosticId(memberId, "member"),
    selectedMemberIdHash: postureDiagnosticId(selectedMemberId, "member") || safeToken(selectedMemberIdHashOverride, 40),
    selectedMemberName,
    resolvedMemberName,
    photosBucketMemberIdHash: postureDiagnosticId(photosBucketMemberId, "member"),
    recordMemberIdHash: postureDiagnosticId(recordMemberId, "member"),
    photosBucketExists,
    rawPhotoCount: rawPhotos.length,
    poseCount: poses.length,
    normalizedAssessmentCount: normalized.length,
    completedAssessmentCount: normalized.filter((set) => set.status === "completed").length,
    latestAssessmentIdHash: postureDiagnosticId(latest?.id, "asmt"),
    assessmentIdHash: postureDiagnosticId(targetId, "asmt") || safeToken(assessmentIdHashOverride, 40),
    photoRecords: targetPhotos.length,
    poseRecords: targetPoses.length,
    views: uniqueViews(targetEntries.map(({ record, storageKey }) => diagnosticView(record, storageKey))),
    assessmentStatus: targetSet?.status || safeToken(rawTargetRecords.find((record) => record?.assessmentStatus)?.assessmentStatus),
    assessmentComplete: targetSet?.status === "completed" || rawTargetRecords.some((record) => record?.assessmentComplete === true),
    selectedViews: uniqueViews(selectedViews.map((view) => {
      const normalizedView = normalizePostureView(view);
      return ALLOWED_VIEWS.has(normalizedView) ? normalizedView : "";
    })),
    blobIdPresent: rawTargetRecords.some((record) => Boolean(record?.blobId)),
    cleanBlobIdPresent: rawTargetRecords.some((record) => Boolean(record?.cleanBlobId)),
    ptsPresent: rawTargetRecords.some((record) => Boolean(record?.pts && typeof record.pts === "object" && Object.keys(record.pts).length)),
    memberIdMatches,
    rejectReasons,
    excludedRecordCount: Object.values(excludedByReason).reduce((sum, count) => sum + count, 0),
    excludedByReason,
    recordDiagnostics,
    reason,
  };
}

export function buildPostureSaveDiagnostic({
  beforePhotoMap = {},
  afterPhotoMap = {},
  metadataWriteSucceeded = false,
  completionPromoted = false,
  memoryPatchSucceeded = false,
  failureReason = "",
  ...identity
} = {}) {
  const before = buildPosturePersistenceSnapshot({ ...identity, photoMap: beforePhotoMap });
  const after = buildPosturePersistenceSnapshot({ ...identity, photoMap: afterPhotoMap });
  return {
    ...after,
    beforeRawPhotoCount: before.rawPhotoCount,
    afterRawPhotoCount: after.rawPhotoCount,
    beforePoseCount: before.poseCount,
    afterPoseCount: after.poseCount,
    beforeAssessmentCount: before.normalizedAssessmentCount,
    afterAssessmentCount: after.normalizedAssessmentCount,
    beforePhotoRecords: before.photoRecords,
    afterPhotoRecords: after.photoRecords,
    beforePoseRecords: before.poseRecords,
    afterPoseRecords: after.poseRecords,
    metadataWriteSucceeded: Boolean(metadataWriteSucceeded),
    completionPromoted: Boolean(completionPromoted),
    memoryPatchSucceeded: Boolean(memoryPatchSucceeded),
    failureReason,
  };
}

export function buildPostureRestoreDiagnostic({
  photoMap = {},
  metadataPhotoMap = photoMap,
  accountId = null,
  memberId = null,
  selectedMemberId = memberId,
  selectedMemberIdHashOverride = "",
  selectedMemberName = "",
  resolvedMemberName = "",
  assessmentId = null,
  assessmentIdHashOverride = "",
  metadataExists = false,
  metadataParsed = false,
  idbOpen = "unknown",
  blobKeyCount = 0,
  adoptAttempted = 0,
  adoptRestored = 0,
  adoptMissingBlob = 0,
  adoptFailed = 0,
  failureReasons = [],
  recordLookups = [],
} = {}) {
  const metadataSource = metadataPhotoMap && typeof metadataPhotoMap === "object" ? metadataPhotoMap : {};
  return {
    ...buildPosturePersistenceSnapshot({
      accountId,
      memberId,
      selectedMemberId,
      selectedMemberIdHashOverride,
      selectedMemberName,
      resolvedMemberName,
      assessmentId,
      assessmentIdHashOverride,
      photoMap,
      photosBucketMemberId: memberId,
      recordLookups,
    }),
    metadataExists: Boolean(metadataExists),
    metadataParsed: Boolean(metadataParsed),
    metadataMemberBucketCount: Object.keys(metadataSource).length,
    targetMemberBucketExists: Boolean(memberId) && Object.prototype.hasOwnProperty.call(metadataSource, memberId),
    idbOpen: ["success", "fail", "unknown"].includes(idbOpen) ? idbOpen : "unknown",
    blobKeyCount,
    adoptAttempted,
    adoptRestored,
    adoptMissingBlob,
    adoptFailed,
    failureReasons,
  };
}

const sanitizeEntry = (event, details, clock) => {
  const source = details && typeof details === "object" ? details : {};
  const entry = { at: clock().toISOString(), event: safeToken(event, 48) };
  for (const [key, value] of Object.entries(source)) {
    if (COUNT_FIELDS.has(key)) entry[key] = Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
    else if (BOOLEAN_FIELDS.has(key)) entry[key] = Boolean(value);
    else if (TOKEN_FIELDS.has(key) && key !== "event") entry[key] = safeToken(value);
    else if (ARRAY_FIELDS.has(key)) entry[key] = Array.isArray(value) ? value.map((item) => safeToken(item, 64)).filter(Boolean).slice(0, 12) : [];
    else if (LOCAL_TEXT_FIELDS.has(key)) entry[key] = safeLocalText(value);
    else if (MAP_FIELDS.has(key)) entry[key] = Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {}).map(([mapKey, count]) => [safeToken(mapKey, 64), Math.max(0, Math.round(Number(count) || 0))]).slice(0, 12));
    else if (RECORD_ARRAY_FIELDS.has(key)) entry[key] = Array.isArray(value) ? value.map(sanitizeRecordDiagnostic).slice(0, 32) : [];
  }
  return entry;
};

export function readPosturePersistenceDiagnostics(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(POSTURE_PERSISTENCE_DIAGNOSTIC_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(-POSTURE_PERSISTENCE_DIAGNOSTIC_LIMIT).reverse() : [];
  } catch (_error) {
    return [];
  }
}

export function appendPosturePersistenceDiagnostic(event, details = {}, storage = globalThis.localStorage, clock = () => new Date()) {
  const entry = sanitizeEntry(event, details, clock);
  try {
    const current = readPosturePersistenceDiagnostics(storage).reverse();
    storage?.setItem?.(POSTURE_PERSISTENCE_DIAGNOSTIC_KEY, JSON.stringify([...current, entry].slice(-POSTURE_PERSISTENCE_DIAGNOSTIC_LIMIT)));
  } catch (_error) {}
  return entry;
}

export function appendPosturePersistenceFailure(failureReason, details = {}, storage = globalThis.localStorage, clock = () => new Date()) {
  return appendPosturePersistenceDiagnostic(POSTURE_PERSISTENCE_EVENTS.FAILURE, {
    ...details,
    failureReason,
    errorName: safeToken(details?.errorName, 64),
  }, storage, clock);
}

export function posturePersistenceDiagnosticSummary(entry = {}) {
  const label = entry.event === POSTURE_PERSISTENCE_EVENTS.SAVE_COMMITTED ? "POSTURE SAVE"
    : entry.event === POSTURE_PERSISTENCE_EVENTS.WORKSPACE_ENTER ? "POSTURE ENTER"
      : entry.event === POSTURE_PERSISTENCE_EVENTS.STORAGE_RESTORED ? "POSTURE RESTORE"
        : "POSTURE ERROR";
  return [
    label,
    `raw ${Number(entry.rawPhotoCount) || 0}`,
    `poses ${Number(entry.poseCount) || 0}`,
    `sets ${Number(entry.normalizedAssessmentCount) || 0}`,
    entry.memberIdMatches == null ? "" : `member match ${entry.memberIdMatches ? "YES" : "NO"}`,
    entry.latestAssessmentIdHash ? `latest ${entry.latestAssessmentIdHash}` : "",
    entry.selectedMemberIdHash ? `selected ${entry.selectedMemberIdHash}` : "",
    entry.photosBucketMemberIdHash ? `bucket ${entry.photosBucketMemberIdHash}` : "",
    entry.recordMemberIdHash ? `record member ${entry.recordMemberIdHash}` : "",
    entry.selectedMemberName ? `selected name ${entry.selectedMemberName}` : "",
    entry.resolvedMemberName ? `resolved name ${entry.resolvedMemberName}` : "",
    Object.hasOwn(entry, "beforeRawPhotoCount")
      ? `before ${Number(entry.beforeRawPhotoCount) || 0}/${Number(entry.beforePoseCount) || 0}/${Number(entry.beforeAssessmentCount) || 0} → after ${Number(entry.afterRawPhotoCount) || 0}/${Number(entry.afterPoseCount) || 0}/${Number(entry.afterAssessmentCount) || 0}`
      : "",
    Object.hasOwn(entry, "metadataWriteSucceeded")
      ? `write ${entry.metadataWriteSucceeded ? "YES" : "NO"} · promoted ${entry.completionPromoted ? "YES" : "NO"} · memory ${entry.memoryPatchSucceeded ? "YES" : "NO"}`
      : "",
    entry.recordDiagnostics?.length
      ? `records ${entry.recordDiagnostics.map((record) => `${record.recordIdHash || "record"}/${record.assessmentIdHash || "asmt"}/${record.view || "view"}/${record.captureStatus || record.assessmentStatus || "status"}/blob ${record.blobIdHash || "none"}:${record.idbLookupAttempted ? (record.idbLookupFound ? "found" : record.idbLookupMissing ? "missing" : record.idbLookupFailed ? "failed" : "checked") : "not-checked"}`).join(", ")}`
      : "",
    entry.excludedRecordCount ? `excluded ${entry.excludedRecordCount} ${Object.entries(entry.excludedByReason || {}).map(([reason, count]) => `${reason}:${count}`).join(",")}` : "",
    entry.event === POSTURE_PERSISTENCE_EVENTS.STORAGE_RESTORED
      ? `metadata ${entry.metadataExists ? (entry.metadataParsed ? "parsed" : "unparsed") : "missing"} · idb ${entry.idbOpen || "unknown"} · adopt ${Number(entry.adoptRestored) || 0}/${Number(entry.adoptMissingBlob) || 0}/${Number(entry.adoptFailed) || 0}`
      : "",
    entry.reason ? `reason ${entry.reason}` : "",
    entry.failureReason ? `reason ${entry.failureReason}` : "",
  ].filter(Boolean).join(" · ");
}
