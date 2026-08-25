export const VOICE_SILENCE_LIMIT_MS = 8000;
export const RECOGNIZER_BUSY_RETRY_MS = 300;

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
