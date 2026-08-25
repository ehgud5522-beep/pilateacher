"use strict";

const { logger: functionsLogger } = require("firebase-functions/logger");

const CONFIG_PATH = "runtimeConfig/aiRecording";
const ALERTS_COLLECTION = "operationalAlerts";

function operationalFailure(error) {
  const diagnostic = error?.diagnostic || {};
  const providerStatus = Number(diagnostic.providerStatus) || 0;
  const providerCode = String(diagnostic.providerCode || "");
  if (error?.code === "provider_quota_exhausted" || (providerStatus === 429 && providerCode === "insufficient_quota")) {
    return { code: "provider_quota_exhausted", status: "degraded" };
  }
  if (providerCode === "secret_missing" || diagnostic.providerType === "configuration") {
    return { code: "provider_configuration", status: "off" };
  }
  return null;
}

function createAIRecordingOperations({ firestore, logger = functionsLogger, clock = () => new Date() } = {}) {
  if (!firestore?.doc || !firestore?.collection) throw new TypeError("Firestore is required");
  return Object.freeze({
    async handleFailure(error, { requestId = "", operation = "" } = {}) {
      const failure = operationalFailure(error);
      if (!failure) return { changed: false };
      const at = clock();
      const safeRequestId = String(requestId || "").replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 160);
      await firestore.doc(CONFIG_PATH).set({
        status: failure.status,
        reasonCode: failure.code,
        updatedAt: at,
        updatedBy: "aiGateway",
      }, { merge: true });
      await firestore.collection(ALERTS_COLLECTION).add({
        type: "ai_recording_service_failure",
        code: failure.code,
        stage: String(error?.diagnostic?.stage || "gateway").slice(0, 80),
        operation: String(operation || "").slice(0, 80),
        requestId: safeRequestId,
        createdAt: at,
        acknowledged: false,
      });
      logger.error?.("ai_recording_operational_alert", {
        code: failure.code,
        stage: String(error?.diagnostic?.stage || "gateway"),
        operation: String(operation || ""),
        requestId: safeRequestId,
      });
      return { changed: true, ...failure };
    },
  });
}

module.exports = { ALERTS_COLLECTION, CONFIG_PATH, createAIRecordingOperations, operationalFailure };
