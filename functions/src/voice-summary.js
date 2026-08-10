"use strict";

const { createHash } = require("node:crypto");
const { readHeader, verifyFirebaseRequest } = require("./auth");
const { GatewayError, sendError } = require("./errors");
const { validateVoiceSummaryResult } = require("./openai-provider");

const OPERATION = "voice_summary";
const CLIENT_OPERATION = "summarizeVoice";
const MAX_TRANSCRIPT_LENGTH = 12000;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;

function requireId(value, field) {
  const normalized = String(value || "").trim();
  if (!ID_PATTERN.test(normalized)) {
    throw new GatewayError("invalid_request", { internalMessage: `${field} is invalid` });
  }
  return normalized;
}

function parseVoiceSummaryRequest(req) {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new GatewayError("invalid_request");

  const isClientEnvelope = body.operation !== undefined || body.input !== undefined;
  if (isClientEnvelope && body.operation !== CLIENT_OPERATION) throw new GatewayError("invalid_request");
  if (isClientEnvelope && body.provider && body.provider !== "openai") throw new GatewayError("invalid_request");
  const source = isClientEnvelope ? body.input : body;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new GatewayError("invalid_request");

  const lessonId = requireId(source.lessonId, "lessonId");
  const memberId = requireId(source.memberId, "memberId");
  const transcript = String(source.transcript || "").trim();
  if (!transcript || transcript.length > MAX_TRANSCRIPT_LENGTH) throw new GatewayError("invalid_request");

  const headerKey = String(readHeader(req, "x-idempotency-key") || "").trim();
  const bodyKey = String(body.idempotencyKey || body.requestId || source.idempotencyKey || "").trim();
  if (headerKey && bodyKey && headerKey !== bodyKey) throw new GatewayError("invalid_request");
  const idempotencyKey = headerKey || bodyKey;
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) throw new GatewayError("invalid_request");

  return { lessonId, memberId, transcript, idempotencyKey };
}

function fingerprintRequest(uid, input) {
  return createHash("sha256")
    .update(JSON.stringify([uid, input.lessonId, input.memberId, input.transcript]))
    .digest("hex");
}

function createVoiceSummaryHandler({
  verifyIdToken,
  policyService,
  idempotencyStore,
  summarizeVoice,
}) {
  if (typeof verifyIdToken !== "function" || !policyService || !idempotencyStore || typeof summarizeVoice !== "function") {
    throw new TypeError("Voice summary dependencies are required");
  }

  return async function voiceSummaryHandler(req, res) {
    let requestId = "";
    let idempotencyClaim = null;
    try {
      res.set("Cache-Control", "no-store");
      if (String(req.method || "").toUpperCase() !== "POST") {
        res.set("Allow", "POST");
        throw new GatewayError("invalid_request", { status: 405 });
      }

      const { uid } = await verifyFirebaseRequest(req, verifyIdToken);
      const input = parseVoiceSummaryRequest(req);
      requestId = input.idempotencyKey;

      const policyContext = {
        uid,
        lessonId: input.lessonId,
        memberId: input.memberId,
        operation: OPERATION,
        idempotencyKey: input.idempotencyKey,
      };
      const consent = await policyService.checkConsent(policyContext);
      if (consent?.allowed !== true) throw new GatewayError("consent_required");
      const rateLimit = await policyService.checkRateLimit(policyContext);
      if (rateLimit?.allowed !== true) {
        if (Number.isFinite(rateLimit?.retryAfterSeconds)) res.set("Retry-After", String(Math.max(1, Math.ceil(rateLimit.retryAfterSeconds))));
        throw new GatewayError("rate_limited");
      }

      idempotencyClaim = await idempotencyStore.begin({
        scope: uid,
        key: input.idempotencyKey,
        fingerprint: fingerprintRequest(uid, input),
      });
      if (idempotencyClaim?.state === "conflict") throw new GatewayError("invalid_request");
      if (idempotencyClaim?.state === "pending") throw new GatewayError("provider_unavailable");
      if (idempotencyClaim?.state === "cached") return res.status(200).json(idempotencyClaim.response);
      if (idempotencyClaim?.state !== "new" || !idempotencyClaim.storageKey) throw new GatewayError("internal_error");

      const providerResponse = await summarizeVoice({
        transcript: input.transcript,
        lessonId: input.lessonId,
        memberId: input.memberId,
        uid,
        requestId,
      });
      const response = {
        requestId,
        operation: OPERATION,
        provider: "openai",
        model: String(providerResponse?.model || ""),
        result: validateVoiceSummaryResult(providerResponse?.result),
      };
      if (!response.model) throw new GatewayError("invalid_output");
      await idempotencyStore.complete({ storageKey: idempotencyClaim.storageKey, response });
      return res.status(200).json(response);
    } catch (error) {
      if (idempotencyClaim?.state === "new" && idempotencyClaim.storageKey) {
        try {
          await idempotencyStore.fail({ storageKey: idempotencyClaim.storageKey });
        } catch (_cleanupError) {
          // Preserve the original safe error response. No request content is logged.
        }
      }
      return sendError(res, error, requestId);
    }
  };
}

module.exports = {
  CLIENT_OPERATION,
  MAX_TRANSCRIPT_LENGTH,
  OPERATION,
  createVoiceSummaryHandler,
  fingerprintRequest,
  parseVoiceSummaryRequest,
};
