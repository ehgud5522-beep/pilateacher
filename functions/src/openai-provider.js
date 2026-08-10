"use strict";

const OpenAI = require("openai");
const { GatewayError } = require("./errors");

const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_TIMEOUT_MS = 25000;

const VOICE_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    todayExercises: { type: "array", items: { type: "string" }, maxItems: 20 },
    memberCondition: { type: "string" },
    painOrDiscomfort: { type: "string" },
    improvements: { type: "string" },
    nextGoal: { type: "string" },
    homework: { type: "string" },
    cautions: { type: "string" },
  },
  required: [
    "todayExercises",
    "memberCondition",
    "painOrDiscomfort",
    "improvements",
    "nextGoal",
    "homework",
    "cautions",
  ],
});

const SYSTEM_INSTRUCTIONS = [
  "당신은 필라테스 강사의 수업 전사 원문을 간결한 수업 기록 초안으로 정리합니다.",
  "의료 진단을 하거나 전사 원문에 없는 통증, 질환, 수술, 개인정보, 운동 또는 결과를 추측하지 마세요.",
  "정보가 없으면 문자열은 빈 문자열, 배열은 빈 배열로 반환하세요.",
  "의학적 판단이 필요한 표현은 생성하지 말고 관찰된 발언만 중립적으로 요약하세요.",
  "반드시 지정된 JSON 스키마만 반환하세요.",
].join("\n");

const RESULT_STRING_FIELDS = Object.freeze([
  "memberCondition",
  "painOrDiscomfort",
  "improvements",
  "nextGoal",
  "homework",
  "cautions",
]);

function validateVoiceSummaryResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GatewayError("invalid_output");
  const expectedFields = new Set(["todayExercises", ...RESULT_STRING_FIELDS]);
  const keys = Object.keys(value);
  if (keys.some((key) => !expectedFields.has(key)) || keys.length !== expectedFields.size) {
    throw new GatewayError("invalid_output");
  }
  if (!Array.isArray(value.todayExercises) || value.todayExercises.length > 20 || value.todayExercises.some((item) => typeof item !== "string" || item.length > 500)) {
    throw new GatewayError("invalid_output");
  }
  for (const field of RESULT_STRING_FIELDS) {
    if (typeof value[field] !== "string" || value[field].length > 4000) throw new GatewayError("invalid_output");
  }
  return {
    todayExercises: value.todayExercises.map((item) => item.trim()).filter(Boolean),
    ...Object.fromEntries(RESULT_STRING_FIELDS.map((field) => [field, value[field].trim()])),
  };
}

function readOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text;
  return "";
}

function mapProviderError(error) {
  if (error instanceof GatewayError) return error;
  if (error?.name === "AbortError" || error?.name === "APIConnectionTimeoutError" || error?.code === "ETIMEDOUT") {
    return new GatewayError("timeout", { cause: error });
  }
  return new GatewayError("provider_unavailable", { cause: error });
}

function createOpenAIVoiceSummaryProvider({ apiKey, model = DEFAULT_MODEL, client = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const normalizedModel = String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  if (!client && !String(apiKey || "").trim()) throw new GatewayError("provider_unavailable");
  const openai = client || new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 });

  return Object.freeze({
    provider: "openai",
    model: normalizedModel,
    async summarize({ transcript }) {
      const controller = new AbortController();
      let timer;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new GatewayError("timeout"));
          }, timeoutMs);
        });
        const response = await Promise.race([
          openai.responses.create({
            model: normalizedModel,
            instructions: SYSTEM_INSTRUCTIONS,
            input: `다음 필라테스 수업 전사 원문만 근거로 기록을 정리하세요.\n\n${transcript}`,
            text: {
              format: {
                type: "json_schema",
                name: "pilateacher_voice_summary",
                strict: true,
                schema: VOICE_SUMMARY_SCHEMA,
              },
            },
            max_output_tokens: 1200,
            store: false,
          }, { signal: controller.signal }),
          timeoutPromise,
        ]);
        const outputText = readOutputText(response);
        if (!outputText) throw new GatewayError("invalid_output");
        let parsed;
        try {
          parsed = JSON.parse(outputText);
        } catch (error) {
          throw new GatewayError("invalid_output", { cause: error });
        }
        return {
          model: String(response?.model || normalizedModel),
          result: validateVoiceSummaryResult(parsed),
        };
      } catch (error) {
        throw mapProviderError(error);
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

module.exports = {
  DEFAULT_MODEL,
  SYSTEM_INSTRUCTIONS,
  VOICE_SUMMARY_SCHEMA,
  createOpenAIVoiceSummaryProvider,
  validateVoiceSummaryResult,
};
