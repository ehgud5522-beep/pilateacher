import assert from "node:assert/strict";
import test from "node:test";
import {
  backupCounts, buildPhotoGraph, buildPhotoManifest, createEmergencyBackupEnvelope, createPhotoQueue, drainPhotoQueue, evaluateOverwriteRisk,
  mergePhotoGraph, mergePhotoMetadata, restorePhotoMetadata, storageUsage,
} from "../../src/features/backup/cloud-backup.js";
import { optimizePhotoBackup } from "../../src/features/backup/photo-optimizer.js";

const fixture = () => ({
  db: {
    members: Array.from({ length: 7 }, (_, index) => ({ id: `m${index + 1}`, aiMemory: index ? [] : [{ id: "memory-1", text: "source" }] })),
    schedule: Array.from({ length: 25 }, (_, index) => ({ id: `s${index + 1}`, memberId: `m${index % 7 + 1}` })),
  },
  photos: {
    m1: {
      front: [{ id: "photo-1", memberId: "m1", assessmentId: "assessment-1", view: "front", date: "2026-08-24", blobId: "blob-1", width: 1800, height: 1200, marks: [{ t: "arrow", x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.5 }] }],
      poses: [{ id: "photo-1", photoId: "photo-1", memberId: "m1", assessmentId: "assessment-1", view: "front", blobId: "blob-1", metrics: [{ key: "tilt", value: 2 }] }],
      sets: [{ id: "set-1", beforeId: "photo-1", afterId: "photo-2" }],
    },
  },
});

test("A/B: backup manifest preserves members, sessions, memory, posture and annotations for restore", () => {
  const source = fixture();
  const manifest = buildPhotoManifest(source.photos);
  const counts = backupCounts(source.db, manifest);
  assert.equal(counts.members, 7);
  assert.equal(counts.sessions, 25);
  assert.equal(counts.photos, 1, "the same photoId must not be duplicated across posture features");
  assert.equal(manifest[0].references.length, 2, "all feature references must survive one-file deduplication");
  const restored = restorePhotoMetadata([{ ...manifest[0], storagePath: "users/u/photos/photo-1/image.jpg", thumbnailPath: "users/u/photos/photo-1/thumb.jpg" }]);
  assert.equal(restored.m1.front[0].marks[0].t, "arrow");
  assert.equal(restored.m1.poses[0].metrics[0].key, "tilt");
  const graph = buildPhotoGraph(source.photos);
  assert.equal(mergePhotoGraph(restored, graph).m1.sets[0].beforeId, "photo-1");
  assert.equal(restored.m1.front[0].cloud.storagePath.endsWith("image.jpg"), true);
  assert.deepEqual(source.db.members[0].aiMemory, [{ id: "memory-1", text: "source" }]);
});

test("C: restored metadata contains paths but no eager image or base64 payload", () => {
  const item = { ...buildPhotoManifest(fixture().photos)[0], storagePath: "users/u/photos/photo-1/image.jpg", thumbnailPath: "users/u/photos/photo-1/thumb.jpg" };
  const restored = restorePhotoMetadata([item]).m1.front[0];
  assert.equal(restored.src, undefined);
  assert.equal(restored.blobId, undefined);
  assert.equal(JSON.stringify(restored).includes("base64"), false);
});

test("D/G: persistent queue deduplicates photo uploads and survives a new queue instance", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const first = createPhotoQueue(storage, "user-1");
  first.upsert([{ photoId: "photo-1", blobId: "blob-1" }, { photoId: "photo-1", blobId: "blob-1" }]);
  assert.equal(first.read().length, 1);
  const restarted = createPhotoQueue(storage, "user-1");
  assert.equal(restarted.read()[0].blobId, "blob-1");
  restarted.remove("photo-1");
  assert.equal(restarted.read().length, 0);
});

test("D: failed photo upload remains pending across restart and succeeds on retry", async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  createPhotoQueue(storage, "user-1").upsert([{ photoId: "photo-1" }]);
  const failed = await drainPhotoQueue(createPhotoQueue(storage, "user-1"), async () => { throw new Error("offline"); });
  assert.deepEqual(failed, { processed: 0, failed: 1, pending: 1 });
  const retried = await drainPhotoQueue(createPhotoQueue(storage, "user-1"), async () => {});
  assert.deepEqual(retried, { processed: 1, failed: 0, pending: 0 });
});

test("E/F: empty and sudden mass-decrease backups are blocked", () => {
  const cloud = { counts: { members: 7, sessions: 25, photos: 3 } };
  assert.deepEqual(evaluateOverwriteRisk({ members: [], schedule: [] }, cloud).reasons, ["members_empty", "sessions_empty"]);
  assert.equal(evaluateOverwriteRisk({ members: Array.from({ length: 3 }), schedule: Array.from({ length: 5 }) }, { counts: { members: 80, sessions: 100 } }).blocked, true);
  assert.equal(evaluateOverwriteRisk({ members: Array.from({ length: 7 }), schedule: Array.from({ length: 25 }) }, cloud).blocked, false);
});

test("G: local and cloud metadata merge by photoId without duplication", () => {
  const source = fixture();
  const manifest = buildPhotoManifest(source.photos).map((item) => ({ ...item, storagePath: "image", thumbnailPath: "thumb" }));
  const merged = mergePhotoMetadata(source.photos, manifest);
  assert.equal(merged.m1.front.filter((item) => (item.photoId || item.id) === "photo-1").length, 1);
});

test("storage usage exposes photo and thumbnail byte totals", () => {
  assert.deepEqual(storageUsage([{ imageBytes: 1200, thumbnailBytes: 100 }, { imageBytes: 800, thumbnailBytes: 80 }]), { photoCount: 2, photoBytes: 2000, thumbnailBytes: 180 });
});

test("JSON v2 emergency backup is manifest-first while legacy photo binary stays optional", () => {
  const source = fixture();
  const compact = createEmergencyBackupEnvelope({ data: source.db, photos: source.photos, from: "강사" });
  assert.equal(compact.kind, "backup");
  assert.equal(compact.ver, 2);
  assert.deepEqual(compact.photos, {});
  assert.equal(compact.photoManifest[0].record.marks[0].t, "arrow");
  assert.equal(compact.photoGraph.m1.sets[0].afterId, "photo-2");
  assert.equal(JSON.stringify(compact).includes("data:image"), false);
  const compatible = createEmergencyBackupEnvelope({ data: source.db, photos: source.photos, photoBinary: { m1: { front: [{ src: "data:image/jpeg;base64,AA==" }] } } });
  assert.equal(compatible.photos.m1.front[0].src.startsWith("data:image"), true);
});

test("photo optimizer normalizes orientation and creates bounded JPEG image plus thumbnail", async () => {
  const encoded = [];
  const createCanvas = () => ({
    getContext: () => ({ drawImage() {} }),
    toBlob(callback, type, quality) { encoded.push({ width: this.width, height: this.height, type, quality }); callback(new globalThis.Blob([new Uint8Array(Math.max(1, Math.round(this.width * this.height / 100)))], { type })); },
  });
  const result = await optimizePhotoBackup(new globalThis.Blob(["photo"], { type: "image/heic" }), {
    createBitmap: async () => ({ width: 4000, height: 3000, close() {} }),
    createCanvas,
  });
  assert.deepEqual([result.image.width, result.image.height], [1800, 1350]);
  assert.deepEqual([result.thumbnail.width, result.thumbnail.height], [320, 240]);
  assert.equal(encoded.every((item) => item.type === "image/jpeg"), true);
});
