export const VOICE_ENGINE = Object.freeze({ SERVER: "server", NATIVE: "native" });
export const DEFAULT_VOICE_ENGINE = VOICE_ENGINE.SERVER;
export const SERVER_AUDIO_FOREGROUND_WAIT_MS = 10000;
export const SERVER_AUDIO_GATEWAY_TIMEOUT_MS = 30000;
export const SERVER_AUDIO_MAX_SECONDS = 90;
export const SERVER_AUDIO_MAX_BYTES = 2 * 1024 * 1024;
export const SERVER_AUDIO_ENERGY_INTERVAL_MS = 100;
export const SERVER_AUDIO_MIN_SPEECH_SECONDS = 1.5;
export const SERVER_AUDIO_LEAD_PADDING_MS = 300;
export const SERVER_AUDIO_TAIL_PADDING_MS = 500;

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

const clampAmplitude = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export function analyzeRecordedSpeech(amplitudes, intervalMs = SERVER_AUDIO_ENERGY_INTERVAL_MS) {
  const values = Array.isArray(amplitudes) ? amplitudes.map(clampAmplitude) : [];
  if (!values.length || !Number.isFinite(intervalMs) || intervalMs < 50 || intervalMs > 250) {
    return { accepted: false, speechSeconds: 0, threshold: 0, confidence: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor((sorted.length - 1) * 0.2)] || 0;
  const threshold = Math.max(0.015, noiseFloor * 2.5 + 0.006);
  const active = values.map((value) => value >= threshold);
  const bridge = Math.max(1, Math.round(300 / intervalMs));
  let previous = -1;
  active.forEach((isActive, index) => {
    if (!isActive) return;
    if (previous >= 0 && index - previous - 1 <= bridge) {
      for (let fill = previous + 1; fill < index; fill += 1) active[fill] = true;
    }
    previous = index;
  });
  const padded = [...active];
  active.forEach((isActive, index) => {
    if (!isActive) return;
    for (let fill = Math.max(0, index - bridge); fill <= Math.min(active.length - 1, index + bridge); fill += 1) padded[fill] = true;
  });
  const activeIndexes = padded.flatMap((isActive, index) => isActive ? [index] : []);
  const speechSeconds = Number((activeIndexes.length * intervalMs / 1000).toFixed(2));
  const activeAverage = activeIndexes.length ? activeIndexes.reduce((sum, index) => sum + values[index], 0) / activeIndexes.length : 0;
  const confidence = Math.max(0, Math.min(1, (activeAverage - noiseFloor) / Math.max(0.08, 1 - noiseFloor)));
  return {
    accepted: speechSeconds >= SERVER_AUDIO_MIN_SPEECH_SECONDS,
    speechSeconds,
    threshold: Number(threshold.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
  };
}

export function createAudioTrimPlan(amplitudes, intervalMs = SERVER_AUDIO_ENERGY_INTERVAL_MS, durationMs = null) {
  const values = Array.isArray(amplitudes) ? amplitudes.map(clampAmplitude) : [];
  const analyzed = analyzeRecordedSpeech(values, intervalMs);
  if (!values.length || !analyzed.accepted) {
    return { ...analyzed, startMs: 0, endMs: 0, trimmedMs: 0, amplitudes: [] };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor((sorted.length - 1) * 0.2)] || 0;
  const threshold = Math.max(0.015, noiseFloor * 2.5 + 0.006);
  const active = values.flatMap((value, index) => value >= threshold ? [index] : []);
  const measuredDurationMs = Math.max(values.length * intervalMs, Number(durationMs) || 0);
  const startMs = Math.max(0, active[0] * intervalMs - SERVER_AUDIO_LEAD_PADDING_MS);
  const endMs = Math.min(measuredDurationMs, (active.at(-1) + 1) * intervalMs + SERVER_AUDIO_TAIL_PADDING_MS);
  const firstSample = Math.max(0, Math.floor(startMs / intervalMs));
  const lastSample = Math.min(values.length, Math.ceil(endMs / intervalMs));
  return {
    ...analyzed,
    startMs,
    endMs,
    trimmedMs: Math.max(0, measuredDurationMs - (endMs - startMs)),
    amplitudes: values.slice(firstSample, lastSample),
  };
}

export function buildAudioMetrics(amplitudes, intervalMs = SERVER_AUDIO_ENERGY_INTERVAL_MS, details = {}) {
  return {
    intervalMs,
    amplitudes: (amplitudes || []).map((value) => Math.round(clampAmplitude(value) * 10000) / 10000).slice(0, 2000),
    trimmedMs: Math.max(0, Math.round(Number(details.trimmedMs) || 0)),
    captureLatencyMs: Math.max(0, Math.round(Number(details.captureLatencyMs) || 0)),
  };
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

export function audioGatewayInput({ audio, memberId, lessonId, memberName, clipId, audioMetrics }) {
  return {
    schemaVersion: 1,
    memberId: String(memberId || ""),
    lessonId: String(lessonId || ""),
    audio: String(audio || ""),
    memberName: String(memberName || "회원"),
    language: "ko",
    clipId: String(clipId || ""),
    audioMetrics: audioMetrics || null,
  };
}

export function structuredDraftFromAudioOutput(output) {
  const blockingFlags = (output?.flags || []).filter((flag) => flag !== "tail_dropped");
  if (!output?.fields || output?.result !== "ok" || blockingFlags.length) return null;
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

export async function uploadAudioClip({ provider, blob, memberId, lessonId, memberName, requestId, clipId = requestId, audioMetrics, onEvent = () => {} }) {
  const startedAt = Date.now();
  const audio = await blobToBase64(blob);
  onEvent("upload", { bytes: blob.size, requestId });
  const result = await provider.lessonRecordFromAudio(
    audioGatewayInput({ audio, memberId, lessonId, memberName, clipId, audioMetrics }),
    { requestId },
  );
  onEvent("transcribed", { durationMs: Date.now() - startedAt, requestId });
  onEvent("structured", { durationMs: Date.now() - startedAt, requestId });
  return result;
}
