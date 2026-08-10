"use strict";

/*
 * Production implementations must validate the verified uid against the lesson,
 * member, organization membership, and the member/user AI consent record. Client
 * supplied uid, organizationId, studioId, and role must never be used as authority.
 */
function createDisabledPolicyService() {
  return Object.freeze({
    mode: "disabled",
    async checkConsent(_context) {
      return { allowed: false, reason: "policy_store_not_configured" };
    },
    async checkRateLimit(_context) {
      return { allowed: false, reason: "rate_limit_store_not_configured" };
    },
  });
}

module.exports = {
  createDisabledPolicyService,
};
