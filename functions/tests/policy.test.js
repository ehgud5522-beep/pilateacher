"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFirestorePolicyService } = require("../src/policy");
const { createFakeFirestore } = require("./fake-firestore");

const consent = (overrides = {}) => ({
  status: "granted",
  policyVersion: "2026-08-23",
  scopes: ["analyzeBody", "summarizeVoice", "recommendSequence", "generateReport"],
  grantedAt: new Date("2026-08-23T00:00:00Z"),
  revokedAt: null,
  ...overrides,
});

const seed = (consentValue = consent()) => ({
  "users/user-1/backup/latest": {
    data: {
      members: [{ id: "member-1", name: "김지민" }],
      schedule: [{ id: "lesson-1", attendees: [{ memberId: "member-1" }] }],
    },
  },
  "users/user-1/aiConsents/member-1": consentValue,
});

test("policy requires explicit mode, owned member and exact consent scope", async () => {
  const firestore = createFakeFirestore(seed());
  const disabled = createFirestorePolicyService({ firestore });
  assert.equal((await disabled.authorize({ uid: "user-1", memberId: "member-1", operation: "analyzeBody" })).allowed, false);

  const policy = createFirestorePolicyService({ firestore, mode: "legacy_owner_backup" });
  const result = await policy.authorize({ uid: "user-1", memberId: "member-1", operation: "analyzeBody" });
  assert.equal(result.allowed, true);
  assert.equal(result.memberName, "김지민");
  assert.equal((await policy.authorize({ uid: "user-1", memberId: "unknown", operation: "analyzeBody" })).reason, "consent_missing");

  const wrongScope = createFirestorePolicyService({ firestore: createFakeFirestore(seed(consent({ scopes: ["generateReport"] }))), mode: "legacy_owner_backup" });
  assert.equal((await wrongScope.authorize({ uid: "user-1", memberId: "member-1", operation: "analyzeBody" })).reason, "consent_not_granted");
  const incomplete = createFirestorePolicyService({ firestore: createFakeFirestore(seed(consent({ grantedAt: "not-a-timestamp", revokedAt: undefined }))), mode: "legacy_owner_backup" });
  assert.equal((await incomplete.authorize({ uid: "user-1", memberId: "member-1", operation: "analyzeBody" })).reason, "consent_not_granted");
});

test("voice operation verifies that the lesson contains the owned member", async () => {
  const policy = createFirestorePolicyService({ firestore: createFakeFirestore(seed()), mode: "legacy_owner_backup" });
  assert.equal((await policy.authorize({ uid: "user-1", memberId: "member-1", lessonId: "lesson-1", operation: "summarizeVoice" })).allowed, true);
  assert.equal((await policy.authorize({ uid: "user-1", memberId: "member-1", lessonId: "other", operation: "summarizeVoice" })).allowed, false);
});

test("durable limiter atomically enforces minute and daily bounds", async () => {
  let current = new Date("2026-08-23T01:00:00Z");
  const policy = createFirestorePolicyService({
    firestore: createFakeFirestore(seed()), mode: "legacy_owner_backup", minuteLimit: 2, dailyLimit: 3, now: () => current,
  });
  assert.equal((await policy.consumeRateLimit({ uid: "user-1" })).allowed, true);
  assert.equal((await policy.consumeRateLimit({ uid: "user-1" })).allowed, true);
  const minuteDenied = await policy.consumeRateLimit({ uid: "user-1" });
  assert.equal(minuteDenied.allowed, false);
  assert.ok(minuteDenied.retryAfterSeconds > 0);
  current = new Date("2026-08-23T01:01:00Z");
  assert.equal((await policy.consumeRateLimit({ uid: "user-1" })).allowed, true);
  assert.equal((await policy.consumeRateLimit({ uid: "user-1" })).allowed, false);
});
