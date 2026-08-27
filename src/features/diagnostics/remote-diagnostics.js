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
});

const voiceEvent = (event) => ({
  kind: "voice",
  at: String(event?.at || ""),
  event: safeToken(event?.event, 40),
  source: safeToken(event?.source, 40),
  code: safeToken(event?.code, 80),
  reason: safeToken(event?.reason, 80),
  phase: safeToken(event?.phase, 40),
  state: safeToken(event?.state, 40),
  requestId: safeToken(event?.requestId, 160),
  flags: Array.isArray(event?.flags) ? event.flags.map((flag) => safeToken(flag, 40)).filter(Boolean).slice(0, 4) : [],
  attempt: finite(event?.attempt),
  delayMs: finite(event?.delayMs),
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

/**
 * @param {{ pipelineEvents?: any[], voiceEvents?: any[], authEvents?: any[],
 *   appInfo?: Record<string, any>, deviceInfo?: Record<string, any>, now?: Date }} [options]
 */
export function buildRemoteDiagnosticReport({ pipelineEvents = [], voiceEvents = [], authEvents = [], appInfo = {}, deviceInfo = {}, now = new Date() } = {}) {
  const logs = [
    ...pipelineEvents.map(pipelineEvent),
    ...voiceEvents.map(voiceEvent),
    ...authEvents.map(authEvent),
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
