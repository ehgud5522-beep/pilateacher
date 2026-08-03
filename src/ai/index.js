import { AI_PROVIDERS } from "./contracts.js";
import { getFirebaseIdToken } from "./firebase-token.js";
import { providerClasses } from "./providers.js";

const enabledValue = (value) => String(value || "").trim().toLowerCase() === "true";

export function readAIConfig(env = {}) {
  const requestedProvider = String(env.VITE_AI_PROVIDER || AI_PROVIDERS.OPENAI).trim().toLowerCase();
  const supported = !!providerClasses[requestedProvider];
  return {
    enabled: enabledValue(env.VITE_AI_ENABLED) && supported,
    provider: supported ? requestedProvider : AI_PROVIDERS.OPENAI,
    gatewayUrl: String(env.VITE_AI_GATEWAY_URL || "").trim(),
  };
}

export function createAIProvider(options = {}) {
  const config = options.config || readAIConfig(options.env || {});
  const ProviderClass = providerClasses[config.provider] || providerClasses[AI_PROVIDERS.OPENAI];
  return new ProviderClass({
    enabled: config.enabled,
    gatewayUrl: config.gatewayUrl,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    getAccessToken: options.getAccessToken || null,
    timeoutMs: options.timeoutMs,
  });
}

const runtimeEnv = (/** @type {any} */ (import.meta)).env || {};
export const aiProvider = createAIProvider({ env: runtimeEnv, getAccessToken: getFirebaseIdToken });

export * from "./contracts.js";
export * from "./gateway-provider.js";
export * from "./input-builders.js";
