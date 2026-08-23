import { AIProvider } from "./provider.js";
import { AI_OPERATIONS, AI_STATUSES, normalizeAIOutput } from "./contracts.js";

let fallbackRequestSequence = 0;
const requestNonce = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID().replace(/-/g, "");
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  fallbackRequestSequence += 1;
  const seed = `${Date.now().toString(16)}${fallbackRequestSequence.toString(16).padStart(8, "0")}${Math.random().toString(16).slice(2)}`;
  return seed.padEnd(32, "0").slice(0, 32);
};

const idPart = (value) => String(value || "").replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 40);
export const makeAIRequestId = (provider, operation, _input) => `ai_${idPart(provider)}_${idPart(operation)}_${requestNonce()}`.slice(0, 160);

export class AIProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "AIProviderError";
    this.code = code;
    this.retryable = !!options.retryable;
    this.status = options.status ?? null;
  }
}

const resolveGatewayUrl = (rawUrl) => {
  const base = globalThis.location?.origin || "http://localhost";
  const url = new URL(rawUrl, base);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new AIProviderError("invalid_gateway_url", "AI Gateway must use HTTPS outside localhost");
  }
  return url.toString();
};

const optionalList = (value) => {
  const text = String(value || "").trim();
  return text ? [text] : [];
};

const normalizeGatewayPayload = (operation, payload) => {
  if (operation !== AI_OPERATIONS.SUMMARIZE_VOICE || !payload?.result) return payload?.output;
  return {
    todayExercises: payload.result.todayExercises,
    memberCondition: payload.result.memberCondition,
    pain: optionalList(payload.result.painOrDiscomfort),
    improvements: optionalList(payload.result.improvements),
    nextGoals: optionalList(payload.result.nextGoal),
    homework: optionalList(payload.result.homework),
    precautions: optionalList(payload.result.cautions),
  };
};

export class GatewayAIProvider extends AIProvider {
  constructor({ providerId, enabled = false, gatewayUrl = "", fetchImpl = globalThis.fetch, getAccessToken = null, timeoutMs = 30000 }) {
    super(providerId);
    this.enabled = enabled === true;
    this.gatewayUrl = String(gatewayUrl || "").trim();
    this.fetchImpl = fetchImpl;
    this.getAccessToken = getAccessToken;
    this.timeoutMs = timeoutMs;
  }

  getStatus() {
    return {
      status: this.enabled && this.gatewayUrl && typeof this.fetchImpl === "function" ? "connected" : AI_STATUSES.NOT_CONNECTED,
      provider: this.providerId,
    };
  }

  async execute(operation, input, options = {}) {
    if (this.getStatus().status !== "connected") {
      return { status: AI_STATUSES.NOT_CONNECTED, provider: this.providerId, operation, output: null };
    }
    const requestId = options.requestId || makeAIRequestId(this.providerId, operation, input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener?.("abort", abortFromCaller, { once: true });
    const headers = { "Content-Type": "application/json", "X-Idempotency-Key": requestId };
    try {
      const token = this.getAccessToken ? await this.getAccessToken() : "";
      if (this.getAccessToken && !String(token || "").trim()) {
        throw new AIProviderError("unauthenticated", "Firebase authentication is required for AI Gateway requests");
      }
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await this.fetchImpl(resolveGatewayUrl(this.gatewayUrl), {
        method: "POST",
        credentials: "omit",
        headers,
        body: JSON.stringify({
          schemaVersion: 1,
          requestId,
          provider: this.providerId,
          operation,
          input,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let errorCode = "gateway_error";
        try {
          const errorPayload = await response.json();
          if (typeof errorPayload?.error?.code === "string") errorCode = errorPayload.error.code;
        } catch (_error) {
          // A non-JSON gateway failure remains a generic, non-sensitive error.
        }
        throw new AIProviderError(errorCode, `AI Gateway request failed (${response.status})`, { status: response.status, retryable: response.status === 429 || response.status >= 500 });
      }
      const payload = await response.json();
      if (payload?.requestId && payload.requestId !== requestId) throw new AIProviderError("request_mismatch", "AI Gateway response requestId mismatch");
      if (payload?.provider && payload.provider !== this.providerId) throw new AIProviderError("provider_mismatch", "AI Gateway response provider mismatch");
      let output;
      try { output = normalizeAIOutput(operation, normalizeGatewayPayload(operation, payload)); }
      catch (error) { throw new AIProviderError("invalid_output", "AI Gateway returned an invalid structured output", { cause: error }); }
      return {
        status: AI_STATUSES.DRAFT,
        provider: payload?.provider || this.providerId,
        operation,
        requestId,
        model: String(payload?.model || ""),
        modelVersion: String(payload?.modelVersion || ""),
        promptVersion: String(payload?.promptVersion || ""),
        pipelineVersion: String(payload?.pipelineVersion || ""),
        createdAt: String(payload?.createdAt || new Date().toISOString()),
        usage: payload?.usage && typeof payload.usage === "object" ? {
          inputTokens: Math.max(0, Number(payload.usage.inputTokens) || 0),
          outputTokens: Math.max(0, Number(payload.usage.outputTokens) || 0),
          totalTokens: Math.max(0, Number(payload.usage.totalTokens) || 0),
        } : null,
        output,
      };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error?.name === "AbortError") throw new AIProviderError("timeout", "AI Gateway request timed out", { retryable: true, cause: error });
      throw new AIProviderError("network_error", "AI Gateway request failed", { retryable: true, cause: error });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener?.("abort", abortFromCaller);
    }
  }
}
