import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_DELETION_PHASES,
  AccountDeletionFlowError,
  DELETE_CONFIRMATION_PHRASE,
  collectOwnedBlobIds,
  collectReferencedBlobIds,
  isAccountDeletionPhraseConfirmed,
  runAccountDeletion,
} from "../../src/features/account/account-deletion.js";

test("account deletion requires the exact normalized confirmation phrase", async () => {
  assert.equal(DELETE_CONFIRMATION_PHRASE, "계정 삭제");
  assert.equal(isAccountDeletionPhraseConfirmed(" 계정 삭제 "), true);
  assert.equal(isAccountDeletionPhraseConfirmed("삭제"), false);

  let called = false;
  await assert.rejects(
    runAccountDeletion({
      confirmationPhrase: "삭제",
      reauthenticate: async () => { called = true; },
      deleteServerAccount: async () => ({ deleted: true }),
      cleanupLocalData: async () => {},
    }),
    (error) => error instanceof AccountDeletionFlowError && error.code === "account_deletion/confirmation_required",
  );
  assert.equal(called, false);
});

test("referenced blob IDs are collected recursively, deduplicated, and cycle-safe", () => {
  const db = {
    members: [{ photo: { blobId: "member-photo" } }],
    lessons: [{ note: { audioBlobId: "voice-1" } }, { note: { audioBlobId: "voice-1" } }],
    ignored: { id: "not-a-blob", src: "data:image/png;base64,secret" },
    blobIds: ["extra-2", "extra-1"],
  };
  const photos = [{ cleanBlobId: "clean-photo" }, { recordingBlobId: "recording" }];
  db.circular = db;
  assert.deepEqual(collectOwnedBlobIds(db, photos), [
    "clean-photo",
    "extra-1",
    "extra-2",
    "member-photo",
    "recording",
    "voice-1",
  ]);
  assert.deepEqual(collectReferencedBlobIds({ src: "https://example.com/photo.jpg" }), []);
});

test("successful deletion uses reauth, trusted server, then local cleanup in order", async () => {
  const calls = [];
  const phases = [];
  const result = await runAccountDeletion({
    confirmationPhrase: "계정 삭제",
    provider: "google",
    reauthenticate: async (input) => {
      calls.push(["reauthenticate", input]);
      return { proof: "recent-auth" };
    },
    deleteServerAccount: async (input) => {
      calls.push(["deleteRemote", input]);
      return { deleted: true, requestId: "r1" };
    },
    cleanupLocalData: async (input) => { calls.push(["cleanupLocal", input]); },
    localDataSnapshot: { members: [{ blobId: "photo-1" }], lessons: [{ audioBlobId: "voice-1" }] },
    onPhase: (phase) => { phases.push(phase); },
  });
  assert.deepEqual(calls.map(([name]) => name), ["reauthenticate", "deleteRemote", "cleanupLocal"]);
  assert.deepEqual(calls[0][1], { provider: "google", password: "" });
  assert.deepEqual(calls[1][1], { provider: "google", reauthentication: { proof: "recent-auth" } });
  assert.deepEqual(calls[2][1].blobIds, ["photo-1", "voice-1"]);
  assert.deepEqual(phases, [
    ACCOUNT_DELETION_PHASES.REAUTHENTICATING,
    ACCOUNT_DELETION_PHASES.DELETING_REMOTE,
    ACCOUNT_DELETION_PHASES.CLEANING_LOCAL,
    ACCOUNT_DELETION_PHASES.COMPLETED,
  ]);
  assert.equal(result.status, "deleted");
});

test("Apple provider revocation happens after reauthentication and before remote deletion", async () => {
  const calls = [];
  await runAccountDeletion({
    confirmationPhrase: "계정 삭제",
    provider: "apple",
    reauthenticate: async () => {
      calls.push("reauthenticate");
      return { authorizationCode: "one-time-code" };
    },
    revokeApple: async ({ reauthentication }) => {
      calls.push(`revoke:${reauthentication.authorizationCode}`);
    },
    deleteServerAccount: async () => {
      calls.push("deleteRemote");
      return { status: "deleted" };
    },
    cleanupLocalData: async () => { calls.push("cleanupLocal"); },
  });
  assert.deepEqual(calls, ["reauthenticate", "revoke:one-time-code", "deleteRemote", "cleanupLocal"]);
});

test("cancelled reauthentication preserves remote and local data", async () => {
  let remoteCalls = 0;
  let cleanupCalls = 0;
  await assert.rejects(
    runAccountDeletion({
      confirmationPhrase: "계정 삭제",
      reauthenticate: async () => { throw Object.assign(new Error("cancelled"), { code: "auth/popup-closed-by-user" }); },
      deleteServerAccount: async () => { remoteCalls += 1; return { deleted: true }; },
      cleanupLocalData: async () => { cleanupCalls += 1; },
    }),
    (error) => error instanceof AccountDeletionFlowError && error.cancelled === true,
  );
  assert.equal(remoteCalls, 0);
  assert.equal(cleanupCalls, 0);
});

test("reauthentication or remote failures never erase local data", async (context) => {
  await context.test("reauthentication failure", async () => {
    let cleanupCalls = 0;
    await assert.rejects(
      runAccountDeletion({
        confirmationPhrase: "계정 삭제",
        reauthenticate: async () => { throw new Error("provider failure"); },
        deleteServerAccount: async () => ({ deleted: true }),
        cleanupLocalData: async () => { cleanupCalls += 1; },
      }),
      (error) => /** @type {any} */ (error).code === "account_deletion/reauthentication_failed"
        && /** @type {any} */ (error).remoteDeleted === false,
    );
    assert.equal(cleanupCalls, 0);
  });

  await context.test("remote failure", async () => {
    let cleanupCalls = 0;
    await assert.rejects(
      runAccountDeletion({
        confirmationPhrase: "계정 삭제",
        reauthenticate: async () => ({ proof: true }),
        deleteServerAccount: async () => { throw new Error("callable unavailable"); },
        cleanupLocalData: async () => { cleanupCalls += 1; },
      }),
      (error) => /** @type {any} */ (error).code === "account_deletion/server_failed"
        && /** @type {any} */ (error).remoteDeleted === false,
    );
    assert.equal(cleanupCalls, 0);
  });
});

test("local cleanup failure explicitly reports that remote deletion already succeeded", async () => {
  await assert.rejects(
    runAccountDeletion({
      confirmationPhrase: "계정 삭제",
      reauthenticate: async () => ({ proof: true }),
      deleteServerAccount: async () => ({ deleted: true }),
      cleanupLocalData: async () => { throw new Error("IndexedDB unavailable"); },
    }),
    (error) => error instanceof AccountDeletionFlowError
      && error.code === "account_deletion/local_cleanup_failed"
      && error.remoteDeleted === true
      && error.phase === ACCOUNT_DELETION_PHASES.FAILED_LOCAL,
  );
});

test("sole organization owner failures keep local data and return an actionable message", async () => {
  let cleanupCalls = 0;
  await assert.rejects(
    runAccountDeletion({
      confirmationPhrase: DELETE_CONFIRMATION_PHRASE,
      reauthenticate: async () => ({ proof: true }),
      deleteServerAccount: async () => {
        throw { code: "functions/failed-precondition", details: { code: "sole_organization_owner" } };
      },
      cleanupLocalData: async () => { cleanupCalls += 1; },
    }),
    (error) => {
      const deletionError = /** @type {{code?: string, message?: string, remoteDeleted?: boolean}} */ (error);
      return deletionError.code === "account_deletion/sole_organization_owner"
        && deletionError.message?.includes("다른 관리자") === true
        && deletionError.remoteDeleted === false;
    },
  );
  assert.equal(cleanupCalls, 0);
});
