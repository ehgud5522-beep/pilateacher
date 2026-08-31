/**
 * Reachability checks for the layers a sign-in depends on.
 *
 * Sign-in on this app is the Firebase JavaScript SDK running inside the web
 * view: it resolves identitytoolkit.googleapis.com, completes a CORS preflight,
 * and stores its session in IndexedDB. When a sign-in hangs until the timeout
 * there is nothing to read afterwards, because the SDK never reports why. These
 * probes ask each of those layers directly and record the answer, so the failing
 * one can be named before a sign-in is attempted at all.
 *
 * The endpoint probe posts an empty body: the service answers 400 without
 * touching an account, so any HTTP status at all proves DNS, TLS, the CORS
 * preflight and the API key route are working. No credential is sent.
 */

export const AUTH_ENDPOINT_ORIGIN = "https://identitytoolkit.googleapis.com";
export const AUTH_PROBE_PATH = "/v1/accounts:signInWithPassword";
export const AUTH_PROBE_TIMEOUT_MS = 8000;
export const STORAGE_PROBE_TIMEOUT_MS = 3000;

const elapsedSince = (start, now) => Math.max(0, Math.round(now() - start));

/** Names the layer that refused, keeping its own wording. */
function describeFetchFailure(error) {
  const name = String(error?.name || "");
  if (name === "AbortError") {
    return { errorDomain: "auth_endpoint", errorCode: "timeout", message: "요청이 시간 안에 끝나지 않았습니다." };
  }
  if (name === "TypeError") {
    // A web view reports a blocked connection, a failed TLS handshake and a
    // refused CORS preflight all as one TypeError; the wording is the only
    // thing that separates them, so keep it.
    return { errorDomain: "auth_endpoint", errorCode: "fetch_failed", message: String(error?.message || "fetch failed") };
  }
  return { errorDomain: "auth_endpoint", errorCode: name || "unknown", message: String(error?.message || error || "") };
}

/**
 * @param {{ apiKey?: string, fetchImpl?: Function|null, timeoutMs?: number,
 *   now?: () => number, AbortControllerImpl?: any }} [options]
 */
export async function probeAuthEndpoint({
  apiKey = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = AUTH_PROBE_TIMEOUT_MS,
  now = () => Date.now(),
  AbortControllerImpl = globalThis.AbortController,
} = {}) {
  const startedAt = now();
  if (typeof fetchImpl !== "function") {
    return { ok: false, httpStatus: 0, elapsedMs: 0, errorDomain: "auth_endpoint", errorCode: "fetch_unavailable", message: "이 환경에는 fetch가 없습니다." };
  }
  const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(`${AUTH_ENDPOINT_ORIGIN}${AUTH_PROBE_PATH}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      credentials: "omit",
      cache: "no-store",
      signal: controller?.signal,
    });
    // 400 is the expected answer to an empty body. Any status means the whole
    // path worked, which is what this probe measures.
    return {
      ok: true,
      httpStatus: Number(response?.status) || 0,
      elapsedMs: elapsedSince(startedAt, now),
      errorDomain: "",
      errorCode: "",
      message: `HTTP ${response?.status}`,
    };
  } catch (error) {
    return { ok: false, httpStatus: 0, elapsedMs: elapsedSince(startedAt, now), ...describeFetchFailure(error) };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** @param {{ storage?: any, now?: () => number }} [options] */
export function probeLocalStorage({ storage = globalThis.localStorage, now = () => Date.now() } = {}) {
  const startedAt = now();
  const key = "pilateacher_probe_v1";
  try {
    storage?.setItem?.(key, "1");
    const readBack = storage?.getItem?.(key);
    storage?.removeItem?.(key);
    return readBack === "1"
      ? { ok: true, elapsedMs: elapsedSince(startedAt, now), errorDomain: "", errorCode: "", message: "" }
      : { ok: false, elapsedMs: elapsedSince(startedAt, now), errorDomain: "local_storage", errorCode: "read_back_failed", message: "저장한 값을 다시 읽지 못했습니다." };
  } catch (error) {
    return { ok: false, elapsedMs: elapsedSince(startedAt, now), errorDomain: "local_storage", errorCode: String(error?.name || "unknown"), message: String(error?.message || error || "") };
  }
}

/**
 * Firebase Auth keeps its session in IndexedDB. An open that never settles
 * leaves every sign-in call pending with no error, which is indistinguishable
 * from a network hang unless it is measured on its own.
 *
 * @param {{ factory?: any, timeoutMs?: number, now?: () => number,
 *   setTimer?: Function, clearTimer?: Function }} [options]
 */
export function probeIndexedDb({ factory = globalThis.indexedDB, timeoutMs = STORAGE_PROBE_TIMEOUT_MS, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const startedAt = now();
  if (!factory) {
    return Promise.resolve({ ok: false, elapsedMs: 0, errorDomain: "indexed_db", errorCode: "unavailable", message: "이 웹뷰에서 IndexedDB를 쓸 수 없습니다." });
  }
  return new Promise((resolve) => {
    let settled = false;
    // Declared before the timer is armed: a timer that fires immediately must
    // still find something to clear.
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      resolve({ elapsedMs: elapsedSince(startedAt, now), ...result });
    };
    timer = setTimer(() => finish({ ok: false, errorDomain: "indexed_db", errorCode: "timeout", message: "IndexedDB 열기가 끝나지 않았습니다." }), timeoutMs);
    let request;
    try {
      request = factory.open("pilateacher-probe", 1);
    } catch (error) {
      finish({ ok: false, errorDomain: "indexed_db", errorCode: String(error?.name || "open_threw"), message: String(error?.message || error || "") });
      return;
    }
    request.onsuccess = () => {
      try { request.result?.close?.(); } catch (_error) {}
      finish({ ok: true, errorDomain: "", errorCode: "", message: "" });
    };
    request.onerror = () => finish({ ok: false, errorDomain: "indexed_db", errorCode: String(request.error?.name || "open_failed"), message: String(request.error?.message || "") });
    request.onblocked = () => finish({ ok: false, errorDomain: "indexed_db", errorCode: "blocked", message: "다른 탭이나 세션이 IndexedDB를 잡고 있습니다." });
  });
}

/**
 * Runs every probe and returns one record per layer, ready to be written to the
 * sign-in diagnostics. Each record already carries its own domain and code.
 *
 * @param {{ apiKey?: string, fetchImpl?: Function, factory?: any,
 *   storage?: any, timeoutMs?: number, now?: () => number }} [options]
 */
export async function runAuthPreflight({ apiKey = "", fetchImpl, factory, storage, timeoutMs, now = () => Date.now() } = {}) {
  const online = globalThis.navigator?.onLine !== false;
  const [endpoint, indexedDb] = await Promise.all([
    probeAuthEndpoint({ apiKey, fetchImpl, timeoutMs, now }),
    probeIndexedDb({ factory, now }),
  ]);
  const local = probeLocalStorage({ storage, now });
  return [
    { ...endpoint, stage: "auth_endpoint_probe", outcome: endpoint.ok ? "succeeded" : "failed" },
    { ...indexedDb, stage: "indexed_db_probe", outcome: indexedDb.ok ? "succeeded" : "failed" },
    { ...local, stage: "local_storage_probe", outcome: local.ok ? "succeeded" : "failed" },
    { stage: "network_state", outcome: online ? "succeeded" : "failed", errorDomain: online ? "" : "navigator", errorCode: online ? "" : "offline", message: online ? "온라인" : "오프라인", elapsedMs: 0 },
  ];
}
