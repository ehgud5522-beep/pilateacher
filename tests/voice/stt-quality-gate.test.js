import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assessSttQuality,
  detectSustainedLowVolume,
  filterSttHallucinations,
} from "../../src/features/lesson-record/stt-quality.js";
import backendQuality from "../../functions/src/stt-quality.js";

test("low confidence and sustained low volume reject without saving transcript text", () => {
  const result = assessSttQuality({ transcript: "브릿지 동작을 진행했습니다", confidence: 0.3, lowVolume: true });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasons, ["low_confidence_low_volume"]);
});

test("normal confidence passes and unavailable confidence does not fabricate a score", () => {
  const normal = assessSttQuality({ transcript: "브릿지 동작을 진행했습니다", confidence: 0.9, lowVolume: false });
  const unavailable = assessSttQuality({ transcript: "브릿지 동작을 진행했습니다", confidence: undefined, lowVolume: false });
  assert.equal(normal.accepted, true);
  assert.equal(normal.confidence, 0.9);
  assert.equal(unavailable.accepted, true);
  assert.equal(unavailable.confidenceAvailable, false);
  assert.equal(unavailable.confidence, null);
});

test("hallucination filtering removes only the matching sentence and rejects an all-match result", () => {
  const partial = filterSttHallucinations("브릿지를 진행했습니다. 시청해주셔서 감사합니다.");
  const all = assessSttQuality({ transcript: "구독과 좋아요 부탁드립니다.", confidence: 0.9 });
  assert.equal(partial.transcript, "브릿지를 진행했습니다.");
  assert.equal(partial.removedCount, 1);
  assert.equal(all.accepted, false);
  assert.deepEqual(all.reasons, ["hallucination_phrase"]);
});

test("three seconds of low samples are required for sustained low volume", () => {
  assert.equal(detectSustainedLowVolume(Array(29).fill(0.001), 100), false);
  assert.equal(detectSustainedLowVolume(Array(30).fill(0.001), 100), true);
  assert.equal(detectSustainedLowVolume([...Array(29).fill(0.001), 0.2], 100), false);
});

test("backend and client use the same hallucination phrase behavior", () => {
  assert.equal(backendQuality.filterSttHallucinations("브릿지 진행. 다음 영상에서 만나요.").transcript, "브릿지 진행.");
  assert.equal(backendQuality.filterSttHallucinations("알림 설정 부탁드립니다.").removedAll, true);
});

test("quality gate precedes raw persistence and exposes retry/direct-entry recovery without transcript diagnostics", async () => {
  const app = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const finish = app.slice(app.indexOf("const finishRecognition"), app.indexOf("const scheduleFinish"));
  assert.ok(finish.indexOf("gateTranscript(captured") < finish.indexOf("persistRawDraft(finalized"));
  const request = app.slice(app.indexOf("const requestSummary"), app.indexOf("const retrySummary"));
  assert.ok(request.indexOf("gateTranscript(candidateTranscript") < request.indexOf("persistRawDraft(transcript"));
  assert.match(app, /잘 들리지 않아 기록하지 않았습니다\./);
  assert.match(app, />다시 말하기<\/button>/);
  assert.match(app, />직접 입력<\/button>/);
  const rejection = app.slice(app.indexOf("const rejectSttQuality"), app.indexOf("const gateTranscript"));
  assert.doesNotMatch(rejection, /transcript\s*:/);
});

test("server filters hallucinations before structuring and partial removal is informational", async () => {
  const provider = await readFile(new URL("../../functions/src/openai-provider.js", import.meta.url), "utf8");
  assert.ok(provider.indexOf("filterSttHallucinations(assessment.transcript)") < provider.indexOf("async function executeAudio"));
  const session = await readFile(new URL("../../src/features/voice/server-audio-session.js", import.meta.url), "utf8");
  assert.match(session, /"hallucination_phrase_removed"/);
});
