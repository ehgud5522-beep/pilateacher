/**
 * Stage trace for the sign-in flows.
 *
 * A sign-in crosses three layers - the Apple authorization sheet, the Capacitor
 * plugin, and Firebase Auth - and a failure in any of them used to reach the
 * teacher as one sentence. This records which stage ran, which stage failed
 * first, and the failing layer's own domain and code, so the failure can be
 * located from the device instead of guessed at.
 *
 * Nothing secret is stored. Tokens, nonces, credentials, authorization codes,
 * identity tokens, passwords and e-mail addresses are dropped by key and
 * scrubbed out of every free-text field; only their presence is ever recorded.
 */

export const AUTH_DIAGNOSTIC_STORAGE_KEY = "pilateacher_auth_diagnostics_v1";
export const AUTH_DIAGNOSTIC_LIMIT = 40;

export const AUTH_STAGES = Object.freeze({
  LOGIN_START: "apple_login_start",
  NATIVE_PLUGIN_MISSING: "native_plugin_missing",
  NATIVE_AUTHORIZATION_STARTED: "native_authorization_started",
  NATIVE_AUTHORIZATION_SUCCEEDED: "native_authorization_succeeded",
  NATIVE_AUTHORIZATION_FAILED: "native_authorization_failed",
  CREDENTIAL_INSPECTED: "credential_inspected",
  CREDENTIAL_REJECTED: "credential_rejected",
  FIREBASE_CREDENTIAL_CREATED: "firebase_credential_created",
  FIREBASE_SIGN_IN_STARTED: "firebase_sign_in_started",
  FIREBASE_SIGN_IN_SETTLED: "firebase_sign_in_settled",
  FIREBASE_SIGN_IN_RETRY: "firebase_sign_in_retry",
  AUTHSTATE_LISTENER_FAILED: "authstate_listener_failed",
  FIREBASE_AUTH_SUCCEEDED: "firebase_auth_succeeded",
  FIREBASE_AUTH_FAILED: "firebase_auth_failed",
  PROFILE_LOADED: "profile_loaded",
  LOGIN_CANCELLED: "login_cancelled",
  LOGIN_FAILED: "login_failed",
  // Email sign-in and sign-up run entirely on the Firebase JavaScript SDK, so
  // they fail in the same place a credential exchange does.
  EMAIL_REQUEST_START: "email_request_start",
  EMAIL_AUTH_SUCCEEDED: "email_auth_succeeded",
  EMAIL_AUTH_FAILED: "email_auth_failed",
  // Reachability of the layers a sign-in needs, measured before one is tried.
  PREFLIGHT_STARTED: "connectivity_preflight_started",
  AUTH_ENDPOINT_PROBE: "auth_endpoint_probe",
  INDEXED_DB_PROBE: "indexed_db_probe",
  LOCAL_STORAGE_PROBE: "local_storage_probe",
  NETWORK_STATE: "network_state",
});

export const AUTH_FEATURES = Object.freeze({
  APPLE_SIGN_IN: "apple_sign_in",
  EMAIL_SIGN_IN: "email_sign_in",
  CONNECTIVITY: "auth_connectivity",
});

// The stored entry is built from this fixed list of fields and nothing else, so
// a caller cannot leak a secret by passing an extra key. FORBIDDEN_FIELD states
// what must never become one of them; a test holds the list to it.
export const FORBIDDEN_FIELD = /(^|[^a-z])(token|nonce|credential|authorizationcode|identitytoken|password|secret|email|phone)([^a-z]|$)/i;

/** @type {[RegExp, string][]} */
const SECRET_VALUE_PATTERNS = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]"],
  [/\bBearer\s+\S+/gi, "Bearer [redacted]"],
  [/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-token]"],
  [/\b(token|nonce|code|credential)\s*[=:]\s*\S+/gi, "$1=[redacted]"],
  [/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-value]"],
];

const token = (value, max = 120) => String(value ?? "")
  .replace(/[^A-Za-z0-9._:/#@-]/g, "_")
  .slice(0, max);

export function scrubAuthMessage(value, max = 240) {
  let text = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) text = text.replace(pattern, replacement);
  return text.slice(0, max);
}

/** Reads the layer that produced an error and that layer's own code, unchanged. */
export function readAuthErrorIdentity(error) {
  if (!error || typeof error !== "object") {
    return { errorDomain: "", errorCode: "", message: scrubAuthMessage(error) };
  }
  const code = String(error.code ?? "");
  const nativeDomain = String(error.errorDomain ?? "");
  const nativeCode = error.errorCode === undefined || error.errorCode === null ? "" : String(error.errorCode);
  // The iOS patch prefixes a code it could not map to a Firebase one with
  // `native:<NSError.domain>:<NSError.code>`; keep both halves visible.
  const nativeFromCode = /^native:([^:]+):(-?\d+)$/.exec(code);
  if (nativeDomain || nativeFromCode) {
    return {
      errorDomain: token(nativeDomain || nativeFromCode[1], 96),
      errorCode: token(nativeCode || nativeFromCode[2], 40),
      message: scrubAuthMessage(error.message ?? error.localizedDescription),
    };
  }
  if (code.startsWith("auth/")) {
    return { errorDomain: "firebase_auth", errorCode: token(code, 64), message: scrubAuthMessage(error.message) };
  }
  if (code) {
    return { errorDomain: "capacitor_plugin", errorCode: token(code, 64), message: scrubAuthMessage(error.message) };
  }
  return { errorDomain: "unknown", errorCode: "", message: scrubAuthMessage(error.message ?? error) };
}

export function readAuthDiagnostics(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(AUTH_DIAGNOSTIC_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(-AUTH_DIAGNOSTIC_LIMIT).reverse() : [];
  } catch (_error) {
    return [];
  }
}

export function clearAuthDiagnostics(storage = globalThis.localStorage) {
  try { storage?.removeItem?.(AUTH_DIAGNOSTIC_STORAGE_KEY); } catch (_error) {}
}

/** Shared by both diagnostic screens and clipboard export; only stored fields. */
export function authDiagnosticDetail(entry) {
  const parts = [];
  if (typeof entry.hasIdToken === "boolean") {
    parts.push(`idToken ${entry.hasIdToken ? "있음" : "없음"}`);
    parts.push(`nonce ${typeof entry.hasNonce !== "boolean" ? "미기록" : entry.hasNonce ? "있음" : "없음"}`);
    parts.push(`authCode ${typeof entry.hasAuthorizationCode !== "boolean" ? "미기록" : entry.hasAuthorizationCode ? "있음" : "없음"}`);
  }
  parts.push(`build ${entry.appBuild || "미기록"}`);
  return parts.join(" · ");
}

/**
 * Appends one stage record. `details` is filtered by key and by value, so a
 * caller cannot leak a secret into the log by accident.
 */
export function appendAuthDiagnostic(stage, details = {}, storage = globalThis.localStorage, clock = () => new Date()) {
  const source = /** @type {Record<string, any>} */ (details && typeof details === "object" ? details : {});
  const date = clock();
  const entry = {
    at: date.toISOString(),
    localTime: date.toLocaleString("ko-KR", { hour12: false }),
    feature: token(source.feature || "apple_sign_in", 40),
    stage: token(stage, 48),
    outcome: token(source.outcome || "info", 16),
    provider: token(source.provider || "apple", 16),
    errorDomain: token(source.errorDomain, 96),
    errorCode: token(source.errorCode, 64),
    message: scrubAuthMessage(source.message),
    correlationId: token(source.correlationId, 64),
    appBuild: token(source.appBuild, 40),
    platform: token(source.platform, 24),
    osVersion: token(source.osVersion, 40),
    deviceModel: token(source.deviceModel, 40),
    elapsedMs: Number.isFinite(Number(source.elapsedMs)) ? Math.max(0, Math.round(Number(source.elapsedMs))) : null,
    httpStatus: Number.isFinite(Number(source.httpStatus)) ? Math.max(0, Math.round(Number(source.httpStatus))) : null,
    // Presence only. The values themselves must never appear here.
    hasIdToken: typeof source.hasIdToken === "boolean" ? source.hasIdToken : null,
    hasNonce: typeof source.hasNonce === "boolean" ? source.hasNonce : null,
    hasAuthorizationCode: typeof source.hasAuthorizationCode === "boolean" ? source.hasAuthorizationCode : null,
  };
  try {
    const current = readAuthDiagnostics(storage).reverse();
    storage?.setItem?.(AUTH_DIAGNOSTIC_STORAGE_KEY, JSON.stringify([...current, entry].slice(-AUTH_DIAGNOSTIC_LIMIT)));
  } catch (_error) {}
  return entry;
}

/** The first stage that failed, which is the only stage worth acting on. */
export function firstFailedAuthStage(entries = []) {
  const ordered = [...entries].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const start = ordered.map((entry) => entry.stage).lastIndexOf(AUTH_STAGES.LOGIN_START);
  const attempt = start >= 0 ? ordered.slice(start) : ordered;
  return attempt.find((entry) => entry.outcome === "failed") || null;
}
