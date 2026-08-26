"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeEnergyEnvelope,
  assessGptTranscription,
  assessTranscriptConsistency,
  assessWhisperTranscription,
} = require("../src/audio-quality");
const { PILATES_TRANSCRIPTION_TERMS, buildTranscriptionPrompt } = require("../src/transcription-config");

const voicedEnvelope = () => ({ intervalMs: 100, amplitudes: [...Array(5).fill(0.002), ...Array(20).fill(0.22), ...Array(5).fill(0.002)] });

test("energy VAD blocks silence and accepts at least 1.5 seconds of speech", () => {
  assert.equal(analyzeEnergyEnvelope({ intervalMs: 100, amplitudes: Array(50).fill(0.001) }).accepted, false);
  const speech = analyzeEnergyEnvelope(voicedEnvelope());
  assert.equal(speech.accepted, true);
  assert.ok(speech.speechSeconds >= 1.5);
  assert.equal(analyzeEnergyEnvelope(null).reason, "missing_energy_envelope");
});

test("model-specific confidence rejects weak output and keeps accepted Whisper segments only", () => {
  assert.equal(assessGptTranscription({ text: "사전 환각", logprobs: [{ logprob: -3 }] }).accepted, false);
  assert.equal(assessGptTranscription({ text: "브릿지", logprobs: [{ logprob: -0.2 }] }).transcript, "브릿지");
  const whisper = assessWhisperTranscription({ segments: [
    { text: "브릿지", no_speech_prob: 0.1, avg_logprob: -0.2, compression_ratio: 1.1 },
    { text: "환각", no_speech_prob: 0.9, avg_logprob: -2, compression_ratio: 3 },
  ] });
  assert.equal(whisper.transcript, "브릿지");
  assert.equal(whisper.rejectedSegments, 1);
});

test("implausible Korean speed and four consecutive glossary terms block structuring", () => {
  assert.deepEqual(assessTranscriptConsistency("리포머 캐딜락 체어 바렐", 5, PILATES_TRANSCRIPTION_TERMS).flags, ["glossary_sequence"]);
  assert.ok(assessTranscriptConsistency("오른쪽허리가아주많이좋아졌습니다", 1, PILATES_TRANSCRIPTION_TERMS).flags.includes("implausible_transcript_rate"));
  assert.equal(assessTranscriptConsistency("브릿지", 1.5, PILATES_TRANSCRIPTION_TERMS).accepted, true);
  const prompt = buildTranscriptionPrompt("제이");
  assert.match(prompt, /같은 용어가 나올 수 있습니다/);
  assert.doesNotMatch(prompt, /필라테스 용어 참고:/);
});

module.exports = { voicedEnvelope };
