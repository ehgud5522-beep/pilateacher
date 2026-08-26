"use strict";

const MIN_SPEECH_SECONDS = 1.5;
const ENERGY_INTERVAL_MIN_MS = 50;
const ENERGY_INTERVAL_MAX_MS = 250;
const ENERGY_ABSOLUTE_FLOOR = 0.015;
const GPT_MIN_MEAN_LOGPROB = -1;
const WHISPER_MAX_NO_SPEECH = 0.6;
const WHISPER_MIN_AVG_LOGPROB = -1;
const WHISPER_MAX_COMPRESSION_RATIO = 2.4;
const MAX_KOREAN_SYLLABLES_PER_SPEECH_SECOND = 8;

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function analyzeEnergyEnvelope(metrics, { minimumSpeechSeconds = MIN_SPEECH_SECONDS } = {}) {
  const intervalMs = Number(metrics?.intervalMs);
  const raw = Array.isArray(metrics?.amplitudes) ? metrics.amplitudes : [];
  if (!Number.isFinite(intervalMs) || intervalMs < ENERGY_INTERVAL_MIN_MS || intervalMs > ENERGY_INTERVAL_MAX_MS || !raw.length || raw.length > 2000) {
    return Object.freeze({ accepted: false, speechSeconds: 0, confidence: 0, threshold: 0, reason: "missing_energy_envelope" });
  }
  const amplitudes = raw.map(clamp01);
  const noiseFloor = percentile(amplitudes, 0.2);
  const threshold = Math.max(ENERGY_ABSOLUTE_FLOOR, noiseFloor * 2.5 + 0.006);
  const active = amplitudes.map((value) => value >= threshold);
  const gapSamples = Math.max(1, Math.round(300 / intervalMs));
  let previous = -1;
  for (let index = 0; index < active.length; index += 1) {
    if (!active[index]) continue;
    if (previous >= 0 && index - previous - 1 <= gapSamples) {
      for (let fill = previous + 1; fill < index; fill += 1) active[fill] = true;
    }
    previous = index;
  }
  const paddingSamples = Math.max(1, Math.round(300 / intervalMs));
  const padded = [...active];
  active.forEach((isActive, index) => {
    if (!isActive) return;
    const start = Math.max(0, index - paddingSamples);
    const end = Math.min(active.length - 1, index + paddingSamples);
    for (let fill = start; fill <= end; fill += 1) padded[fill] = true;
  });
  const activeIndexes = padded.flatMap((isActive, index) => isActive ? [index] : []);
  const rawActiveIndexes = active.flatMap((isActive, index) => isActive ? [index] : []);
  const speechSeconds = Number((activeIndexes.length * intervalMs / 1000).toFixed(2));
  const activeAverage = activeIndexes.length
    ? activeIndexes.reduce((sum, index) => sum + amplitudes[index], 0) / activeIndexes.length
    : 0;
  const confidence = clamp01((activeAverage - noiseFloor) / Math.max(0.08, 1 - noiseFloor));
  return Object.freeze({
    accepted: speechSeconds >= minimumSpeechSeconds,
    speechSeconds,
    confidence: Number(confidence.toFixed(4)),
    threshold: Number(threshold.toFixed(4)),
    firstSpeechMs: rawActiveIndexes.length ? rawActiveIndexes[0] * intervalMs : null,
    lastSpeechMs: rawActiveIndexes.length ? (rawActiveIndexes.at(-1) + 1) * intervalMs : null,
    trimmedMs: Math.max(0, Number(metrics?.trimmedMs) || 0),
    captureLatencyMs: Math.max(0, Number(metrics?.captureLatencyMs) || 0),
    reason: speechSeconds >= minimumSpeechSeconds ? "speech_detected" : "speech_too_short",
  });
}

function meanLogprob(logprobs) {
  const values = (logprobs || []).map((entry) => Number(entry?.logprob)).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function assessGptTranscription(response) {
  const transcript = String(response?.text || "").trim();
  const average = meanLogprob(response?.logprobs);
  const confidence = average == null ? 0 : Math.exp(Math.min(0, average));
  const accepted = Boolean(transcript) && average != null && average >= GPT_MIN_MEAN_LOGPROB;
  return Object.freeze({
    transcript: accepted ? transcript : "",
    accepted,
    confidence: Number(clamp01(confidence).toFixed(4)),
    averageLogprob: average,
    rejectedSegments: accepted ? 0 : 1,
    totalSegments: 1,
  });
}

function whisperSegmentAccepted(segment) {
  const noSpeech = Number(segment?.no_speech_prob);
  const average = Number(segment?.avg_logprob);
  const compression = Number(segment?.compression_ratio);
  return Number.isFinite(noSpeech) && noSpeech < WHISPER_MAX_NO_SPEECH
    && Number.isFinite(average) && average >= WHISPER_MIN_AVG_LOGPROB
    && (!Number.isFinite(compression) || compression <= WHISPER_MAX_COMPRESSION_RATIO);
}

function assessWhisperTranscription(response, { speechEndSeconds = Number.POSITIVE_INFINITY } = {}) {
  const segments = Array.isArray(response?.segments) ? response.segments : [];
  const confidenceAccepted = segments.filter(whisperSegmentAccepted);
  const tailSegments = Number.isFinite(speechEndSeconds)
    ? confidenceAccepted.filter((segment) => Number.isFinite(Number(segment?.start)) && Number(segment.start) > speechEndSeconds + 0.2)
    : [];
  const tailSet = new Set(tailSegments);
  const acceptedSegments = confidenceAccepted.filter((segment) => !tailSet.has(segment));
  const transcript = acceptedSegments.map((segment) => String(segment?.text || "").trim()).filter(Boolean).join(" ").trim();
  const confidenceValues = acceptedSegments.map((segment) => Math.exp(Math.min(0, Number(segment.avg_logprob))));
  const confidence = confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0;
  return Object.freeze({
    transcript,
    accepted: Boolean(transcript),
    confidence: Number(clamp01(confidence).toFixed(4)),
    averageLogprob: acceptedSegments.length
      ? acceptedSegments.reduce((sum, segment) => sum + Number(segment.avg_logprob), 0) / acceptedSegments.length
      : null,
    rejectedSegments: Math.max(0, segments.length - acceptedSegments.length),
    totalSegments: segments.length,
    tailDropped: tailSegments.length > 0,
    tailDroppedSegments: tailSegments.length,
  });
}

function countKoreanSyllables(value) {
  return (String(value || "").match(/[가-힣]/g) || []).length;
}

function glossaryRunLength(transcript, terms) {
  const escaped = (terms || []).map((term) => String(term || "").trim()).filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return 0;
  const matcher = new RegExp(escaped.join("|"), "gu");
  const matches = [...String(transcript || "").matchAll(matcher)];
  let best = matches.length ? 1 : 0;
  let run = best;
  for (let index = 1; index < matches.length; index += 1) {
    const previousEnd = (matches[index - 1].index || 0) + matches[index - 1][0].length;
    const between = String(transcript || "").slice(previousEnd, matches[index].index);
    if (/^[\s,./·ㆍ|+&와과및]*(?:으로|로|랑|하고)?[\s,./·ㆍ|+&]*$/u.test(between)) run += 1;
    else run = 1;
    best = Math.max(best, run);
  }
  return best;
}

function assessTranscriptConsistency(transcript, speechSeconds, terms) {
  const text = String(transcript || "").trim();
  const seconds = Math.max(0, Number(speechSeconds) || 0);
  const syllables = countKoreanSyllables(text);
  const syllablesPerSecond = seconds > 0 ? syllables / seconds : Number.POSITIVE_INFINITY;
  const termRunLength = glossaryRunLength(text, terms);
  const flags = [];
  if (text && syllablesPerSecond > MAX_KOREAN_SYLLABLES_PER_SPEECH_SECOND) flags.push("implausible_transcript_rate");
  if (termRunLength >= 4) flags.push("glossary_sequence");
  return Object.freeze({
    accepted: flags.length === 0,
    flags,
    syllables,
    syllablesPerSecond: Number.isFinite(syllablesPerSecond) ? Number(syllablesPerSecond.toFixed(2)) : null,
    glossaryRunLength: termRunLength,
  });
}

module.exports = {
  GPT_MIN_MEAN_LOGPROB,
  MAX_KOREAN_SYLLABLES_PER_SPEECH_SECOND,
  MIN_SPEECH_SECONDS,
  WHISPER_MAX_COMPRESSION_RATIO,
  WHISPER_MAX_NO_SPEECH,
  WHISPER_MIN_AVG_LOGPROB,
  analyzeEnergyEnvelope,
  assessGptTranscription,
  assessTranscriptConsistency,
  assessWhisperTranscription,
  countKoreanSyllables,
  glossaryRunLength,
};
