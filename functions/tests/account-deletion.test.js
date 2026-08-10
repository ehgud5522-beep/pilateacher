"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AccountDeletionStageError,
  STAGES,
  createAccountDeletionService,
} = require("../src/account-deletion");

const NOW_MS = Date.UTC(2026, 7, 5, 0, 0, 0);
const UID = "firebase-user-1";

function request(overrides = {}) {
  return {
    auth: {
      uid: UID,
      token: { auth_time: Math.floor(NOW_MS / 1000) - 30 },
    },
    data: { confirmation: "delete_current_user" },
    ...overrides,
  };
}

function membership(overrides = {}) {
  return {
    id: "membership-1",
    userId: UID,
    organizationId: "organization-1",
    role: "instructor",
    status: "active",
    ...overrides,
  };
}

function createFixture(overrides = {}) {
  const calls = [];
  const state = {
    memberships: [membership()],
    deletedMembershipIds: new Set(),
    userDeleted: false,
    legacyDeleted: false,
    storageDeleted: false,
    authDeleted: false,
  };
  const dependencies = {
    now: () => NOW_MS,
    async listMembershipsByUserId(uid) {
      calls.push(["listMembershipsByUserId", uid]);
      return state.memberships.filter((item) => !state.deletedMembershipIds.has(item.id));
    },
    async listActiveOwnersByOrganizationId(organizationId) {
      calls.push(["listActiveOwnersByOrganizationId", organizationId]);
      return [membership({
        id: "other-owner",
        userId: "other-user",
        organizationId,
        role: "owner",
      })];
    },
    async deleteStoragePrefix(prefix) {
      calls.push(["deleteStoragePrefix", prefix]);
      state.storageDeleted = true;
    },
    async deleteUserTree(path) {
      calls.push(["deleteUserTree", path]);
      state.userDeleted = true;
    },
    async deleteLegacyOrganization(path) {
      calls.push(["deleteLegacyOrganization", path]);
      state.legacyDeleted = true;
    },
    async deleteMembership(path) {
      calls.push(["deleteMembership", path]);
      state.deletedMembershipIds.add(path.slice("memberships/".length));
    },
    async deleteAuthUser(uid) {
      calls.push(["deleteAuthUser", uid]);
      state.authDeleted = true;
    },
    ...overrides,
  };
  return {
    calls,
    state,
    service: createAccountDeletionService(dependencies),
  };
}

async function assertErrorCode(promise, code, stage) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    assert.equal(error.stage, stage);
    return true;
  });
}

test("requires a recently authenticated Firebase uid before any data lookup", async () => {
  for (const invalidRequest of [
    request({ auth: null }),
    request({ auth: { uid: UID, token: {} } }),
    request({ auth: { uid: UID, token: { auth_time: Math.floor(NOW_MS / 1000) - 301 } } }),
  ]) {
    const fixture = createFixture();
    const expectedCode = invalidRequest.auth ? "reauthentication_required" : "unauthenticated";
    await assertErrorCode(
      fixture.service.deleteCurrentUserAccount(invalidRequest),
      expectedCode,
      STAGES.AUTHORIZE,
    );
    assert.deepEqual(fixture.calls, []);
  }
});

test("rejects every client supplied authority field, even when it matches auth", async () => {
  for (const [field, value] of [
    ["uid", UID],
    ["userId", UID],
    ["targetUid", UID],
    ["organizationId", "organization-1"],
    ["membershipIds", ["membership-1"]],
    ["role", "owner"],
  ]) {
    const fixture = createFixture();
    await assertErrorCode(
      fixture.service.deleteCurrentUserAccount(request({ data: { [field]: value } })),
      "client_authority_rejected",
      STAGES.AUTHORIZE,
    );
    assert.deepEqual(fixture.calls, []);
  }
});

test("blocks a sole active organization owner before deleting anything", async () => {
  const fixture = createFixture({
    async listMembershipsByUserId(uid) {
      fixture.calls.push(["listMembershipsByUserId", uid]);
      return [membership({ role: "owner" })];
    },
    async listActiveOwnersByOrganizationId(organizationId) {
      fixture.calls.push(["listActiveOwnersByOrganizationId", organizationId]);
      return [membership({ role: "owner" })];
    },
  });

  await assertErrorCode(
    fixture.service.deleteCurrentUserAccount(request()),
    "sole_organization_owner",
    STAGES.VERIFY_OWNERSHIP,
  );
  assert.deepEqual(fixture.calls, [
    ["listMembershipsByUserId", UID],
    ["listActiveOwnersByOrganizationId", "organization-1"],
  ]);
  assert.equal(fixture.state.authDeleted, false);
});

test("also blocks legacy ownerId organizations when membership ownership is missing", async () => {
  const fixture = createFixture({
    async listOrganizationsOwnedByUserId(uid) {
      fixture.calls.push(["listOrganizationsOwnedByUserId", uid]);
      return [{ id: "legacy-owned-organization" }];
    },
    async listActiveOwnersByOrganizationId(organizationId) {
      fixture.calls.push(["listActiveOwnersByOrganizationId", organizationId]);
      return [];
    },
  });
  await assertErrorCode(
    fixture.service.deleteCurrentUserAccount(request()),
    "sole_organization_owner",
    STAGES.VERIFY_OWNERSHIP,
  );
  assert.equal(fixture.state.userDeleted, false);
  assert.equal(fixture.state.authDeleted, false);
});

test("ignores inactive owner memberships during the sole-owner preflight", async () => {
  const fixture = createFixture({
    async listMembershipsByUserId(uid) {
      fixture.calls.push(["listMembershipsByUserId", uid]);
      return [membership({ role: "owner", status: "removed" })];
    },
  });
  await fixture.service.deleteCurrentUserAccount(request());
  assert.equal(fixture.calls.some(([name]) => name === "listActiveOwnersByOrganizationId"), false);
  assert.equal(fixture.state.authDeleted, true);
});

test("deletes only exact uid-derived private paths and server-listed memberships", async () => {
  const fixture = createFixture({
    async listMembershipsByUserId(uid) {
      fixture.calls.push(["listMembershipsByUserId", uid]);
      return [
        membership({ id: "membership-b" }),
        membership({ id: "membership-a", organizationId: "organization-2" }),
      ];
    },
  });

  const result = await fixture.service.deleteCurrentUserAccount(request());
  assert.deepEqual(result, { status: "deleted" });
  assert.deepEqual(fixture.calls, [
    ["listMembershipsByUserId", UID],
    ["deleteStoragePrefix", `users/${UID}/`],
    ["deleteUserTree", `users/${UID}`],
    ["deleteLegacyOrganization", `organizations/legacy_${UID}`],
    ["deleteMembership", "memberships/membership-a"],
    ["deleteMembership", "memberships/membership-b"],
    ["deleteAuthUser", UID],
  ]);
  assert.equal(fixture.calls.some(([, target]) => String(target).startsWith("clients/")), false);
  assert.equal(fixture.calls.some(([, target]) => String(target).startsWith("lessons/")), false);
  assert.equal(fixture.calls.at(-1)[0], "deleteAuthUser");
});

test("refuses a membership record that is not scoped to the verified uid", async () => {
  const fixture = createFixture({
    async listMembershipsByUserId(uid) {
      fixture.calls.push(["listMembershipsByUserId", uid]);
      return [membership({ userId: "another-user" })];
    },
  });
  await assertErrorCode(
    fixture.service.deleteCurrentUserAccount(request()),
    "invalid_membership_scope",
    STAGES.LOAD_MEMBERSHIPS,
  );
  assert.deepEqual(fixture.calls, [["listMembershipsByUserId", UID]]);
});

test("unexpected failures report the exact stage and never delete auth early", async () => {
  const fixture = createFixture({
    async deleteStoragePrefix(prefix) {
      fixture.calls.push(["deleteStoragePrefix", prefix]);
      throw Object.assign(new Error("temporary storage failure"), { code: "unavailable" });
    },
  });

  await assert.rejects(
    fixture.service.deleteCurrentUserAccount(request()),
    (error) => {
      assert.equal(error instanceof AccountDeletionStageError, true);
      assert.equal(error.code, "account_deletion_failed");
      assert.equal(error.stage, STAGES.DELETE_STORAGE);
      assert.equal(error.retryable, true);
      assert.deepEqual(error.completedStages, [
        STAGES.AUTHORIZE,
        STAGES.LOAD_MEMBERSHIPS,
        STAGES.VERIFY_OWNERSHIP,
      ]);
      return true;
    },
  );
  assert.equal(fixture.state.authDeleted, false);
  assert.equal(fixture.calls.some(([name]) => name === "deleteUserTree"), false);
});

test("a partial membership failure is retry-safe and auth remains last", async () => {
  let shouldFail = true;
  const fixture = createFixture({
    async listMembershipsByUserId(uid) {
      fixture.calls.push(["listMembershipsByUserId", uid]);
      return [membership({ id: "membership-a" }), membership({ id: "membership-b" })]
        .filter((item) => !fixture.state.deletedMembershipIds.has(item.id));
    },
    async deleteMembership(path) {
      fixture.calls.push(["deleteMembership", path]);
      if (path === "memberships/membership-b" && shouldFail) {
        shouldFail = false;
        throw Object.assign(new Error("temporary Firestore failure"), { code: "unavailable" });
      }
      fixture.state.deletedMembershipIds.add(path.slice("memberships/".length));
    },
  });

  await assert.rejects(
    fixture.service.deleteCurrentUserAccount(request()),
    (error) => error.stage === STAGES.DELETE_MEMBERSHIPS,
  );
  assert.deepEqual([...fixture.state.deletedMembershipIds], ["membership-a"]);
  assert.equal(fixture.state.authDeleted, false);

  const result = await fixture.service.deleteCurrentUserAccount(request());
  assert.deepEqual(result, { status: "deleted" });
  assert.deepEqual([...fixture.state.deletedMembershipIds].sort(), ["membership-a", "membership-b"]);
  assert.equal(fixture.calls.at(-1)[0], "deleteAuthUser");
  assert.equal(fixture.state.authDeleted, true);
});

test("an Auth deletion failure is reported after private data cleanup and remains retryable", async () => {
  let failAuth = true;
  const fixture = createFixture({
    async deleteAuthUser(uid) {
      fixture.calls.push(["deleteAuthUser", uid]);
      if (failAuth) {
        failAuth = false;
        throw Object.assign(new Error("temporary Auth failure"), { code: "auth/internal-error" });
      }
      fixture.state.authDeleted = true;
    },
  });

  await assert.rejects(
    fixture.service.deleteCurrentUserAccount(request()),
    (error) => error.stage === STAGES.DELETE_AUTH_USER
      && error.retryable === true
      && error.completedStages.includes(STAGES.DELETE_MEMBERSHIPS),
  );
  assert.equal(fixture.state.userDeleted, true);
  assert.equal(fixture.state.authDeleted, false);

  assert.deepEqual(await fixture.service.deleteCurrentUserAccount(request()), { status: "deleted" });
  assert.equal(fixture.state.authDeleted, true);
});

test("not-found responses are successful, making a repeated request idempotent", async () => {
  const notFound = () => {
    throw Object.assign(new Error("already removed"), { code: "not-found" });
  };
  const fixture = createFixture({
    deleteStoragePrefix: notFound,
    deleteUserTree: notFound,
    deleteLegacyOrganization: notFound,
    deleteMembership: notFound,
    deleteAuthUser: notFound,
  });

  assert.deepEqual(await fixture.service.deleteCurrentUserAccount(request()), { status: "deleted" });
  assert.deepEqual(await fixture.service.deleteCurrentUserAccount(request()), { status: "deleted" });
});
