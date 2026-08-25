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
    this.requestId = options.requestId ?? null;
    this.path = options.path ?? options.cause?.path ?? null;
    this.expected = options.expected ?? options.cause?.expected ?? null;
    this.received = options.received ?? options.cause?.received ?? null;
    this.failureStage = options.failureStage ?? options.cause?.failureStage ?? null;
    this.providerStatus = options.providerStatus ?? options.cause?.providerStatus ?? null;
    this.providerCode = options.providerCode ?? options.cause?.providerCode ?? null;
    this.providerType = options.providerType ?? options.cause?.providerType ?? null;
    this.transportCode = options.transportCode ?? options.cause?.transportCode ?? null;
    this.gatewayUrl = options.gatewayUrl ?? options.cause?.gatewayUrl ?? null;
    this.causeName = options.causeName ?? options.cause?.causeName ?? null;
    this.causeMessage = options.causeMessage ?? options.cause?.causeMessage ?? null;
  }
}

const safeNetworkText = (value, max = 180) => String(value || "")
  .replace(/[\r\n\t]+/g, " ")
  .replace(/Bearer\s+\S+/gi, "Bearer_[redacted]")
  .replace(/sk-[A-Za-z0-9_-]+/g, "sk_[redacted]")
  .slice(0, max);

export const bindFetchToEnvironment = (fetchImpl, target = globalThis) => {
  const candidate = fetchImpl || target?.fetch;
  if (typeof candidate !== "function") return candidate;
  return candidate === target?.fetch ? candidate.bind(target) : candidate;
};

const isFetchInvocationError = (error) => {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "");
  return name === "typeerror" && /illegal invocation|failed to execute ['"]?fetch['"]? on ['"]?window/i.test(message);
};

const resolveGatewayUrl = (rawUrl) => {
  const base = globalThis.location?.origin || "http://localhost";
  const url = new URL(rawUrl, base);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new AIProviderError("invalid_gateway_url", "AI Gateway must use HTTPS outside localhost");
  }
  return url.toString();
};

export const gatewayUrlForDiagnostics = (rawUrl) => {
  if (!String(rawUrl || "").trim()) return "";
  try {
    const url = new URL(String(rawUrl || ""), globalThis.location?.origin || "http://localhost");
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return safeNetworkText(rawUrl, 500).replace(/\/\/[^/@]+@/, "//[redacted]@").split(/[?#]/)[0];
  }
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
  constructor({ providerId, enabled = false, gatewayUrl = "", fetchImpl = null, getAccessToken = null, timeoutMs = 30000 }) {
    super(providerId);
    this.enabled = enabled === true;
    this.gatewayUrl = String(gatewayUrl || "").trim();
    this.fetchImpl = bindFetchToEnvironment(fetchImpl);
    this.getAccessToken = getAccessToken;
    this.timeoutMs = timeoutMs;
  }

  getStatus() {
    return {
      status: this.enabled && this.gatewayUrl && typeof this.fetchImpl === "function" ? "connected" : AI_STATUSES.NOT_CONNECTED,
      provider: this.providerId,
      gatewayUrl: gatewayUrlForDiagnostics(this.gatewayUrl),
    };
  }

  async execute(operation, input, options = {}) {
    if (this.getStatus().status !== "connected") {
      return { status: AI_STATUSES.NOT_CONNECTED, provider: this.providerId, operation, output: null };
    }
    const requestId = options.requestId || makeAIRequestId(this.providerId, operation, input);
    const diagnosticGatewayUrl = gatewayUrlForDiagnostics(this.gatewayUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener?.("abort", abortFromCaller, { once: true });
    const requestBody = JSON.stringify({
      schemaVersion: 1,
      requestId,
      provider: this.providerId,
      operation,
      input,
    });
    try {
      let response = null;
      for (let authAttempt = 0; authAttempt < 2; authAttempt += 1) {
        const token = this.getAccessToken ? await this.getAccessToken(authAttempt === 1) : "";
        if (this.getAccessToken && !String(token || "").trim()) {
          if (authAttempt === 0) continue;
          throw new AIProviderError("auth_refresh_failed", "Firebase authentication could not be refreshed", { retryable: false, failureStage: "auth_refresh", gatewayUrl: diagnosticGatewayUrl });
        }
        const headers = { "Content-Type": "application/json", "X-Idempotency-Key": requestId };
        if (token) headers.Authorization = `Bearer ${token}`;
        response = await this.fetchImpl(resolveGatewayUrl(this.gatewayUrl), {
          method: "POST",
          credentials: "omit",
          headers,
          body: requestBody,
          signal: controller.signal,
        });
        if (response.status !== 401 || authAttempt === 1 || !this.getAccessToken) break;
      }
      if (!response.ok) {
        let errorCode = "gateway_error";
        let errorRequestId = requestId;
        let diagnostic = null;
        try {
          const errorPayload = await response.json();
          if (typeof errorPayload?.error?.code === "string") errorCode = errorPayload.error.code;
          if (typeof errorPayload?.error?.requestId === "string") errorRequestId = errorPayload.error.requestId;
          if (errorPayload?.error?.diagnostic && typeof errorPayload.error.diagnostic === "object") diagnostic = errorPayload.error.diagnostic;
        } catch (_error) {
          // A non-JSON gateway failure remains a generic, non-sensitive error.
        }
        const providerCode = String(diagnostic?.providerCode || "");
        const quotaExhausted = Number(diagnostic?.providerStatus) === 429 && providerCode === "insufficient_quota";
        const exhaustedAuthRefresh = response.status === 401 && Boolean(this.getAccessToken);
        throw new AIProviderError(quotaExhausted ? "provider_quota_exhausted" : exhaustedAuthRefresh ? "auth_refresh_failed" : errorCode, `AI Gateway request failed (${response.status})`, {
          status: response.status,
          requestId: errorRequestId,
          retryable: !quotaExhausted && (response.status === 429 || response.status >= 500),
          transportCode: `E-HTTP-${response.status}`,
          gatewayUrl: diagnosticGatewayUrl,
          failureStage: exhaustedAuthRefresh ? "auth_refresh" : String(diagnostic?.stage || "gateway_http"),
          providerStatus: Number(diagnostic?.providerStatus) || null,
          providerCode,
          providerType: String(diagnostic?.providerType || ""),
        });
      }
      const payload = await response.json();
      if (payload?.requestId && payload.requestId !== requestId) throw new AIProviderError("request_mismatch", "AI Gateway response requestId mismatch", { requestId, gatewayUrl: diagnosticGatewayUrl });
      if (payload?.provider && payload.provider !== this.providerId) throw new AIProviderError("provider_mismatch", "AI Gateway response provider mismatch", { requestId, gatewayUrl: diagnosticGatewayUrl });
      let output;
      try { output = normalizeAIOutput(operation, normalizeGatewayPayload(operation, payload)); }
      catch (error) { throw new AIProviderError("invalid_output", "AI Gateway returned an invalid structured output", { cause: error, requestId, retryable: true, failureStage: "client_schema_validation", path: error?.path, expected: error?.expected, received: error?.received, gatewayUrl: diagnosticGatewayUrl }); }
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
        gatewayUrl: diagnosticGatewayUrl,
        output,
      };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error?.name === "AbortError") throw new AIProviderError("timeout", "AI Gateway request timed out", {
        retryable: true, cause: error, requestId, transportCode: "E-TIMEOUT", gatewayUrl: diagnosticGatewayUrl,
        causeName: safeNetworkText(error?.name || "AbortError", 80), causeMessage: safeNetworkText(error?.message),
      });
      if (isFetchInvocationError(error)) throw new AIProviderError("client_invocation_error", "AI Gateway client invocation failed", {
        retryable: false, cause: error, requestId, failureStage: "fetch_internal", transportCode: "E-INTERNAL", gatewayUrl: diagnosticGatewayUrl,
        causeName: safeNetworkText(error?.name || "TypeError", 80), causeMessage: safeNetworkText(error?.message),
      });
      throw new AIProviderError("network_error", "AI Gateway request failed", {
        retryable: true, cause: error, requestId, failureStage: "fetch_network", transportCode: "E-NETWORK", gatewayUrl: diagnosticGatewayUrl,
        causeName: safeNetworkText(error?.name || "Error", 80), causeMessage: safeNetworkText(error?.message || String(error || "network failure")),
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener?.("abort", abortFromCaller);
    }
  }
}
