export const LEGACY_ONBOARDING_STORAGE_KEY = "pilateacher_onboarding_completed_v1";
export const ONBOARDING_ACCOUNT_KEY_PREFIX = "pilateacher_onboarding_completed_v2_";
export const ONBOARDING_MIGRATION_CLAIM_KEY = "pilateacher_onboarding_completion_migrated_to_v2";

export const onboardingStorageKey = (accountId) => `${ONBOARDING_ACCOUNT_KEY_PREFIX}${String(accountId || "").trim()}`;

function readPersistedSessionAccount(storage) {
  try {
    const value = JSON.parse(storage?.getItem("pilateacher_session_v1") || "null");
    return String(value?.accountId || "").trim();
  } catch (_error) {
    return "";
  }
}

function storedDatabaseAccountIds(storage) {
  const ids = [];
  try {
    for (let index = 0; index < Number(storage?.length || 0); index += 1) {
      const key = storage.key(index);
      if (key?.startsWith("pilateacher_db_")) ids.push(key.slice("pilateacher_db_".length));
    }
  } catch (_error) {
    return [];
  }
  return [...new Set(ids.filter(Boolean))];
}

export function hasCompletedOnboarding(storage, accountId) {
  const id = String(accountId || "").trim();
  if (!id) return false;
  try {
    return storage?.getItem(onboardingStorageKey(id)) === "1";
  } catch (_error) {
    return false;
  }
}

export function completeOnboarding(storage, accountId) {
  const id = String(accountId || "").trim();
  if (!id) return false;
  try {
    storage?.setItem(onboardingStorageKey(id), "1");
    return hasCompletedOnboarding(storage, id);
  } catch (_error) {
    return false;
  }
}

export function resolveOnboardingCompletion(storage, accountId) {
  const id = String(accountId || "").trim();
  if (!id) return { resolved: false, completed: false, migrated: false, migrationClaimedBy: "", migrationGuard: "account_unresolved" };
  if (hasCompletedOnboarding(storage, id)) return { resolved: true, completed: true, migrated: false, migrationClaimedBy: "", migrationGuard: "account_scoped" };

  try {
    if (storage?.getItem(LEGACY_ONBOARDING_STORAGE_KEY) !== "1") return { resolved: true, completed: false, migrated: false, migrationClaimedBy: "", migrationGuard: "no_legacy_completion" };
    const claimedBy = String(storage?.getItem(ONBOARDING_MIGRATION_CLAIM_KEY) || "").trim();
    if (claimedBy) {
      if (claimedBy === id) {
        storage.setItem(onboardingStorageKey(id), "1");
        return { resolved: true, completed: hasCompletedOnboarding(storage, id), migrated: true, migrationClaimedBy: id, migrationGuard: "existing_claim" };
      }
      return { resolved: true, completed: false, migrated: false, migrationClaimedBy: claimedBy, migrationGuard: "claimed_by_other_account" };
    }

    const persistedAccountId = readPersistedSessionAccount(storage);
    const databaseAccountIds = storedDatabaseAccountIds(storage);
    const guard = persistedAccountId === id
      ? "persisted_session"
      : databaseAccountIds.length === 1 && databaseAccountIds[0] === id
        ? "single_account_database"
        : "ambiguous_legacy_owner";
    if (guard === "ambiguous_legacy_owner") return { resolved: true, completed: false, migrated: false, migrationClaimedBy: "", migrationGuard: guard };

    storage.setItem(ONBOARDING_MIGRATION_CLAIM_KEY, id);
    if (storage.getItem(ONBOARDING_MIGRATION_CLAIM_KEY) !== id) return { resolved: true, completed: false, migrated: false, migrationClaimedBy: "", migrationGuard: "claim_failed" };
    storage.setItem(onboardingStorageKey(id), "1");
    return { resolved: true, completed: hasCompletedOnboarding(storage, id), migrated: true, migrationClaimedBy: id, migrationGuard: guard };
  } catch (_error) {
    return { resolved: true, completed: false, migrated: false, migrationClaimedBy: "", migrationGuard: "storage_unavailable" };
  }
}
