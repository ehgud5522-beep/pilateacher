import { AI_STATUSES } from "../../ai/contracts.js";
import { validateStructuredOutput } from "./record-schema.js";

export class LlmProvider {
  async structureLessonRecord(_input, _options) {
    throw new Error("structureLessonRecord() must be implemented");
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryable = (error) => error?.retryable === true || ["timeout", "network_error", "provider_unavailable", "invalid_output"].includes(String(error?.code || ""));

export class GatewayLlmProvider extends LlmProvider {
  constructor({ gatewayProvider, maxRetries = 1, retryDelayMs = 250, online = () => globalThis.navigator?.onLine !== false } = {}) {
    super();
    this.gatewayProvider = gatewayProvider;
    this.maxRetries = Math.max(0, Math.min(1, Number(maxRetries) || 0));
    this.retryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
    this.online = online;
  }

  async structureLessonRecord(input, options = {}) {
    const startedAt = Date.now();
    if (!this.online()) return { status: "queued", reason: "offline", attempts: 0, latencyMs: 0, output: null, usage: null };
    let lastError = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
      attempts = attempt;
      try {
        const result = await this.gatewayProvider.structureLessonRecord(input, options);
        if (result?.status === AI_STATUSES.NOT_CONNECTED) return { status: "unstructured", reason: "not_connected", attempts: attempt, latencyMs: Date.now() - startedAt, output: null, usage: null };
        return {
          status: "structured",
          attempts: attempt,
          latencyMs: Date.now() - startedAt,
          output: validateStructuredOutput(result.output),
          usage: result.usage || null,
          meta: result,
        };
      } catch (error) {
        lastError = error;
        if (attempt > this.maxRetries || !retryable(error)) break;
        if (this.retryDelayMs) await sleep(this.retryDelayMs * attempt);
      }
    }
    return {
      status: "unstructured",
      reason: String(lastError?.code || "llm_failed"),
      attempts,
      latencyMs: Date.now() - startedAt,
      output: null,
      usage: null,
      error: lastError,
    };
  }
}
