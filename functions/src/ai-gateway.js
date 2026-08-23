"use strict";

const { createHash } = require("node:crypto");
const { verifyFirebaseRequest } = require("./auth");
const { GatewayError, sendError } = require("./errors");
const { validateOperationOutput } = require("./operation-contracts");
const { prepareProviderInput } = require("./privacy");
const { fingerprintRequest, parseGatewayRequest } = require("./request-contracts");

const PIPELINE_VERSION = "ai-gateway-v1";
const consentOperation = (operation) => operation === "structureLessonRecord" ? "summarizeVoice" : operation;

function safetyIdentifier(uid) {
  return createHash("sha256").update(`pilateacher:${String(uid || "")}`).digest("hex");
}

function createAIGatewayHandler({
  verifyIdToken,
  policyService,
  idempotencyStore,
  getProvider,
  clock = () => new Date(),
}) {
  if (typeof verifyIdToken !== "function" || !policyService || !idempotencyStore || typeof getProvider !== "function") {
    throw new TypeError("AI gateway dependencies are required");
  }

  return async function aiGatewayHandler(req, res) {
    let requestId = "";
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
      if (!provider || typeof provider.execute !== "function") throw new GatewayError("provider_unavailable");

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

      const providerInput = prepareProviderInput(request.input, { memberName: authorization.memberName });
      const providerResponse = await provider.execute({
        operation: request.operation,
        input: providerInput,
        safetyIdentifier: safetyIdentifier(uid),
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
          totalTokens: Math.max(0, Number(providerResponse.usage.totalTokens) || 0),
        } : null,
        output,
      };
      await idempotencyStore.complete({
        storageKey: idempotencyClaim.storageKey,
        fingerprint,
        response,
      });
      return res.status(200).json(response);
    } catch (error) {
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
  PIPELINE_VERSION,
  createAIGatewayHandler,
  safetyIdentifier,
};
