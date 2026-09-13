"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAIGatewayHandler } = require("../src/ai-gateway");
const { GatewayError } = require("../src/errors");
const { createMemoryIdempotencyStore } = require("../src/idempotency");
const { createRequest, createResponse } = require("./helpers");
const { createM4aFixture } = require("./audio-fixtures");

const voiceOutput = Object.freeze({
  memberCondition: "불편감 없음",
  todayExercises: ["호흡"],
  pain: [],
  improvements: [],
  nextGoals: [],
  homework: [],
  precautions: [],
});

function gatewayRequest(overrides = {}) {
  const requestId = overrides.requestId || "ai_openai_summarizeVoice_12345678";
  return createRequest({
    headers: { authorization: "Bearer valid-token", "x-idempotency-key": requestId },
    body: {
      schemaVersion: 1,
      requestId,
      provider: "openai",
      operation: "summarizeVoice",
      input: {
        schemaVersion: 1,
        memberId: "member-1",
        lessonId: "lesson-1",
        transcript: "김지민 회원은 010-1234-5678, member@example.com이며 호흡을 진행했다.",
        language: "ko-KR",
      },
    },
    ...overrides,
  });
}

async function invoke(handler, request = gatewayRequest()) {
  const response = createResponse();
  await handler(request, response);
  return response;
}

function sequenceGatewayRequest() {
  const requestId = "ai_openai_recommendSequence_12345678";
  return createRequest({
    headers: { authorization: "Bearer valid-token", "x-idempotency-key": requestId },
    body: {
      schemaVersion: 1,
      requestId,
      provider: "openai",
      operation: "recommendSequence",
      input: {
        schemaVersion: 1,
        memberId: "member-1",
        goals: ["코어"],
        precautions: [],
        bodyAssessment: null,
        recentLessons: [],
        recentNotes: [],
      },
    },
  });
}

function postureGatewayRequest(operation = "analyzeBody") {
  const requestId = `ai_openai_${operation}_posture1234`;
  const input = operation === "analyzeBody" ? {
    schemaVersion: 1,
    memberId: "member-1",
    goals: [],
    precautions: [],
    teacherNote: "",
    views: [{
      view: "front",
      assessmentId: "assessment-1",
      pose: { nose: { x: 0.5, y: 0.2, score: 0.9, source: "ai" } },
      measurements: [{ key: "shoulder", value: 2.1, unit: "deg", direction: "" }],
      confidence: { threshold: 0.4, lowJoints: [], missingJoints: [] },
      analysisSource: "ai",
      editedJoints: [],
    }],
  } : {
    schemaVersion: 1,
    reportType: "member_body_assessment_card",
    memberId: "member-1",
    source: {
      bodyAnalysis: { bodyCharacteristics: ["legacy interpretation"], asymmetries: [], pelvis: "", thorax: "", scapula: "", head: "", knees: "", feet: "", recommendedExercises: [], precautions: [] },
      teacherNote: "",
    },
  };
  return createRequest({
    headers: { authorization: "Bearer valid-token", "x-idempotency-key": requestId },
    body: { schemaVersion: 1, requestId, provider: "openai", operation, input },
  });
}

function audioGatewayRequest() {
  const requestId = "ai_openai_lesson_audio_12345678";
  return createRequest({
    headers: { authorization: "Bearer valid-token", "x-idempotency-key": requestId },
    body: {
      schemaVersion: 1,
      requestId,
      provider: "openai",
      operation: "lesson_record_from_audio",
      input: {
        schemaVersion: 1,
        memberId: "member-1",
        lessonId: "lesson-1",
        audio: createM4aFixture(12).toString("base64"),
        memberName: "위조 이름",
        language: "ko",
        clipId: requestId,
        audioMetrics: { intervalMs: 100, amplitudes: Array(30).fill(0.2) },
      },
    },
  });
}

test("gateway verifies auth, strips identifiers, and returns the client contract", async () => {
  let calls = 0;
  let providerInput;
  let safetyId;
  let rateCalls = 0;
  const handler = createAIGatewayHandler({
    verifyIdToken: async () => ({ uid: "verified-user" }),
    policyService: {
      authorize: async () => ({ allowed: true, memberName: "김지민" }),
      consumeRateLimit: async () => { rateCalls += 1; return { allowed: true }; },
    },
    idempotencyStore: createMemoryIdempotencyStore(),
    getProvider: async () => ({ execute: async ({ input, safetyIdentifier }) => {
      calls += 1;
      providerInput = input;
      safetyId = safetyIdentifier;
      return { model: "gpt-5-mini", promptVersion: "voice_v1", output: voiceOutput };
    } }),
    clock: () => new Date("2026-08-23T00:00:00Z"),
  });
  const first = await invoke(handler);
  const second = await invoke(handler);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(calls, 1);
  assert.equal(rateCalls, 1);
  assert.equal(providerInput.memberId, undefined);
  assert.equal(providerInput.lessonId, undefined);
  assert.equal(JSON.stringify(providerInput).includes("김지민"), false);
  assert.equal(JSON.stringify(providerInput).includes("010-1234-5678"), false);
  assert.equal(JSON.stringify(providerInput).includes("member@example.com"), false);
  assert.match(safetyId, /^[a-f0-9]{64}$/);
  assert.equal(first.body.operation, "summarizeVoice");
  assert.deepEqual(first.body.output, voiceOutput);
  assert.equal(first.headers["Cache-Control"], "no-store");
});

test("authorization and missing Secret both fail before provider execution or quota", async () => {
  let getProviderCalls = 0;
  const denied = createAIGatewayHandler({
    verifyIdToken: async () => ({ uid: "verified-user" }),
    policyService: { authorize: async () => ({ allowed: false, reason: "consent_missing" }), consumeRateLimit: async () => ({ allowed: true }) },
    idempotencyStore: createMemoryIdempotencyStore(),
    getProvider: async () => { getProviderCalls += 1; return {}; },
  });
  const deniedResponse = await invoke(denied);
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(deniedResponse.body.error.code, "consent_required");
  assert.equal(getProviderCalls, 0);

  const brokenLink = createAIGatewayHandler({
    verifyIdToken: async () => ({ uid: "verified-user" }),
    policyService: { authorize: async () => ({ allowed: false, reason: "lesson_not_owned" }), consumeRateLimit: async () => ({ allowed: true }) },
    idempotencyStore: createMemoryIdempotencyStore(),
    getProvider: async () => { getProviderCalls += 1; return {}; },
  });
  const brokenLinkResponse = await invoke(brokenLink);
  assert.equal(brokenLinkResponse.statusCode, 403);
  assert.equal(brokenLinkResponse.body.error.code, "invalid_request");
  assert.equal(brokenLinkResponse.body.error.diagnostic.stage, "authorization");
  assert.equal(brokenLinkResponse.body.error.diagnostic.validationReason, "lesson_not_owned");
  assert.equal(brokenLinkResponse.body.error.diagnostic.invalidField, "input.lessonId");
  assert.equal(brokenLinkResponse.body.error.diagnostic.operation, "summarizeVoice");
  assert.equal(getProviderCalls, 0);

  let rateCalls = 0;
  const missingSecret = createAIGatewayHandler({
    verifyIdToken: async () => ({ uid: "verified-user" }),
    policyService: {
      authorize: async () => ({ allowed: true, memberName: "" }),
      consumeRateLimit: async () => { rateCalls += 1; return { allowed: true }; },
    },
    idempotencyStore: createMemoryIdempotencyStore(),
    getProvider: async () => { throw new GatewayError("provider_unavailable"); },
  });
  const secretResponse = await invoke(missingSecret);
  assert.equal(secretResponse.statusCode, 503);
  assert.equal(secretResponse.body.error.code, "provider_unavailable");
  assert.equal(rateCalls, 0);
});

test("provider failures return only allowlisted diagnostic fields", async () => {
  const handler = createAIGatewayHandler({
    verifyIdToken: async () => ({ uid: "verified-user" }),
    policyService: {
      authorize: async () => ({ allowed: true, memberName: "" }),
      consumeRateLimit: async () => ({ allowed: true }),
    },
    idempotencyStore: createMemoryIdempotencyStore(),
    getProvider: async () => ({
      execute: async () => { throw new GatewayError("provider_unavailable", { diagnostic: {
        stage: "provider_http",
        providerStatus: 401,
        providerCode: "invalid_api_key",
        providerType: "invalid_request_error",
        providerRequestId: "req_safe_1",
        transcript: "private",
      } }); },
    }),
  });
  const response = await invoke(handler);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body.error.diagnostic, {
    stage: "provider_http",
    providerStatus: 401,
    providerCode: "invalid_api_key",
    providerType: "invalid_request_error",
    providerRequestId: "req_safe_1",
  });
  assert.equal(JSON.stringify(response.body).includes("private"), false);
  assert.equal(JSON.stringify(response.body).includes("transcript"), false);
});

test("deferred sequence recommendation stops before policy, quota, or provider execution", async () => {
  let policyCalls = 0;
  let providerCalls = 0;
  const handler = createAIGatewayHandler({
    verifyIdToken: async () => ({ uid: "verified-user" }),
    policyService: {
      authorize: async () => { policyCalls += 1; return { allowed: true }; },
      consumeRateLimit: async () => { policyCalls += 1; return { allowed: true }; },
    },
    idempotencyStore: createMemoryIdempotencyStore(),
    getProvider: async () => { providerCalls += 1; return { execute: async () => ({}) }; },
  });
  const response = await invoke(handler, sequenceGatewayRequest());
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error.code, "operation_deferred");
  assert.equal(policyCalls, 0);
  assert.equal(providerCalls, 0);
});

test("posture interpretation and result-card generation stop before policy, quota, or provider execution", async () => {
  let policyCalls = 0;
  let providerCalls = 0;
  const handler = createAIGatewayHandler({
    verifyIdToken: async () => ({ uid: "verified-user" }),
    policyService: {
      authorize: async () => { policyCalls += 1; return { allowed: true }; },
      consumeRateLimit: async () => { policyCalls += 1; return { allowed: true }; },
    },
    idempotencyStore: createMemoryIdempotencyStore(),
    getProvider: async () => { providerCalls += 1; return { execute: async () => ({}) }; },
  });
  for (const operation of ["analyzeBody", "generateReport"]) {
    const response = await invoke(handler, postureGatewayRequest(operation));
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.error.code, "operation_deferred");
  }
  assert.equal(policyCalls, 0);
  assert.equal(providerCalls, 0);
});

test("successful request logs the actual response model with its request id", async () => {
  const logs = [];
  const originalInfo = globalThis.console.info;
  globalThis.console.info = (message, details) => logs.push({ message, details });
  try {
    const handler = createAIGatewayHandler({
      verifyIdToken: async () => ({ uid: "verified-user" }),
      policyService: {
        authorize: async () => ({ allowed: true, memberName: "" }),
        consumeRateLimit: async () => ({ allowed: true }),
      },
      idempotencyStore: createMemoryIdempotencyStore(),
      getProvider: async () => ({ execute: async () => ({
        model: "gpt-5-mini-2026-08-07",
        promptVersion: "voice_v1",
        status: "completed",
        incompleteReason: "",
        usage: { inputTokens: 90, outputTokens: 40, reasoningTokens: 10, totalTokens: 130 },
        latencyMs: 842,
        validation: "success",
        output: voiceOutput,
      }) }),
    });
    const response = await invoke(handler);
    assert.equal(response.statusCode, 200);
    const modelLog = logs.find((entry) => entry.message.includes("model_call_succeeded"));
    const completionLog = logs.find((entry) => entry.message.includes("gateway_completed"));
    assert.equal(modelLog.details.model, "gpt-5-mini-2026-08-07");
    assert.equal(modelLog.details.requestId, response.body.requestId);
    assert.equal(modelLog.details.promptVersion, "voice_v1");
    assert.equal(modelLog.details.status, "completed");
    assert.deepEqual(modelLog.details.usage, { input: 90, output: 40, reasoning: 10 });
    assert.equal(modelLog.details.latencyMs, 842);
    assert.equal(modelLog.details.validation, "success");
    assert.equal(completionLog.details.model, "gpt-5-mini-2026-08-07");
    assert.equal(completionLog.details.requestId, response.body.requestId);
    assert.equal(completionLog.details.promptVersion, "voice_v1");
    assert.equal(completionLog.details.status, "completed");
    assert.deepEqual(completionLog.details.usage, { input: 90, output: 40, reasoning: 10 });
    assert.equal(completionLog.details.latencyMs, 842);
    assert.equal(response.body.usage.reasoningTokens, 10);
  } finally {
    globalThis.console.info = originalInfo;
  }
});

test("audio operation uses the authorized member name and never logs audio or transcript content", async () => {
  let providerInput;
  const logs = [];
  const originalInfo = globalThis.console.info;
  globalThis.console.info = (message, details) => logs.push({ message, details });
  try {
    const handler = createAIGatewayHandler({
      verifyIdToken: async () => ({ uid: "verified-user" }),
      policyService: {
        authorize: async () => ({ allowed: true, memberName: "김지민" }),
        consumeRateLimit: async () => ({ allowed: true }),
      },
      idempotencyStore: createMemoryIdempotencyStore(),
      getProvider: async () => ({ executeAudio: async ({ input, onDiagnostic }) => {
        providerInput = input;
        onDiagnostic("AUDIO_STT_STARTED", { elapsedMs: 0 });
        onDiagnostic("AUDIO_STT_SUCCEEDED", { elapsedMs: 12 });
        onDiagnostic("AUDIO_STRUCTURE_STARTED", { elapsedMs: 12 });
        onDiagnostic("AUDIO_STRUCTURE_SUCCEEDED", { elapsedMs: 20 });
        return {
          model: "gpt-5-mini-2025-08-07",
          promptVersion: "lesson_record_v3",
          status: "completed",
          transcriptionModel: "gpt-4o-mini-transcribe",
          output: {
            transcript: "민감한 전사 원문",
            result: "ok",
            fields: { didToday: [], observations: [], responses: [], nextFocus: [] },
            summary: null,
            speechSeconds: 2.8,
            confidence: 0.9,
            flags: [],
            provenance: { stt: "openai", llm: "openai" },
          },
        };
      } }),
    });
    const response = await invoke(handler, audioGatewayRequest());
    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(providerInput).sort(), ["audio", "audioMetrics", "clipId", "language", "memberName"]);
    assert.equal(providerInput.memberName, "김지민");
    assert.equal(providerInput.language, "ko");
    const logText = JSON.stringify(logs);
    assert.equal(logText.includes("민감한 전사 원문"), false);
    assert.equal(logText.includes(providerInput.audio), false);
    assert.equal(logText.includes("김지민"), false);
    assert.deepEqual(logs.filter((entry) => /AUDIO_(?:STT|STRUCTURE)_/.test(entry.message)).map((entry) => entry.message.split(" ").at(-1)), [
      "AUDIO_STT_STARTED", "AUDIO_STT_SUCCEEDED", "AUDIO_STRUCTURE_STARTED", "AUDIO_STRUCTURE_SUCCEEDED",
    ]);
  } finally {
    globalThis.console.info = originalInfo;
  }
});
