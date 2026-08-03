import test from "node:test";
import assert from "node:assert/strict";
import { AI_STATUSES, buildBodyAnalysisInput, createAIProvider, makeAIRequestId } from "../../src/ai/index.js";

const bodyOutput = {
  bodyCharacteristics: ["흉곽 회전 경향"], asymmetries: ["오른쪽 어깨 높이 차이"],
  pelvis: "전방 경사 경향", thorax: "회전 경향", scapula: "좌우 차이", head: "전방 이동 경향", knees: "중립", feet: "중립",
  recommendedExercises: ["호흡 기반 흉곽 가동성"], precautions: ["통증 발생 시 중단"],
};

test("disabled provider is safely not_connected and never calls fetch", async () => {
  let calls = 0;
  const provider = createAIProvider({ config: { enabled: false, provider: "openai", gatewayUrl: "https://ai.example.com/v1" }, fetchImpl: async () => { calls += 1; } });
  const result = await provider.analyzeBody({ memberId: "m1" });
  assert.equal(result.status, AI_STATUSES.NOT_CONNECTED);
  assert.equal(calls, 0);
});

test("provider switch and structured body output use the secure gateway contract", async () => {
  let request;
  const provider = createAIProvider({
    config: { enabled: true, provider: "gemini", gatewayUrl: "https://ai.example.com/v1/execute" },
    fetchImpl: async (_url, init) => {
      request = { headers: init.headers, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ requestId: init.headers["X-Idempotency-Key"], provider: "gemini", model: "server-owned-model", output: bodyOutput }) };
    },
  });
  const result = await provider.analyzeBody({ memberId: "m1", views: [] });
  assert.equal(result.status, AI_STATUSES.DRAFT);
  assert.equal(result.provider, "gemini");
  assert.equal(request.body.provider, "gemini");
  assert.equal(request.body.operation, "analyzeBody");
  assert.deepEqual(result.output.recommendedExercises, ["호흡 기반 흉곽 가동성"]);
});

test("idempotency key is deterministic for normalized object order", () => {
  const first = makeAIRequestId("anthropic", "summarizeVoice", { lessonId: "l1", transcript: "기록" });
  const second = makeAIRequestId("anthropic", "summarizeVoice", { transcript: "기록", lessonId: "l1" });
  assert.equal(first, second);
});

test("voice summary maps the Firebase Gateway result contract to the existing client contract", async () => {
  let request;
  const provider = createAIProvider({
    config: { enabled: true, provider: "openai", gatewayUrl: "https://ai.example.com/v1/ai/voice-summary" },
    getAccessToken: async () => "firebase-id-token",
    fetchImpl: async (_url, init) => {
      request = init;
      return {
        ok: true,
        json: async () => ({
          requestId: init.headers["X-Idempotency-Key"],
          operation: "voice_summary",
          provider: "openai",
          model: "gpt-5-mini",
          result: {
            todayExercises: ["호흡", "브리지"],
            memberCondition: "불편감 없음",
            painOrDiscomfort: "",
            improvements: "골반 중립 유지가 안정적이었음",
            nextGoal: "호흡과 동작 연결",
            homework: "호흡 연습",
            cautions: "",
          },
        }),
      };
    },
  });
  const result = await provider.summarizeVoice({ lessonId: "lesson-1", memberId: "member-1", transcript: "수업 기록" });
  assert.equal(request.headers.Authorization, "Bearer firebase-id-token");
  assert.equal(request.credentials, "omit");
  assert.equal(result.output.memberCondition, "불편감 없음");
  assert.deepEqual(result.output.improvements, ["골반 중립 유지가 안정적이었음"]);
  assert.deepEqual(result.output.pain, []);
});

test("voice summary accepts a schema-valid empty result and preserves gateway error codes", async () => {
  const emptyResult = {
    todayExercises: [], memberCondition: "", painOrDiscomfort: "", improvements: "",
    nextGoal: "", homework: "", cautions: "",
  };
  const successProvider = createAIProvider({
    config: { enabled: true, provider: "openai", gatewayUrl: "https://ai.example.com/v1/ai/voice-summary" },
    fetchImpl: async (_url, init) => ({ ok: true, json: async () => ({ requestId: init.headers["X-Idempotency-Key"], provider: "openai", model: "gpt-5-mini", result: emptyResult }) }),
  });
  const success = await successProvider.summarizeVoice({ lessonId: "lesson-1", memberId: "member-1", transcript: "관련 정보 없음" });
  assert.deepEqual(success.output.todayExercises, []);

  const deniedProvider = createAIProvider({
    config: { enabled: true, provider: "openai", gatewayUrl: "https://ai.example.com/v1/ai/voice-summary" },
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { code: "consent_required" } }) }),
  });
  await assert.rejects(
    deniedProvider.summarizeVoice({ lessonId: "lesson-1", memberId: "member-1", transcript: "기록" }),
    (error) => (/** @type {any} */ (error)).code === "consent_required" && (/** @type {any} */ (error)).status === 403,
  );
});

test("malformed provider output fails instead of fabricating AI content", async () => {
  const provider = createAIProvider({
    config: { enabled: true, provider: "anthropic", gatewayUrl: "https://ai.example.com/v1/execute" },
    fetchImpl: async (_url, init) => ({ ok: true, json: async () => ({ requestId: init.headers["X-Idempotency-Key"], output: {} }) }),
  });
  await assert.rejects(() => provider.summarizeVoice({ transcript: "기록" }), (error) => (/** @type {any} */ (error))?.code === "invalid_output");
});

test("OpenAI, Gemini, and Anthropic are interchangeable without changing operation callers", async () => {
  for (const providerId of ["openai", "gemini", "anthropic"]) {
    const provider = createAIProvider({
      config: { enabled: true, provider: providerId, gatewayUrl: "https://ai.example.com/v1/execute" },
      fetchImpl: async (_url, init) => ({ ok: true, json: async () => ({ requestId: init.headers["X-Idempotency-Key"], provider: providerId, output: { title: "시퀀스", exercises: [{ name: "브리딩", purpose: "호흡", dosage: "5회" }], rationale: [], precautions: [] } }) }),
    });
    const result = await provider.recommendSequence({ memberId: "m1" });
    assert.equal(result.provider, providerId);
    assert.equal(result.output.exercises[0].name, "브리딩");
  }
});

test("unknown provider is disabled instead of silently calling a different provider", async () => {
  let calls = 0;
  const provider = createAIProvider({ env: { VITE_AI_ENABLED: "true", VITE_AI_PROVIDER: "typo", VITE_AI_GATEWAY_URL: "https://ai.example.com" }, fetchImpl: async () => { calls += 1; } });
  const result = await provider.generateReport({ memberId: "m1" });
  assert.equal(result.status, AI_STATUSES.NOT_CONNECTED);
  assert.equal(calls, 0);
});

test("body AI input contains four canonical pose views but never photo or blob payloads", () => {
  const records = ["front", "side", "back", "rightSide"].map((view) => ({
    assessmentId: "a1", view, pts: { nose: { x: 0.5, y: 0.2, score: 0.9 } }, metrics: [{ key: "headTilt", value: 2, unit: "degree" }],
    blob: new Uint8Array([1, 2, 3]), src: "data:image/jpeg;base64,secret", blobId: "blob-secret",
  }));
  const input = buildBodyAnalysisInput({ member: { id: "m1", goal: "균형" }, records, teacherNote: "통증 없음" });
  assert.deepEqual(input.views.map((view) => view.view), ["front", "leftSide", "back", "rightSide"]);
  assert.equal(input.views.find((view) => view.view === "leftSide")?.assessmentId, "a1");
  const serialized = JSON.stringify(input);
  assert.equal(serialized.includes("base64"), false);
  assert.equal(serialized.includes("blob-secret"), false);
  assert.equal(serialized.includes('"blob"'), false);
});
