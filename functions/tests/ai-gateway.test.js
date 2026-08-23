"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAIGatewayHandler } = require("../src/ai-gateway");
const { GatewayError } = require("../src/errors");
const { createMemoryIdempotencyStore } = require("../src/idempotency");
const { createRequest, createResponse } = require("./helpers");

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
    policyService: { authorize: async () => ({ allowed: false }), consumeRateLimit: async () => ({ allowed: true }) },
    idempotencyStore: createMemoryIdempotencyStore(),
    getProvider: async () => { getProviderCalls += 1; return {}; },
  });
  const deniedResponse = await invoke(denied);
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(deniedResponse.body.error.code, "consent_required");
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
