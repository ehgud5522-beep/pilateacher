"use strict";

const { GatewayError } = require("./errors");

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

module.exports = {
  createDisabledIdempotencyStore,
  createMemoryIdempotencyStore,
};
