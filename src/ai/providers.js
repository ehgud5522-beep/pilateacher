import { AI_PROVIDERS } from "./contracts.js";
import { GatewayAIProvider } from "./gateway-provider.js";

export class OpenAIProvider extends GatewayAIProvider {
  constructor(options = {}) { super({ ...options, providerId: AI_PROVIDERS.OPENAI }); }
}

export class GeminiProvider extends GatewayAIProvider {
  constructor(options = {}) { super({ ...options, providerId: AI_PROVIDERS.GEMINI }); }
}

export class AnthropicProvider extends GatewayAIProvider {
  constructor(options = {}) { super({ ...options, providerId: AI_PROVIDERS.ANTHROPIC }); }
}

export const providerClasses = Object.freeze({
  [AI_PROVIDERS.OPENAI]: OpenAIProvider,
  [AI_PROVIDERS.GEMINI]: GeminiProvider,
  [AI_PROVIDERS.ANTHROPIC]: AnthropicProvider,
});
