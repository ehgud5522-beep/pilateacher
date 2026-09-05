import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  LEGACY_ONBOARDING_STORAGE_KEY, ONBOARDING_MIGRATION_CLAIM_KEY, completeOnboarding, hasCompletedOnboarding,
  onboardingStorageKey, resolveOnboardingCompletion,
} from "../../src/features/onboarding/onboarding-storage.js";

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

test("onboarding completion survives app version changes", () => {
  const storage = memoryStorage();
  assert.equal(hasCompletedOnboarding(storage, "account-a"), false);
  assert.equal(completeOnboarding(storage, "account-a"), true);
  assert.equal(hasCompletedOnboarding(storage, "account-a"), true);
  assert.equal(onboardingStorageKey("account-a").includes("1.1."), false);
  assert.equal(hasCompletedOnboarding(storage, "account-b"), false);
});

test("unavailable storage fails safely without claiming completion", () => {
  const storage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.equal(hasCompletedOnboarding(storage, "account-a"), false);
  assert.equal(completeOnboarding(storage, "account-a"), false);
});

test("legacy completion is claimed once by the persisted account and never copied to a second account", () => {
  const storage = memoryStorage([
    [LEGACY_ONBOARDING_STORAGE_KEY, "1"],
    ["pilateacher_session_v1", JSON.stringify({ accountId: "account-a", auto: true })],
  ]);
  const first = resolveOnboardingCompletion(storage, "account-a");
  const repeat = resolveOnboardingCompletion(storage, "account-a");
  const second = resolveOnboardingCompletion(storage, "account-b");
  assert.equal(first.completed, true);
  assert.equal(first.migrationGuard, "persisted_session");
  assert.equal(repeat.completed, true);
  assert.equal(second.completed, false);
  assert.equal(second.migrationGuard, "claimed_by_other_account");
  assert.equal(storage.getItem(ONBOARDING_MIGRATION_CLAIM_KEY), "account-a");
  assert.equal(storage.getItem(LEGACY_ONBOARDING_STORAGE_KEY), "1");
});

test("one account-scoped app database can identify the legacy owner", () => {
  const storage = memoryStorage([
    [LEGACY_ONBOARDING_STORAGE_KEY, "1"],
    ["pilateacher_db_account-a", "{}"],
  ]);
  const result = resolveOnboardingCompletion(storage, "account-a");
  assert.equal(result.completed, true);
  assert.equal(result.migrationGuard, "single_account_database");
});

test("ambiguous legacy ownership is not migrated", () => {
  const storage = memoryStorage([
    [LEGACY_ONBOARDING_STORAGE_KEY, "1"],
    ["pilateacher_db_account-a", "{}"],
    ["pilateacher_db_account-b", "{}"],
  ]);
  const result = resolveOnboardingCompletion(storage, "account-a");
  assert.equal(result.completed, false);
  assert.equal(result.migrationGuard, "ambiguous_legacy_owner");
  assert.equal(storage.getItem(ONBOARDING_MIGRATION_CLAIM_KEY), null);
});

test("logout session removal does not remove account completion", () => {
  const storage = memoryStorage();
  completeOnboarding(storage, "account-a");
  storage.removeItem("pilateacher_session_v1");
  assert.equal(hasCompletedOnboarding(storage, "account-a"), true);
});

test("onboarding is demo-only and never requests AI or microphone access", () => {
  const file = path.resolve("src/features/onboarding/Onboarding.jsx");
  const source = fs.readFileSync(file, "utf8");
  assert.match(source, /실제 회원 데이터가 아닙니다/);
  assert.match(source, /수업은 선생님이/);
  assert.match(source, /PilaTeacher 시작하기/);
  assert.doesNotMatch(source, /getUserMedia|SpeechRecognition|aiProvider|fetch\s*\(/);
});

test("app exposes onboarding replay from More without adding startup delay", () => {
  const source = fs.readFileSync(path.resolve("src/App.jsx"), "utf8");
  assert.match(source, /PilaTeacher 사용법/);
  assert.match(source, /onOpenOnboarding=\{\(\) => setOnboardingOpen\(true\)\}/);
  assert.match(source, /phase !== "app" \|\| !accountId/);
  assert.match(source, /resolveOnboardingCompletion\(window\.localStorage, accountId\)/);
  assert.match(source, /completeOnboarding\(window\.localStorage, account\.id\)/);

  const onboardingSource = fs.readFileSync(path.resolve("src/features/onboarding/Onboarding.jsx"), "utf8");
  assert.doesNotMatch(onboardingSource, /setTimeout|setInterval/);
});
