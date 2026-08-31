/**
 * Carries the boot-time auth records until a logger exists.
 *
 * Two of the records that decide an initialization failure are produced before
 * the app has anything to store them in: the fetch wrapper installed in
 * `index.html` runs before the bundle, and the Auth initialization probe runs
 * while `src/lib/firebase.js` is still evaluating. Both write here; App.jsx
 * connects the real recorder afterwards and the buffer is flushed in order.
 *
 * Only a request path, an HTTP status and an elapsed time ever pass through.
 * No URL, query string, token or request body is accepted or forwarded.
 */

import { AUTH_FEATURES } from "./auth-diagnostics.js";

export const AUTH_INIT_BUFFER_LIMIT = 40;
/** Set by the inline script in index.html before the bundle runs. */
export const AUTH_FETCH_LOG_KEY = "__authFetchLog";
export const AUTH_FETCH_QUEUE_KEY = "__authFetchQueue";

/** @type {((stage: string, details: Record<string, any>) => void) | null} */
let sink = null;
/** @type {[string, Record<string, any>][]} */
const buffered = [];

const emit = (stage, details) => {
  try { sink?.(stage, details); } catch (_error) { /* Diagnostics must not break a boot. */ }
};

/** Records one boot-time event, buffering it while no recorder is connected. */
export function recordAuthInitEvent(stage, details = {}) {
  if (sink) { emit(stage, details); return; }
  if (buffered.length < AUTH_INIT_BUFFER_LIMIT) buffered.push([stage, details]);
}

/** Connects the real recorder and flushes everything buffered so far, in order. */
export function connectAuthInitLog(next) {
  sink = typeof next === "function" ? next : null;
  if (!sink) return;
  const pending = buffered.splice(0, buffered.length);
  for (const [stage, details] of pending) emit(stage, details);
}

/**
 * Points the inline fetch wrapper at this buffer and drains what it already
 * collected. The wrapper only ever hands over a path, a status and a duration;
 * the feature and provider are stamped here so both screens can group them.
 */
export function attachAuthFetchBridge(target = globalThis) {
  if (!target) return;
  const record = (stage, details) => recordAuthInitEvent(stage, {
    feature: AUTH_FEATURES.INITIALIZATION,
    provider: "firebase",
    ...(details && typeof details === "object" ? details : {}),
  });
  const queued = Array.isArray(target[AUTH_FETCH_QUEUE_KEY]) ? target[AUTH_FETCH_QUEUE_KEY].splice(0) : [];
  try { target[AUTH_FETCH_LOG_KEY] = record; } catch (_error) { /* A frozen global still gets the drained queue. */ }
  for (const item of queued) {
    if (Array.isArray(item)) record(item[0], item[1]);
  }
}

/** Test seam: drops the connected recorder and anything still buffered. */
export function resetAuthInitLog() {
  sink = null;
  buffered.splice(0, buffered.length);
}
