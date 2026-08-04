import assert from "node:assert/strict";
import test from "node:test";
import { RetryMetadataStore } from "../../src/data/dual-write/retry-store.js";

test("retry metadata is upserted by idempotency key without payload", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const store = new RetryMetadataStore(storage);
  const entry = {
    idempotencyKey: "key-1", entityType: "client", entityId: "client-1",
    operation: "update", lastErrorCode: "unavailable",
    createdAt: "2026-07-31T00:00:00.000Z", nextRetryAt: "2026-07-31T00:00:30.000Z",
  };
  store.record(entry);
  store.record(entry);
  assert.equal(store.read().length, 1);
  assert.equal(store.read()[0].retryCount, 2);
  assert.equal("payload" in store.read()[0], false);
});
