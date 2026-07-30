import assert from "node:assert/strict";
import test from "node:test";
import { DualWriteCoordinator, idempotencyKeyOf, mutationFingerprint } from "../../src/data/dual-write/coordinator.js";
import { dualWriteEnabled } from "../../src/data/dual-write/feature-flags.js";

test("client dual write runs legacy before new write", async () => {
  const order = [];
  const coordinator = new DualWriteCoordinator({ enabled: () => true });
  const result = await coordinator.execute({
    context: { organizationId: "org-1" },
    entityType: "client", entityId: "client-1", operation: "create",
    legacyWrite: async () => order.push("legacy"),
    newWrite: async () => order.push("new"),
  });
  assert.deepEqual(order, ["legacy", "new"]);
  assert.equal(result.secondary, "written");
});

test("legacy failure prevents the secondary write", async () => {
  let secondaryCalls = 0;
  const coordinator = new DualWriteCoordinator({ enabled: () => true });
  await assert.rejects(() => coordinator.execute({
    context: { organizationId: "org-1" },
    entityType: "lesson", entityId: "lesson-1", operation: "update",
    legacyWrite: async () => { throw new Error("legacy failed"); },
    newWrite: async () => { secondaryCalls += 1; },
  }), /legacy failed/);
  assert.equal(secondaryCalls, 0);
});

test("secondary failure preserves legacy success and records non-PII retry metadata", async () => {
  const recorded = [];
  const coordinator = new DualWriteCoordinator({
    enabled: () => true,
    retryStore: { record: (entry) => recorded.push(entry), remove: () => {} },
    now: () => new Date("2026-07-31T00:00:00.000Z"),
  });
  const result = await coordinator.execute({
    context: { organizationId: "org-1" },
    entityType: "client", entityId: "client-1", operation: "update",
    legacyWrite: async () => "legacy-ok",
    newWrite: async () => { throw Object.assign(new Error("private payload"), { code: "unavailable" }); },
  });
  assert.equal(result.legacyResult, "legacy-ok");
  assert.equal(result.secondary, "queued");
  assert.equal(recorded[0].lastErrorCode, "unavailable");
  assert.equal(JSON.stringify(recorded).includes("private payload"), false);
});

test("feature flag is safe-off and requires both allowlists outside production", () => {
  const context = { userId: "u1", organizationId: "o1" };
  assert.equal(dualWriteEnabled({}, context), false);
  assert.equal(dualWriteEnabled({
    MODE: "development",
    VITE_FIREBASE_DUAL_WRITE_ENABLED: "true",
    VITE_FIREBASE_DUAL_WRITE_UID_ALLOWLIST: "u1",
    VITE_FIREBASE_DUAL_WRITE_ORG_ALLOWLIST: "o1",
  }, context), true);
  assert.equal(dualWriteEnabled({
    MODE: "production",
    VITE_FIREBASE_DUAL_WRITE_ENABLED: "true",
    VITE_FIREBASE_DUAL_WRITE_UID_ALLOWLIST: "u1",
    VITE_FIREBASE_DUAL_WRITE_ORG_ALLOWLIST: "o1",
  }, context), false);
});

test("idempotency keys are deterministic", () => {
  const input = { organizationId: "o", entityType: "lesson", entityId: "l", operation: "update" };
  assert.equal(idempotencyKeyOf(input), idempotencyKeyOf(input));
});

test("mutation fingerprints are stable but distinguish different updates", () => {
  assert.equal(mutationFingerprint({ name: "A", status: "active" }), mutationFingerprint({ status: "active", name: "A" }));
  assert.notEqual(mutationFingerprint({ name: "A" }), mutationFingerprint({ name: "B" }));
});

test("missing organization context preserves legacy success and skips the new write", async () => {
  let secondaryCalls = 0;
  const coordinator = new DualWriteCoordinator({ enabled: () => true });
  const result = await coordinator.execute({
    context: { organizationId: "" },
    entityType: "client", entityId: "client-1", operation: "update",
    legacyWrite: async () => "legacy-ok",
    newWrite: async () => { secondaryCalls += 1; },
  });
  assert.equal(result.legacyResult, "legacy-ok");
  assert.equal(result.secondary, "invalid_context");
  assert.equal(secondaryCalls, 0);
});

test("unknown error codes cannot expose arbitrary error content", async () => {
  const recorded = [];
  const coordinator = new DualWriteCoordinator({
    enabled: () => true,
    retryStore: { record: (entry) => recorded.push(entry), remove: () => {} },
  });
  await coordinator.execute({
    context: { organizationId: "org-1" },
    entityType: "lesson", entityId: "lesson-1", operation: "update",
    legacyWrite: async () => {},
    newWrite: async () => { throw Object.assign(new Error("private"), { code: "person@example.com" }); },
  });
  assert.equal(recorded[0].lastErrorCode, "unknown");
  assert.equal(JSON.stringify(recorded).includes("person@example.com"), false);
});
