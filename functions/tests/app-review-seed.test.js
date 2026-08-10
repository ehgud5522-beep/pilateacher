"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildReviewSeed,
  deterministicUserId,
  runSeedOperation,
  seedChecksum,
} = require("../src/app-review-seed");
const {
  detectCredentialProjectId,
  main,
  parseArguments,
} = require("../scripts/seed-app-review");

const EMAIL = "app-review@example.test";
const PASSWORD = "review-password-2026";
const PROJECT = "pilateacher-dev";
const REFERENCE_DATE = "2026-08-05";

test("review seed is deterministic and contains only stable fixture ids", () => {
  const input = { uid: deterministicUserId(EMAIL), email: EMAIL, referenceDate: REFERENCE_DATE };
  const first = buildReviewSeed(input);
  const second = buildReviewSeed(input);
  assert.deepEqual(first, second);
  assert.equal(seedChecksum(first), seedChecksum(second));
  assert.equal(new Set(first.backup.data.members.map((item) => item.id)).size, first.backup.data.members.length);
  assert.equal(new Set(first.backup.data.schedule.map((item) => item.id)).size, first.backup.data.schedule.length);
});

test("review seed includes three placeholder members and reviewable schedule states", () => {
  const seed = buildReviewSeed({ uid: "review-uid", email: EMAIL, referenceDate: REFERENCE_DATE });
  assert.equal(seed.backup.data.members.length, 3);
  assert.deepEqual(seed.backup.data.members.map((item) => item.status), ["active", "hold", "active"]);
  assert.equal(seed.backup.data.members.find((item) => item.id === "review-member-expiring").regular, 2);
  const statuses = new Set(seed.backup.data.schedule.flatMap((item) => [item.status, ...(item.attendees || []).map((attendee) => attendee.status)]).filter(Boolean));
  for (const expected of ["booked", "done", "noshow", "cancel"]) assert.equal(statuses.has(expected), true);
  assert.equal(seed.backup.data.schedule.some((item) => item.type === "그룹" && item.groupDone === false), true);
});

test("manual assessment placeholder is one safe three-view set without real photos or fake AI", () => {
  const seed = buildReviewSeed({ uid: "review-uid", email: EMAIL, referenceDate: REFERENCE_DATE });
  const photos = seed.backup.reviewPhotos["review-member-active"];
  const records = [photos.front[0], photos.leftSide[0], photos.back[0]];
  assert.deepEqual(records.map((item) => item.view), ["front", "leftSide", "back"]);
  assert.equal(new Set(records.map((item) => item.assessmentId)).size, 1);
  assert.equal(records.every((item) => item.analysisMethod === "manual" && item.captureStatus === "completed"), true);
  assert.equal(records.every((item) => item.src.startsWith("data:image/svg+xml") && !("blobId" in item)), true);
  assert.equal(records.every((item) => item.mediaState === "safe_review_placeholder"), true);
  assert.deepEqual(photos.poses, []);
  const serialized = JSON.stringify(seed);
  assert.equal(serialized.includes("aiAnalysis"), false);
  assert.equal(serialized.includes("interpretation"), false);
});

test("default CLI mode is dry-run and apply must be explicit", () => {
  assert.deepEqual(parseArguments(["--project", PROJECT]), { mode: "dry-run", projectId: PROJECT, help: false });
  assert.deepEqual(parseArguments([`--project=${PROJECT}`, "--apply"]), { mode: "apply", projectId: PROJECT, help: false });
});

test("production project is blocked before any adapter call", async () => {
  let calls = 0;
  const adapter = {
    async assertProject() { calls += 1; },
    async ensureUser() { calls += 1; },
    async writeSeed() { calls += 1; },
  };
  await assert.rejects(
    runSeedOperation({ mode: "apply", projectId: "pilateacher-prod", email: EMAIL, password: PASSWORD, adapter }),
    (error) => error.code === "production_project_blocked",
  );
  assert.equal(calls, 0);
});

test("dry-run performs no Admin calls and exposes no credential values", async () => {
  const result = await runSeedOperation({
    mode: "dry-run",
    projectId: PROJECT,
    email: EMAIL,
    password: PASSWORD,
    adapter: new Proxy({}, { get() { throw new Error("Admin adapter must not be read"); } }),
    referenceDate: REFERENCE_DATE,
  });
  assert.equal(result.writesPerformed, false);
  assert.equal(JSON.stringify(result).includes(EMAIL), false);
  assert.equal(JSON.stringify(result).includes(PASSWORD), false);
});

test("apply orchestration is retry-safe after a partial write failure", async () => {
  const users = new Map();
  let createCount = 0;
  let writeAttempts = 0;
  let stored = null;
  const adapter = {
    async assertProject(projectId) { assert.equal(projectId, PROJECT); },
    async ensureUser({ email, deterministicUid }) {
      if (!users.has(email)) {
        users.set(email, { uid: deterministicUid });
        createCount += 1;
      }
      return users.get(email);
    },
    async writeSeed(value) {
      writeAttempts += 1;
      if (writeAttempts === 1) throw Object.assign(new Error("injected"), { code: "injected_failure" });
      stored = value;
    },
  };
  const options = { mode: "apply", projectId: PROJECT, email: EMAIL, password: PASSWORD, adapter, referenceDate: REFERENCE_DATE };
  await assert.rejects(runSeedOperation(options), (error) => error.code === "injected_failure");
  const result = await runSeedOperation(options);
  assert.equal(result.writesPerformed, true);
  assert.equal(createCount, 1);
  assert.equal(writeAttempts, 2);
  assert.equal(stored.uid, deterministicUserId(EMAIL));
  assert.equal(stored.backup.data.members.length, 3);
});

test("credential project detection supports explicit environment and service account metadata", () => {
  assert.equal(detectCredentialProjectId({ GOOGLE_CLOUD_PROJECT: PROJECT }), PROJECT);
  assert.equal(detectCredentialProjectId({ FIREBASE_CONFIG: JSON.stringify({ projectId: PROJECT }) }), PROJECT);
  assert.equal(detectCredentialProjectId(
    { GOOGLE_APPLICATION_CREDENTIALS: "credential.json" },
    () => JSON.stringify({ project_id: PROJECT }),
  ), PROJECT);
  assert.equal(detectCredentialProjectId(
    { GOOGLE_APPLICATION_CREDENTIALS: "credential.json", GOOGLE_CLOUD_PROJECT: "different-project" },
    () => JSON.stringify({ project_id: PROJECT }),
  ), PROJECT);
  assert.equal(detectCredentialProjectId({}, () => ""), "");
});

test("CLI dry-run returns a sanitized report and does not load Firebase Admin", async () => {
  const output = [];
  const errors = [];
  const exitCode = await main({
    argv: ["--project", PROJECT],
    env: { APP_REVIEW_EMAIL: EMAIL, APP_REVIEW_PASSWORD: PASSWORD },
    write: (line) => output.push(line),
    writeError: (line) => errors.push(line),
    modules: new Proxy({}, { get() { throw new Error("Firebase Admin must not load during dry-run"); } }),
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(errors, []);
  assert.equal(output.join("\n").includes(EMAIL), false);
  assert.equal(output.join("\n").includes(PASSWORD), false);
  assert.equal(JSON.parse(output.join("\n")).mode, "dry-run");
});

test("CLI refuses apply when the Admin credential project cannot be verified", async () => {
  const errors = [];
  const exitCode = await main({
    argv: ["--project", PROJECT, "--apply"],
    env: { APP_REVIEW_EMAIL: EMAIL, APP_REVIEW_PASSWORD: PASSWORD },
    write: () => {},
    writeError: (line) => errors.push(line),
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(errors, ["[app-review-seed] failed code=admin_project_unverified"]);
});
