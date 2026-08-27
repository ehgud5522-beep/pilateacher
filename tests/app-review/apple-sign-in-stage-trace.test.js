import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  APPLE_SIGN_IN_ERROR_KINDS,
  appleAuthorizationErrorCode,
  classifyAppleSignInError,
} from "../../src/features/auth/apple-sign-in.js";
import {
  AUTH_DIAGNOSTIC_LIMIT,
  AUTH_DIAGNOSTIC_STORAGE_KEY,
  AUTH_STAGES,
  FORBIDDEN_FIELD,
  appendAuthDiagnostic,
  firstFailedAuthStage,
  readAuthDiagnostics,
  readAuthErrorIdentity,
  scrubAuthMessage,
} from "../../src/features/auth/auth-diagnostics.js";
import { buildRemoteDiagnosticReport } from "../../src/features/diagnostics/remote-diagnostics.js";

const memoryStorage = () => {
  const values = new Map();
  return /** @type {Storage & { raw: Map<string, string> }} */ (/** @type {unknown} */ ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    raw: values,
  }));
};

const clockFrom = (start) => {
  let tick = 0;
  return () => new Date(start + (tick += 1000));
};

test("an ASAuthorization outcome is read from Apple's own code, not from the wording", () => {
  const canceled = { code: "native:com.apple.AuthenticationServices.AuthorizationError:1001", message: "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)" };
  assert.equal(appleAuthorizationErrorCode(canceled), 1001);
  assert.equal(classifyAppleSignInError(canceled), APPLE_SIGN_IN_ERROR_KINDS.CANCELLED,
    "a cancelled sheet must never be reported as anything else");

  assert.equal(classifyAppleSignInError({ errorDomain: "com.apple.AuthenticationServices.AuthorizationError", errorCode: 1002 }), APPLE_SIGN_IN_ERROR_KINDS.CREDENTIAL);
  for (const code of [1000, 1003, 1004, 1005]) {
    assert.equal(classifyAppleSignInError({ errorDomain: "com.apple.AuthenticationServices.AuthorizationError", errorCode: code }), APPLE_SIGN_IN_ERROR_KINDS.UNKNOWN, String(code));
  }
  // A message that merely mentions a network must not override Apple's verdict.
  assert.equal(classifyAppleSignInError({ errorDomain: "com.apple.AuthenticationServices.AuthorizationError", errorCode: 1001, message: "network connection lost" }), APPLE_SIGN_IN_ERROR_KINDS.CANCELLED);
  assert.equal(appleAuthorizationErrorCode({ code: "auth/network-request-failed" }), undefined);
  assert.equal(classifyAppleSignInError({ code: "auth/network-request-failed" }), APPLE_SIGN_IN_ERROR_KINDS.NETWORK);
});

test("the failing layer's own domain and code survive to the diagnostic", () => {
  assert.deepEqual(readAuthErrorIdentity({ errorDomain: "com.apple.AuthenticationServices.AuthorizationError", errorCode: 1004, message: "failed" }),
    { errorDomain: "com.apple.AuthenticationServices.AuthorizationError", errorCode: "1004", message: "failed" });
  assert.deepEqual(readAuthErrorIdentity({ code: "native:PilaTeacherAppleSignIn:3", message: "apple_identity_token_missing" }),
    { errorDomain: "PilaTeacherAppleSignIn", errorCode: "3", message: "apple_identity_token_missing" });

  const firebase = readAuthErrorIdentity({ code: "auth/network-request-failed", message: "A network error occurred." });
  assert.equal(firebase.errorDomain, "firebase_auth");
  assert.equal(firebase.errorCode, "auth/network-request-failed");

  const timeout = readAuthErrorIdentity({ code: "auth/operation-timeout", message: "Authentication did not respond in time." });
  assert.equal(timeout.errorCode, "auth/operation-timeout",
    "a timeout must stay a timeout in the diagnostic even when the screen says network");
});

test("no token, nonce, credential, authorization code, password or e-mail can be stored", () => {
  const storage = memoryStorage();
  appendAuthDiagnostic(AUTH_STAGES.CREDENTIAL_INSPECTED, {
    hasIdToken: true,
    hasNonce: true,
    hasAuthorizationCode: false,
    idToken: "eyJhbGciOiJSUzI1NiJ9.PAYLOADPAYLOADPAYLOAD.SIGNATURESIGNATURE",
    nonce: "abcdef0123456789abcdef0123456789",
    authorizationCode: "c1a2b3c4d5",
    identityToken: "should-not-appear",
    credential: { idToken: "nope" },
    password: "hunter2",
    email: "teacher@studio.com",
    message: "sign-in for teacher@studio.com failed, token=eyJhbGciOiJSUzI1NiJ9.PAYLOADPAYLOADPAYLOAD.SIGNATURESIGNATURE",
  }, storage);

  const stored = storage.getItem(AUTH_DIAGNOSTIC_STORAGE_KEY);
  for (const secret of ["eyJhbGciOiJSUzI1NiJ9", "abcdef0123456789abcdef0123456789", "c1a2b3c4d5", "should-not-appear", "hunter2", "teacher@studio.com"]) {
    assert.equal(stored.includes(secret), false, `stored diagnostic leaked ${secret}`);
  }
  const [entry] = readAuthDiagnostics(storage);
  assert.equal(entry.hasIdToken, true, "presence is what gets recorded");
  assert.equal(entry.hasNonce, true);
  assert.equal(entry.hasAuthorizationCode, false);
  for (const key of Object.keys(entry)) {
    assert.equal(FORBIDDEN_FIELD.test(key) && !/^has[A-Z]/.test(key), false, `field ${key} must not exist`);
  }
  assert.match(entry.message, /\[redacted-email\]/);
  assert.doesNotMatch(entry.message, /eyJ/);
});

test("scrubbing keeps the sentence readable while removing the secret", () => {
  assert.equal(scrubAuthMessage("nonce=ABC123 rejected"), "nonce=[redacted] rejected");
  assert.equal(scrubAuthMessage("The operation couldn’t be completed. (error 1004.)"), "The operation couldn’t be completed. (error 1004.)");
});

test("a stage trace names the first stage that failed, not the last", () => {
  const storage = memoryStorage();
  const clock = clockFrom(Date.parse("2026-08-27T10:00:00.000Z"));
  const record = (stage, details) => appendAuthDiagnostic(stage, details, storage, clock);

  record(AUTH_STAGES.LOGIN_START, {});
  record(AUTH_STAGES.NATIVE_AUTHORIZATION_STARTED, {});
  record(AUTH_STAGES.NATIVE_AUTHORIZATION_SUCCEEDED, { elapsedMs: 2400 });
  record(AUTH_STAGES.CREDENTIAL_INSPECTED, { hasIdToken: false, hasNonce: true, hasAuthorizationCode: true });
  record(AUTH_STAGES.CREDENTIAL_REJECTED, { outcome: "failed", errorDomain: "firebase_auth", errorCode: "auth/missing-id-token" });
  record(AUTH_STAGES.LOGIN_FAILED, { outcome: "failed", errorDomain: "firebase_auth", errorCode: "auth/missing-id-token" });

  const failure = firstFailedAuthStage(readAuthDiagnostics(storage));
  assert.equal(failure.stage, AUTH_STAGES.CREDENTIAL_REJECTED);
  assert.equal(failure.errorCode, "auth/missing-id-token");

  // A second attempt must not be diagnosed using the first attempt's failure.
  record(AUTH_STAGES.LOGIN_START, {});
  record(AUTH_STAGES.NATIVE_AUTHORIZATION_STARTED, {});
  assert.equal(firstFailedAuthStage(readAuthDiagnostics(storage)), null);
});

test("the stage trace is bounded and survives unreadable storage", () => {
  const storage = memoryStorage();
  for (let index = 0; index < AUTH_DIAGNOSTIC_LIMIT + 15; index += 1) {
    appendAuthDiagnostic(AUTH_STAGES.LOGIN_START, { correlationId: `attempt-${index}` }, storage);
  }
  const entries = readAuthDiagnostics(storage);
  assert.equal(entries.length, AUTH_DIAGNOSTIC_LIMIT);
  assert.equal(entries[0].correlationId, `attempt-${AUTH_DIAGNOSTIC_LIMIT + 14}`, "newest first");

  storage.setItem(AUTH_DIAGNOSTIC_STORAGE_KEY, "{not json");
  assert.deepEqual(readAuthDiagnostics(storage), []);
});

test("a sent report carries the sign-in stages and still carries no secret", () => {
  const storage = memoryStorage();
  appendAuthDiagnostic(AUTH_STAGES.NATIVE_AUTHORIZATION_FAILED, {
    outcome: "failed",
    errorDomain: "com.apple.AuthenticationServices.AuthorizationError",
    errorCode: "1004",
    message: "The operation couldn’t be completed.",
    platform: "ios", osVersion: "18.5", deviceModel: "iPhone", appBuild: "1.1.22 (87)",
    idToken: "eyJhbGciOiJSUzI1NiJ9.PAYLOADPAYLOADPAYLOAD.SIGNATURESIGNATURE",
  }, storage);

  const report = buildRemoteDiagnosticReport({ authEvents: readAuthDiagnostics(storage), now: new Date("2026-08-27T10:00:00.000Z") });
  const auth = report.logs.find((entry) => entry.kind === "auth");
  assert.equal(auth.stage, AUTH_STAGES.NATIVE_AUTHORIZATION_FAILED);
  assert.equal(auth.errorDomain, "com.apple.AuthenticationServices.AuthorizationError");
  assert.equal(auth.errorCode, "1004");
  assert.equal(auth.deviceModel, "iPhone");
  assert.equal(JSON.stringify(report).includes("eyJhbGciOiJSUzI1NiJ9"), false);
});

// CLAUDE.md 실패 진단 원칙 8: the screen and the diagnostic must point at the
// same kind of failure, and a cancellation must never look like an error.
test("the screen wording and the recorded code cannot disagree", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const start = source.indexOf("const handleSocial = async (provider)");
  const handler = source.slice(start, source.indexOf("return (", start));

  assert.match(handler, /if \(kind === "cancelled"\)/, "cancellation is handled on its own branch");
  const cancelBranch = handler.slice(handler.indexOf('if (kind === "cancelled")'), handler.indexOf("} else {"));
  assert.match(cancelBranch, /AUTH_STAGES\.LOGIN_CANCELLED/);
  assert.doesNotMatch(cancelBranch, /onToast|네트워크/, "a cancelled sign-in shows no error and no network wording");

  const failBranch = handler.slice(handler.indexOf("} else {"));
  assert.match(failBranch, /kind === "network"[\s\S]*네트워크 연결을 확인한 뒤/, "only the network kind may show the network wording");
  assert.match(failBranch, /코드 \$\{failure\.errorCode \|\| "unknown"\}/, "an unclassified failure still shows a traceable code");
  assert.match(failBranch, /AUTH_STAGES\.LOGIN_FAILED/);
});

test("the iOS patch is wired into postinstall and reports every silent path", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.postinstall, /patch-firebase-auth-ios-h14-apple-diagnostics\.mjs/);

  const patch = await readFile(new URL("../../tools/patch-firebase-auth-ios-h14-apple-diagnostics.mjs", import.meta.url), "utf8");
  for (const stage of ["apple_credential_type_unexpected", "apple_nonce_missing", "apple_identity_token_missing", "apple_identity_token_undecodable", "apple_flow_state_missing"]) {
    assert.match(patch, new RegExp(stage), `${stage} must be reported instead of returning silently`);
  }
  assert.ok(patch.includes("native:\\\\(nsError.domain):\\\\(nsError.code)"), "the NSError domain and code must reach JavaScript");
  assert.match(patch, /"errorDomain": nsError\.domain/);
  assert.match(patch, /"errorCode": nsError\.code/);
  // The patch reports; it must leave credential construction exactly as it was.
  assert.doesNotMatch(patch, /OAuthProvider\.appleCredential|rawNonce:|request\.nonce/, "the patch must not touch how the credential is built");
});
