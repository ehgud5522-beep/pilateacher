import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_OPERATION_TIMEOUT_CODE,
  APPLE_SIGN_IN_ERROR_KINDS,
  AppleSignInFlowError,
  classifyAuthError,
  createAppleSignInFlow,
  createSingleFlightGate,
  mergeAppleFirstLoginProfile,
  runAppleSignIn,
  safeAuthDiagnostic,
  validateAppleCredential,
  withAuthTimeout,
} from "../../src/features/auth/apple-sign-in.js";

test("authentication timeouts reject with a safe stage and always clear the timer", async () => {
  let triggerTimeout;
  let cleared;
  const pending = withAuthTimeout(() => new Promise(() => {}), {
    provider: "apple",
    stage: "native_credential",
    setTimer: /** @type {typeof setTimeout} */ ((callback) => { triggerTimeout = callback; return 42; }),
    clearTimer: (timer) => { cleared = timer; },
  });
  triggerTimeout();
  await assert.rejects(
    pending,
    (error) => /** @type {{ code?: string, authStage?: string, provider?: string }} */ (error).code === AUTH_OPERATION_TIMEOUT_CODE
      && /** @type {{ authStage?: string }} */ (error).authStage === "native_credential"
      && /** @type {{ provider?: string }} */ (error).provider === "apple",
  );
  assert.equal(cleared, 42);
});

test("authentication timeouts preserve a successful result and cancel the timer", async () => {
  let cleared;
  const result = await withAuthTimeout(() => Promise.resolve("credential"), {
    setTimer: /** @type {typeof setTimeout} */ (/** @type {unknown} */ (() => 7)),
    clearTimer: (timer) => { cleared = timer; },
  });
  assert.equal(result, "credential");
  assert.equal(cleared, 7);
});

test("Apple errors are separated into cancellation, network, configuration, credential, and unknown", () => {
  assert.equal(classifyAuthError({ code: "1001", message: "The operation was cancelled" }), APPLE_SIGN_IN_ERROR_KINDS.CANCELLED);
  assert.equal(classifyAuthError({ code: "auth/network-request-failed" }), APPLE_SIGN_IN_ERROR_KINDS.NETWORK);
  assert.equal(classifyAuthError({ code: "auth/operation-not-allowed" }), APPLE_SIGN_IN_ERROR_KINDS.CONFIGURATION);
  assert.equal(classifyAuthError({ code: "auth/invalid-credential" }), APPLE_SIGN_IN_ERROR_KINDS.CREDENTIAL);
  assert.equal(classifyAuthError(new Error("unexpected native failure")), APPLE_SIGN_IN_ERROR_KINDS.UNKNOWN);
});

test("safe auth diagnostics never contain raw messages, credentials, e-mail, or nonce", () => {
  const diagnostic = safeAuthDiagnostic({
    code: "auth/invalid-credential",
    message: "token=secret-token nonce=secret-nonce user@example.com",
    credential: { idToken: "secret-token", nonce: "secret-nonce" },
  }, { provider: "apple", stage: "credential_exchange" });
  const serialized = JSON.stringify(diagnostic);
  assert.deepEqual(diagnostic, {
    operation: "apple_sign_in",
    kind: "credential",
    source: "firebase_auth",
    code: "auth/invalid-credential",
    provider: "apple",
    stage: "credential_exchange",
    firebaseCode: "auth/invalid-credential",
    nativeCode: "none",
    nativeMessage: "token=[redacted] nonce=[redacted] [redacted-email]",
    credentialState: "invalid_or_missing",
  });
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("example.com"), false);
});

test("Apple native response requires both identity token and raw nonce", () => {
  assert.deepEqual(
    validateAppleCredential({ credential: { idToken: "id-token", nonce: "raw-nonce" } }),
    { idToken: "id-token", rawNonce: "raw-nonce" },
  );
  assert.throws(
    () => validateAppleCredential({ credential: { nonce: "raw-nonce" } }),
    (error) => error instanceof AppleSignInFlowError && error.diagnostic.code === "missing_id_token",
  );
  assert.throws(
    () => validateAppleCredential({ credential: { idToken: "id-token" } }),
    (error) => error instanceof AppleSignInFlowError && error.diagnostic.code === "missing_nonce",
  );
});

test("single-flight returns the same promise and performs one operation for duplicate taps", async () => {
  const gate = createSingleFlightGate();
  let release;
  let calls = 0;
  const first = gate.run(() => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  });
  const second = gate.run(() => {
    calls += 1;
    return Promise.resolve("unexpected");
  });
  assert.equal(first, second);
  assert.equal(gate.busy, true);
  release("signed-in");
  assert.equal(await first, "signed-in");
  assert.equal(calls, 1);
  assert.equal(gate.busy, false);
});

test("Apple sign-in executes exactly one native request and does not retry a failure", async () => {
  let requests = 0;
  let exchanges = 0;
  const diagnostics = [];
  const gate = createSingleFlightGate();
  await assert.rejects(
    runAppleSignIn({
      gate,
      requestNativeCredential: async () => {
        requests += 1;
        return { credential: { idToken: "id-token", nonce: "raw-nonce" } };
      },
      authenticateCredential: async () => {
        exchanges += 1;
        throw Object.assign(new Error("offline"), { code: "auth/network-request-failed" });
      },
      onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); },
    }),
    (error) => error instanceof AppleSignInFlowError && error.kind === "network",
  );
  assert.equal(requests, 1);
  assert.equal(exchanges, 1);
  assert.equal(diagnostics.length, 1);
});

test("first-login Apple name and e-mail are preserved on later sign-ins", () => {
  const first = mergeAppleFirstLoginProfile({
    nativeResult: { user: { displayName: "김 필라", email: "teacher@example.com" } },
    authenticatedUser: { displayName: null, email: "relay@example.com" },
  });
  assert.equal(first.displayName, "김 필라");
  assert.equal(first.email, "teacher@example.com");

  const later = mergeAppleFirstLoginProfile({
    storedProfile: first,
    nativeResult: { user: { displayName: null, email: null } },
    authenticatedUser: { displayName: null, email: "changed@example.com" },
  });
  assert.equal(later.displayName, "김 필라");
  assert.equal(later.email, "teacher@example.com");
});

test("sign-in flow persists the preserved profile after Firebase credential exchange", async () => {
  let persisted;
  const flow = createAppleSignInFlow({
    requestNativeCredential: async () => ({
      credential: { idToken: "id-token", nonce: "raw-nonce" },
      user: { displayName: { givenName: "필라", familyName: "강사" }, email: "relay@example.com" },
    }),
    authenticateCredential: async ({ idToken, rawNonce }) => ({ user: { uid: "u1", idToken, rawNonce } }),
    readStoredProfile: async () => ({ center: "테스트 센터" }),
    persistProfile: async (profile) => { persisted = profile; },
  });
  const result = await flow.signIn();
  assert.equal(result.authentication.user.uid, "u1");
  assert.deepEqual(persisted, {
    center: "테스트 센터",
    displayName: "필라 강사",
    email: "relay@example.com",
  });
});
