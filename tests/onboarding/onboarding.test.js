import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ONBOARDING_STORAGE_KEY, completeOnboarding, hasCompletedOnboarding,
} from "../../src/features/onboarding/onboarding-storage.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("onboarding completion survives app version changes", () => {
  const storage = memoryStorage();
  assert.equal(hasCompletedOnboarding(storage), false);
  assert.equal(completeOnboarding(storage), true);
  assert.equal(hasCompletedOnboarding(storage), true);
  assert.equal(ONBOARDING_STORAGE_KEY.includes("1.1."), false);
});

test("unavailable storage fails safely without claiming completion", () => {
  const storage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.equal(hasCompletedOnboarding(storage), false);
  assert.equal(completeOnboarding(storage), false);
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
  assert.match(source, /phase === "splash" \|\| onboardingCheckedRef\.current/);
  assert.match(source, /hasCompletedOnboarding\(window\.localStorage\)/);

  const onboardingSource = fs.readFileSync(path.resolve("src/features/onboarding/Onboarding.jsx"), "utf8");
  assert.doesNotMatch(onboardingSource, /setTimeout|setInterval/);
});
