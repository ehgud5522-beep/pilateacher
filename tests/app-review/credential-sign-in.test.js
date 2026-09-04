import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as flush } from "node:timers/promises";
import { signInWithCredentialSafe } from "../../src/features/auth/credential-sign-in.js";
import { AUTH_STAGES } from "../../src/features/auth/auth-diagnostics.js";

const user = (uid, providerId = "apple.com") => ({ uid, providerData: [{ providerId }] });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness(t, { initialUser = null, ready = Promise.resolve(), listenerError = null, syncError = null, providerId = "apple.com", logThrows = false } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const exchange = deferred();
  const events = [];
  let listener = (_user) => {};
  let calls = 0, unsubscribed = 0;
  const auth = { currentUser: initialUser, authStateReady: () => ready };
  const pending = signInWithCredentialSafe(
    /** @type {any} */ (auth), /** @type {any} */ ({ providerId }),
    (stage, outcome, details) => {
      events.push({ stage, outcome, ...details });
      if (logThrows) throw new Error("storage unavailable");
    },
    {
      signIn: /** @type {any} */ (() => {
        calls += 1;
        if (syncError) throw syncError;
        return exchange.promise;
      }),
      subscribe: /** @type {any} */ ((_auth, callback) => {
        if (listenerError) throw listenerError;
        listener = callback;
        callback(auth.currentUser); // Also exercise synchronous initial delivery.
        return () => { unsubscribed += 1; };
      }),
    },
  );
  return {
    auth, pending, exchange, events,
    get calls() { return calls; },
    get unsubscribed() { return unsubscribed; },
    emit(next) { auth.currentUser = next; listener(next); },
    settled() { return events.filter((entry) => entry.stage === AUTH_STAGES.FIREBASE_SIGN_IN_SETTLED); },
  };
}

test("normal SDK success returns its user and clears recovery work", async (t) => {
  const h = harness(t);
  await flush();
  const signedIn = user("new");
  h.exchange.resolve({ user: signedIn });
  assert.equal(await h.pending, signedIn);
  assert.equal(h.unsubscribed, 1);
  t.mock.timers.tick(100000);
  h.emit(user("late"));
  t.mock.timers.tick(0);
  assert.equal(h.calls, 1);
  assert.deepEqual(h.settled().map((event) => event.via), ["promise"]);
});

for (const providerId of ["apple.com", "google.com"]) {
  test(`${providerId}: auth state wins a hung SDK promise and a late rejection is consumed`, async (t) => {
    const h = harness(t, { providerId });
    await flush();
    const signedIn = user("new", providerId);
    h.emit(signedIn);
    t.mock.timers.tick(0);
    assert.equal(await h.pending, signedIn);
    h.exchange.reject(new Error("late SDK failure"));
    await flush();
    t.mock.timers.tick(100000);
    assert.equal(h.unsubscribed, 1);
    assert.equal(h.calls, 1);
    assert.deepEqual(h.settled().map((event) => event.via), ["authstate"]);
  });
}

test("an existing user's initial event or token refresh cannot hide a credential error", async (t) => {
  const h = harness(t, { initialUser: user("old") });
  const error = Object.assign(new Error("invalid"), { code: "auth/invalid-credential" });
  const rejected = assert.rejects(h.pending, (actual) => actual === error);
  await flush();
  h.emit(user("old")); // Different object, same existing account.
  h.exchange.reject(error);
  await flush();
  t.mock.timers.tick(3000);
  await rejected;
  assert.equal(h.calls, 1);
  assert.equal(h.unsubscribed, 1);
  assert.equal(h.settled().length, 0);
});

test("a restored session is captured before observation and is not a new sign-in", async (t) => {
  const ready = deferred();
  const h = harness(t, { ready: ready.promise });
  const rejected = assert.rejects(h.pending, { code: "auth/operation-timeout" });
  await flush();
  assert.equal(h.calls, 0);
  h.auth.currentUser = user("restored");
  ready.resolve();
  await flush();
  t.mock.timers.tick(45000);
  t.mock.timers.tick(45000);
  await rejected;
  assert.equal(h.calls, 1);
  assert.equal(h.unsubscribed, 1);
  assert.equal(h.settled().length, 0);
});

test("initialization is bounded and cannot launch an exchange after timeout", async (t) => {
  const ready = deferred();
  const h = harness(t, { ready: ready.promise });
  const rejected = assert.rejects(h.pending, { code: "auth/operation-timeout", authStage: "firebase_auth_state_init" });
  await flush();
  t.mock.timers.tick(45000);
  await rejected;
  ready.resolve();
  await flush();
  assert.equal(h.calls, 0);
  assert.equal(h.unsubscribed, 0);
});

test("two bounded observation windows time out without resubmitting the credential", async (t) => {
  const h = harness(t);
  const rejected = assert.rejects(h.pending, {
    code: "auth/operation-timeout", authStage: "firebase_credential_exchange", provider: "apple",
  });
  await flush();
  t.mock.timers.tick(45000);
  assert.equal(h.calls, 1);
  assert.equal(h.events.at(-1).stage, AUTH_STAGES.FIREBASE_SIGN_IN_RETRY);
  assert.equal(h.unsubscribed, 0);
  t.mock.timers.tick(45000);
  await rejected;
  assert.equal(h.calls, 1);
  assert.equal(h.unsubscribed, 1);
  h.exchange.resolve({ user: user("too-late") });
  h.emit(user("too-late"));
  await flush();
  t.mock.timers.tick(0);
  assert.equal(h.settled().length, 0);
});

test("the original SDK promise can still complete in the second observation window", async (t) => {
  const h = harness(t);
  await flush();
  t.mock.timers.tick(45000);
  const signedIn = user("new");
  h.exchange.resolve({ user: signedIn });
  assert.equal(await h.pending, signedIn);
  assert.equal(h.calls, 1);
  assert.equal(h.settled()[0].tryNo, 2);
});

test("currentUser recovers a missed auth event at the deadline", async (t) => {
  const h = harness(t);
  await flush();
  const signedIn = user("new");
  h.auth.currentUser = signedIn;
  t.mock.timers.tick(45000);
  assert.equal(await h.pending, signedIn);
  assert.equal(h.settled()[0].via, "timeout_but_signed_in");
});

test("an SDK error allows a brief settling window for an installed new user", async (t) => {
  const h = harness(t);
  await flush();
  h.exchange.reject(Object.assign(new Error("network"), { code: "auth/network-request-failed" }));
  await flush();
  const signedIn = user("new");
  h.auth.currentUser = signedIn;
  t.mock.timers.tick(3000);
  assert.equal(await h.pending, signedIn);
  assert.equal(h.settled()[0].via, "promise_error_but_signed_in");
  assert.equal(h.unsubscribed, 1);
});

test("a different provider and a queued event followed by sign-out cannot recover", async (t) => {
  const h = harness(t);
  const error = Object.assign(new Error("disabled"), { code: "auth/user-disabled" });
  const rejected = assert.rejects(h.pending, (actual) => actual === error);
  await flush();
  h.emit(user("wrong-provider", "google.com"));
  t.mock.timers.tick(0);
  h.emit(user("new"));
  h.emit(null);
  t.mock.timers.tick(0);
  h.exchange.reject(error);
  await flush();
  t.mock.timers.tick(3000);
  await rejected;
  assert.equal(h.settled().length, 0);
});

test("listener or logger failure cannot prevent normal SDK success", async (t) => {
  const h = harness(t, { listenerError: new Error("listener token=secret"), logThrows: true });
  await flush();
  const signedIn = user("new");
  h.exchange.resolve({ user: signedIn });
  assert.equal(await h.pending, signedIn);
  assert.deepEqual(h.events.slice(0, 3).map((event) => event.stage), [
    AUTH_STAGES.AUTH_STATE_READY_STARTED,
    AUTH_STAGES.AUTH_STATE_READY_SUCCEEDED,
    AUTH_STAGES.AUTHSTATE_LISTENER_FAILED,
  ]);
  assert.doesNotMatch(JSON.stringify(h.events), /secret/);
  t.mock.timers.tick(100000);
  assert.equal(h.settled().length, 1);
});

test("a synchronous SDK error retains its identity and clears observation", async (t) => {
  const error = Object.assign(new Error("not allowed"), { code: "auth/operation-not-allowed" });
  const h = harness(t, { syncError: error });
  const rejected = assert.rejects(h.pending, (actual) => actual === error);
  await flush();
  t.mock.timers.tick(3000);
  await rejected;
  assert.equal(h.unsubscribed, 1);
  assert.equal(h.calls, 1);
});
