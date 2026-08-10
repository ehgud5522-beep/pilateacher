"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMemoryIdempotencyStore } = require("../src/idempotency");
const { createDisabledPolicyService } = require("../src/policy");
const { createVoiceSummaryHandler, MAX_TRANSCRIPT_LENGTH } = require("../src/voice-summary");
const { createRequest, createResponse, validResult } = require("./helpers");

function createPolicy({ consent = true, rate = true } = {}) {
  return {
    async checkConsent() { return { allowed: consent }; },
    async checkRateLimit() { return { allowed: rate, retryAfterSeconds: 30 }; },
  };
}

function createHandler(overrides = {}) {
  return createVoiceSummaryHandler({
    verifyIdToken: async () => ({ uid: "verified-user" }),
    policyService: createPolicy(),
    idempotencyStore: createMemoryIdempotencyStore(),
    summarizeVoice: async () => ({ model: "gpt-5-mini", result: validResult }),
    ...overrides,
  });
}

async function invoke(handler, request = createRequest()) {
  const response = createResponse();
  await handler(request, response);
  return response;
}

test("voice summary accepts only POST and requires Firebase authentication", async () => {
  const handler = createHandler();
  const methodResponse = await invoke(handler, createRequest({ method: "GET" }));
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.body.error.code, "invalid_request");

  const authResponse = await invoke(handler, createRequest({ headers: {} }));
  assert.equal(authResponse.statusCode, 401);
  assert.equal(authResponse.body.error.code, "unauthenticated");
});

test("request validation enforces identifiers, transcript limit, and idempotency key", async () => {
  const handler = createHandler();
  const cases = [
    { lessonId: "", memberId: "member-1", transcript: "valid", idempotencyKey: "idem-valid-1" },
    { lessonId: "lesson-1", memberId: "member-1", transcript: "x".repeat(MAX_TRANSCRIPT_LENGTH + 1), idempotencyKey: "idem-valid-2" },
    { lessonId: "lesson-1", memberId: "member-1", transcript: "valid", idempotencyKey: "short" },
  ];
  for (const body of cases) {
    const response = await invoke(handler, createRequest({ body }));
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error.code, "invalid_request");
  }
});

test("disabled production policy never treats missing consent data as true", async () => {
  let providerCalls = 0;
  const handler = createHandler({
    policyService: createDisabledPolicyService(),
    summarizeVoice: async () => { providerCalls += 1; return { model: "gpt-5-mini", result: validResult }; },
  });
  const response = await invoke(handler);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error.code, "consent_required");
  assert.equal(providerCalls, 0);
});

test("rate limit denial happens before the provider call", async () => {
  let providerCalls = 0;
  const handler = createHandler({
    policyService: createPolicy({ rate: false }),
    summarizeVoice: async () => { providerCalls += 1; return { model: "gpt-5-mini", result: validResult }; },
  });
  const response = await invoke(handler);
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["Retry-After"], "30");
  assert.equal(providerCalls, 0);
});

test("successful response has the required public contract", async () => {
  const response = await invoke(createHandler());
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.deepEqual(response.body, {
    requestId: "idem-voice-0001",
    operation: "voice_summary",
    provider: "openai",
    model: "gpt-5-mini",
    result: validResult,
  });
});

test("the existing GatewayAIProvider envelope is accepted for voice summary", async () => {
  const body = {
    schemaVersion: 1,
    requestId: "ai_openai_summarizeVoice_12345678",
    provider: "openai",
    operation: "summarizeVoice",
    input: { lessonId: "lesson-1", memberId: "member-1", transcript: "호흡 수업" },
  };
  const response = await invoke(createHandler(), createRequest({
    headers: { authorization: "Bearer valid-token", "x-idempotency-key": body.requestId },
    body,
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.requestId, body.requestId);
});

test("idempotent retries return the same response and call OpenAI once", async () => {
  let providerCalls = 0;
  const handler = createHandler({
    summarizeVoice: async () => {
      providerCalls += 1;
      return { model: "gpt-5-mini", result: validResult };
    },
  });
  const first = await invoke(handler);
  const second = await invoke(handler);
  assert.equal(providerCalls, 1);
  assert.deepEqual(second.body, first.body);
});

test("reusing an idempotency key with different content is rejected", async () => {
  const handler = createHandler();
  assert.equal((await invoke(handler)).statusCode, 200);
  const response = await invoke(handler, createRequest({ body: {
    lessonId: "lesson-1",
    memberId: "member-1",
    transcript: "다른 전사 원문",
    idempotencyKey: "idem-voice-0001",
  } }));
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, "invalid_request");
});

test("invalid provider output and failures never echo the transcript", async () => {
  const sensitiveTranscript = "민감한 회원 발언 원문";
  const handler = createHandler({ summarizeVoice: async () => ({ model: "gpt-5-mini", result: {} }) });
  const response = await invoke(handler, createRequest({ body: {
    lessonId: "lesson-1",
    memberId: "member-1",
    transcript: sensitiveTranscript,
    idempotencyKey: "idem-sensitive-1",
  } }));
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error.code, "invalid_output");
  assert.equal(JSON.stringify(response.body).includes(sensitiveTranscript), false);
});
