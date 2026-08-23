"use strict";

const { createHash } = require("node:crypto");
const { GatewayError } = require("./errors");

const IDEMPOTENCY_COLLECTION = "_aiGatewayIdempotency";
const IDEMPOTENCY_TTL_FIELD = "expiresAt";

function createDisabledIdempotencyStore() {
  return Object.freeze({
    async begin() {
      throw new GatewayError("internal_error", { internalMessage: "Persistent idempotency store is not configured" });
    },
    async complete() {},
    async fail() {},
  });
}

function createMemoryIdempotencyStore() {
  const entries = new Map();
  return {
    async begin({ scope, key, fingerprint }) {
      const storageKey = `${scope}:${key}`;
      const existing = entries.get(storageKey);
      if (!existing) {
        entries.set(storageKey, { fingerprint, state: "pending" });
        return { state: "new", storageKey };
      }
      if (existing.fingerprint !== fingerprint) return { state: "conflict", storageKey };
      if (existing.state === "complete") return { state: "cached", storageKey, response: existing.response };
      return { state: "pending", storageKey };
    },
    async complete({ storageKey, response }) {
      const existing = entries.get(storageKey);
      if (existing) entries.set(storageKey, { ...existing, state: "complete", response });
    },
    async fail({ storageKey }) {
      entries.delete(storageKey);
    },
    size() {
      return entries.size;
    },
  };
}

function snapshotExists(snapshot) {
  return snapshot && (typeof snapshot.exists === "function" ? snapshot.exists() : snapshot.exists === true);
}

function snapshotData(snapshot) {
  return snapshot && (typeof snapshot.data === "function" ? snapshot.data() : snapshot.data);
}

function millis(value) {
  if (value instanceof Date) return value.valueOf();
  if (value && typeof value.toDate === "function") return value.toDate().valueOf();
  return new Date(value).valueOf();
}

function createFirestoreIdempotencyStore({
  firestore,
  now = () => new Date(),
  ttlMs = 24 * 60 * 60 * 1000,
  pendingTtlMs = 2 * 60 * 1000,
} = {}) {
  if (!firestore) return createDisabledIdempotencyStore();
  const resultTtl = Math.max(60000, Number(ttlMs) || 86400000);
  const pendingTtl = Math.max(5000, Number(pendingTtlMs) || 120000);

  async function begin({ scope, key, fingerprint }) {
    const storageKey = createHash("sha256").update(`${scope}:${key}`).digest("hex");
    const ref = firestore.doc(`${IDEMPOTENCY_COLLECTION}/${storageKey}`);
    const current = now();
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshotExists(snapshot) ? snapshotData(snapshot) || {} : null;
      const expiresAt = existing?.[IDEMPOTENCY_TTL_FIELD];
      const expired = existing && (!Number.isFinite(millis(expiresAt)) || millis(expiresAt) <= current.valueOf());
      const stalePending = existing?.state === "pending" && (!Number.isFinite(millis(existing.updatedAt)) || millis(existing.updatedAt) + pendingTtl <= current.valueOf());
      if (existing && !expired && !stalePending) {
        if (existing.fingerprint !== fingerprint) return { state: "conflict", storageKey };
        if (existing.state === "complete" && existing.response) return { state: "cached", storageKey, response: existing.response };
        return { state: "pending", storageKey };
      }
      transaction.set(ref, {
        state: "pending",
        fingerprint,
        createdAt: current,
        updatedAt: current,
        [IDEMPOTENCY_TTL_FIELD]: new Date(current.valueOf() + resultTtl),
      }, { merge: false });
      return { state: "new", storageKey, fingerprint };
    });
  }

  async function complete({ storageKey, fingerprint, response }) {
    const ref = firestore.doc(`${IDEMPOTENCY_COLLECTION}/${storageKey}`);
    const current = now();
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshotExists(snapshot) ? snapshotData(snapshot) || {} : null;
      if (!existing || existing.state !== "pending" || (fingerprint && existing.fingerprint !== fingerprint)) {
        throw new GatewayError("internal_error");
      }
      transaction.set(ref, {
        ...existing,
        state: "complete",
        response,
        updatedAt: current,
        [IDEMPOTENCY_TTL_FIELD]: new Date(current.valueOf() + resultTtl),
      }, { merge: false });
    });
  }

  async function fail({ storageKey, fingerprint }) {
    const ref = firestore.doc(`${IDEMPOTENCY_COLLECTION}/${storageKey}`);
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshotExists(snapshot) ? snapshotData(snapshot) || {} : null;
      if (existing?.state === "pending" && (!fingerprint || existing.fingerprint === fingerprint)) transaction.delete(ref);
    });
  }

  return Object.freeze({ begin, complete, fail });
}

module.exports = {
  IDEMPOTENCY_COLLECTION,
  IDEMPOTENCY_TTL_FIELD,
  createDisabledIdempotencyStore,
  createFirestoreIdempotencyStore,
  createMemoryIdempotencyStore,
};
