import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  AUTH_ENDPOINT_ORIGIN,
  AUTH_PROBE_PATH,
  probeAuthEndpoint,
  probeIndexedDb,
  probeLocalStorage,
  runAuthPreflight,
} from "../../src/features/auth/connectivity-probe.js";
import {
  AUTH_FEATURES,
  AUTH_STAGES,
  appendAuthDiagnostic,
  readAuthDiagnostics,
} from "../../src/features/auth/auth-diagnostics.js";

const memoryStorage = () => {
  const values = new Map();
  return /** @type {Storage} */ (/** @type {unknown} */ ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }));
};

const steppingClock = (step = 120) => {
  let value = 0;
  return () => (value += step);
};

test("a reachable endpoint is proved by any HTTP status, and no credential is sent", async () => {
  const calls = [];
  const result = await probeAuthEndpoint({
    apiKey: "test-key",
    now: steppingClock(),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { status: 400 }; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.httpStatus, 400, "400 to an empty body still proves the whole path works");
  assert.equal(result.elapsedMs, 120);
  assert.equal(result.errorCode, "");
  assert.equal(calls[0].url, `${AUTH_ENDPOINT_ORIGIN}${AUTH_PROBE_PATH}?key=test-key`);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.body, "{}", "the probe must not carry an address or a password");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json",
    "the probe must trigger the same CORS preflight the SDK does");
});

test("each way the endpoint can fail keeps its own code", async () => {
  const abort = await probeAuthEndpoint({ now: steppingClock(), fetchImpl: async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); } });
  assert.equal(abort.ok, false);
  assert.equal(abort.errorDomain, "auth_endpoint");
  assert.equal(abort.errorCode, "timeout");

  const blocked = await probeAuthEndpoint({ now: steppingClock(), fetchImpl: async () => { throw Object.assign(new TypeError("Load failed"), { name: "TypeError" }); } });
  assert.equal(blocked.errorCode, "fetch_failed");
  assert.match(blocked.message, /Load failed/, "the web view's own wording is the only thing that separates blocked from CORS");

  const missing = await probeAuthEndpoint({ fetchImpl: null });
  assert.equal(missing.errorCode, "fetch_unavailable");
});

test("IndexedDB is measured on its own, because a stuck open looks exactly like a network hang", async () => {
  const openable = { open: () => { const request = {}; setTimeout(() => request.onsuccess?.()); return request; } };
  assert.equal((await probeIndexedDb({ factory: openable, now: steppingClock() })).ok, true);

  const failing = { open: () => { const request = { error: { name: "UnknownError", message: "denied" } }; setTimeout(() => request.onerror?.()); return request; } };
  const failed = await probeIndexedDb({ factory: failing, now: steppingClock() });
  assert.equal(failed.ok, false);
  assert.equal(failed.errorDomain, "indexed_db");
  assert.equal(failed.errorCode, "UnknownError");

  const blocking = { open: () => { const request = {}; setTimeout(() => request.onblocked?.()); return request; } };
  assert.equal((await probeIndexedDb({ factory: blocking, now: steppingClock() })).errorCode, "blocked");

  const silent = { open: () => ({}) };
  const timers = [];
  const stuck = await probeIndexedDb({
    factory: silent, now: steppingClock(), clearTimer: () => {},
    setTimer: (fn) => { timers.push(fn); fn(); return 1; },
  });
  assert.equal(stuck.errorCode, "timeout", "an open that never settles must be reported, not waited on forever");

  assert.equal((await probeIndexedDb({ factory: null })).errorCode, "unavailable");
});

test("local storage is probed by writing and reading back", () => {
  assert.equal(probeLocalStorage({ storage: memoryStorage(), now: steppingClock() }).ok, true);

  const throwing = /** @type {Storage} */ (/** @type {unknown} */ ({ setItem: () => { throw Object.assign(new Error("quota"), { name: "QuotaExceededError" }); } }));
  const failed = probeLocalStorage({ storage: throwing, now: steppingClock() });
  assert.equal(failed.ok, false);
  assert.equal(failed.errorDomain, "local_storage");
  assert.equal(failed.errorCode, "QuotaExceededError");
});

test("the preflight returns one verdict per layer a sign-in depends on", async () => {
  const records = await runAuthPreflight({
    apiKey: "k",
    now: steppingClock(),
    storage: memoryStorage(),
    fetchImpl: async () => ({ status: 400 }),
    factory: { open: () => { const request = {}; setTimeout(() => request.onsuccess?.()); return request; } },
  });

  assert.deepEqual(records.map((record) => record.stage), ["auth_endpoint_probe", "indexed_db_probe", "local_storage_probe", "network_state"]);
  assert.deepEqual(records.map((record) => record.stage), [AUTH_STAGES.AUTH_ENDPOINT_PROBE, AUTH_STAGES.INDEXED_DB_PROBE, AUTH_STAGES.LOCAL_STORAGE_PROBE, AUTH_STAGES.NETWORK_STATE]);
  assert.equal(records.every((record) => record.outcome === "succeeded"), true);
  assert.equal(records[0].httpStatus, 400);
});

test("a preflight verdict is stored so it can be read before anyone signs in", () => {
  const storage = memoryStorage();
  appendAuthDiagnostic(AUTH_STAGES.AUTH_ENDPOINT_PROBE, {
    feature: AUTH_FEATURES.CONNECTIVITY, provider: "firebase",
    outcome: "failed", httpStatus: 0, elapsedMs: 8000,
    errorDomain: "auth_endpoint", errorCode: "timeout", message: "요청이 시간 안에 끝나지 않았습니다.",
  }, storage);
  appendAuthDiagnostic(AUTH_STAGES.EMAIL_AUTH_FAILED, { feature: AUTH_FEATURES.EMAIL_SIGN_IN, provider: "email", outcome: "failed", errorCode: "auth/operation-timeout" }, storage);

  const entries = readAuthDiagnostics(storage);
  const connectivity = entries.filter((entry) => entry.feature === AUTH_FEATURES.CONNECTIVITY);
  assert.equal(connectivity.length, 1);
  assert.equal(connectivity[0].httpStatus, 0);
  assert.equal(connectivity[0].elapsedMs, 8000);
  assert.equal(connectivity[0].errorCode, "timeout");
  assert.equal(entries.filter((entry) => entry.feature === AUTH_FEATURES.EMAIL_SIGN_IN).length, 1,
    "the two are separable, so a network verdict is never mistaken for a sign-in verdict");
});

test("the diagnostics are reachable from the login screen, where the failure happens", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const auth = source.slice(source.indexOf("function AuthScreen("), source.indexOf("function Header("));

  assert.match(auth, /diagnosticTaps \+ 1[\s\S]*next >= 7[\s\S]*setDiagnosticsOpen\(true\)/,
    "seven taps on the version line open the diagnostics");
  assert.match(auth, /<AuthDiagnosticsPanel onClose=/);

  const panel = source.slice(source.indexOf("function AuthDiagnosticsPanel("), source.indexOf("function AuthScreen("));
  assert.match(panel, /runAuthConnectivityPreflight\(\{ force: true \}\)/, "the panel can re-run the check");
  assert.match(panel, /firstFailedAuthStage\(attempts\)/);
  assert.doesNotMatch(panel, /f\.email|f\.pw|password/, "the panel must not show an address or a password");

  assert.match(source, /useEffect\(\(\) => \{ runAuthConnectivityPreflight\(\); \}, \[\]\);/,
    "the check runs once at start, before any sign-in");
  assert.match(source, /fbSignInEmail\(f\.email, f\.pw, \{ onStage: emailStage \}\)/);
  assert.match(source, /fbSignUpEmail\(f\.email, f\.pw, f\.name, \{ onStage: emailStage \}\)/);
});

test("an email request records its start, its outcome and how long it took", async () => {
  const firebase = await readFile(new URL("../../src/lib/firebase.js", import.meta.url), "utf8");
  const runner = firebase.slice(firebase.indexOf("async function runEmailAuthRequest"), firebase.indexOf("export async function fbSignUpEmail"));

  assert.match(runner, /AUTH_STAGES\.EMAIL_REQUEST_START/);
  assert.match(runner, /AUTH_STAGES\.EMAIL_AUTH_SUCCEEDED[\s\S]*elapsedMs: Date\.now\(\) - startedAt/);
  assert.match(runner, /AUTH_STAGES\.EMAIL_AUTH_FAILED[\s\S]*error,[\s\S]*elapsedMs: Date\.now\(\) - startedAt/);
  // The address and the password stay inside the caller's closure; this function
  // is only handed the closure, the stage name and the recorder.
  assert.match(runner, /function runEmailAuthRequest\(operation, \{ authStage, onStage \}\)/);
  assert.doesNotMatch(runner, /\bpw\b|f\.email/, "no address or password may reach the stage recorder");
});
