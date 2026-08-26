"use strict";

const fs = require("node:fs");
const path = require("node:path");
const OpenAI = require("openai");
const { assessWhisperTranscription } = require("../src/audio-quality");
const { inspectAudioBuffer } = require("../src/audio-contract");
const { buildTranscriptionPrompt } = require("../src/transcription-config");

const LEGACY_CONTEXT = "필라테스 수업 직후 강사의 짧은 한국어 기록입니다. 리포머·캐딜락·체어·바렐·스프링·풋워크·헌드레드·롤업·롤다운·브릿지·플랭크·사이드 라잉·티저·스완·견갑·흉추·요추·골반·코어·복부·햄스트링·둔근·가동범위·정렬·호흡·통증·재등록·노쇼 같은 용어가 나올 수 있습니다. 실제로 들리는 말만 원문 의미 그대로 전사하고, 들리지 않는 내용은 만들지 마세요.";
const FIXTURES = Object.freeze([
  { name: "02.m4a", observedBefore: "수증기", expected: ["왼쪽", "오른쪽", "브릿지", "스완"] },
  { name: "07.m4a", observedBefore: "힘스", expected: ["흉추"] },
  { name: "11.m4a", observedBefore: "맞췄어요", expected: ["낮췄어요"] },
  { name: "12-tail.m4a", observedBefore: "꼬리 환각", expected: ["브릿지", "별거 없었어요", "평소대로"], tailSilenceSeconds: 3 },
  { name: "13-immediate.m4a", observedBefore: "시작 첫 단어 누락", expected: ["브릿지"] },
]);

const fixtureRoot = path.resolve(__dirname, "../tests/fixtures/voice");
const normalize = (value) => String(value || "").replace(/[\s.,!?]/g, "");

async function transcribe(client, fixture, promptName, prompt) {
  const buffer = fs.readFileSync(path.join(fixtureRoot, fixture.name));
  const metadata = inspectAudioBuffer(buffer);
  const startedAt = Date.now();
  const response = await client.audio.transcriptions.create({
    file: await OpenAI.toFile(buffer, fixture.name, { type: "audio/mp4" }),
    model: "whisper-1",
    language: "ko",
    temperature: 0,
    prompt,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });
  buffer.fill(0);
  const speechEndSeconds = fixture.tailSilenceSeconds
    ? Math.max(0, metadata.durationSeconds - fixture.tailSilenceSeconds)
    : Number.POSITIVE_INFINITY;
  const assessed = assessWhisperTranscription(response, { speechEndSeconds });
  const accepted = normalize(assessed.transcript);
  return {
    fixture: fixture.name,
    prompt: promptName,
    observedBefore: fixture.observedBefore,
    rawTranscript: String(response?.text || "").trim(),
    acceptedTranscript: assessed.transcript,
    expectedTerms: fixture.expected,
    matchedTerms: fixture.expected.filter((term) => accepted.includes(normalize(term))),
    tailDropped: assessed.tailDropped,
    latencyMs: Date.now() - startedAt,
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000, maxRetries: 0 });
  const results = [];
  for (const fixture of FIXTURES) {
    results.push(await transcribe(client, fixture, "legacy_context", LEGACY_CONTEXT));
    results.push(await transcribe(client, fixture, "d5_context", buildTranscriptionPrompt("제이")));
  }
  process.stdout.write(`${JSON.stringify({ testedAt: new Date().toISOString(), model: "whisper-1", temperature: 0, results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`d5_transcription_comparison_failed:${String(error?.status || error?.code || error?.name || "unknown")}\n`);
  process.exitCode = 1;
});
