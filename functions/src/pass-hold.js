"use strict";

/** Server transaction serializes holds with attendance and repeated submissions. */
async function runPassHold(firestore, input) {
  const { planPassHold } = await import("../shared/pass-hold.mjs");
  const { isPassAdmin } = require("./pass-admin");
  const { membershipId } = require("./member-link");
  const { organizationId, passId, actorId } = input;
  for (const value of [organizationId, passId, actorId]) {
    if (typeof value !== "string" || !value || value.includes("/")) throw new Error("hold_invalid_id");
  }
  const ref = firestore.doc(`organizations/${organizationId}/passes/${passId}`);
  const entryRef = ref.collection("ledger").doc();
  return firestore.runTransaction(async (tx) => {
    const membership = await tx.get(firestore.doc(`memberships/${membershipId(organizationId, actorId)}`));
    if (!membership.exists || !isPassAdmin(membership.data())) throw new Error("hold_permission_denied");
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data().organizationId !== organizationId) throw new Error("hold_pass_not_found");
    const pass = snapshot.data();
    const now = input.now ? input.now() : new Date();
    const plan = planPassHold(pass, input, now);
    tx.update(ref, { holdFrom: plan.holdFrom, holdUntil: plan.holdUntil, expiresAt: plan.expiresAt });
    tx.create(entryRef, {
      organizationId, passId, clientId: pass.clientId, locationId: pass.locationId,
      type: "expiry", delta: 0, previousExpiresAt: pass.expiresAt, newExpiresAt: plan.expiresAt,
      holdFrom: plan.holdFrom, holdUntil: plan.holdUntil, reason: plan.reason,
      occurredAt: now, createdAt: now, createdBy: actorId,
    });
    return { passId, expiresAt: plan.expiresAt.toISOString(), holdUntil: plan.holdUntil.toISOString() };
  });
}

module.exports = { runPassHold };
