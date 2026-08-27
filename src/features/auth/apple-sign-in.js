export const APPLE_SIGN_IN_ERROR_KINDS = Object.freeze({
  CANCELLED: "cancelled",
  NETWORK: "network",
  CONFIGURATION: "configuration",
  CREDENTIAL: "credential",
  UNKNOWN: "unknown",
});

export const AUTH_OPERATION_TIMEOUT_CODE = "auth/operation-timeout";

export function withAuthTimeout(operation, {
  timeoutMs = 30000,
  provider = "apple",
  stage = "sign_in",
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof operation !== "function") throw new TypeError("Authentication operation is required");
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimer(() => {
      reject(Object.assign(new Error("Authentication did not respond in time."), {
        code: AUTH_OPERATION_TIMEOUT_CODE,
        authStage: stage,
        provider,
      }));
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(operation), timeout])
    .finally(() => clearTimer(timer));
}

const USER_MESSAGES = Object.freeze({
  [APPLE_SIGN_IN_ERROR_KINDS.CANCELLED]: "Apple 로그인이 취소되었습니다.",
  [APPLE_SIGN_IN_ERROR_KINDS.NETWORK]: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
  [APPLE_SIGN_IN_ERROR_KINDS.CONFIGURATION]: "Apple 로그인 설정을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  [APPLE_SIGN_IN_ERROR_KINDS.CREDENTIAL]: "Apple 로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
  [APPLE_SIGN_IN_ERROR_KINDS.UNKNOWN]: "Apple 로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
});

const CODE_PATTERNS = Object.freeze({
  [APPLE_SIGN_IN_ERROR_KINDS.CANCELLED]: [
    "auth/popup-closed-by-user",
    "auth/cancelled-popup-request",
    "auth/canceled-popup-request",
    "canceled",
    "cancelled",
    "user_cancel",
  ],
  [APPLE_SIGN_IN_ERROR_KINDS.NETWORK]: [
    "auth/network-request-failed",
    "network",
    "notconnectedtointernet",
    "networkconnectionlost",
    "timedout",
    "timeout",
  ],
  [APPLE_SIGN_IN_ERROR_KINDS.CONFIGURATION]: [
    "auth/operation-not-allowed",
    "auth/unauthorized-domain",
    "auth/invalid-oauth-client-id",
    "auth/native-plugin-unavailable",
    "auth/unsupported-provider",
    "plugin_not_implemented",
    "notimplemented",
    "not implemented",
    "provider is not enabled",
    "apple sign-in is not enabled",
    "missing provider",
  ],
  [APPLE_SIGN_IN_ERROR_KINDS.CREDENTIAL]: [
    "auth/invalid-credential",
    "auth/account-exists-with-different-credential",
    "auth/credential-already-in-use",
    "auth/user-disabled",
    "auth/user-token-expired",
    "auth/requires-recent-login",
    "auth/missing-id-token",
    "auth/missing-nonce",
    "auth/missing-authorization-code",
    "invalid credential",
    "invalid response",
    "identity token",
    "id token",
    "nonce",
  ],
});

function readErrorField(error, key) {
  if (!error || typeof error !== "object") return undefined;
  return /** @type {Record<string, unknown>} */ (error)[key];
}

function boundedString(value, maximumLength = 96) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function safeNativeMessage(error) {
  const raw = boundedString(readErrorField(error, "message") || readErrorField(error, "localizedDescription"), 180);
  if (!raw) return "none";
  return raw
    .replace(/\b(token|nonce|authorizationCode)\s*=\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]{12,}){1,2}\b/g, "[redacted-token]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-value]");
}

function errorSearchText(error) {
  if (typeof error === "string") return error.toLowerCase();
  const values = [
    readErrorField(error, "code"),
    readErrorField(error, "errorCode"),
    readErrorField(error, "nativeCode"),
    readErrorField(error, "name"),
    readErrorField(error, "message"),
    readErrorField(error, "localizedDescription"),
  ];
  return values.filter((value) => typeof value === "string" || typeof value === "number").join(" ").toLowerCase();
}

function errorNumericCode(error) {
  const candidates = [
    readErrorField(error, "nativeCode"),
    readErrorField(error, "errorCode"),
    readErrorField(error, "code"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && /^\d+$/.test(candidate.trim())) return Number(candidate);
  }
  return undefined;
}

function matchesAny(haystack, values) {
  return values.some((value) => haystack.includes(value));
}

export const APPLE_AUTHORIZATION_ERROR_DOMAIN = "com.apple.AuthenticationServices.AuthorizationError";

// ASAuthorizationError codes. Apple states the outcome exactly, so this must be
// read before any text matching: the localized description of a cancellation
// says nothing about cancelling, and guessing from words is how a cancelled
// sheet ends up reported as a network problem.
const APPLE_AUTHORIZATION_KINDS = Object.freeze({
  1000: APPLE_SIGN_IN_ERROR_KINDS.UNKNOWN,
  1001: APPLE_SIGN_IN_ERROR_KINDS.CANCELLED,
  1002: APPLE_SIGN_IN_ERROR_KINDS.CREDENTIAL,
  1003: APPLE_SIGN_IN_ERROR_KINDS.UNKNOWN,
  1004: APPLE_SIGN_IN_ERROR_KINDS.UNKNOWN,
  1005: APPLE_SIGN_IN_ERROR_KINDS.UNKNOWN,
});

/** Reads the ASAuthorizationError code, whether it arrives as a field or inside the code string. */
export function appleAuthorizationErrorCode(error) {
  if (!error || typeof error !== "object") return undefined;
  const domain = boundedString(readErrorField(error, "errorDomain"), 96);
  const code = boundedString(readErrorField(error, "code"), 160);
  const fromCode = new RegExp(`^native:${APPLE_AUTHORIZATION_ERROR_DOMAIN.replace(/\./g, "\\.")}:(-?\\d+)$`).exec(code);
  if (fromCode) return Number(fromCode[1]);
  if (domain !== APPLE_AUTHORIZATION_ERROR_DOMAIN) return undefined;
  const raw = readErrorField(error, "errorCode");
  const numeric = typeof raw === "number" ? raw : Number(boundedString(raw, 16));
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function classifyAppleSignInError(error) {
  const searchText = errorSearchText(error);
  const numericCode = errorNumericCode(error);

  const authorizationCode = appleAuthorizationErrorCode(error);
  if (authorizationCode !== undefined) return APPLE_AUTHORIZATION_KINDS[authorizationCode] ?? APPLE_SIGN_IN_ERROR_KINDS.UNKNOWN;

  if (numericCode === 1001 || matchesAny(searchText, CODE_PATTERNS.cancelled)) {
    return APPLE_SIGN_IN_ERROR_KINDS.CANCELLED;
  }
  if (matchesAny(searchText, CODE_PATTERNS.network)) {
    return APPLE_SIGN_IN_ERROR_KINDS.NETWORK;
  }
  if (matchesAny(searchText, CODE_PATTERNS.configuration)) {
    return APPLE_SIGN_IN_ERROR_KINDS.CONFIGURATION;
  }
  if (numericCode === 1002 || matchesAny(searchText, CODE_PATTERNS.credential)) {
    return APPLE_SIGN_IN_ERROR_KINDS.CREDENTIAL;
  }
  return APPLE_SIGN_IN_ERROR_KINDS.UNKNOWN;
}

export const classifyAuthError = classifyAppleSignInError;

function inferErrorSource(error) {
  const code = boundedString(readErrorField(error, "code"));
  if (code.startsWith("auth/")) return "firebase_auth";
  if (/^\d+$/.test(code) || errorNumericCode(error) !== undefined) return "apple_native";
  if (code.toLowerCase().includes("plugin")) return "capacitor_plugin";
  return "apple_sign_in";
}

function safeErrorCode(error) {
  const candidates = [readErrorField(error, "code"), readErrorField(error, "errorCode")];
  for (const candidate of candidates) {
    const value = boundedString(candidate);
    if (value && /^[a-zA-Z0-9_./:-]+$/.test(value)) return value;
  }
  const numericCode = errorNumericCode(error);
  return numericCode === undefined ? "unclassified" : String(numericCode);
}

/**
 * Returns a log-safe diagnostic. Raw error messages, tokens, nonces, e-mail
 * addresses, display names, and provider responses are intentionally omitted.
 */
export function createAppleSignInDiagnostic(error) {
  const kind = classifyAppleSignInError(error);
  return Object.freeze({
    operation: "apple_sign_in",
    kind,
    source: inferErrorSource(error),
    code: safeErrorCode(error),
  });
}

export function safeAuthDiagnostic(error, { provider = "apple", stage = "sign_in" } = {}) {
  const diagnostic = createAppleSignInDiagnostic(error);
  const safeProvider = boundedString(provider, 24).toLowerCase();
  const safeStage = boundedString(stage, 48).toLowerCase();
  return Object.freeze({
    ...diagnostic,
    provider: /^[a-z0-9_-]+$/.test(safeProvider) ? safeProvider : "unknown",
    stage: /^[a-z0-9_-]+$/.test(safeStage) ? safeStage : "unknown",
    firebaseCode: diagnostic.code.startsWith("auth/") ? diagnostic.code : "none",
    nativeCode: diagnostic.source === "apple_native" || diagnostic.source === "capacitor_plugin" ? diagnostic.code : "none",
    nativeMessage: safeNativeMessage(error),
    credentialState: diagnostic.kind === APPLE_SIGN_IN_ERROR_KINDS.CREDENTIAL ? "invalid_or_missing" : "not_evaluated",
  });
}

export class AppleSignInFlowError extends Error {
  constructor(kind, diagnostic) {
    super(USER_MESSAGES[kind] ?? USER_MESSAGES.unknown);
    this.name = "AppleSignInFlowError";
    this.kind = kind;
    this.code = `apple_sign_in/${kind}`;
    this.userMessage = USER_MESSAGES[kind] ?? USER_MESSAGES.unknown;
    this.diagnostic = diagnostic;
  }
}

export function validateAppleCredential(result) {
  const credential = result && typeof result === "object"
    ? /** @type {Record<string, unknown>} */ (result).credential
    : undefined;
  const idToken = boundedString(
    credential && typeof credential === "object" ? /** @type {Record<string, unknown>} */ (credential).idToken : undefined,
    16384,
  );
  const nonce = boundedString(
    credential && typeof credential === "object" ? /** @type {Record<string, unknown>} */ (credential).nonce : undefined,
    2048,
  );

  if (!idToken || !nonce) {
    const diagnostic = Object.freeze({
      operation: "apple_sign_in",
      kind: APPLE_SIGN_IN_ERROR_KINDS.CREDENTIAL,
      source: "capacitor_plugin",
      code: !idToken ? "missing_id_token" : "missing_nonce",
    });
    throw new AppleSignInFlowError(APPLE_SIGN_IN_ERROR_KINDS.CREDENTIAL, diagnostic);
  }

  return Object.freeze({ idToken, rawNonce: nonce });
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = boundedString(value, 320);
    if (text) return text;
  }
  return "";
}

function displayNameFromValue(value) {
  if (typeof value === "string") return boundedString(value, 160);
  if (!value || typeof value !== "object") return "";
  const record = /** @type {Record<string, unknown>} */ (value);
  return [boundedString(record.givenName, 80), boundedString(record.familyName, 80)].filter(Boolean).join(" ").trim();
}

function nativeUserFrom(result) {
  if (!result || typeof result !== "object") return {};
  const user = /** @type {Record<string, unknown>} */ (result).user;
  return user && typeof user === "object" ? /** @type {Record<string, unknown>} */ (user) : {};
}

/**
 * Apple normally returns name/e-mail only on the first authorization. Existing
 * non-empty profile values always win so subsequent sign-ins cannot erase them.
 */
export function mergeAppleFirstLoginProfile({ storedProfile = {}, nativeResult = {}, authenticatedUser = {} } = {}) {
  const stored = storedProfile && typeof storedProfile === "object" ? storedProfile : {};
  const nativeUser = nativeUserFrom(nativeResult);
  const credential = nativeResult && typeof nativeResult === "object"
    ? /** @type {Record<string, unknown>} */ (nativeResult).credential
    : undefined;
  const credentialRecord = credential && typeof credential === "object" ? /** @type {Record<string, unknown>} */ (credential) : {};
  const authUser = authenticatedUser && typeof authenticatedUser === "object" ? authenticatedUser : {};

  const displayName = firstNonEmptyString(
    /** @type {Record<string, unknown>} */ (stored).displayName,
    /** @type {Record<string, unknown>} */ (stored).name,
    displayNameFromValue(nativeUser.displayName),
    displayNameFromValue(nativeUser.name),
    displayNameFromValue(credentialRecord.fullName),
    displayNameFromValue(/** @type {Record<string, unknown>} */ (authUser).displayName),
  );
  const email = firstNonEmptyString(
    /** @type {Record<string, unknown>} */ (stored).email,
    nativeUser.email,
    credentialRecord.email,
    /** @type {Record<string, unknown>} */ (authUser).email,
  );

  return {
    ...stored,
    ...(displayName ? { displayName } : {}),
    ...(email ? { email } : {}),
  };
}

export function createSingleFlightGate() {
  let inFlight = null;
  return Object.freeze({
    get busy() {
      return inFlight !== null;
    },
    run(operation) {
      if (inFlight) return inFlight;
      let operationResult;
      try {
        operationResult = operation();
      } catch (error) {
        operationResult = Promise.reject(error);
      }
      const promise = Promise.resolve(operationResult).finally(() => {
        if (inFlight === promise) inFlight = null;
      });
      inFlight = promise;
      return promise;
    },
  });
}

async function executeAppleSignIn({
  requestNativeCredential,
  authenticateCredential,
  readStoredProfile,
  persistProfile,
  onDiagnostic,
}) {
  try {
    const nativeResult = await requestNativeCredential();
    const credential = validateAppleCredential(nativeResult);
    const authentication = await authenticateCredential(credential);
    const storedProfile = await readStoredProfile(authentication, nativeResult);
    const profile = mergeAppleFirstLoginProfile({
      storedProfile,
      nativeResult,
      authenticatedUser: authentication?.user ?? authentication,
    });
    await persistProfile(profile, authentication, nativeResult);
    return { authentication, nativeResult, profile };
  } catch (error) {
    if (error instanceof AppleSignInFlowError) {
      onDiagnostic(error.diagnostic);
      throw error;
    }
    const diagnostic = createAppleSignInDiagnostic(error);
    onDiagnostic(diagnostic);
    throw new AppleSignInFlowError(diagnostic.kind, diagnostic);
  }
}

export function runAppleSignIn({
  gate = createSingleFlightGate(),
  requestNativeCredential,
  authenticateCredential,
  readStoredProfile = async () => ({}),
  persistProfile = async (_profile, _authentication, _nativeResult) => {},
  onDiagnostic = (_diagnostic) => {},
}) {
  if (typeof requestNativeCredential !== "function" || typeof authenticateCredential !== "function") {
    throw new TypeError("Apple sign-in dependencies are required");
  }
  return gate.run(() => executeAppleSignIn({
    requestNativeCredential,
    authenticateCredential,
    readStoredProfile,
    persistProfile,
    onDiagnostic,
  }));
}

/**
 * Dependency-injected Apple sign-in orchestration. It deliberately performs one
 * native request and one Firebase credential exchange, with no retry loop.
 */
export function createAppleSignInFlow({
  requestNativeCredential,
  authenticateCredential,
  readStoredProfile = async () => ({}),
  persistProfile = async (_profile, _authentication, _nativeResult) => {},
  onDiagnostic = (_diagnostic) => {},
}) {
  if (typeof requestNativeCredential !== "function" || typeof authenticateCredential !== "function") {
    throw new TypeError("Apple sign-in dependencies are required");
  }
  const gate = createSingleFlightGate();

  return Object.freeze({
    get busy() {
      return gate.busy;
    },
    signIn() {
      return runAppleSignIn({
        gate,
        requestNativeCredential,
        authenticateCredential,
        readStoredProfile,
        persistProfile,
        onDiagnostic,
      });
    },
  });
}
