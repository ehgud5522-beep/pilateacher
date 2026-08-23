"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPhotoBackupCleanupService, ownedPhotoPath } = require("../src/photo-backup-cleanup");

test("owned photo paths are exact and cannot cross user or photo scope", () => {
  assert.equal(ownedPhotoPath("users/u1/photos/p1/image.jpg", "u1", "p1"), true);
  assert.equal(ownedPhotoPath("users/u2/photos/p1/image.jpg", "u1", "p1"), false);
  assert.equal(ownedPhotoPath("users/u1/photos/p2/image.jpg", "u1", "p1"), false);
  assert.equal(ownedPhotoPath("users/u1/photos/p1/other.jpg", "u1", "p1"), false);
});

test("expired soft-deleted photos purge both files and metadata while active photos remain", async () => {
  const deleted = [];
  const docs = [
    { id: "old", data: () => ({ status: "deleted", purgeAfter: new Date("2026-07-01"), storagePath: "users/u1/photos/old/image.jpg", thumbnailPath: "users/u1/photos/old/thumb.jpg" }), ref: { delete: async () => deleted.push("doc:old") } },
    { id: "active", data: () => ({ status: "active", purgeAfter: null, storagePath: "users/u1/photos/active/image.jpg", thumbnailPath: "users/u1/photos/active/thumb.jpg" }), ref: { delete: async () => deleted.push("doc:active") } },
    { id: "future", data: () => ({ status: "deleted", purgeAfter: new Date("2026-09-01"), storagePath: "users/u1/photos/future/image.jpg", thumbnailPath: "users/u1/photos/future/thumb.jpg" }), ref: { delete: async () => deleted.push("doc:future") } },
  ];
  const service = createPhotoBackupCleanupService({
    firestore: { collection: () => ({ get: async () => ({ docs }) }) },
    bucket: { file: (path) => ({ delete: async () => deleted.push(path) }) },
    now: () => new Date("2026-08-24"),
  });
  assert.deepEqual(await service.purgeForUser("u1"), { purged: 1, remaining: 0 });
  assert.deepEqual(deleted.sort(), ["doc:old", "users/u1/photos/old/image.jpg", "users/u1/photos/old/thumb.jpg"].sort());
});

test("scheduled cleanup scans expired tombstones across users with exact owner paths", async () => {
  const deleted = [];
  const docs = [
    { id: "p1", data: () => ({ status: "deleted", purgeAfter: new Date("2026-07-01"), storagePath: "users/u1/photos/p1/image.jpg", thumbnailPath: "users/u1/photos/p1/thumb.jpg" }), ref: { delete: async () => deleted.push("doc:p1") } },
  ];
  const query = { where: () => query, limit: () => query, get: async () => ({ docs }) };
  const service = createPhotoBackupCleanupService({
    firestore: { collectionGroup: () => query },
    bucket: { file: (path) => ({ delete: async () => deleted.push(path) }) },
    now: () => new Date("2026-08-24"),
  });
  assert.deepEqual(await service.purgeExpiredGlobal(), { purged: 1, remaining: 0 });
  assert.equal(deleted.includes("doc:p1"), true);
});
