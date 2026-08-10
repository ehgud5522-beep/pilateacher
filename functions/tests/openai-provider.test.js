"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_MODEL,
  createOpenAIVoiceSummaryProvider,
  validateVoiceSummaryResult,
} = require("../src/openai-provider");
const { validResult } = require("./helpers");

test("OpenAI provider uses Responses API structured output without storing the response", async () => {
  let params;
  let options;
  const provider = createOpenAIVoiceSummaryProvider({
    client: {
      responses: {
        create: async (nextParams, nextOptions) => {
          params = nextParams;
          options = nextOptions;
          return { model: DEFAULT_MODEL, output_text: JSON.stringify(validResult) };
        },
      },
    },
  });
  const response = await provider.summarize({ transcript: "브리지와 호흡을 진행했다." });
  assert.equal(params.model, "gpt-5-mini");
  assert.equal(params.store, false);
  assert.equal(params.text.format.type, "json_schema");
  assert.equal(params.text.format.strict, true);
  assert.equal(params.text.format.schema.additionalProperties, false);
  assert.ok(options.signal);
  assert.deepEqual(response.result, validResult);
});

test("OpenAI provider rejects malformed or invented-shaped output", async () => {
  const provider = createOpenAIVoiceSummaryProvider({
    client: { responses: { create: async () => ({ output_text: JSON.stringify({ diagnosis: "임의 진단" }) }) } },
  });
  await assert.rejects(provider.summarize({ transcript: "기록" }), (error) => error.code === "invalid_output");
  assert.throws(() => validateVoiceSummaryResult({ ...validResult, extra: "not allowed" }), (error) => error.code === "invalid_output");
});

test("OpenAI provider timeout is returned as the public timeout code", async () => {
  const provider = createOpenAIVoiceSummaryProvider({
    timeoutMs: 5,
    client: { responses: { create: async () => new Promise(() => {}) } },
  });
  await assert.rejects(provider.summarize({ transcript: "기록" }), (error) => error.code === "timeout");
});

test("provider errors do not expose provider messages", async () => {
  const provider = createOpenAIVoiceSummaryProvider({
    client: { responses: { create: async () => { throw new Error("secret transcript and key details"); } } },
  });
  await assert.rejects(
    provider.summarize({ transcript: "민감한 원문" }),
    (error) => error.code === "provider_unavailable" && !error.publicMessage.includes("secret"),
  );
});

test("missing Secret Manager value fails safely before an API request", () => {
  assert.throws(
    () => createOpenAIVoiceSummaryProvider({ apiKey: "" }),
    (error) => error.code === "provider_unavailable",
  );
});
