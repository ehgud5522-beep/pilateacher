"use strict";

const { createHash } = require("node:crypto");
const { verifyFirebaseRequest } = require("./auth");
const { GatewayError, sendError } = require("./errors");
const { OPERATIONS, validateOperationOutput } = require("./operation-contracts");
const { prepareProviderInput } = require("./privacy");
const { fingerprintRequest, parseGatewayRequest } = require("./request-contracts");

const PIPELINE_VERSION = "ai-gateway-v1";
const DEFERRED_OPERATIONS = new Set(["recommendSequence"]);
const consentOperation = (operation) => (
  operation === OPERATIONS.STRUCTURE_LESSON_RECORD || operation === OPERATIONS.LESSON_RECORD_FROM_AUDIO
    ? OPERATIONS.SUMMARIZE_VOICE
    : operation
);
const diagnosticsEnabled = () => process.env.NODE_ENV !== "production" || process.env.AI_GATEWAY_DIAGNOSTICS === "1";
const ALWAYS_LOG_EVENTS = new Set(["model_call_succeeded", "gateway_completed"]);
const safeLogToken = (value, max = 120) => String(value || "")
  .replace(/[^A-Za-z0-9._:/-]/g, "_")
  .slice(0, max);
const diagnosticLog = (event, details = {}) => {
  if (!diagnosticsEnabled() && !ALWAYS_LOG_EVENTS.has(event)) return;
  globalThis.console.info(`[PilaTeacher/aiGateway] ${event}`, details);
};

function safetyIdentifier(uid) {
  return createHash("sha256").update(`pilateacher:${String(uid || "")}`).digest("hex");
}

function createAIGatewayHandler({
  verifyIdToken,
  policyService,
  idempotencyStore,
  getProvider,
  aiRecordingOperations = null,
  clock = () => new Date(),
}) {
  if (typeof verifyIdToken !== "function" || !policyService || !idempotencyStore || typeof getProvider !== "function") {
    throw new TypeError("AI gateway dependencies are required");
  }

  return async function aiGatewayHandler(req, res) {
    let requestId = "";
    let operation = "";
    let idempotencyClaim = null;
    let fingerprint = "";
    try {
      res.set("Cache-Control", "no-store");
      res.set("Pragma", "no-cache");
      if (String(req.method || "").toUpperCase() !== "POST") {
        res.set("Allow", "POST");
        throw new GatewayError("invalid_request", { status: 405 });
      }

      const { uid } = await verifyFirebaseRequest(req, verifyIdToken);
      const request = parseGatewayRequest(req);
      requestId = request.requestId;
      operation = request.operation;
      diagnosticLog("request_authenticated", { requestId, operation: request.operation, httpStatus: 0, auth: "success" });
      // DEFER: Sequence recommendation keeps its request/output contracts for a
      // future release, but has no active Gateway route or provider execution.
      if (DEFERRED_OPERATIONS.has(request.operation)) throw new GatewayError("operation_deferred");
      const authorization = await policyService.authorize({
        uid,
        memberId: request.input.memberId,
        lessonId: request.input.lessonId || "",
        operation: consentOperation(request.operation),
      });
      if (authorization?.allowed !== true) throw new GatewayError("consent_required");

      // Resolve the Secret-backed provider before consuming quota. An absent Secret
      // therefore fails closed without creating a billable request.
      const provider = await getProvider();
      const providerMethod = request.operation === OPERATIONS.LESSON_RECORD_FROM_AUDIO ? "executeAudio" : "execute";
      if (!provider || typeof provider[providerMethod] !== "function") throw new GatewayError("provider_unavailable");

      fingerprint = fingerprintRequest(uid, request);
      idempotencyClaim = await idempotencyStore.begin({
        scope: uid,
        key: requestId,
        fingerprint,
      });
      if (idempotencyClaim?.state === "conflict") throw new GatewayError("invalid_request");
      if (idempotencyClaim?.state === "pending") throw new GatewayError("provider_unavailable");
      if (idempotencyClaim?.state === "cached") return res.status(200).json(idempotencyClaim.response);
      if (idempotencyClaim?.state !== "new" || !idempotencyClaim.storageKey) throw new GatewayError("internal_error");

      const rateLimit = await policyService.consumeRateLimit({ uid, operation: request.operation });
      if (rateLimit?.allowed !== true) {
        if (Number.isFinite(rateLimit?.retryAfterSeconds)) {
          res.set("Retry-After", String(Math.max(1, Math.ceil(rateLimit.retryAfterSeconds))));
        }
        throw new GatewayError("rate_limited");
      }

      let providerResponse;
      if (request.operation === OPERATIONS.LESSON_RECORD_FROM_AUDIO) {
        if (typeof provider.executeAudio !== "function") throw new GatewayError("provider_unavailable");
        try {
          providerResponse = await provider.executeAudio({
            input: {
              audio: request.input.audio,
              memberName: authorization.memberName || request.input.memberName,
              language: "ko",
              clipId: request.input.clipId,
              audioMetrics: request.input.audioMetrics,
            },
            safetyIdentifier: safetyIdentifier(uid),
          });
        } finally {
          request.input.audio = "";
        }
      } else {
        const providerInput = prepareProviderInput(request.input, { memberName: authorization.memberName });
        providerResponse = await provider.execute({
          operation: request.operation,
          input: providerInput,
          safetyIdentifier: safetyIdentifier(uid),
        });
      }
      diagnosticLog("model_call_succeeded", {
        requestId,
        operation: request.operation,
        model: safeLogToken(providerResponse?.model),
        promptVersion: safeLogToken(providerResponse?.promptVersion),
        status: safeLogToken(providerResponse?.status || "completed"),
        incompleteReason: safeLogToken(providerResponse?.incompleteReason || ""),
        usage: {
          input: Math.max(0, Number(providerResponse?.usage?.inputTokens) || 0),
          output: Math.max(0, Number(providerResponse?.usage?.outputTokens) || 0),
          reasoning: Math.max(0, Number(providerResponse?.usage?.reasoningTokens) || 0),
        },
        latencyMs: Math.max(0, Number(providerResponse?.latencyMs) || 0),
        validation: safeLogToken(providerResponse?.validation || "success"),
        transcriptionModel: safeLogToken(providerResponse?.transcriptionModel || ""),
        transcriptionLatencyMs: Math.max(0, Number(providerResponse?.transcriptionLatencyMs) || 0),
        speechSeconds: Math.max(0, Number(providerResponse?.speechSeconds) || 0),
        transcriptionConfidence: Math.max(0, Number(providerResponse?.transcriptionConfidence) || 0),
        transcriptionFlags: Array.isArray(providerResponse?.transcriptionFlags) ? providerResponse.transcriptionFlags : [],
        confidenceDiagnostic: providerResponse?.confidenceDiagnostic ? {
          averageLogprob: Number.isFinite(providerResponse.confidenceDiagnostic.averageLogprob) ? Number(providerResponse.confidenceDiagnostic.averageLogprob) : null,
          rejectedSegments: Math.max(0, Number(providerResponse.confidenceDiagnostic.rejectedSegments) || 0),
          totalSegments: Math.max(0, Number(providerResponse.confidenceDiagnostic.totalSegments) || 0),
          syllablesPerSecond: Number.isFinite(providerResponse.confidenceDiagnostic.syllablesPerSecond) ? Number(providerResponse.confidenceDiagnostic.syllablesPerSecond) : null,
          glossaryRunLength: Math.max(0, Number(providerResponse.confidenceDiagnostic.glossaryRunLength) || 0),
        } : null,
        outputShape: Object.fromEntries(Object.entries(providerResponse?.output || {}).map(([field, value]) => [field, Array.isArray(value) ? `array:${value.every((item) => typeof item === "string") ? "string" : "mixed"}` : typeof value])),
      });
      const output = validateOperationOutput(request.operation, providerResponse?.output);
      const model = String(providerResponse?.model || "").trim();
      const promptVersion = String(providerResponse?.promptVersion || "").trim();
      if (!model || !promptVersion) throw new GatewayError("invalid_output");
      const response = {
        requestId,
        provider: "openai",
        operation: request.operation,
        model,
        modelVersion: "",
        promptVersion,
        pipelineVersion: PIPELINE_VERSION,
        createdAt: clock().toISOString(),
        usage: providerResponse?.usage && typeof providerResponse.usage === "object" ? {
          inputTokens: Math.max(0, Number(providerResponse.usage.inputTokens) || 0),
          outputTokens: Math.max(0, Number(providerResponse.usage.outputTokens) || 0),
          reasoningTokens: Math.max(0, Number(providerResponse.usage.reasoningTokens) || 0),
          totalTokens: Math.max(0, Number(providerResponse.usage.totalTokens) || 0),
        } : null,
        output,
      };
      await idempotencyStore.complete({
        storageKey: idempotencyClaim.storageKey,
        fingerprint,
        response,
      });
      diagnosticLog("gateway_completed", {
        requestId,
        operation: request.operation,
        model: safeLogToken(model),
        promptVersion: safeLogToken(promptVersion),
        status: safeLogToken(providerResponse?.status || "completed"),
        incompleteReason: safeLogToken(providerResponse?.incompleteReason || ""),
        usage: {
          input: Math.max(0, Number(providerResponse?.usage?.inputTokens) || 0),
          output: Math.max(0, Number(providerResponse?.usage?.outputTokens) || 0),
          reasoning: Math.max(0, Number(providerResponse?.usage?.reasoningTokens) || 0),
        },
        latencyMs: Math.max(0, Number(providerResponse?.latencyMs) || 0),
        httpStatus: 200,
        validation: "success",
      });
      return res.status(200).json(response);
    } catch (error) {
      if (aiRecordingOperations?.handleFailure) {
        try { await aiRecordingOperations.handleFailure(error, { requestId, operation }); }
        catch (operationsError) {
          globalThis.console.error("[PilaTeacher/aiGateway] operational_alert_failed", { code: String(operationsError?.code || "unknown") });
        }
      }
      if (error?.diagnostic && typeof error.diagnostic === "object") {
        const details = error.diagnostic;
        globalThis.console.warn("[PilaTeacher/aiGateway] provider_failed", {
          requestId,
          operation,
          httpStatus: Number(error?.status) || 500,
          code: String(error?.code || "internal_error"),
          stage: String(details.stage || "unknown"),
          providerStatus: Number(details.providerStatus) || 0,
          providerCode: String(details.providerCode || "unknown"),
          providerType: String(details.providerType || "unknown"),
          providerRequestId: String(details.providerRequestId || ""),
          responseStatus: safeLogToken(details.responseStatus || "unknown"),
          incompleteReason: safeLogToken(details.incompleteReason || ""),
          usage: {
            input: Math.max(0, Number(details.usage?.inputTokens) || 0),
            output: Math.max(0, Number(details.usage?.outputTokens) || 0),
            reasoning: Math.max(0, Number(details.usage?.reasoningTokens) || 0),
          },
          latencyMs: Math.max(0, Number(details.latencyMs) || 0),
          validation: safeLogToken(details.validation || "not_run"),
        });
      }
      diagnosticLog("gateway_failed", { requestId, httpStatus: Number(error?.status) || 500, code: String(error?.code || "internal_error") });
      if (idempotencyClaim?.state === "new" && idempotencyClaim.storageKey) {
        try {
          await idempotencyStore.fail({
            storageKey: idempotencyClaim.storageKey,
            fingerprint,
          });
        } catch (_cleanupError) {
          // Preserve the original safe response. Request content is never logged.
        }
      }
      return sendError(res, error, requestId);
    }
  };
}

module.exports = {
  DEFERRED_OPERATIONS,
  PIPELINE_VERSION,
  createAIGatewayHandler,
  safetyIdentifier,
};
