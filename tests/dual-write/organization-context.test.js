import assert from "node:assert/strict";
import test from "node:test";
import {
  UNRESOLVED_ORGANIZATION_CONTEXT, readyOrganizationContext, resolveOrganizationContext,
} from "../../src/data/repositories/organization-context.js";

const membership = (overrides = {}) => ({
  organizationId: "center-a",
  userId: "user-1",
  role: "instructor",
  status: "active",
  ...overrides,
});

test("an active membership decides the organization and the role", async () => {
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async (userId) => {
      assert.equal(userId, "user-1");
      return [membership()];
    },
  });
  assert.deepEqual(context, {
    organizationId: "center-a",
    role: "instructor",
    status: "active",
    isLegacy: false,
  });
});

test("no membership falls back to the legacy single-instructor organization", async () => {
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [],
  });
  assert.equal(context.organizationId, "legacy_user-1");
  assert.equal(context.role, "owner");
  assert.equal(context.isLegacy, true);
});

test("a reader that was never supplied is treated as no membership", async () => {
  const context = await resolveOrganizationContext("user-1");
  assert.equal(context.isLegacy, true);
  assert.equal(context.organizationId, "legacy_user-1");
});

test("a membership that is not active is ignored", async () => {
  for (const status of ["invited", "suspended", "revoked"]) {
    const context = await resolveOrganizationContext("user-1", {
      listActiveMemberships: async () => [membership({ status })],
    });
    assert.equal(context.isLegacy, true, `${status} must not become a membership`);
    assert.equal(context.organizationId, "legacy_user-1");
  }
});

test("several memberships take the first one and leave a warning", async () => {
  const warnings = [];
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [
      membership({ organizationId: "center-a" }),
      membership({ organizationId: "center-b" }),
    ],
    warn: (code, detail) => warnings.push({ code, detail }),
  });
  assert.equal(context.organizationId, "center-a");
  assert.equal(context.isLegacy, false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "organization_context_multiple_memberships");
  assert.equal(warnings[0].detail.membershipCount, 2);
  assert.equal(warnings[0].detail.selectedOrganizationId, "center-a");
});

test("a single membership leaves no warning", async () => {
  const warnings = [];
  await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership()],
    warn: (code) => warnings.push(code),
  });
  assert.deepEqual(warnings, []);
});

test("a membership without a role is treated as a plain member", async () => {
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership({ role: undefined })],
  });
  assert.equal(context.role, "member");
});

test("a missing userId is refused before anything is read", async () => {
  let reads = 0;
  await assert.rejects(
    () => resolveOrganizationContext("", { listActiveMemberships: async () => { reads += 1; return []; } }),
    /Missing userId/,
  );
  assert.equal(reads, 0);
});

test("a lookup failure is kept apart from having no membership", async () => {
  const warnings = [];
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => { throw Object.assign(new Error("offline"), { code: "unavailable" }); },
    warn: (code, detail) => warnings.push({ code, detail }),
  });
  assert.equal(context.status, "unknown");
  assert.equal(context.isLegacy, false);
  assert.equal(context.organizationId, "");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "organization_context_lookup_failed");
  assert.equal(warnings[0].detail.errorCode, "unavailable");
  assert.equal(warnings[0].detail.errorDomain, "firestore");
});

test("ready marks a resolved context and the unresolved one stays not ready", async () => {
  assert.equal(UNRESOLVED_ORGANIZATION_CONTEXT.ready, false);
  assert.equal(UNRESOLVED_ORGANIZATION_CONTEXT.isLegacy, false);
  const resolved = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership()],
  });
  const ready = readyOrganizationContext(resolved);
  assert.equal(ready.ready, true);
  assert.equal(ready.organizationId, "center-a");
  assert.equal(ready.role, "instructor");
});

test("signing out returns to the unresolved context", () => {
  const signedIn = readyOrganizationContext({ organizationId: "center-a", role: "owner", status: "active", isLegacy: false });
  assert.equal(signedIn.ready, true);
  const signedOut = UNRESOLVED_ORGANIZATION_CONTEXT;
  assert.equal(signedOut.ready, false);
  assert.equal(signedOut.organizationId, "");
  assert.equal(signedOut.role, "");
});

test("a legacy context is ready and says so, which unknown never does", async () => {
  const legacy = readyOrganizationContext(await resolveOrganizationContext("user-1", { listActiveMemberships: async () => [] }));
  const unknown = readyOrganizationContext(await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => { throw new Error("offline"); },
  }));
  assert.equal(legacy.ready, true);
  assert.equal(legacy.isLegacy, true);
  assert.equal(unknown.ready, true);
  assert.equal(unknown.isLegacy, false);
  assert.equal(unknown.status, "unknown");
  assert.notEqual(legacy.organizationId, unknown.organizationId);
});
