"use strict";

const DEFAULT_MAX_AUTH_AGE_SECONDS = 5 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;
const SERVER_CONFIRMATION = "delete_current_user";

const STAGES = Object.freeze({
  AUTHORIZE: "authorize",
  LOAD_MEMBERSHIPS: "load_memberships",
  VERIFY_OWNERSHIP: "verify_ownership",
  DELETE_STORAGE: "delete_storage",
  DELETE_USER_TREE: "delete_user_tree",
  DELETE_LEGACY_ORGANIZATION: "delete_legacy_organization",
  DELETE_MEMBERSHIPS: "delete_memberships",
  DELETE_AUTH_USER: "delete_auth_user",
});

const CLIENT_AUTHORITY_FIELDS = Object.freeze([
  "uid",
  "userId",
  "targetUid",
  "organizationId",
  "organizationIds",
  "membershipIds",
  "role",
]);

const INACTIVE_MEMBERSHIP_STATUSES = new Set([
  "deleted",
  "disabled",
  "inactive",
  "removed",
  "revoked",
]);

class AccountDeletionError extends Error {
  constructor(code, options = {}) {
    super(options.message || code, options.cause ? { cause: options.cause } : undefined);
    this.name = "AccountDeletionError";
    this.code = code;
    this.stage = options.stage || STAGES.AUTHORIZE;
    this.retryable = options.retryable === true;
    this.details = options.details ? { ...options.details } : undefined;
  }
}

class AccountDeletionStageError extends AccountDeletionError {
  constructor(stage, options = {}) {
    super("account_deletion_failed", {
      ...options,
      message: `Account deletion failed during ${stage}.`,
      stage,
      retryable: options.retryable !== false,
    });
    this.name = "AccountDeletionStageError";
    this.completedStages = Object.freeze([...(options.completedStages || [])]);
  }
}

function defaultIsNotFoundError(error) {
  const code = String(error?.code || "").toLowerCase();
  const status = Number(error?.statusCode ?? error?.status ?? error?.response?.statusCode);
  return code === "404"
    || status === 404
    || code === "not-found"
    || code === "auth/user-not-found"
    || code === "storage/object-not-found"
    || code === "firestore/not-found";
}

function requireDependency(dependencies, name) {
  const value = dependencies[name];
  if (typeof value !== "function") {
    throw new TypeError(`Account deletion dependency ${name} must be a function.`);
  }
  return value;
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") return null;
  const data = record.data && typeof record.data === "object" ? record.data : record;
  return {
    id: String(record.id || data.id || "").trim(),
    userId: String(data.userId || "").trim(),
    organizationId: String(data.organizationId || data.orgId || "").trim(),
    role: String(data.role || "").trim().toLowerCase(),
    status: String(data.status || "").trim().toLowerCase(),
    active: data.active,
  };
}

function isActiveMembership(membership) {
  if (!membership || membership.active === false) return false;
  return !INACTIVE_MEMBERSHIP_STATUSES.has(membership.status);
}

function isActiveOwner(membership) {
  return isActiveMembership(membership) && membership.role === "owner";
}

function assertSafePathSegment(value, label) {
  if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    throw new AccountDeletionError("invalid_request", {
      stage: STAGES.AUTHORIZE,
      retryable: false,
      details: { field: label },
    });
  }
}

function assertServerDerivedScope(request) {
  const data = request?.data ?? {};
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new AccountDeletionError("invalid_request", {
      stage: STAGES.AUTHORIZE,
      retryable: false,
    });
  }
  const suppliedAuthorityField = CLIENT_AUTHORITY_FIELDS.find((field) => Object.hasOwn(data, field));
  if (suppliedAuthorityField) {
    throw new AccountDeletionError("client_authority_rejected", {
      stage: STAGES.AUTHORIZE,
      retryable: false,
      details: { field: suppliedAuthorityField },
    });
  }
  if (data.confirmation !== SERVER_CONFIRMATION) {
    throw new AccountDeletionError("confirmation_required", {
      stage: STAGES.AUTHORIZE,
      retryable: false,
    });
  }
}

function authenticatedUid(request, now, maxAuthAgeSeconds) {
  const uid = typeof request?.auth?.uid === "string" ? request.auth.uid.trim() : "";
  if (!uid) {
    throw new AccountDeletionError("unauthenticated", {
      stage: STAGES.AUTHORIZE,
      retryable: false,
    });
  }
  assertSafePathSegment(uid, "authenticatedUid");

  const authTime = Number(request?.auth?.token?.auth_time);
  const nowSeconds = Math.floor(now() / 1000);
  const ageSeconds = nowSeconds - authTime;
  if (!Number.isFinite(authTime)
    || ageSeconds > maxAuthAgeSeconds
    || ageSeconds < -MAX_CLOCK_SKEW_SECONDS) {
    throw new AccountDeletionError("reauthentication_required", {
      stage: STAGES.AUTHORIZE,
      retryable: false,
    });
  }
  return uid;
}

function safeMemberships(records, uid) {
  if (!Array.isArray(records)) {
    throw new AccountDeletionError("invalid_membership_scope", {
      stage: STAGES.LOAD_MEMBERSHIPS,
      retryable: true,
    });
  }

  const memberships = records.map(normalizeRecord);
  for (const membership of memberships) {
    if (!membership || membership.userId !== uid) {
      throw new AccountDeletionError("invalid_membership_scope", {
        stage: STAGES.LOAD_MEMBERSHIPS,
        retryable: false,
      });
    }
    assertSafePathSegment(membership.id, "membershipId");
    if (isActiveOwner(membership)) {
      assertSafePathSegment(membership.organizationId, "organizationId");
    }
  }
  return memberships.sort((left, right) => left.id.localeCompare(right.id));
}

function createAccountDeletionService(dependencies = {}) {
  const listMembershipsByUserId = requireDependency(dependencies, "listMembershipsByUserId");
  const listActiveOwnersByOrganizationId = requireDependency(dependencies, "listActiveOwnersByOrganizationId");
  const listOrganizationsOwnedByUserId = dependencies.listOrganizationsOwnedByUserId || (async () => []);
  const deleteStoragePrefix = requireDependency(dependencies, "deleteStoragePrefix");
  const deleteUserTree = requireDependency(dependencies, "deleteUserTree");
  const deleteLegacyOrganization = requireDependency(dependencies, "deleteLegacyOrganization");
  const deleteMembership = requireDependency(dependencies, "deleteMembership");
  const deleteAuthUser = requireDependency(dependencies, "deleteAuthUser");
  const now = dependencies.now || Date.now;
  const isNotFoundError = dependencies.isNotFoundError || defaultIsNotFoundError;
  const maxAuthAgeSeconds = dependencies.maxAuthAgeSeconds ?? DEFAULT_MAX_AUTH_AGE_SECONDS;

  if (typeof now !== "function" || typeof isNotFoundError !== "function" || typeof listOrganizationsOwnedByUserId !== "function") {
    throw new TypeError("Account deletion clock and not-found matcher must be functions.");
  }
  if (!Number.isFinite(maxAuthAgeSeconds) || maxAuthAgeSeconds <= 0) {
    throw new TypeError("maxAuthAgeSeconds must be a positive number.");
  }

  async function deleteCurrentUserAccount(request) {
    assertServerDerivedScope(request);
    const uid = authenticatedUid(request, now, maxAuthAgeSeconds);
    const completedStages = [STAGES.AUTHORIZE];

    async function runStage(stage, operation, { ignoreNotFound = false } = {}) {
      try {
        const result = await operation();
        completedStages.push(stage);
        return result;
      } catch (error) {
        if (error instanceof AccountDeletionError) throw error;
        if (ignoreNotFound && isNotFoundError(error)) {
          completedStages.push(stage);
          return undefined;
        }
        throw new AccountDeletionStageError(stage, {
          cause: error,
          completedStages,
        });
      }
    }

    const membershipRecords = await runStage(
      STAGES.LOAD_MEMBERSHIPS,
      () => listMembershipsByUserId(uid),
    );
    const memberships = safeMemberships(membershipRecords, uid);

    await runStage(STAGES.VERIFY_OWNERSHIP, async () => {
      const ownedOrganizations = await listOrganizationsOwnedByUserId(uid);
      if (!Array.isArray(ownedOrganizations)) {
        throw new AccountDeletionError("ownership_check_unavailable", {
          stage: STAGES.VERIFY_OWNERSHIP,
          retryable: true,
        });
      }
      const legacyOwnedIds = ownedOrganizations.map((record) => String(record?.id || record?.organizationId || "").trim());
      legacyOwnedIds.forEach((organizationId) => assertSafePathSegment(organizationId, "ownedOrganizationId"));
      const ownerOrganizationIds = [...new Set([
        ...memberships.filter(isActiveOwner).map((membership) => membership.organizationId),
        ...legacyOwnedIds,
      ])].sort();

      for (const organizationId of ownerOrganizationIds) {
        const ownerRecords = await listActiveOwnersByOrganizationId(organizationId);
        if (!Array.isArray(ownerRecords)) {
          throw new AccountDeletionError("ownership_check_unavailable", {
            stage: STAGES.VERIFY_OWNERSHIP,
            retryable: true,
          });
        }
        const hasOtherOwner = ownerRecords
          .map(normalizeRecord)
          .some((owner) => owner
            && owner.userId !== uid
            && owner.organizationId === organizationId
            && isActiveOwner(owner));
        if (!hasOtherOwner) {
          throw new AccountDeletionError("sole_organization_owner", {
            stage: STAGES.VERIFY_OWNERSHIP,
            retryable: false,
            details: { organizationId },
          });
        }
      }
    });

    const storagePrefix = `users/${uid}/`;
    const userPath = `users/${uid}`;
    const legacyOrganizationPath = `organizations/legacy_${uid}`;

    await runStage(
      STAGES.DELETE_STORAGE,
      () => deleteStoragePrefix(storagePrefix),
      { ignoreNotFound: true },
    );
    await runStage(
      STAGES.DELETE_USER_TREE,
      () => deleteUserTree(userPath),
      { ignoreNotFound: true },
    );
    await runStage(
      STAGES.DELETE_LEGACY_ORGANIZATION,
      () => deleteLegacyOrganization(legacyOrganizationPath),
      { ignoreNotFound: true },
    );
    await runStage(STAGES.DELETE_MEMBERSHIPS, async () => {
      for (const membership of memberships) {
        try {
          await deleteMembership(`memberships/${membership.id}`);
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
        }
      }
    });

    // Authentication is intentionally deleted last. Until every scoped cleanup
    // stage succeeds, the caller retains an authenticated identity for retry.
    await runStage(
      STAGES.DELETE_AUTH_USER,
      () => deleteAuthUser(uid),
      { ignoreNotFound: true },
    );

    return Object.freeze({ status: "deleted" });
  }

  return Object.freeze({ deleteCurrentUserAccount });
}

module.exports = {
  AccountDeletionError,
  AccountDeletionStageError,
  CLIENT_AUTHORITY_FIELDS,
  DEFAULT_MAX_AUTH_AGE_SECONDS,
  STAGES,
  SERVER_CONFIRMATION,
  createAccountDeletionService,
  defaultIsNotFoundError,
  isActiveMembership,
  isActiveOwner,
};
