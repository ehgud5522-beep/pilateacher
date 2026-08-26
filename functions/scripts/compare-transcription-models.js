"use strict";

const fs = require("node:fs");
const path = require("node:path");
const OpenAI = require("openai");
const { assessGptTranscription, assessWhisperTranscription } = require("../src/audio-quality");
const { inspectAudioBuffer } = require("../src/audio-contract");
const { buildTranscriptionPrompt } = require("../src/transcription-config");

const MODELS = Object.freeze(["whisper-1", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"]);
const FIXTURES = Object.freeze([
  { name: "01.m4a", expected: ["오른쪽 허리", "리포머", "흉추"] },
  { name: "02.m4a", expected: ["왼쪽", "오른쪽", "브릿지", "스완"] },
  { name: "03.m4a", expected: [] },
  { name: "04.m4a", expected: ["풋워크", "헌드레드", "복부", "브릿지"] },
]);

const fixtureRoot = path.resolve(__dirname, "../tests/fixtures/voice");

function normalized(value) {
  return String(value || "").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function scoreResult(fixture, transcript) {
  const text = normalized(transcript);
  if (!fixture.expected.length) return text ? 0 : 4;
  return fixture.expected.filter((token) => text.includes(normalized(token))).length;
}

async function transcribe(client, model, fixture, usePrompt) {
  const buffer = fs.readFileSync(path.join(fixtureRoot, fixture.name));
  const metadata = inspectAudioBuffer(buffer);
  const startedAt = Date.now();
  const isWhisper = model === "whisper-1";
  const response = await client.audio.transcriptions.create({
    file: await OpenAI.toFile(buffer, fixture.name, { type: "audio/mp4" }),
    model,
    language: "ko",
    temperature: 0,
    ...(usePrompt ? { prompt: buildTranscriptionPrompt("제이") } : {}),
    ...(isWhisper
      ? { response_format: "verbose_json", timestamp_granularities: ["segment"] }
      : { response_format: "json", include: ["logprobs"] }),
  });
  const quality = isWhisper ? assessWhisperTranscription(response) : assessGptTranscription(response);
  return {
    fixture: fixture.name,
    durationSeconds: Number(metadata.durationSeconds.toFixed(2)),
    rawTranscript: String(response?.text || "").trim(),
    acceptedTranscript: quality.transcript,
    confidence: quality.confidence,
    averageLogprob: quality.averageLogprob,
    accepted: quality.accepted,
    score: scoreResult(fixture, quality.transcript),
    latencyMs: Date.now() - startedAt,
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000, maxRetries: 0 });
  const combinations = [];
  for (const model of MODELS) {
    for (const usePrompt of [false, true]) {
      const results = [];
      for (const fixture of FIXTURES) results.push(await transcribe(client, model, fixture, usePrompt));
      combinations.push({
        model,
        prompt: usePrompt ? "context" : "none",
        score: results.reduce((sum, result) => sum + result.score, 0),
        averageLatencyMs: Math.round(results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length),
        results,
      });
    }
  }
  combinations.sort((a, b) => b.score - a.score || a.averageLatencyMs - b.averageLatencyMs);
  process.stdout.write(`${JSON.stringify({ comparedAt: new Date().toISOString(), winner: combinations[0], combinations }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`comparison_failed:${String(error?.status || error?.code || error?.name || "unknown")}\n`);
  process.exitCode = 1;
});
