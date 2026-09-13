import test from "node:test";
import assert from "node:assert/strict";
import { AI_OPERATIONS, normalizeAIOutput } from "../../src/ai/contracts.js";
import { OpenAIProvider } from "../../src/ai/providers.js";

const output = {
  transcript: "브릿지를 진행했습니다.",
  result: "ok",
  fields: { didToday: ["브릿지"], observations: [], responses: [], nextFocus: [] },
  // 제안이 없는 응답도 그대로 통과한다 -- 제안은 기록의 조건이 아니다.
  suggestions: [],
  summary: "브릿지를 진행했습니다.",
  speechSeconds: 2.1,
  confidence: 0.91,
  flags: [],
  provenance: { stt: "openai", llm: "openai" },
};

test("client validates the deployed audio lesson contract", () => {
  assert.equal(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, "lesson_record_from_audio");
  assert.deepEqual(normalizeAIOutput(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, output), output);
  assert.deepEqual(normalizeAIOutput(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, { ...output, flags: ["tail_dropped"] }).flags, ["tail_dropped"]);
  assert.deepEqual(normalizeAIOutput(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, { ...output, flags: ["hallucination_phrase_removed"] }).flags, ["hallucination_phrase_removed"]);
  assert.throws(() => normalizeAIOutput(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, { ...output, audio: "forbidden" }));
  assert.deepEqual(normalizeAIOutput(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, {
    transcript: "", result: "no_speech", fields: null, summary: null, speechSeconds: 0, confidence: 0,
    flags: ["no_speech"], provenance: { stt: null, llm: null },
  }).result, "no_speech");
  assert.deepEqual(normalizeAIOutput(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, {
    transcript: "브릿지", result: "low_confidence", fields: null, summary: null, speechSeconds: 1.8, confidence: 0.2,
    flags: ["low_confidence"], provenance: { stt: "openai", llm: null },
  }).result, "low_confidence");
  assert.deepEqual(normalizeAIOutput(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, {
    transcript: "", result: "low_confidence", fields: null, summary: null, speechSeconds: 1.8, confidence: 0.9,
    flags: ["hallucination_phrase"], provenance: { stt: "openai", llm: null },
  }).flags, ["hallucination_phrase"]);
});

test("gateway client sends audio with the caller's stable idempotency key", async () => {
  const requests = [];
  const provider = new OpenAIProvider({
    enabled: true,
    gatewayUrl: "https://example.test/aiGateway",
    getAccessToken: async () => "firebase-token",
    fetchImpl: async (_url, init) => {
      requests.push({ body: JSON.parse(init.body), headers: init.headers });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: "audio-fixed-request",
          provider: "openai",
          operation: AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO,
          model: "gpt-5-mini",
          promptVersion: "lesson_record_v2",
          output,
        }),
      };
    },
  });
  await provider.lessonRecordFromAudio({ schemaVersion: 1, memberId: "m1", lessonId: "l1", audio: "AQID", memberName: "제이", language: "ko" }, { requestId: "audio-fixed-request" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.requestId, "audio-fixed-request");
  assert.equal(requests[0].body.operation, "lesson_record_from_audio");
  assert.equal(requests[0].headers["Content-Type"], "application/json");
});

test("gateway client preserves safe invalid-request diagnostics", async () => {
  const provider = new OpenAIProvider({
    enabled: true,
    gatewayUrl: "https://example.test/aiGateway",
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "invalid_request", message: "The request is invalid.", diagnostic: {
        stage: "request_validation",
        validationReason: "unsupported_audio_type_or_duration",
        invalidField: "input.audio",
        operation: "lesson_record_from_audio",
      } } }),
    }),
  });
  await assert.rejects(
    async () => provider.lessonRecordFromAudio({ schemaVersion: 1, memberId: "m1", lessonId: "l1", audio: "AQID", memberName: "제이", language: "ko" }, { requestId: "audio-fixed-request" }),
    (error) => {
      const failure = /** @type {any} */ (error);
      return failure.code === "invalid_request"
        && failure.status === 400
        && failure.validationReason === "unsupported_audio_type_or_duration"
        && failure.invalidField === "input.audio"
        && failure.operation === "lesson_record_from_audio";
    },
  );
});
