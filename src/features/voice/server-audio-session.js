export const VOICE_ENGINE = Object.freeze({ SERVER: "server", NATIVE: "native" });
export const DEFAULT_VOICE_ENGINE = VOICE_ENGINE.SERVER;
export const SERVER_AUDIO_FOREGROUND_WAIT_MS = 10000;
export const SERVER_AUDIO_GATEWAY_TIMEOUT_MS = 30000;
export const SERVER_AUDIO_MAX_SECONDS = 90;
export const SERVER_AUDIO_MAX_BYTES = 2 * 1024 * 1024;

const safeIdPart = (value) => String(value || "unknown").replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 40);

export function resolveVoiceEngine(value) {
  return String(value || "").trim().toLowerCase() === VOICE_ENGINE.NATIVE
    ? VOICE_ENGINE.NATIVE
    : DEFAULT_VOICE_ENGINE;
}

export function createStableAudioRequestId(memberId, lessonId, clipIndex = 0, nonce = "") {
  const random = String(nonce || globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`).replace(/[^A-Za-z0-9]/g, "");
  return `audio_${safeIdPart(memberId)}_${safeIdPart(lessonId || "general")}_${Math.max(0, Number(clipIndex) || 0)}_${random}`.slice(0, 160);
}

export async function blobToBase64(blob) {
  if (!(blob instanceof Blob)) throw Object.assign(new TypeError("recorded audio blob is missing"), { code: "audio_missing" });
  if (blob.size > SERVER_AUDIO_MAX_BYTES) throw Object.assign(new RangeError("recorded audio exceeds 2 MB"), { code: "audio_too_large" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const stride = 0x8000;
  for (let index = 0; index < bytes.length; index += stride) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + stride)));
  }
  return globalThis.btoa(binary);
}

export async function recordingResultToBlob(result, { readFile } = {}) {
  if (result?.blob instanceof Blob) return result.blob;
  if (!result?.uri || typeof readFile !== "function") {
    throw Object.assign(new TypeError("recording result has no accessible audio"), { code: "audio_missing" });
  }
  const file = await readFile({ path: result.uri });
  if (file?.data instanceof Blob) return file.data;
  const base64 = String(file?.data || "").replace(/^data:[^,]+,/, "");
  if (!base64) throw Object.assign(new TypeError("recording file is empty"), { code: "audio_missing" });
  const binary = globalThis.atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const mime = /\.aac(?:$|[?#])/i.test(result.uri) ? "audio/aac" : "audio/mp4";
  return new Blob([bytes], { type: mime });
}

export function audioGatewayInput({ audio, memberId, lessonId, memberName }) {
  return {
    schemaVersion: 1,
    memberId: String(memberId || ""),
    lessonId: String(lessonId || ""),
    audio: String(audio || ""),
    memberName: String(memberName || "회원"),
    language: "ko",
  };
}

export function structuredDraftFromAudioOutput(output) {
  const fields = output?.fields || {};
  return {
    didToday: fields.didToday || [],
    observations: fields.observations || [],
    responses: fields.responses || [],
    nextFocus: fields.nextFocus || [],
    uncertain: [],
    summary: output?.summary ?? null,
  };
}

export async function settleWithin(promise, timeoutMs = SERVER_AUDIO_FOREGROUND_WAIT_MS, timers = globalThis) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = timers.setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const settled = Promise.resolve(promise).then(
    (value) => ({ timedOut: false, value }),
    (error) => ({ timedOut: false, error }),
  );
  const result = await Promise.race([settled, timeout]);
  if (timer !== null) timers.clearTimeout(timer);
  return result;
}

export async function uploadAudioClip({ provider, blob, memberId, lessonId, memberName, requestId, onEvent = () => {} }) {
  const startedAt = Date.now();
  const audio = await blobToBase64(blob);
  onEvent("upload", { bytes: blob.size, requestId });
  const result = await provider.lessonRecordFromAudio(
    audioGatewayInput({ audio, memberId, lessonId, memberName }),
    { requestId },
  );
  onEvent("transcribed", { durationMs: Date.now() - startedAt, requestId });
  onEvent("structured", { durationMs: Date.now() - startedAt, requestId });
  return result;
}
