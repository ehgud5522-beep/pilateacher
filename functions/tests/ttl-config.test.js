"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { IDEMPOTENCY_COLLECTION, IDEMPOTENCY_TTL_FIELD } = require("../src/idempotency");

test("Firestore deployment config enables unindexed TTL for AI idempotency documents", () => {
  const repositoryRoot = path.resolve(path.dirname(require.resolve("../src/idempotency")), "../..");
  const firebaseConfig = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "firebase.foundation.json"), "utf8"));
  assert.equal(firebaseConfig?.firestore?.indexes, "firestore.foundation.indexes.json");
  const config = JSON.parse(fs.readFileSync(path.join(repositoryRoot, firebaseConfig.firestore.indexes), "utf8"));
  const overrides = Array.isArray(config.fieldOverrides) ? config.fieldOverrides : [];
  const policy = overrides.find((entry) => (
    entry?.collectionGroup === IDEMPOTENCY_COLLECTION &&
    entry?.fieldPath === IDEMPOTENCY_TTL_FIELD
  ));
  assert.ok(policy, `${IDEMPOTENCY_COLLECTION}.${IDEMPOTENCY_TTL_FIELD} TTL policy is missing`);
  assert.equal(policy.ttl, true);
  assert.deepEqual(policy.indexes, []);
});
