import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildBackfillPlan } from "../../tools/migration/backfill-plan.js";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/legacy-backup.json", import.meta.url), "utf8"),
);

test("backfill defaults to dry-run, has no deletes, and is deterministic", () => {
  const first = buildBackfillPlan(fixture, { projectId: "pilateacher-dev" });
  const second = buildBackfillPlan(fixture, { projectId: "pilateacher-dev" });
  assert.equal(first.mode, "dry-run");
  assert.equal(first.deleteOperations, 0);
  assert.equal(first.planChecksum, second.planChecksum);
  assert.deepEqual(
    first.documents.map(({ collection, id }) => `${collection}/${id}`),
    second.documents.map(({ collection, id }) => `${collection}/${id}`),
  );
});

test("backfill supports user and organization scope", () => {
  assert.equal(buildBackfillPlan(fixture, { userId: "different-user" }).documentCount, 0);
  const scoped = buildBackfillPlan(fixture, { organizationId: "org_fixture" });
  assert.equal(scoped.scope.organizationId, "org_fixture");
  assert.ok(scoped.documents.every((document) =>
    document.collection === "users" || document.data.organizationId === "org_fixture"));
});

test("production-like project IDs stop immediately", () => {
  assert.throws(
    () => buildBackfillPlan(fixture, { projectId: "pilateacher-prod" }),
    /Blocked Firebase project/,
  );
});

test("write mode is unavailable in foundation v1", () => {
  assert.throws(() => buildBackfillPlan(fixture, { write: true }), /intentionally unavailable/);
});
