export const ONBOARDING_STORAGE_KEY = "pilateacher_onboarding_completed_v1";

export function hasCompletedOnboarding(storage) {
  try {
    return storage?.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch (_error) {
    return false;
  }
}

export function completeOnboarding(storage) {
  try {
    storage?.setItem(ONBOARDING_STORAGE_KEY, "1");
    return storage?.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch (_error) {
    return false;
  }
}
