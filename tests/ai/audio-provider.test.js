import test from "node:test";
import assert from "node:assert/strict";
import { AI_OPERATIONS, normalizeAIOutput } from "../../src/ai/contracts.js";
import { OpenAIProvider } from "../../src/ai/providers.js";

const output = {
  transcript: "브릿지를 진행했습니다.",
  fields: { didToday: ["브릿지"], observations: [], responses: [], nextFocus: [] },
  summary: "브릿지를 진행했습니다.",
  provenance: { stt: "openai", llm: "openai" },
};

test("client validates the deployed audio lesson contract", () => {
  assert.equal(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, "lesson_record_from_audio");
  assert.deepEqual(normalizeAIOutput(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, output), output);
  assert.throws(() => normalizeAIOutput(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, { ...output, audio: "forbidden" }));
});

test("gateway client sends audio with the caller's stable idempotency key", async () => {
  const requests = [];
  const provider = new OpenAIProvider({
    enabled: true,
    gatewayUrl: "https://example.test/aiGateway",
    getAccessToken: async () => "firebase-token",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
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
  assert.equal(requests[0].requestId, "audio-fixed-request");
  assert.equal(requests[0].operation, "lesson_record_from_audio");
});
