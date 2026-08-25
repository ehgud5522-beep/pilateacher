export const VOICE_SILENCE_LIMIT_MS = 8000;
export const RECOGNIZER_BUSY_RETRY_MS = 300;
export const VOICE_SESSION_DIAGNOSTIC_LIMIT = 30;
export const VOICE_SESSION_DIAGNOSTIC_KEY = "pilateacher_voice_session_diagnostics_v1";

const VOICE_SESSION_EVENT_TYPES = new Set([
  "start", "interim", "final", "engine_end", "restart",
  "silence_end", "user_end", "cap_end", "error",
]);

const normalizeSpace = (value) => String(value || "").replace(/\s+/g, " ").trim();

export function stitchSpeechTranscript(current, incoming) {
  const base = normalizeSpace(current).replace(/\s*⟨[^⟩]*⟩\s*$/, "").trim();
  const next = normalizeSpace(incoming);
  if (!base) return next;
  if (!next || base.endsWith(next)) return base;
  if (next.startsWith(base)) return next;
  const baseWords = base.split(" ");
  const nextWords = next.split(" ");
  const maxOverlap = Math.min(12, baseWords.length, nextWords.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (baseWords.slice(-size).join(" ") === nextWords.slice(0, size).join(" ")) {
      return [...baseWords, ...nextWords.slice(size)].join(" ");
    }
  }
  return `${base} ${next}`;
}

export function isRecognizerBusyError(error) {
  const detail = [error?.code, error?.name, error?.message, typeof error === "string" ? error : ""]
    .filter(Boolean).join(" ").toLowerCase();
  return /recognitionservice busy|recognizer busy|client side|ongoing|error[_ .-]*recognizer[_ .-]*busy|error 8\b/.test(detail);
}

export function resolveVoicePhase({ availability = "ready", starting = false, listening = false, finishing = false, organizing = false, hasResult = false, attempted = false, error = "" } = {}) {
  if (organizing || finishing) return "organizing";
  if (listening) return "listening";
  if (starting || availability === "checking") return "preparing";
  if (attempted && error) return "failed";
  if (hasResult) return "result";
  if (availability === "unsupported") return "unsupported";
  if (availability === "permission_required") return "permission_required";
  return "idle";
}

export function shouldRestartRecognizer({
  stopping = false,
  sessionStartedAt = 0,
  lastSpeechAt = 0,
  now = Date.now(),
  maxDurationMs = 90000,
  silenceLimitMs = VOICE_SILENCE_LIMIT_MS,
} = {}) {
  const startedAt = Number(sessionStartedAt) || 0;
  const heardAt = Number(lastSpeechAt) || startedAt;
  const current = Number(now) || Date.now();
  return !stopping
    && startedAt > 0
    && current - startedAt < maxDurationMs
    && current - heardAt < silenceLimitMs;
}

const safeDiagnosticText = (value, max = 80) => String(value || "")
  .replace(/[^A-Za-z0-9._:/-]/g, "_")
  .slice(0, max);

export function readVoiceSessionDiagnostics(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(VOICE_SESSION_DIAGNOSTIC_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(-VOICE_SESSION_DIAGNOSTIC_LIMIT).reverse() : [];
  } catch (_error) { return []; }
}

export function appendVoiceSessionDiagnostic(event, details = {}, storage = globalThis.localStorage, clock = () => new Date()) {
  if (!VOICE_SESSION_EVENT_TYPES.has(event)) return null;
  const date = clock();
  const entry = {
    at: date.toISOString(),
    localTime: date.toLocaleString("ko-KR", { hour12: false }),
    event,
    source: safeDiagnosticText(details.source || "unknown", 40),
    ...(details.code ? { code: safeDiagnosticText(details.code) } : {}),
    ...(details.reason ? { reason: safeDiagnosticText(details.reason) } : {}),
    ...(details.phase ? { phase: safeDiagnosticText(details.phase) } : {}),
    ...(Number.isFinite(Number(details.attempt)) ? { attempt: Math.max(0, Number(details.attempt)) } : {}),
    ...(Number.isFinite(Number(details.delayMs)) ? { delayMs: Math.max(0, Number(details.delayMs)) } : {}),
    ...(Number.isFinite(Number(details.charCount)) ? { charCount: Math.max(0, Number(details.charCount)) } : {}),
  };
  try {
    const current = readVoiceSessionDiagnostics(storage).reverse();
    storage?.setItem?.(VOICE_SESSION_DIAGNOSTIC_KEY, JSON.stringify([...current, entry].slice(-VOICE_SESSION_DIAGNOSTIC_LIMIT)));
  } catch (_error) {}
  return entry;
}

export function createSilenceGuard({
  limitMs = VOICE_SILENCE_LIMIT_MS,
  setTimer = (...args) => globalThis.setTimeout(...args),
  clearTimer = (...args) => globalThis.clearTimeout(...args),
  onTimeout = () => {},
} = {}) {
  let timer = null;
  let generation = 0;
  const clear = () => {
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const arm = () => {
    clear();
    const activeGeneration = generation;
    timer = setTimer(() => {
      if (activeGeneration !== generation) return;
      timer = null;
      onTimeout();
    }, limitMs);
  };
  return Object.freeze({ start: arm, heard: arm, stop: clear });
}
