"use strict";

const ERROR_DEFINITIONS = Object.freeze({
  unauthenticated: { status: 401, message: "Authentication is required." },
  invalid_request: { status: 400, message: "The request is invalid." },
  consent_required: { status: 403, message: "AI usage consent is required." },
  operation_deferred: { status: 404, message: "The requested AI operation is deferred." },
  rate_limited: { status: 429, message: "The AI request limit has been reached." },
  provider_unavailable: { status: 503, message: "The AI provider is temporarily unavailable." },
  provider_incomplete: { status: 502, message: "The AI provider response was incomplete." },
  invalid_output: { status: 502, message: "The AI provider returned an invalid response." },
  timeout: { status: 504, message: "The AI request timed out." },
  internal_error: { status: 500, message: "An internal error occurred." },
});

class GatewayError extends Error {
  constructor(code, options = {}) {
    const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.internal_error;
    super(options.internalMessage || definition.message, options.cause ? { cause: options.cause } : undefined);
    this.name = "GatewayError";
    this.code = ERROR_DEFINITIONS[code] ? code : "internal_error";
    this.status = options.status || definition.status;
    this.publicMessage = options.publicMessage || definition.message;
    this.diagnostic = options.diagnostic && typeof options.diagnostic === "object"
      ? Object.freeze({ ...options.diagnostic })
      : null;
  }
}

function asGatewayError(error) {
  if (error instanceof GatewayError) return error;
  return new GatewayError("internal_error", { cause: error });
}

function sendError(res, error, requestId = "") {
  const safeError = asGatewayError(error);
  const payload = {
    error: {
      code: safeError.code,
      message: safeError.publicMessage,
    },
  };
  if (requestId) payload.error.requestId = requestId;
  if (safeError.diagnostic) {
    payload.error.diagnostic = {
      stage: String(safeError.diagnostic.stage || "unknown"),
      providerStatus: Number(safeError.diagnostic.providerStatus) || 0,
      providerCode: String(safeError.diagnostic.providerCode || "unknown"),
      providerType: String(safeError.diagnostic.providerType || "unknown"),
      providerRequestId: String(safeError.diagnostic.providerRequestId || ""),
    };
  }
  return res.status(safeError.status).json(payload);
}

module.exports = {
  ERROR_DEFINITIONS,
  GatewayError,
  asGatewayError,
  sendError,
};
