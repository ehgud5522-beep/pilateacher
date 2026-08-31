/**
 * The Auth instance itself is the layer under test here.
 *
 * On this device an Apple sign-in and an e-mail sign-in both went silent for 45
 * seconds with no HTTP request and no Firebase error code. The only thing the
 * two paths share is `auth`, so these tests hold the three things that make the
 * next build able to say which layer stalled: the instance is created once with
 * localStorage persistence and no popup resolver, initialization is measured on
 * app start, and a request that leaves the device is recorded.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUTH_FEATURES,
  AUTH_STAGES,
  appendAuthDiagnostic,
  authDiagnosticSummary,
  readAuthDiagnostics,
} from "../../src/features/auth/auth-diagnostics.js";
import {
  AUTH_RECOVERY_FLAG,
  AUTH_STORAGE_PREFIXES,
  measureAuthInitialization,
  recoverAuthStorage,
} from "../../src/features/auth/auth-init-guard.js";
import {
  attachAuthFetchBridge,
  connectAuthInitLog,
  recordAuthInitEvent,
  resetAuthInitLog,
} from "../../src/features/auth/auth-init-log.js";
import { getAuthInstance, setAuthInstance } from "../../src/features/auth/auth-instance.js";

const readSource = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");

/** Comments explain why an API is avoided; only real calls are being checked. */
const withoutComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const memoryStorage = () => {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
    keys: () => [...map.keys()],
  };
};

/* ------------------------------------------------------------------ Task 3 */

test("the Auth instance is created once, with localStorage and no popup resolver", async () => {
  const firebase = withoutComments(await readSource("src/lib/firebase.js"));

  assert.equal((firebase.match(/initializeAuth\(/g) || []).length, 1,
    "initializeAuth must be called exactly once; a second call throws already-initialized");
  assert.match(firebase, /auth = initializeAuth\(app, \{ persistence: browserLocalPersistence \}\)/);
  assert.doesNotMatch(firebase, /popupRedirectResolver:/,
    "the resolver must not be attached to the instance: on iOS it loads the auth iframe inside Auth's initialization promise");
  assert.doesNotMatch(firebase, /indexedDBLocalPersistence/,
    "IndexedDB persistence is what this build removes from the startup path");
  assert.doesNotMatch(firebase, /\bgetAuth\s*\(/,
    "getAuth() would reinstate IndexedDB persistence and the popup resolver");
  assert.ok(
    firebase.indexOf("attachAuthFetchBridge()") > firebase.indexOf("initializeAuth(app")
      && firebase.indexOf("attachAuthFetchBridge()") < firebase.indexOf("measureAuthInitialization("),
    "the queued requests are drained before the probe records anything, so the log stays in order",
  );
});

test("no module can create the Auth instance ahead of initializeAuth", async () => {
  for (const file of ["src/ai/firebase-token.js", "src/App.jsx", "src/features/auth/auth-instance.js"]) {
    const source = withoutComments(await readSource(file));
    assert.doesNotMatch(source, /\bgetAuth\s*\(/, `${file} must read the instance instead of calling getAuth()`);
  }
  const token = await readSource("src/ai/firebase-token.js");
  assert.match(token, /getAuthInstance\(\)\?\.currentUser/);
});

test("the instance published for the rest of the app is the one that was initialized", () => {
  const instance = { name: "[DEFAULT]" };
  setAuthInstance(instance);
  assert.equal(getAuthInstance(), instance);
  setAuthInstance(null);
  assert.equal(getAuthInstance(), null);
});

test("the browser popup keeps its resolver at the call site, so no path is silently broken", async () => {
  const firebase = await readSource("src/lib/firebase.js");
  assert.match(firebase, /signInWithPopup\(auth, providerObject\(provider\), browserPopupRedirectResolver\)/);
  assert.match(firebase, /reauthenticateWithPopup\(user, providerObject\(provider\), browserPopupRedirectResolver\)/);
});

/* ------------------------------------------------------------------ Task 2 */

const hungAuth = () => ({ authStateReady: () => new Promise(() => {}) });

test("initialization that completes is recorded as ready, with how long it took", async () => {
  const events = [];
  let clock = 1000;
  const settled = await measureAuthInitialization(
    { authStateReady: async () => {} },
    {
      log: (stage, details) => events.push([stage, details]),
      now: () => (clock += 120),
      setTimer: () => null,
      clearTimer: () => {},
    },
  );
  assert.equal(settled, true);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], AUTH_STAGES.AUTH_INIT_READY);
  assert.ok(events[0][1].elapsedMs >= 0);
});

test("initialization that never completes is recorded as a timeout and triggers recovery once", async () => {
  const events = [];
  let recoveries = 0;
  const timers = [];
  const settled = await measureAuthInitialization(hungAuth(), {
    timeoutMs: 8000,
    log: (stage, details) => events.push([stage, details]),
    setTimer: (fn) => { timers.push(fn); fn(); return 1; },
    clearTimer: () => {},
    onTimeout: () => { recoveries += 1; },
  });
  assert.equal(settled, false);
  assert.deepEqual(events.map(([stage]) => stage), [AUTH_STAGES.AUTH_INIT_TIMEOUT]);
  assert.equal(recoveries, 1);
});

test("a recovery that throws cannot turn the measurement into an unhandled rejection", async () => {
  const settled = await measureAuthInitialization(hungAuth(), {
    setTimer: (fn) => { fn(); return 1; },
    clearTimer: () => {},
    onTimeout: () => { throw new Error("storage refused"); },
  });
  assert.equal(settled, false);
});

test("an SDK without authStateReady falls back to the first auth state notification", async () => {
  const events = [];
  let listener = null;
  const promise = measureAuthInitialization(
    { onAuthStateChanged: (fn) => { listener = fn; return () => { listener = null; }; } },
    { log: (stage) => events.push(stage), setTimer: () => null, clearTimer: () => {} },
  );
  assert.equal(typeof listener, "function");
  listener();
  assert.equal(await promise, true);
  assert.deepEqual(events, [AUTH_STAGES.AUTH_INIT_READY]);
  assert.equal(listener, null, "the fallback listener is disposed once it has answered");
});

/* ------------------------------------------------------------------ Task 4 */

test("the recovery runs once per session and cannot loop the app", () => {
  const session = memoryStorage();
  const local = memoryStorage();
  local.setItem("firebase:authUser:key", "1");
  local.setItem("firebase:persistence:key", "1");
  local.setItem("pilateacher_auth_diagnostics_v1", "keep");
  local.setItem("pilateacher_db", "keep");
  const deleted = [];
  let reloads = 0;
  const events = [];
  const run = () => recoverAuthStorage({
    session, local,
    databases: { deleteDatabase: (name) => deleted.push(name) },
    reload: () => { reloads += 1; },
    log: (stage) => events.push(stage),
  });

  assert.equal(run(), "reloaded");
  assert.deepEqual(deleted, ["firebaseLocalStorageDb"]);
  assert.deepEqual(local.keys(), ["pilateacher_auth_diagnostics_v1", "pilateacher_db"],
    "only Firebase Auth's own keys may be removed");
  assert.equal(session.getItem(AUTH_RECOVERY_FLAG), "1");
  assert.deepEqual(events, [AUTH_STAGES.AUTH_RECOVERY_STARTED, AUTH_STAGES.AUTH_RECOVERY_RELOAD]);

  assert.equal(run(), "already_attempted");
  assert.equal(reloads, 1, "a second attempt in the same session must not reload");
  assert.equal(events.at(-1), AUTH_STAGES.AUTH_RECOVERY_SKIPPED);
});

test("a session flag that cannot be stored blocks the reload instead of repeating it", () => {
  let reloads = 0;
  const events = [];
  const result = recoverAuthStorage({
    session: { getItem: () => null, setItem: () => { throw new Error("full"); } },
    local: memoryStorage(),
    databases: { deleteDatabase: () => {} },
    reload: () => { reloads += 1; },
    log: (stage, details) => events.push([stage, details.errorCode]),
  });
  assert.equal(result, "flag_unavailable");
  assert.equal(reloads, 0, "without a readable flag a reload would repeat forever");
  assert.deepEqual(events, [[AUTH_STAGES.AUTH_RECOVERY_SKIPPED, "flag_unavailable"]]);
});

test("the recovery never reloads while a sign-in is in flight", () => {
  const session = memoryStorage();
  let reloads = 0;
  const events = [];
  const result = recoverAuthStorage({
    session,
    local: memoryStorage(),
    databases: { deleteDatabase: () => { throw new Error("must not run"); } },
    reload: () => { reloads += 1; },
    isBusy: () => true,
    log: (stage) => events.push(stage),
  });
  assert.equal(result, "deferred");
  assert.equal(reloads, 0);
  assert.equal(session.getItem(AUTH_RECOVERY_FLAG), null,
    "a deferred attempt must leave the next app start able to recover");
  assert.deepEqual(events, [AUTH_STAGES.AUTH_RECOVERY_DEFERRED]);
});

test("recovery keys are limited to Firebase Auth's own prefixes", () => {
  assert.deepEqual([...AUTH_STORAGE_PREFIXES], ["firebase:authUser:", "firebase:persistence:"]);
});

test("the sign-in paths report themselves as in flight so the recovery can stand down", async () => {
  const firebase = await readSource("src/lib/firebase.js");
  assert.match(firebase, /isBusy: \(\) => authRequestsInFlight > 0/);
  assert.match(firebase, /export async function fbSignInSocial\(provider, options = \{\}\) \{\s*return trackAuthRequest/);
  assert.match(firebase, /export async function fbReauthenticate\(provider, password = ""\) \{\s*return trackAuthRequest/);
  const runner = firebase.slice(firebase.indexOf("async function runEmailAuthRequest"), firebase.indexOf("export async function fbSignUpEmail"));
  assert.match(runner, /authRequestsInFlight \+= 1;/);
  assert.match(runner, /finally \{\s*authRequestsInFlight -= 1;/);
});

/* ------------------------------------------------------------------ Task 1 */

const loadFetchInstrument = async () => {
  const html = await readSource("index.html");
  const open = html.indexOf('<script id="pilateacher-auth-fetch-instrument">');
  assert.ok(open >= 0, "the instrumentation must be an inline script in index.html");
  const bundle = html.indexOf('<script type="module" src="/src/main.jsx">');
  assert.ok(open < bundle, "the wrapper must be installed before the bundle's module script");
  const body = html.slice(html.indexOf(">", open) + 1, html.indexOf("</script>", open));
  // The shipped script is what is exercised here, not a copy of it.
  return (window) => new Function("window", body)(window);
};

test("only Identity Toolkit traffic is instrumented; everything else passes through untouched", async () => {
  const install = await loadFetchInstrument();
  const calls = [];
  const original = async (...args) => { calls.push(args); return { status: 204 }; };
  const win = /** @type {any} */ ({ fetch: original });
  install(win);
  assert.notEqual(win.fetch, original, "the wrapper must be installed");

  const response = await win.fetch("https://asia-northeast3-pilateacher.cloudfunctions.net/aiGateway", { method: "POST" });
  assert.equal(response.status, 204);
  assert.deepEqual(calls.length, 1);
  assert.deepEqual(win.__authFetchQueue, [], "an unrelated request must not be recorded");
});

test("a sign-in request records its method name, status and duration and no secret", async () => {
  const install = await loadFetchInstrument();
  const win = /** @type {any} */ ({ fetch: async () => ({ status: 200 }) });
  install(win);

  await win.fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=AIzaSySECRETKEY", { body: "{\"idToken\":\"eyJhbGciOi\"}" });
  await win.fetch({ url: "https://securetoken.googleapis.com/v1/token?key=AIzaSySECRETKEY" });

  const stages = win.__authFetchQueue.map(([stage]) => stage);
  assert.deepEqual(stages, ["idp_fetch_started", "idp_fetch_done", "idp_fetch_started", "idp_fetch_done"]);
  assert.deepEqual(win.__authFetchQueue[0][1], { path: "accounts:signInWithIdp" });
  assert.equal(win.__authFetchQueue[1][1].path, "accounts:signInWithIdp");
  assert.equal(win.__authFetchQueue[1][1].httpStatus, 200);
  assert.ok(win.__authFetchQueue[1][1].elapsedMs >= 0);
  assert.equal(win.__authFetchQueue[2][1].path, "token");

  const serialized = JSON.stringify(win.__authFetchQueue);
  for (const secret of ["AIzaSySECRETKEY", "key=", "eyJhbGciOi", "identitytoolkit.googleapis.com"]) {
    assert.equal(serialized.includes(secret), false, `the trace leaked ${secret}`);
  }
});

test("a request that never answers is recorded as an error and the rejection still reaches the SDK", async () => {
  const install = await loadFetchInstrument();
  const win = /** @type {any} */ ({ fetch: async () => { throw Object.assign(new TypeError("Load failed"), { name: "TypeError" }); } });
  install(win);

  await assert.rejects(() => win.fetch("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=K"), /Load failed/);
  const [started, failed] = win.__authFetchQueue;
  assert.equal(started[0], "idp_fetch_started");
  assert.equal(failed[0], "idp_fetch_error");
  assert.equal(failed[1].errorCode, "TypeError");
  assert.equal(failed[1].errorDomain, "auth_endpoint");
});

test("events raised before the app has a logger are flushed in order, once one exists", async () => {
  const install = await loadFetchInstrument();
  resetAuthInitLog();
  const win = /** @type {any} */ ({ fetch: async () => ({ status: 200 }) });
  install(win);
  // Anything sent before the bundle evaluates waits in the window queue.
  await win.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=K");

  // src/lib/firebase.js drains that queue before it starts measuring, so the
  // records stay in the order they happened.
  attachAuthFetchBridge(win);
  recordAuthInitEvent(AUTH_STAGES.AUTH_INIT_TIMEOUT, { feature: AUTH_FEATURES.INITIALIZATION, elapsedMs: 8000 });
  const seen = [];
  connectAuthInitLog((stage, details) => seen.push([stage, details]));

  assert.deepEqual(seen.map(([stage]) => stage), [
    AUTH_STAGES.IDP_FETCH_STARTED, AUTH_STAGES.IDP_FETCH_DONE, AUTH_STAGES.AUTH_INIT_TIMEOUT,
  ]);
  assert.equal(seen[0][1].feature, AUTH_FEATURES.INITIALIZATION);
  assert.equal(seen[0][1].provider, "firebase");
  assert.deepEqual(win.__authFetchQueue, [], "the queue is drained, not replayed twice");

  // Once connected, later events go straight through.
  await win.fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=K");
  assert.deepEqual(seen.slice(3).map(([stage]) => stage), [AUTH_STAGES.IDP_FETCH_STARTED, AUTH_STAGES.IDP_FETCH_DONE]);
  resetAuthInitLog();
});

/* ------------------------------------------------------------------ Task 5 */

test("every new event is storable and shows its path, status and build", () => {
  const storage = memoryStorage();
  const entry = appendAuthDiagnostic(AUTH_STAGES.IDP_FETCH_DONE, {
    feature: AUTH_FEATURES.INITIALIZATION, provider: "firebase",
    path: "accounts:signInWithIdp", httpStatus: 200, elapsedMs: 812, appBuild: "1.1.22 (94)",
  }, storage);
  assert.equal(entry.path, "accounts:signInWithIdp");
  assert.equal(entry.httpStatus, 200);
  const summary = authDiagnosticSummary(entry);
  assert.match(summary, /auth_init · firebase · idp_fetch_done · info · accounts:signInWithIdp · HTTP 200 · 812ms/);
  assert.equal(readAuthDiagnostics(storage).length, 1);
});

test("a URL or a query string cannot be stored through the path field", () => {
  const storage = memoryStorage();
  const entry = appendAuthDiagnostic(AUTH_STAGES.IDP_FETCH_STARTED, {
    path: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=AIzaSySECRETKEY",
  }, storage);
  assert.equal(entry.path.includes("?"), false, "the separator that starts a query string must not survive");
  assert.equal(entry.path.includes("="), false);
});

test("both diagnostic screens render the same row for the same record", async () => {
  const app = await readSource("src/App.jsx");
  assert.equal((app.match(/function AuthDiagnosticRow\(/g) || []).length, 1,
    "one row component, so a field cannot be legible on one screen only");
  assert.equal((app.match(/<AuthDiagnosticRow /g) || []).length, 3,
    "connectivity and attempts on the login panel, plus the hidden lesson diagnostics");

  const panel = app.slice(app.indexOf("function AuthDiagnosticsPanel("), app.indexOf("function AuthScreen("));
  assert.match(panel, /connectivity\.map\(\(entry, index\) => <AuthDiagnosticRow /);
  assert.match(panel, /attempts\.map\(\(entry, index\) => <AuthDiagnosticRow /);
  assert.match(panel, /authDiagnosticSummary\(entry\)/, "the clipboard export uses the same summary line");

  const lesson = app.slice(app.indexOf("로그인 단계 진단"));
  assert.match(lesson.slice(0, 1200), /authDiagnostics\.map\(\(item, index\) => <AuthDiagnosticRow /);

  const row = app.slice(app.indexOf("function AuthDiagnosticRow("), app.indexOf("function AuthDiagnosticsPanel("));
  assert.match(row, /authDiagnosticSummary\(entry\)/);
  assert.match(row, /authDiagnosticDetail\(entry\)/);
  assert.doesNotMatch(row, /uid|token|email|password/i, "no identifier or secret may be rendered");
});

test("the app connects the boot-time recorder, so the probe is visible without a login attempt", async () => {
  const app = await readSource("src/App.jsx");
  assert.match(app, /connectAuthInitLog\(recordAuthStage\);/);
  assert.ok(app.indexOf("connectAuthInitLog(recordAuthStage);") > app.indexOf("const recordAuthStage ="),
    "the recorder has to exist before it is connected");
});

test("the new stages carry the names the diagnostics are read by", () => {
  assert.deepEqual(
    [
      AUTH_STAGES.AUTH_INIT_READY, AUTH_STAGES.AUTH_INIT_TIMEOUT,
      AUTH_STAGES.IDP_FETCH_STARTED, AUTH_STAGES.IDP_FETCH_DONE, AUTH_STAGES.IDP_FETCH_ERROR,
      AUTH_STAGES.AUTH_RECOVERY_STARTED, AUTH_STAGES.AUTH_RECOVERY_RELOAD,
    ],
    [
      "auth_init_ready", "auth_init_timeout",
      "idp_fetch_started", "idp_fetch_done", "idp_fetch_error",
      "auth_recovery_started", "auth_recovery_reload",
    ],
  );
  assert.equal(AUTH_FEATURES.INITIALIZATION, "auth_init");
});

/* -------------------------------------------------------- no regression in */

test("the credential exchange keeps its existing deadlines and its two windows", async () => {
  const credential = await readSource("src/features/auth/credential-sign-in.js");
  assert.match(credential, /hardMs = 45000/, "the deadline must not be raised to hide the hang");
  assert.match(credential, /settleMs = 3000/);
  assert.match(credential, /if \(started && tryNo === 1\) \{\s*tryNo = 2;/);
  assert.doesNotMatch(credential, /tryNo = [3-9]/, "no third attempt may be added");
  assert.doesNotMatch(credential, /tryNo === 2/, "the second window is the last one");
  assert.match(credential, /await auth\.authStateReady\(\);/);
});
