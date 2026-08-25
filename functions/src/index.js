"use strict";

const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { logger } = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { createAccountDeletionService } = require("./account-deletion");
const { createAIGatewayHandler } = require("./ai-gateway");
const { createAIRecordingOperations } = require("./ai-recording-operations");
const { applyCors, parseAllowedOrigins } = require("./cors");
const { sendError, GatewayError } = require("./errors");
const { createFirestoreIdempotencyStore } = require("./idempotency");
const { DEFAULT_MODEL, createOpenAIProvider } = require("./openai-provider");
const { createFirestorePolicyService } = require("./policy");
const { createPhotoBackupCleanupService } = require("./photo-backup-cleanup");

if (!getApps().length) initializeApp();

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const AI_EXECUTE_ROUTE = "/v1/ai/execute";
const allowedOrigins = parseAllowedOrigins(process.env.AI_ALLOWED_ORIGINS);
const firestore = getFirestore();
const policyService = createFirestorePolicyService({
  firestore,
  mode: process.env.AI_POLICY_MODE,
  consentPolicyVersion: "2026-08-23",
  minuteLimit: process.env.AI_RATE_LIMIT_PER_MINUTE || 8,
  dailyLimit: process.env.AI_RATE_LIMIT_PER_DAY || 80,
});
const idempotencyStore = createFirestoreIdempotencyStore({ firestore });
const aiRecordingOperations = createAIRecordingOperations({ firestore, logger });
const photoBackupCleanupService = createPhotoBackupCleanupService({ firestore, bucket: getStorage().bucket() });
let openAIProvider;

const accountDeletionService = createAccountDeletionService({
  async listMembershipsByUserId(uid) {
    const snapshot = await getFirestore().collection("memberships").where("userId", "==", uid).get();
    return snapshot.docs.map((membership) => ({ id: membership.id, data: membership.data() }));
  },
  async listActiveOwnersByOrganizationId(organizationId) {
    const snapshot = await getFirestore().collection("memberships").where("organizationId", "==", organizationId).get();
    return snapshot.docs.map((membership) => ({ id: membership.id, data: membership.data() }));
  },
  async listOrganizationsOwnedByUserId(uid) {
    const snapshot = await getFirestore().collection("organizations").where("ownerId", "==", uid).get();
    return snapshot.docs.map((organization) => ({ id: organization.id }));
  },
  deleteStoragePrefix(prefix) {
    return getStorage().bucket().deleteFiles({ prefix, force: true });
  },
  deleteUserTree(path) {
    const db = getFirestore();
    return db.recursiveDelete(db.doc(path));
  },
  deleteLegacyOrganization(path) {
    const db = getFirestore();
    return db.recursiveDelete(db.doc(path));
  },
  deleteMembership(path) {
    return getFirestore().doc(path).delete();
  },
  deleteAuthUser(uid) {
    return getAuth().deleteUser(uid);
  },
});

const handler = createAIGatewayHandler({
  verifyIdToken: (token) => getAuth().verifyIdToken(token, true),
  policyService,
  idempotencyStore,
  aiRecordingOperations,
  getProvider: async () => {
    if (!openAIProvider) {
      openAIProvider = createOpenAIProvider({
        apiKey: OPENAI_API_KEY.value(),
        model: process.env.AI_MODEL || DEFAULT_MODEL,
      });
    }
    return openAIProvider;
  },
});

function requestPath(req) {
  const raw = String(req.path || req.url || "").split("?")[0];
  return raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

exports.aiGateway = onRequest({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 60,
  memory: "256MiB",
  secrets: [OPENAI_API_KEY],
  cors: false,
  invoker: "public",
}, async (req, res) => {
  try {
    if (applyCors(req, res, allowedOrigins)) return;
    if (requestPath(req) !== AI_EXECUTE_ROUTE) throw new GatewayError("invalid_request", { status: 404 });
    await handler(req, res);
  } catch (error) {
    sendError(res, error);
  }
});

function accountDeletionHttpsError(error) {
  const details = {
    code: String(error?.code || "account_deletion_failed"),
    stage: String(error?.stage || "unknown"),
    completedStages: Array.isArray(error?.completedStages) ? error.completedStages : [],
    retryable: error?.retryable === true,
  };
  if (details.code === "unauthenticated" || details.code === "reauthentication_required") {
    return new HttpsError("unauthenticated", "Please sign in again before deleting the account.", details);
  }
  if (details.code === "sole_organization_owner") {
    return new HttpsError("failed-precondition", "Assign another organization owner before deleting this account.", details);
  }
  if (["invalid_request", "confirmation_required", "client_authority_rejected", "invalid_membership_scope"].includes(details.code)) {
    return new HttpsError("invalid-argument", "The account deletion request is invalid.", details);
  }
  if (details.retryable) return new HttpsError("unavailable", "Account deletion did not finish. Please retry.", details);
  return new HttpsError("internal", "Account deletion did not finish.", details);
}

exports.deleteCurrentUserAccount = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 540,
  memory: "256MiB",
  invoker: "public",
}, async (request) => {
  try {
    return await accountDeletionService.deleteCurrentUserAccount(request);
  } catch (error) {
    logger.error("account_deletion_failed", {
      code: String(error?.code || "unknown"),
      stage: String(error?.stage || "unknown"),
      retryable: error?.retryable === true,
    });
    throw accountDeletionHttpsError(error);
  }
});

exports.purgeExpiredPhotoBackups = onCall({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  timeoutSeconds: 120,
  memory: "256MiB",
  invoker: "public",
}, async (request) => {
  const uid = String(request?.auth?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "Authentication is required.");
  try {
    return await photoBackupCleanupService.purgeForUser(uid);
  } catch (error) {
    logger.error("photo_backup_cleanup_failed", { code: String(error?.code || "unknown") });
    throw new HttpsError("internal", "Photo backup cleanup failed.");
  }
});

exports.cleanupExpiredPhotoBackups = onSchedule({
  region: process.env.FUNCTIONS_REGION || "asia-northeast3",
  schedule: "every day 03:00",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 300,
  memory: "256MiB",
}, async () => {
  const result = await photoBackupCleanupService.purgeExpiredGlobal();
  logger.info("photo_backup_cleanup_completed", { purged: result.purged, remaining: result.remaining });
});

exports._test = {
  AI_EXECUTE_ROUTE,
  accountDeletionHttpsError,
  requestPath,
};
