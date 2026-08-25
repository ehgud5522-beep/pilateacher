import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AI_STATUSES,
  buildBodyAnalysisInput,
  buildReportInput,
  buildVoiceSummaryInput,
  createAIProvider,
  makeAIRequestId,
} from "../../src/ai/index.js";

const bodyOutput = {
  bodyCharacteristics: ["흉곽 회전 경향"], asymmetries: ["오른쪽 어깨 높이 차이"],
  pelvis: "전방 경사 경향", thorax: "회전 경향", scapula: "좌우 차이", head: "전방 이동 경향", knees: "중립", feet: "중립",
  recommendedExercises: ["호흡 기반 흉곽 가동성"], precautions: ["통증 발생 시 중단"],
};

test("production config uses Vite's statically replaceable import.meta.env access", async () => {
  const source = await readFile(new URL("../../src/ai/index.js", import.meta.url), "utf8");
  assert.match(source, /VITE_AI_ENABLED: import\.meta\.env\.VITE_AI_ENABLED/);
  assert.match(source, /VITE_AI_PROVIDER: import\.meta\.env\.VITE_AI_PROVIDER/);
  assert.match(source, /VITE_AI_GATEWAY_URL: import\.meta\.env\.VITE_AI_GATEWAY_URL/);
  assert.doesNotMatch(source, /const runtimeEnv = import\.meta\.env/);
});

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

test("each user action gets a new opaque idempotency key", () => {
  const first = makeAIRequestId("anthropic", "summarizeVoice", { lessonId: "l1", transcript: "기록" });
  const second = makeAIRequestId("anthropic", "summarizeVoice", { transcript: "기록", lessonId: "l1" });
  assert.notEqual(first, second);
  assert.match(first, /^ai_anthropic_summarizeVoice_[a-f0-9]{32}$/);
  assert.equal(first.includes("기록"), false);
});

test("an explicit request id is preserved for a real network retry", async () => {
  const ids = [];
  const provider = createAIProvider({
    env: { VITE_AI_ENABLED: "true", VITE_AI_PROVIDER: "openai", VITE_AI_GATEWAY_URL: "https://ai.example.com/v1/ai/execute" },
    getAccessToken: async () => "firebase-token",
    fetchImpl: async (_url, request) => {
      ids.push(JSON.parse(request.body).requestId);
      return { ok: true, json: async () => ({ provider: "openai", output: bodyOutput }) };
    },
  });
  const requestId = "ai_openai_analyzeBody_retry12345678";
  await provider.analyzeBody({ memberId: "m1", views: [] }, { requestId });
  await provider.analyzeBody({ memberId: "m1", views: [] }, { requestId });
  assert.deepEqual(ids, [requestId, requestId]);
});

test("configured Firebase authentication refreshes once then fails closed before fetch when its token stays empty", async () => {
  let calls = 0;
  const tokenRefreshes = [];
  const provider = createAIProvider({
    config: { enabled: true, provider: "openai", gatewayUrl: "https://ai.example.com/v1/ai/execute" },
    getAccessToken: async (force) => { tokenRefreshes.push(force); return ""; },
    fetchImpl: async () => { calls += 1; },
  });
  await assert.rejects(provider.analyzeBody({ memberId: "m1", views: [] }), (error) => (/** @type {any} */ (error)).code === "auth_refresh_failed");
  assert.deepEqual(tokenRefreshes, [false, true]);
  assert.equal(calls, 0);
});

test("network failures preserve the exact sanitized Gateway URL and have no HTTP status", async () => {
  const gatewayUrl = "https://asia-northeast3-pilateacher.cloudfunctions.net/aiGateway/v1/ai/execute";
  const provider = createAIProvider({
    config: { enabled: true, provider: "openai", gatewayUrl },
    getAccessToken: async () => "firebase-token",
    fetchImpl: async () => { throw new TypeError("Failed to fetch"); },
  });
  assert.equal(provider.getStatus().gatewayUrl, gatewayUrl);
  await assert.rejects(provider.structureLessonRecord({ memberId: "m1", lessonId: "l1", rawTranscript: "기록" }), (error) => {
    const actual = /** @type {any} */ (error);
    return actual.code === "network_error"
      && actual.status === null
      && actual.failureStage === "fetch_network"
      && actual.transportCode === "E-NETWORK"
      && actual.gatewayUrl === gatewayUrl
      && actual.causeName === "TypeError"
      && actual.causeMessage === "Failed to fetch";
  });
});

test("default browser fetch keeps its Window receiver when the provider stores and invokes it", async () => {
  const originalFetch = globalThis.fetch;
  let observedReceiver = null;
  globalThis.fetch = /** @type {typeof globalThis.fetch} */ (function receiverSensitiveFetch(_url, init) {
    observedReceiver = this;
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ requestId: init.headers["X-Idempotency-Key"], provider: "openai", output: bodyOutput }),
    });
  });
  try {
    const provider = createAIProvider({
      config: { enabled: true, provider: "openai", gatewayUrl: "https://ai.example.com/v1/ai/execute" },
      getAccessToken: async () => "firebase-token",
    });
    const result = await provider.analyzeBody({ memberId: "m1", views: [] });
    assert.equal(result.status, AI_STATUSES.DRAFT);
    assert.equal(observedReceiver, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetch Illegal invocation is an internal non-retryable defect, not a network failure", async () => {
  const provider = createAIProvider({
    config: { enabled: true, provider: "openai", gatewayUrl: "https://ai.example.com/v1/ai/execute" },
    getAccessToken: async () => "firebase-token",
    fetchImpl: async () => { throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"); },
  });
  await assert.rejects(provider.analyzeBody({ memberId: "m1", views: [] }), (error) => {
    const actual = /** @type {any} */ (error);
    return actual.code === "client_invocation_error"
      && actual.retryable === false
      && actual.failureStage === "fetch_internal"
      && actual.transportCode === "E-INTERNAL";
  });
});

test("an expired Firebase token is force-refreshed once with the same idempotency key", async () => {
  const tokenRefreshes = [];
  const requestIds = [];
  let calls = 0;
  const provider = createAIProvider({
    config: { enabled: true, provider: "openai", gatewayUrl: "https://ai.example.com/v1/ai/execute" },
    getAccessToken: async (force) => { tokenRefreshes.push(force); return force ? "fresh" : "expired"; },
    fetchImpl: async (_url, init) => {
      calls += 1;
      requestIds.push(JSON.parse(init.body).requestId);
      if (calls === 1) return { ok: false, status: 401, json: async () => ({ error: { code: "unauthenticated" } }) };
      return { ok: true, status: 200, json: async () => ({ requestId: requestIds[0], provider: "openai", model: "gpt-5-mini", promptVersion: "v1", output: { didToday: [], observations: [], responses: [], nextFocus: [], uncertain: [] } }) };
    },
  });
  const result = await provider.structureLessonRecord({ memberId: "m1", lessonId: "l1", rawTranscript: "기록" });
  assert.equal(result.status, AI_STATUSES.DRAFT);
  assert.deepEqual(tokenRefreshes, [false, true]);
  assert.equal(new Set(requestIds).size, 1);
});

test("an expired Firebase token becomes a non-retryable service failure after one unsuccessful refresh", async () => {
  const tokenRefreshes = [];
  let calls = 0;
  const provider = createAIProvider({
    config: { enabled: true, provider: "openai", gatewayUrl: "https://ai.example.com/v1/ai/execute" },
    getAccessToken: async (force) => { tokenRefreshes.push(force); return force ? "still-invalid" : "expired"; },
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 401, json: async () => ({ error: { code: "unauthenticated" } }) };
    },
  });
  await assert.rejects(provider.structureLessonRecord({ memberId: "m1", lessonId: "l1", rawTranscript: "기록" }), (error) => {
    const actual = /** @type {any} */ (error);
    return actual.code === "auth_refresh_failed" && actual.retryable === false && actual.failureStage === "auth_refresh";
  });
  assert.deepEqual(tokenRefreshes, [false, true]);
  assert.equal(calls, 2);
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

test("deferred sequence recommendation has no client convenience call path", async () => {
  for (const providerId of ["openai", "gemini", "anthropic"]) {
    const provider = createAIProvider({
      config: { enabled: true, provider: providerId, gatewayUrl: "https://ai.example.com/v1/execute" },
      fetchImpl: async () => { throw new Error("deferred operation must not reach fetch"); },
    });
    assert.equal(provider.recommendSequence, undefined);
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

test("provider quota diagnostics remain internal and disable identical retries", async () => {
  const provider = createAIProvider({
    config: { enabled: true, provider: "openai", gatewayUrl: "https://ai.example.com/v1/ai/execute" },
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: {
      code: "provider_unavailable",
      requestId: "ai_safe_request_12345678",
      diagnostic: { stage: "provider_http", providerStatus: 429, providerCode: "insufficient_quota", providerType: "insufficient_quota" },
    } }) }),
  });
  await assert.rejects(
    provider.structureLessonRecord({ rawTranscript: "원문" }),
    (error) => (/** @type {any} */ (error)).code === "provider_quota_exhausted"
      && (/** @type {any} */ (error)).retryable === false
      && (/** @type {any} */ (error)).failureStage === "provider_http"
      && (/** @type {any} */ (error)).providerStatus === 429
      && (/** @type {any} */ (error)).providerCode === "insufficient_quota"
      && (/** @type {any} */ (error)).transportCode === "E-HTTP-503"
      && (/** @type {any} */ (error)).gatewayUrl === "https://ai.example.com/v1/ai/execute",
  );
});

test("client builders bound text and remove direct PII before the gateway", () => {
  const voice = buildVoiceSummaryInput({
    memberId: "m1", lessonId: "l1", transcript: `${"x".repeat(13000)} 010-1234-5678 member@example.com`,
  });
  assert.equal(voice.transcript.length, 12000);
  assert.equal(voice.transcript.includes("010-1234-5678"), false);
  const redactedVoice = buildVoiceSummaryInput({ memberId: "m1", lessonId: "l1", transcript: "연락처 010-1234-5678 member@example.com" });
  assert.equal(redactedVoice.transcript.includes("010-1234-5678"), false);
  assert.equal(redactedVoice.transcript.includes("member@example.com"), false);

  const report = buildReportInput({
    reportType: "member_progress_message",
    memberId: "m1",
    source: {
      회원: "김지민",
      목표: "코어",
      수행능력: [{ name: "균형", now: 70 }],
      photo: "data:image/jpeg;base64,AAAA",
      unsupported: "drop",
    },
  });
  assert.equal(report.source.회원, undefined);
  assert.equal(report.source.photo, undefined);
  assert.equal(report.source.unsupported, undefined);
  assert.deepEqual(report.source.수행능력, [{ label: "균형", now: 70 }]);
});
