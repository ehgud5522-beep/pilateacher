const MAX_REMOTE_DIAGNOSTICS = 50;

/* 이 보고서는 기기를 떠난다. 그래서 통과 목록이 아니라 통과 "형태"로 짠다.

   위험한 패턴을 지우는 방식은 목록에 없는 패턴이 나오면 그대로 뚫린다.
   Bearer 와 sk- 만 가리던 예전 방식이 그랬다 -- 한글 회원 이름도,
   전화번호도, 파일 경로도 전부 통과했다.

   그래서 자유 문구는 아예 보내지 않는다. 나가는 값은 열거된 코드,
   불리언, 숫자, 해시뿐이다. 문자열은 이 문자셋을 벗어날 수 없고,
   벗어나는 글자는 뜻을 잃고 _ 가 된다 -- 띄어쓰기가 빠지므로 사람이 쓴
   문장은 통과해도 문장으로 남지 않는다.

   기기 안 진단 화면은 그대로다. 거기서는 원문을 봐야 원인을 찾을 수
   있고, 그 화면은 기기를 떠나지 않는다. */

/* 자격 증명은 문자셋을 통과한다 -- 토큰은 원래 영숫자다. 형태 규칙이 막는
   것은 사람이 쓴 문장이지 기계가 만든 문자열이 아니므로, 알려진 자격 증명
   모양은 그 앞에서 따로 지운다.

   이것은 보조 장치다. 무엇이 나갈 수 있는지를 정하는 것은 아래의 형태
   규칙이고, 이 목록은 그 규칙이 놓칠 수밖에 없는 한 종류를 덜어낸다.
   예전과 달리 자유 문구 몇 개가 아니라 모든 문자열에 걸린다. */
const withoutCredentials = (text) => text
  .replace(/Bearer\s+\S+/gi, "bearer_redacted")
  .replace(/\b(sk|ya29|ghp|gho|glpat|github_pat)[-_][A-Za-z0-9_-]{6,}/gi, "credential_redacted")
  .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "jwt_redacted");

const safeToken = (value, max = 120) => withoutCredentials(String(value || ""))
  .replace(/[^A-Za-z0-9._:/-]/g, "_")
  .slice(0, max);

/* 열거된 코드만 통과한다. 코드는 사람이 소스에 적어 둔 이름이라 반드시
   글자로 시작한다 -- 전화번호도 계좌번호도 생년월일도 그렇지 않다.
   문자셋만 거르면 숫자와 하이픈은 그대로 남으므로, 시작 글자를 함께 본다.

   식별자(requestId·해시·판 번호·시각·UA)는 숫자로 시작할 수 있어 이 규칙을
   쓰지 않는다. CLAUDE.md 가 원본 코드와 correlationId 를 그대로 남기라고
   했고, 그것을 지우면 서버 로그와 이어 붙일 수가 없다. */
const safeCode = (value, max = 120) => {
  const text = safeToken(value, max);
  return /^[A-Za-z]/.test(text) ? text : "";
};

/* 원문 대신 모양. 무슨 문구였는지는 말하지 않고, 문구가 있었는지와 그것이
   대략 어떤 종류였는지만 남긴다.

   이것이 있어야 "코드로는 구분이 안 되는데 문구는 달랐다"를 알아챈다.
   알아챈 다음에는 기기 진단 화면을 열어 보면 된다. */
const textShape = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return [
    `len${Math.min(9999, text.length)}`,
    /[^\u0020-\u007e]/.test(text) ? "nonascii" : "ascii",
    /[0-9]/.test(text) ? "digits" : "",
    /[a-z][a-z0-9+.-]*:\/\//i.test(text) ? "url" : "",
    /[/\\]/.test(text) ? "path" : "",
  ].filter(Boolean).join("_");
};

const finite = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;

const pipelineEvent = (event) => ({
  kind: "pipeline",
  at: safeToken(event?.at, 32),
  code: safeCode(event?.code),
  stage: safeCode(event?.stage),
  category: safeCode(event?.category),
  model: safeCode(event?.model),
  requestId: safeToken(event?.requestId, 160),
  transportCode: safeCode(event?.transportCode, 40),
  httpStatus: finite(event?.httpStatus) || 0,
  causeName: safeCode(event?.causeName, 80),
  validationReason: safeCode(event?.validationReason, 80),
  invalidField: safeToken(event?.invalidField, 120),
  operation: safeCode(event?.operation, 80),
});

const voiceEvent = (event) => ({
  kind: "voice",
  at: safeToken(event?.at, 32),
  event: safeCode(event?.event, 40),
  source: safeCode(event?.source, 40),
  stage: safeCode(event?.stage, 80),
  code: safeCode(event?.code, 80),
  messageShape: textShape(event?.message),
  reason: safeCode(event?.reason, 80),
  validationReason: safeCode(event?.validationReason, 80),
  invalidField: safeToken(event?.invalidField, 120),
  operation: safeCode(event?.operation, 80),
  phase: safeCode(event?.phase, 40),
  state: safeCode(event?.state, 40),
  platform: safeCode(event?.platform, 24),
  lifecycleState: safeCode(event?.lifecycleState, 40),
  causeShape: textShape(event?.causeMessage),
  blobIdHash: safeToken(event?.blobIdHash, 80),
  uriPresent: typeof event?.uriPresent === "boolean" ? event.uriPresent : null,
  consentRequired: typeof event?.consentRequired === "boolean" ? event.consentRequired : null,
  consentGranted: typeof event?.consentGranted === "boolean" ? event.consentGranted : null,
  requestId: safeToken(event?.requestId, 160),
  httpStatus: finite(event?.httpStatus) || 0,
  flags: Array.isArray(event?.flags) ? event.flags.map((flag) => safeCode(flag, 40)).filter(Boolean).slice(0, 4) : [],
  attempt: finite(event?.attempt),
  delayMs: finite(event?.delayMs),
  elapsedMs: finite(event?.elapsedMs),
  durationMs: finite(event?.durationMs),
  seconds: finite(event?.seconds),
  bytes: finite(event?.bytes),
  speechSeconds: finite(event?.speechSeconds),
  trimmedMs: finite(event?.trimmedMs),
  captureLatencyMs: finite(event?.captureLatencyMs),
  pluginErrorShape: textShape(event?.pluginError),
  permissionState: safeCode(event?.permissionState, 40),
  audioSessionCategory: safeCode(event?.audioSessionCategory, 80),
  audioSessionMode: safeCode(event?.audioSessionMode, 80),
  x: finite(event?.x),
  y: finite(event?.y),
  width: finite(event?.width),
  height: finite(event?.height),
});

// Sign-in stage records already arrive scrubbed from auth-diagnostics.js; this
// only bounds their length so one report cannot grow without limit.
const authEvent = (event) => ({
  kind: "auth",
  at: safeToken(event?.at, 32),
  feature: safeCode(event?.feature, 40),
  stage: safeCode(event?.stage, 48),
  outcome: safeCode(event?.outcome, 16),
  provider: safeCode(event?.provider, 16),
  errorDomain: safeCode(event?.errorDomain, 96),
  errorCode: safeToken(event?.errorCode, 64),
  messageShape: textShape(event?.message),
  correlationId: safeToken(event?.correlationId, 64),
  appBuild: safeToken(event?.appBuild, 40),
  platform: safeCode(event?.platform, 24),
  osVersion: safeToken(event?.osVersion, 40),
  deviceModel: safeToken(event?.deviceModel, 40),
  elapsedMs: finite(event?.elapsedMs),
  hasIdToken: typeof event?.hasIdToken === "boolean" ? event.hasIdToken : null,
  hasNonce: typeof event?.hasNonce === "boolean" ? event.hasNonce : null,
  hasAuthorizationCode: typeof event?.hasAuthorizationCode === "boolean" ? event.hasAuthorizationCode : null,
});

const postureRecord = (record) => ({
  recordType: safeCode(record?.recordType, 12),
  recordIdHash: safeToken(record?.recordIdHash, 40),
  assessmentIdHash: safeToken(record?.assessmentIdHash, 40),
  recordMemberIdHash: safeToken(record?.recordMemberIdHash, 40),
  blobIdHash: safeToken(record?.blobIdHash, 40),
  view: safeCode(record?.view, 24),
  assessmentStatus: safeCode(record?.assessmentStatus, 40),
  captureStatus: safeCode(record?.captureStatus, 40),
  blobIdPresent: typeof record?.blobIdPresent === "boolean" ? record.blobIdPresent : null,
  idbLookupAttempted: typeof record?.idbLookupAttempted === "boolean" ? record.idbLookupAttempted : null,
  idbLookupFound: typeof record?.idbLookupFound === "boolean" ? record.idbLookupFound : null,
  idbLookupMissing: typeof record?.idbLookupMissing === "boolean" ? record.idbLookupMissing : null,
  idbLookupFailed: typeof record?.idbLookupFailed === "boolean" ? record.idbLookupFailed : null,
});

const postureReasonCounts = (value) => Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {})
  .map(([reason, count]) => [safeCode(reason, 64), finite(count) || 0])
  .slice(0, 12));

const postureEvent = (event) => ({
  kind: "posture",
  at: safeToken(event?.at, 32),
  event: safeCode(event?.event, 48),
  reason: safeCode(event?.reason, 80),
  failureReason: safeCode(event?.failureReason, 80),
  errorName: safeCode(event?.errorName, 80),
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
  assessmentStatus: safeCode(event?.assessmentStatus, 40),
  idbOpen: safeCode(event?.idbOpen, 16),
  views: Array.isArray(event?.views) ? event.views.map((view) => safeCode(view, 24)).filter(Boolean).slice(0, 6) : [],
  selectedViews: Array.isArray(event?.selectedViews) ? event.selectedViews.map((view) => safeCode(view, 24)).filter(Boolean).slice(0, 6) : [],
  rejectReasons: Array.isArray(event?.rejectReasons) ? event.rejectReasons.map((reason) => safeCode(reason, 64)).filter(Boolean).slice(0, 12) : [],
  failureReasons: Array.isArray(event?.failureReasons) ? event.failureReasons.map((reason) => safeCode(reason, 64)).filter(Boolean).slice(0, 12) : [],
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
      name: safeToken(appInfo?.name, 80),
      version: safeToken(appInfo?.version, 40),
      build: safeToken(appInfo?.build, 40),
    },
    device: {
      platform: safeCode(deviceInfo?.platform, 40),
      /* 웹뷰 판을 알아야 하는 값이라 남기되, 다른 값과 같은 문자셋으로
         거른다. 괄호와 띄어쓰기는 _ 가 되지만 판 번호는 그대로 읽힌다. */
      userAgent: safeToken(deviceInfo?.userAgent, 240),
      language: safeCode(deviceInfo?.language, 40),
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
