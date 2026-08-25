const STORAGE_KEY = "pilateacher_ai_recording_status_v1";
export const AI_RECORDING_STATUS = Object.freeze({ NORMAL: "normal", DEGRADED: "degraded", OFF: "off" });

const normalize = (value) => Object.values(AI_RECORDING_STATUS).includes(value) ? value : AI_RECORDING_STATUS.NORMAL;

export function readAIRecordingStatus(storage = globalThis.localStorage) {
  try {
    const cached = JSON.parse(storage?.getItem(STORAGE_KEY) || "null") || {};
    return { status: normalize(cached.status), reasonCode: String(cached.reasonCode || ""), updatedAt: String(cached.updatedAt || "") };
  } catch (_error) {
    return { status: AI_RECORDING_STATUS.NORMAL, reasonCode: "", updatedAt: "" };
  }
}

export function writeAIRecordingStatus(value, storage = globalThis.localStorage) {
  const next = {
    status: normalize(value?.status),
    reasonCode: String(value?.reasonCode || "").slice(0, 80),
    updatedAt: String(value?.updatedAt || new Date().toISOString()),
  };
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_error) {}
  return next;
}

export function aiRecordingAvailable(value) {
  return normalize(value?.status) === AI_RECORDING_STATUS.NORMAL;
}

export const AI_RECORDING_STATUS_STORAGE_KEY = STORAGE_KEY;
