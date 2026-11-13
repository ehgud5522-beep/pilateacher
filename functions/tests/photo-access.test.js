"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mayAccessPhoto, preparePhotoAccess, movePhotoGroup } = require("../src/photo-access");

function fixture() {
  const data = new Map([
    ["memberships/org_teacher", { status: "active", role: "instructor" }],
    ["organizations/org/clients/a", { instructorIds: ["teacher"] }],
    ["organizations/org/clients/b", { instructorIds: ["teacher"] }],
    ["users/teacher/photoBackups/p", { organizationId: "org", clientId: "a", memberId: "local-a", photoId: "p", originalSha256: "digest", record: { id: "p", memberId: "local-a", albumEdit: { rotate: 90 } }, references: [{ memberId: "local-a", record: { id: "p", memberId: "local-a" } }] }],
  ]);
  const doc = (path) => ({ path,
    get: async () => ({ exists: data.has(path), data: () => data.get(path) }),
    set: async (value, options) => data.set(path, options?.merge ? { ...data.get(path), ...value } : value),
    create: async (value) => { if (data.has(path)) throw new Error("exists"); data.set(path, value); },
  });
  const db = { doc, batch: () => { const writes = []; return { update: (ref, value) => writes.push([ref.path, value]), commit: async () => { for (const [path, value] of writes) data.set(path, { ...data.get(path), ...value }); } }; } };
  const files = new Map(["image.jpg", "thumb.jpg", "original.bin"].map((name) => [`users/teacher/photos/p/${name}`, { metadata: { organizationId: "org", clientId: "a", sha256: "digest", firebaseStorageDownloadTokens: "old-token" } }]));
  const fault = { fail: false };
  const bucket = { file: (path) => ({ exists: async () => [files.has(path)], getMetadata: async () => [files.get(path)], setMetadata: async (value) => { if (fault.fail) { fault.fail = false; throw new Error("network"); } const old = files.get(path); files.set(path, { ...old, ...value, metadata: { ...old.metadata, ...value.metadata } }); } }) };
  return { data, db, bucket, files, fault };
}
test("current assignment and retirement override a previously valid login", () => {
  const membership = { status: "active", role: "instructor" }, client = { instructorIds: ["teacher"] };
  assert.equal(mayAccessPhoto("teacher", membership, client), true);
  assert.equal(mayAccessPhoto("teacher", membership, { ...client, photoAccessRevoked: { teacher: true } }), false);
  assert.equal(mayAccessPhoto("teacher", { ...membership, status: "inactive" }, client), false);
  assert.equal(mayAccessPhoto("other", membership, client), false);
  assert.equal(mayAccessPhoto("teacher", { status: "active", role: "member" }, client), false);
});
test("prepare preserves digest, removes bearer tokens, and rejects scope substitution", async () => {
  const f = fixture();
  await preparePhotoAccess(f.db, f.bucket, "teacher", { photoId: "p", organizationId: "org", clientId: "a" });
  for (const file of f.files.values()) { assert.equal(file.metadata.firebaseStorageDownloadTokens, null); assert.equal(file.metadata.sha256, "digest"); assert.equal(file.cacheControl, "private,no-store,max-age=0"); }
  await assert.rejects(preparePhotoAccess(f.db, f.bucket, "teacher", { photoId: "p", organizationId: "org", clientId: "b" }), /immutable/);
});
test("interrupted graph move resumes without rewriting originals or losing edits", async () => {
  const f = fixture(), input = { organizationId: "org", clientId: "b", targetMemberId: "local-b", photoIds: ["p"] };
  f.fault.fail = true;
  await assert.rejects(movePhotoGroup(f.db, f.bucket, "teacher", input), /network/);
  assert.equal(f.data.get("users/teacher/photoBackups/p").moving, true);
  const result = await movePhotoGroup(f.db, f.bucket, "teacher", input);
  assert.equal(result.state, "complete");
  const photo = f.data.get("users/teacher/photoBackups/p");
  assert.equal(photo.memberId, "local-b"); assert.equal(photo.references[0].record.memberId, "local-b");
  assert.equal(photo.record.albumEdit.rotate, 90); assert.equal(photo.originalSha256, "digest"); assert.equal(photo.moving, false);
  assert.deepEqual(await movePhotoGroup(f.db, f.bucket, "teacher", input), result);
});
test("move refuses an unauthorized target without altering the source", async () => {
  const f = fixture(); f.data.set("organizations/org/clients/b", { instructorIds: ["other"] });
  await assert.rejects(movePhotoGroup(f.db, f.bucket, "teacher", { organizationId: "org", clientId: "b", targetMemberId: "local-b", photoIds: ["p"] }), /access-denied/);
  assert.equal(f.data.get("users/teacher/photoBackups/p").clientId, "a");
});
