"use strict";

const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { logger } = require("firebase-functions");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { createAccountDeletionService } = require("./account-deletion");
const { applyCors, parseAllowedOrigins } = require("./cors");
const { sendError, GatewayError } = require("./errors");
const { createDisabledIdempotencyStore } = require("./idempotency");
const { DEFAULT_MODEL, createOpenAIVoiceSummaryProvider } = require("./openai-provider");
const { createDisabledPolicyService } = require("./policy");
const { createVoiceSummaryHandler } = require("./voice-summary");

if (!getApps().length) initializeApp();

const OPENAI_API_KEY = "OPENAI_API_KEY";
const VOICE_SUMMARY_ROUTE = "/v1/ai/voice-summary";
const allowedOrigins = parseAllowedOrigins(process.env.AI_ALLOWED_ORIGINS);
const policyService = createDisabledPolicyService();
const idempotencyStore = createDisabledIdempotencyStore();
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

const handler = createVoiceSummaryHandler({
  verifyIdToken: (token) => getAuth().verifyIdToken(token, true),
  policyService,
  idempotencyStore,
  summarizeVoice: async (input) => {
    if (!openAIProvider) {
      openAIProvider = createOpenAIVoiceSummaryProvider({
        apiKey: process.env[OPENAI_API_KEY] || "",
        model: process.env.AI_VOICE_SUMMARY_MODEL || DEFAULT_MODEL,
      });
    }
    return openAIProvider.summarize(input);
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
    if (requestPath(req) !== VOICE_SUMMARY_ROUTE) throw new GatewayError("invalid_request", { status: 404 });
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

exports._test = {
  accountDeletionHttpsError,
  requestPath,
  VOICE_SUMMARY_ROUTE,
};
