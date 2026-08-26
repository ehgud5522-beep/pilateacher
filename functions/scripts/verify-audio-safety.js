"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createOpenAIProvider } = require("../src/openai-provider");

const FIXTURES = Object.freeze([
  ["03.m4a", "silence_5s"],
  ["05-noise.m4a", "background_noise_5s"],
  ["06-bridge.m4a", "single_word_bridge"],
  ["04.m4a", "normal_with_pauses"],
]);
const fixtureRoot = path.resolve(__dirname, "../tests/fixtures/voice");

function energyEnvelope(filePath, ffmpegPath) {
  const pcm = execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", filePath, "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"], { maxBuffer: 8 * 1024 * 1024 });
  const samplesPerWindow = 1600;
  const amplitudes = [];
  for (let offset = 0; offset + 1 < pcm.length; offset += samplesPerWindow * 2) {
    const end = Math.min(pcm.length, offset + samplesPerWindow * 2);
    let sumSquares = 0;
    let count = 0;
    for (let cursor = offset; cursor + 1 < end; cursor += 2) {
      const value = pcm.readInt16LE(cursor) / 32768;
      sumSquares += value * value;
      count += 1;
    }
    amplitudes.push(Number(Math.sqrt(sumSquares / Math.max(1, count)).toFixed(4)));
  }
  pcm.fill(0);
  return { intervalMs: 100, amplitudes };
}

async function main() {
  if (!process.env.OPENAI_API_KEY || !process.env.FFMPEG_PATH) throw new Error("OPENAI_API_KEY and FFMPEG_PATH are required");
  const provider = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY, timeoutMs: 60000 });
  const results = [];
  for (const [name, label] of FIXTURES) {
    const filePath = path.join(fixtureRoot, name);
    const audio = fs.readFileSync(filePath);
    const startedAt = Date.now();
    const result = await provider.executeAudio({
      input: {
        audio: audio.toString("base64"),
        audioMetrics: energyEnvelope(filePath, process.env.FFMPEG_PATH),
        memberName: "제이",
        language: "ko",
      },
    });
    audio.fill(0);
    results.push({
      fixture: name,
      label,
      latencyMs: Date.now() - startedAt,
      transcriptionModel: result.transcriptionModel,
      result: result.output.result,
      transcript: result.output.transcript,
      fields: result.output.fields,
      summary: result.output.summary,
      speechSeconds: result.output.speechSeconds,
      confidence: result.output.confidence,
      flags: result.output.flags,
    });
  }
  process.stdout.write(`${JSON.stringify({ verifiedAt: new Date().toISOString(), results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`audio_safety_verification_failed:${String(error?.status || error?.code || error?.name || "unknown")}\n`);
  process.exitCode = 1;
});
