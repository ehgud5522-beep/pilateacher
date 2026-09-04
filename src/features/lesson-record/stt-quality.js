export const LOW_CONFIDENCE_THRESHOLD = 0.6;
export const LOW_VOLUME_THRESHOLD = 0.008;
export const LOW_VOLUME_DURATION_MS = 3000;

export const STT_HALLUCINATION_PATTERNS = Object.freeze([
  "구독과 좋아요",
  "좋아요 부탁",
  "시청해주셔서",
  "영상이 도움이",
  "다음 영상",
  "알림 설정",
  "구독 부탁",
]);

const normalizedConfidence = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
};

const sentences = (value) => String(value || "").match(/[^.!?。！？]+[.!?。！？]?/gu) || [];
const containsHallucination = (value) => STT_HALLUCINATION_PATTERNS.some((phrase) => String(value || "").includes(phrase));

export function filterSttHallucinations(transcript) {
  const input = String(transcript || "").trim();
  if (!input) return { transcript: "", removedCount: 0, removedAll: false };
  const parts = sentences(input);
  const retained = parts.filter((sentence) => !containsHallucination(sentence));
  const removedCount = parts.length - retained.length;
  const filtered = retained.join(" ").replace(/\s+/g, " ").trim();
  return { transcript: filtered, removedCount, removedAll: removedCount > 0 && !filtered };
}

export function detectSustainedLowVolume(samples, intervalMs = 100) {
  if (!Array.isArray(samples) || !Number.isFinite(Number(intervalMs)) || Number(intervalMs) <= 0) return false;
  const required = Math.ceil(LOW_VOLUME_DURATION_MS / Number(intervalMs));
  if (samples.length < required) return false;
  return samples.slice(-required).every((sample) => Number.isFinite(Number(sample)) && Number(sample) < LOW_VOLUME_THRESHOLD);
}

export function assessSttQuality({ transcript, confidence = null, lowVolume = false } = {}) {
  const filtered = filterSttHallucinations(transcript);
  const value = filtered.transcript;
  const availableConfidence = normalizedConfidence(confidence);
  const lowConfidence = availableConfidence !== null && availableConfidence < LOW_CONFIDENCE_THRESHOLD;
  const substantive = value.replace(/[\s.,!?。！？·~_-]+/g, "").length >= 3;
  const reasons = [];
  if (!substantive) reasons.push(filtered.removedAll ? "hallucination_phrase" : "no_substantive_content");
  if (lowConfidence && lowVolume) reasons.push("low_confidence_low_volume");
  return {
    accepted: reasons.length === 0,
    transcript: value,
    confidence: availableConfidence,
    confidenceAvailable: availableConfidence !== null,
    lowConfidence,
    lowVolume: Boolean(lowVolume),
    removedHallucinationSentences: filtered.removedCount,
    reasons,
  };
}
