const MAX_REMOTE_DIAGNOSTICS = 50;

const safeToken = (value, max = 120) => String(value || "")
  .replace(/[^A-Za-z0-9._:/-]/g, "_")
  .slice(0, max);
const safeDeviceText = (value, max = 240) => String(value || "")
  .replace(/[\r\n\t]+/g, " ")
  .replace(/Bearer\s+\S+/gi, "Bearer_[redacted]")
  .replace(/sk-[A-Za-z0-9_-]+/g, "sk_[redacted]")
  .slice(0, max);
const finite = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;

const pipelineEvent = (event) => ({
  kind: "pipeline",
  at: String(event?.at || ""),
  code: safeToken(event?.code),
  stage: safeToken(event?.stage),
  category: safeToken(event?.category),
  model: safeToken(event?.model),
  requestId: safeToken(event?.requestId, 160),
  transportCode: safeToken(event?.transportCode, 40),
  httpStatus: finite(event?.httpStatus) || 0,
  causeName: safeToken(event?.causeName, 80),
  validationReason: safeToken(event?.validationReason, 80),
  invalidField: safeToken(event?.invalidField, 120),
  operation: safeToken(event?.operation, 80),
});

const voiceEvent = (event) => ({
  kind: "voice",
  at: String(event?.at || ""),
  event: safeToken(event?.event, 40),
  source: safeToken(event?.source, 40),
  stage: safeToken(event?.stage, 80),
  code: safeToken(event?.code, 80),
  message: safeDeviceText(event?.message, 240),
  reason: safeToken(event?.reason, 80),
  validationReason: safeToken(event?.validationReason, 80),
  invalidField: safeToken(event?.invalidField, 120),
  operation: safeToken(event?.operation, 80),
  phase: safeToken(event?.phase, 40),
  state: safeToken(event?.state, 40),
  platform: safeToken(event?.platform, 24),
  causeMessage: safeDeviceText(event?.causeMessage, 400),
  blobIdHash: safeToken(event?.blobIdHash, 80),
  uriPresent: typeof event?.uriPresent === "boolean" ? event.uriPresent : null,
  consentRequired: typeof event?.consentRequired === "boolean" ? event.consentRequired : null,
  consentGranted: typeof event?.consentGranted === "boolean" ? event.consentGranted : null,
  requestId: safeToken(event?.requestId, 160),
  httpStatus: finite(event?.httpStatus) || 0,
  flags: Array.isArray(event?.flags) ? event.flags.map((flag) => safeToken(flag, 40)).filter(Boolean).slice(0, 4) : [],
  attempt: finite(event?.attempt),
  delayMs: finite(event?.delayMs),
  elapsedMs: finite(event?.elapsedMs),
  durationMs: finite(event?.durationMs),
  seconds: finite(event?.seconds),
  bytes: finite(event?.bytes),
  speechSeconds: finite(event?.speechSeconds),
  trimmedMs: finite(event?.trimmedMs),
  captureLatencyMs: finite(event?.captureLatencyMs),
  pluginError: safeDeviceText(event?.pluginError, 240),
  permissionState: safeToken(event?.permissionState, 40),
  audioSessionCategory: safeToken(event?.audioSessionCategory, 80),
  audioSessionMode: safeToken(event?.audioSessionMode, 80),
  x: finite(event?.x),
  y: finite(event?.y),
  width: finite(event?.width),
  height: finite(event?.height),
});

// Sign-in stage records already arrive scrubbed from auth-diagnostics.js; this
// only bounds their length so one report cannot grow without limit.
const authEvent = (event) => ({
  kind: "auth",
  at: String(event?.at || ""),
  feature: safeToken(event?.feature, 40),
  stage: safeToken(event?.stage, 48),
  outcome: safeToken(event?.outcome, 16),
  provider: safeToken(event?.provider, 16),
  errorDomain: safeToken(event?.errorDomain, 96),
  errorCode: safeToken(event?.errorCode, 64),
  message: safeDeviceText(event?.message, 240),
  correlationId: safeToken(event?.correlationId, 64),
  appBuild: safeToken(event?.appBuild, 40),
  platform: safeToken(event?.platform, 24),
  osVersion: safeToken(event?.osVersion, 40),
  deviceModel: safeToken(event?.deviceModel, 40),
  elapsedMs: finite(event?.elapsedMs),
  hasIdToken: typeof event?.hasIdToken === "boolean" ? event.hasIdToken : null,
  hasNonce: typeof event?.hasNonce === "boolean" ? event.hasNonce : null,
  hasAuthorizationCode: typeof event?.hasAuthorizationCode === "boolean" ? event.hasAuthorizationCode : null,
});

const postureRecord = (record) => ({
  recordType: safeToken(record?.recordType, 12),
  recordIdHash: safeToken(record?.recordIdHash, 40),
  assessmentIdHash: safeToken(record?.assessmentIdHash, 40),
  recordMemberIdHash: safeToken(record?.recordMemberIdHash, 40),
  blobIdHash: safeToken(record?.blobIdHash, 40),
  view: safeToken(record?.view, 24),
  assessmentStatus: safeToken(record?.assessmentStatus, 40),
  captureStatus: safeToken(record?.captureStatus, 40),
  blobIdPresent: typeof record?.blobIdPresent === "boolean" ? record.blobIdPresent : null,
  idbLookupAttempted: typeof record?.idbLookupAttempted === "boolean" ? record.idbLookupAttempted : null,
  idbLookupFound: typeof record?.idbLookupFound === "boolean" ? record.idbLookupFound : null,
  idbLookupMissing: typeof record?.idbLookupMissing === "boolean" ? record.idbLookupMissing : null,
  idbLookupFailed: typeof record?.idbLookupFailed === "boolean" ? record.idbLookupFailed : null,
});

const postureReasonCounts = (value) => Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {})
  .map(([reason, count]) => [safeToken(reason, 64), finite(count) || 0])
  .slice(0, 12));

const postureEvent = (event) => ({
  kind: "posture",
  at: String(event?.at || ""),
  event: safeToken(event?.event, 48),
  reason: safeToken(event?.reason, 80),
  failureReason: safeToken(event?.failureReason, 80),
  errorName: safeToken(event?.errorName, 80),
  accountPresent: typeof event?.accountPresent === "boolean" ? event.accountPresent : null,
  accountIdHash: safeToken(event?.accountIdHash, 40),
  memberIdHash: safeToken(event?.memberIdHash, 40),
  selectedMemberIdHash: safeToken(event?.selectedMemberIdHash, 40),
  photosBucketMemberIdHash: safeToken(event?.photosBucketMemberIdHash, 40),
  recordMemberIdHash: safeToken(event?.recordMemberIdHash, 40),
  assessmentIdHash: safeToken(event?.assessmentIdHash, 40),
  latestAssessmentIdHash: safeToken(event?.latestAssessmentIdHash, 40),
  photosBucketExists: typeof event?.photosBucketExists === "boolean" ? event.photosBucketExists : null,
  memberIdMatches: typeof event?.memberIdMatches === "boolean" ? event.memberIdMatches : null,
  assessmentComplete: typeof event?.assessmentComplete === "boolean" ? event.assessmentComplete : null,
  metadataExists: typeof event?.metadataExists === "boolean" ? event.metadataExists : null,
  metadataParsed: typeof event?.metadataParsed === "boolean" ? event.metadataParsed : null,
  targetMemberBucketExists: typeof event?.targetMemberBucketExists === "boolean" ? event.targetMemberBucketExists : null,
  blobIdPresent: typeof event?.blobIdPresent === "boolean" ? event.blobIdPresent : null,
  cleanBlobIdPresent: typeof event?.cleanBlobIdPresent === "boolean" ? event.cleanBlobIdPresent : null,
  ptsPresent: typeof event?.ptsPresent === "boolean" ? event.ptsPresent : null,
  rawPhotoCount: finite(event?.rawPhotoCount),
  poseCount: finite(event?.poseCount),
  normalizedAssessmentCount: finite(event?.normalizedAssessmentCount),
  completedAssessmentCount: finite(event?.completedAssessmentCount),
  photoRecords: finite(event?.photoRecords),
  poseRecords: finite(event?.poseRecords),
  beforeRawPhotoCount: finite(event?.beforeRawPhotoCount),
  afterRawPhotoCount: finite(event?.afterRawPhotoCount),
  beforePoseCount: finite(event?.beforePoseCount),
  afterPoseCount: finite(event?.afterPoseCount),
  beforeAssessmentCount: finite(event?.beforeAssessmentCount),
  afterAssessmentCount: finite(event?.afterAssessmentCount),
  beforePhotoRecords: finite(event?.beforePhotoRecords),
  afterPhotoRecords: finite(event?.afterPhotoRecords),
  beforePoseRecords: finite(event?.beforePoseRecords),
  afterPoseRecords: finite(event?.afterPoseRecords),
  metadataMemberBucketCount: finite(event?.metadataMemberBucketCount),
  blobKeyCount: finite(event?.blobKeyCount),
  adoptAttempted: finite(event?.adoptAttempted),
  adoptRestored: finite(event?.adoptRestored),
  adoptMissingBlob: finite(event?.adoptMissingBlob),
  adoptFailed: finite(event?.adoptFailed),
  excludedRecordCount: finite(event?.excludedRecordCount),
  assessmentStatus: safeToken(event?.assessmentStatus, 40),
  idbOpen: safeToken(event?.idbOpen, 16),
  views: Array.isArray(event?.views) ? event.views.map((view) => safeToken(view, 24)).filter(Boolean).slice(0, 6) : [],
  selectedViews: Array.isArray(event?.selectedViews) ? event.selectedViews.map((view) => safeToken(view, 24)).filter(Boolean).slice(0, 6) : [],
  rejectReasons: Array.isArray(event?.rejectReasons) ? event.rejectReasons.map((reason) => safeToken(reason, 64)).filter(Boolean).slice(0, 12) : [],
  failureReasons: Array.isArray(event?.failureReasons) ? event.failureReasons.map((reason) => safeToken(reason, 64)).filter(Boolean).slice(0, 12) : [],
  excludedByReason: postureReasonCounts(event?.excludedByReason),
  metadataWriteSucceeded: typeof event?.metadataWriteSucceeded === "boolean" ? event.metadataWriteSucceeded : null,
  completionPromoted: typeof event?.completionPromoted === "boolean" ? event.completionPromoted : null,
  memoryPatchSucceeded: typeof event?.memoryPatchSucceeded === "boolean" ? event.memoryPatchSucceeded : null,
  recordDiagnostics: Array.isArray(event?.recordDiagnostics) ? event.recordDiagnostics.map(postureRecord).slice(0, 32) : [],
});

/**
 * @param {{ pipelineEvents?: any[], voiceEvents?: any[], authEvents?: any[], postureEvents?: any[],
 *   appInfo?: Record<string, any>, deviceInfo?: Record<string, any>, now?: Date }} [options]
 */
export function buildRemoteDiagnosticReport({ pipelineEvents = [], voiceEvents = [], authEvents = [], postureEvents = [], appInfo = {}, deviceInfo = {}, now = new Date() } = {}) {
  const logs = [
    ...pipelineEvents.map(pipelineEvent),
    ...voiceEvents.map(voiceEvent),
    ...authEvents.map(authEvent),
    ...postureEvents.map(postureEvent),
  ].filter((event) => event.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, MAX_REMOTE_DIAGNOSTICS);
  return {
    schemaVersion: 1,
    createdAt: now.toISOString(),
    app: {
      id: safeToken(appInfo?.id, 120),
      name: safeDeviceText(appInfo?.name, 80),
      version: safeToken(appInfo?.version, 40),
      build: safeToken(appInfo?.build, 40),
    },
    device: {
      platform: safeToken(deviceInfo?.platform, 40),
      userAgent: safeDeviceText(deviceInfo?.userAgent, 240),
      language: safeToken(deviceInfo?.language, 40),
      screenWidth: finite(deviceInfo?.screenWidth),
      screenHeight: finite(deviceInfo?.screenHeight),
      pixelRatio: finite(deviceInfo?.pixelRatio),
      online: deviceInfo?.online !== false,
    },
    logs,
    logCount: logs.length,
  };
}

export const REMOTE_DIAGNOSTIC_LIMIT = MAX_REMOTE_DIAGNOSTICS;
