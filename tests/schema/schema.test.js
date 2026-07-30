import assert from "node:assert/strict";
import test from "node:test";
import { DATA_KIND, ROLES, SCHEMA_VERSION, UNITS } from "../../src/data/schema/constants.js";
import { deterministicId } from "../../src/data/schema/ids.js";
import { assertAuditFields, assertPainScore, assertRole, assertTimestamp } from "../../src/data/schema/validators.js";

test("foundation constants define required units and data kinds", () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(UNITS.WEIGHT, "kg");
  assert.equal(UNITS.LENGTH, "cm");
  assert.equal(UNITS.ANGLE, "degree");
  assert.deepEqual(Object.values(DATA_KIND).sort(), ["derived", "source"]);
});

test("deterministic IDs are stable and scoped", () => {
  const first = deterministicId("client", ["user-a", "legacy-1"]);
  assert.equal(first, deterministicId("client", ["user-a", "legacy-1"]));
  assert.notEqual(first, deterministicId("client", ["user-b", "legacy-1"]));
});

test("timestamps reject date strings and accept Timestamp-like UTC values", () => {
  assert.throws(() => assertTimestamp("2026-01-01"), /Timestamp-compatible/);
  assert.deepEqual(assertTimestamp({ seconds: 1, nanoseconds: 0 }), { seconds: 1, nanoseconds: 0 });
});

test("pain and enum values are constrained", () => {
  assert.equal(assertPainScore(0), 0);
  assert.equal(assertPainScore(10), 10);
  assert.throws(() => assertPainScore(11), /0 to 10/);
  assert.equal(assertRole(ROLES.INSTRUCTOR), "instructor");
  assert.throws(() => assertRole("superuser"), /Invalid role/);
});

test("audit fields require schema, timestamps, creator and data kind", () => {
  const timestamp = { seconds: 1, nanoseconds: 0 };
  assert.equal(assertAuditFields({
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: "fixture-user",
    dataKind: "source",
  }).createdBy, "fixture-user");
});
