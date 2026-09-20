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

/* ── 센터가 등록한 회원 ────────────────────────────────────────────────────

   기기 백업에만 회원이 있다고 보던 시절의 판정이 남아 있었다. FC매니저가
   등록한 회원은 강사의 기기에 없어서, 그 회원의 음성 수업기록이 게이트웨이
   authorization 에서 member_not_owned 로 막혔다 -- 앱은 회원을 찾는데
   서버만 organizations/{org}/clients 를 몰랐다. */

const orgSeed = (overrides = {}) => ({
  "users/user-1/backup/latest": { data: { members: [], schedule: [] } },
  "users/user-1/aiConsents/client-9": consent(),
  "memberships/center-a_user-1": { organizationId: "center-a", userId: "user-1", role: "instructor", status: "active" },
  "organizations/center-a/clients/client-9": { organizationId: "center-a", name: "박서연", status: "active" },
  ...overrides,
});

const orgPolicy = (seedValue) => createFirestorePolicyService({
  firestore: createFakeFirestore(seedValue), mode: "legacy_owner_backup",
});

test("a member the centre registered is authorized, though the device never had them", async () => {
  const result = await orgPolicy(orgSeed()).authorize({ uid: "user-1", memberId: "client-9", operation: "analyzeBody" });
  assert.equal(result.allowed, true);
  assert.equal(result.memberName, "박서연");
});

test("membership is the authority, not the organization the caller names", async () => {
  /* 요청에 조직 번호를 싣지 않는 이유가 이것이다. 소속이 없거나 끊긴 사람은
     그 센터의 회원에 닿지 못한다 -- 서버가 uid 로 찾으므로 적어 보낼 자리가
     아예 없다. */
  const stranger = orgSeed({ "memberships/center-a_user-1": undefined });
  delete stranger["memberships/center-a_user-1"];
  assert.equal(
    (await orgPolicy(stranger).authorize({ uid: "user-1", memberId: "client-9", operation: "analyzeBody" })).reason,
    "member_not_owned",
  );

  const retired = orgSeed({
    "memberships/center-a_user-1": { organizationId: "center-a", userId: "user-1", role: "instructor", status: "revoked" },
  });
  assert.equal(
    (await orgPolicy(retired).authorize({ uid: "user-1", memberId: "client-9", operation: "analyzeBody" })).reason,
    "member_not_owned",
  );

  const otherCentre = orgSeed({
    "memberships/center-a_user-1": { organizationId: "center-b", userId: "user-1", role: "instructor", status: "active" },
  });
  assert.equal(
    (await orgPolicy(otherCentre).authorize({ uid: "user-1", memberId: "client-9", operation: "analyzeBody" })).reason,
    "member_not_owned",
  );
});

test("someone else's membership does not become mine", async () => {
  const seedValue = orgSeed({
    "memberships/center-a_user-2": { organizationId: "center-a", userId: "user-2", role: "instructor", status: "active" },
  });
  delete seedValue["memberships/center-a_user-1"];
  assert.equal(
    (await orgPolicy(seedValue).authorize({ uid: "user-1", memberId: "client-9", operation: "analyzeBody" })).reason,
    "member_not_owned",
  );
});

test("consent is still required for a centre member", async () => {
  const seedValue = orgSeed();
  delete seedValue["users/user-1/aiConsents/client-9"];
  assert.equal(
    (await orgPolicy(seedValue).authorize({ uid: "user-1", memberId: "client-9", operation: "analyzeBody" })).reason,
    "consent_missing",
  );
});

test("a centre member with no device backup at all still gets through", async () => {
  /* 갓 붙은 강사는 백업이 없을 수 있다. 백업 없음으로 막으면 그 강사는 센터
     회원에게도 아무것도 못 한다. */
  const seedValue = orgSeed();
  delete seedValue["users/user-1/backup/latest"];
  assert.equal(
    (await orgPolicy(seedValue).authorize({ uid: "user-1", memberId: "client-9", operation: "analyzeBody" })).allowed,
    true,
  );
  // 회원도 소속도 없으면 예전 그대로 backup_missing 이다 -- 둘은 다른 실패다.
  const nothing = { "users/user-1/aiConsents/member-1": consent() };
  assert.equal(
    (await orgPolicy(nothing).authorize({ uid: "user-1", memberId: "member-1", operation: "analyzeBody" })).reason,
    "backup_missing",
  );
});

test("the lesson check accepts either the device or the settled organization lesson", async () => {
  /* 음성 수업기록은 lessonId 를 함께 보낸다. 정산 전 수업은 기기에만 있고,
     정산한 수업은 조직에도 참가자 문서가 생긴다. 둘 중 하나면 된다. */
  const onDevice = orgSeed({
    "users/user-1/backup/latest": { data: { members: [], schedule: [{ id: "lesson-1", attendees: [{ memberId: "client-9" }] }] } },
  });
  assert.equal(
    (await orgPolicy(onDevice).authorize({ uid: "user-1", memberId: "client-9", lessonId: "lesson-1", operation: "summarizeVoice" })).allowed,
    true,
  );

  const settled = orgSeed({
    "organizations/center-a/lessons/lesson-1/participants/client-9": { clientId: "client-9" },
  });
  assert.equal(
    (await orgPolicy(settled).authorize({ uid: "user-1", memberId: "client-9", lessonId: "lesson-1", operation: "summarizeVoice" })).allowed,
    true,
  );

  // 어느 쪽으로도 증명되지 않으면 거부한다. 회원이 맞다고 수업까지 맞는 것은 아니다.
  assert.equal(
    (await orgPolicy(orgSeed()).authorize({ uid: "user-1", memberId: "client-9", lessonId: "lesson-1", operation: "summarizeVoice" })).reason,
    "lesson_not_owned",
  );
});
