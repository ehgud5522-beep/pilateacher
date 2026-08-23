"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { IDEMPOTENCY_COLLECTION, createFirestoreIdempotencyStore } = require("../src/idempotency");
const { createFakeFirestore } = require("./fake-firestore");

test("Firestore idempotency prevents duplicate and conflicting execution", async () => {
  let current = new Date("2026-08-23T00:00:00Z");
  const firestore = createFakeFirestore();
  const store = createFirestoreIdempotencyStore({ firestore, now: () => current });
  const claim = await store.begin({ scope: "user-1", key: "request-12345678", fingerprint: "fingerprint-a" });
  assert.equal(claim.state, "new");
  const pending = firestore.read(`${IDEMPOTENCY_COLLECTION}/${claim.storageKey}`);
  assert.ok(pending.expiresAt instanceof Date);
  assert.equal(pending.expiresAt.valueOf() - current.valueOf(), 24 * 60 * 60 * 1000);
  assert.equal((await store.begin({ scope: "user-1", key: "request-12345678", fingerprint: "fingerprint-a" })).state, "pending");
  assert.equal((await store.begin({ scope: "user-1", key: "request-12345678", fingerprint: "fingerprint-b" })).state, "conflict");
  await store.complete({ storageKey: claim.storageKey, fingerprint: "fingerprint-a", response: { ok: true } });
  const cached = await store.begin({ scope: "user-1", key: "request-12345678", fingerprint: "fingerprint-a" });
  assert.equal(cached.state, "cached");
  assert.deepEqual(cached.response, { ok: true });

  current = new Date("2026-08-25T00:00:00Z");
  assert.equal((await store.begin({ scope: "user-1", key: "request-12345678", fingerprint: "fingerprint-b" })).state, "new");
});

test("failed calls release only their own pending claim", async () => {
  const store = createFirestoreIdempotencyStore({ firestore: createFakeFirestore() });
  const claim = await store.begin({ scope: "user-1", key: "request-abcdefgh", fingerprint: "fingerprint-a" });
  await store.fail({ storageKey: claim.storageKey, fingerprint: "different" });
  assert.equal((await store.begin({ scope: "user-1", key: "request-abcdefgh", fingerprint: "fingerprint-a" })).state, "pending");
  await store.fail({ storageKey: claim.storageKey, fingerprint: "fingerprint-a" });
  assert.equal((await store.begin({ scope: "user-1", key: "request-abcdefgh", fingerprint: "fingerprint-a" })).state, "new");
});
