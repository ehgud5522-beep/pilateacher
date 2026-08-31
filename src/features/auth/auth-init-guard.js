/**
 * Measures whether the Firebase Auth instance ever finishes initializing, and
 * clears its stored session once if it does not.
 *
 * A sign-in call is queued behind `auth._initializationPromise`. When that
 * promise never settles, every sign-in - Apple, Google or e-mail - waits with
 * no error, no HTTP request and no Firebase code, which is exactly what a
 * network hang looks like from the outside. Measuring initialization on its own
 * separates the two, and it is measured on app start so the answer exists
 * before anyone presses a login button.
 *
 * The recovery runs at most once per app session. Without that flag a web view
 * whose storage keeps failing would reload forever.
 */

import { AUTH_STAGES } from "./auth-diagnostics.js";

export const AUTH_INIT_TIMEOUT_MS = 8000;
export const AUTH_RECOVERY_FLAG = "pilateacher:auth_recovery_attempted";
/** Firebase Auth's own IndexedDB database; nothing of the teacher's is in it. */
export const AUTH_PERSISTENCE_DATABASE = "firebaseLocalStorageDb";
/** Only Firebase Auth's own localStorage keys are removed. */
export const AUTH_STORAGE_PREFIXES = Object.freeze(["firebase:authUser:", "firebase:persistence:"]);

const readyPromise = (auth) => {
  if (typeof auth?.authStateReady === "function") return auth.authStateReady();
  // Older SDKs have no authStateReady; the first auth state notification is
  // only sent once initialization has completed, so it means the same thing.
  return new Promise((resolve) => {
    let unsubscribe = null;
    try {
      unsubscribe = auth?.onAuthStateChanged?.(() => {
        try { unsubscribe?.(); } catch (_error) { /* Resolve even if disposal fails. */ }
        resolve(undefined);
      });
    } catch (_error) { /* Leave it pending; the deadline below reports it. */ }
  });
};

/**
 * Resolves `true` when initialization completed inside the deadline and `false`
 * when it did not. It never rejects: this is a measurement, not a gate.
 *
 * @param {any} auth
 * @param {{ timeoutMs?: number, now?: () => number, setTimer?: Function,
 *   clearTimer?: Function, log?: Function, onTimeout?: Function }} [options]
 */
export function measureAuthInitialization(auth, {
  timeoutMs = AUTH_INIT_TIMEOUT_MS,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {},
  onTimeout = () => {},
} = {}) {
  const startedAt = now();
  let timer = null;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimer(() => reject(new Error("init-timeout")), timeoutMs);
  });
  const record = (stage) => {
    try { log(stage, { elapsedMs: Math.max(0, Math.round(now() - startedAt)) }); }
    catch (_error) { /* Diagnostics must not break a boot. */ }
  };
  return Promise.race([readyPromise(auth), deadline]).then(
    () => { clearTimer(timer); record(AUTH_STAGES.AUTH_INIT_READY); return true; },
    () => {
      clearTimer(timer);
      record(AUTH_STAGES.AUTH_INIT_TIMEOUT);
      try { onTimeout(); } catch (_error) { /* Recovery failure must not throw here. */ }
      return false;
    },
  );
}

const storageKeys = (store) => {
  try {
    if (store && typeof store.key === "function" && Number.isFinite(store.length)) {
      return Array.from({ length: store.length }, (_value, index) => store.key(index))
        .filter((key) => typeof key === "string");
    }
    return Object.keys(store || {}).filter((key) => typeof key === "string");
  } catch (_error) {
    return [];
  }
};

/**
 * Clears Firebase Auth's own stored session once and reloads, so a broken store
 * does not require the teacher to delete and reinstall the app.
 *
 * Returns why it stopped, which is what the tests hold it to:
 * `"reloaded" | "deferred" | "already_attempted" | "flag_unavailable"`.
 *
 * @param {{ session?: any, local?: any, databases?: any, reload?: Function,
 *   isBusy?: () => boolean, log?: Function, flag?: string }} [options]
 */
export function recoverAuthStorage({
  session = globalThis.sessionStorage,
  local = globalThis.localStorage,
  databases = globalThis.indexedDB,
  reload = () => globalThis.location?.reload?.(),
  isBusy = () => false,
  log = () => {},
  flag = AUTH_RECOVERY_FLAG,
} = {}) {
  const record = (stage, details = {}) => {
    try { log(stage, details); } catch (_error) { /* Diagnostics must not break a boot. */ }
  };
  let busy = false;
  try { busy = isBusy() === true; } catch (_error) { busy = true; }
  if (busy) {
    // A reload in the middle of a sign-in would throw away the attempt the
    // teacher is watching. The next app start gets a clean flag and retries.
    record(AUTH_STAGES.AUTH_RECOVERY_DEFERRED, { message: "로그인 시도 중 · 복구를 다음 실행으로 넘김" });
    return "deferred";
  }
  let attempted = null;
  try { attempted = session?.getItem?.(flag); } catch (_error) { attempted = null; }
  if (attempted) {
    record(AUTH_STAGES.AUTH_RECOVERY_SKIPPED, { message: "이 실행에서 이미 복구했습니다" });
    return "already_attempted";
  }
  // The flag has to be readable back before anything reloads. If it is not,
  // reloading would repeat this forever.
  let flagStored = false;
  try {
    session?.setItem?.(flag, "1");
    flagStored = session?.getItem?.(flag) === "1";
  } catch (_error) { flagStored = false; }
  if (!flagStored) {
    record(AUTH_STAGES.AUTH_RECOVERY_SKIPPED, {
      errorDomain: "session_storage", errorCode: "flag_unavailable",
      message: "재시도 방지 표시를 저장할 수 없어 복구를 건너뜁니다",
    });
    return "flag_unavailable";
  }
  record(AUTH_STAGES.AUTH_RECOVERY_STARTED, {});
  try { databases?.deleteDatabase?.(AUTH_PERSISTENCE_DATABASE); } catch (_error) { /* Best effort. */ }
  for (const key of storageKeys(local)) {
    if (!AUTH_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    try { local.removeItem(key); } catch (_error) { /* Best effort. */ }
  }
  record(AUTH_STAGES.AUTH_RECOVERY_RELOAD, {});
  try { reload(); } catch (_error) { /* A web view that refuses to reload keeps the flag set. */ }
  return "reloaded";
}
