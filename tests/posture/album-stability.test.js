import test from 'node:test';
import assert from 'node:assert/strict';
import { patchAlbumPhoto, albumPhotos } from '../../src/features/photos/album-model.js';
import { gestureTransform } from '../../src/features/photos/photo-gestures.js';
import { buildPhotoManifest, restorePhotoMetadata, createPhotoQueue, drainPhotoQueue } from '../../src/features/backup/cloud-backup.js';

test('legacy member move preserves the complete assessment, analyses, original IDs and saved comparison', () => {
  const f = { id: 'front', blobId: 'raw-front', assessmentId: 'assessment', view: 'front' };
  const map = { a: { front: [f], leftSide: [{ id: 'left', blobId: 'raw-left', assessmentId: 'assessment' }], poses: [{ id: 'ai', assessmentId: 'assessment', metrics: [4], cleanBlobId: 'raw-front' }], sets: [{ beforeId: 'front', afterId: 'left' }] }, b: { front: [{ id: 'unrelated', blobId: 'other' }] } };
  const moved = patchAlbumPhoto(map, 'a', albumPhotos(map.a)[0], {}, 'b');
  assert.equal(moved.a.front.length, 0); assert.equal(moved.a.poses.length, 0);
  assert.equal(moved.b.front[1].blobId, 'raw-front'); assert.equal(moved.b.leftSide[0].memberId, 'b');
  assert.deepEqual(moved.b.poses[0].metrics, [4]); assert.equal(moved.b.poses[0].assessmentId, 'assessment');
  assert.deepEqual(moved.b.sets[0], { beforeId: 'front', afterId: 'left', memberId: 'b' });
  assert.equal(map.a.front[0].blobId, 'raw-front');
});
test('original path, digest and independent edits survive reinstall metadata restoration', () => {
  const cloud = { storagePath: 'private/image.jpg', thumbnailPath: 'private/thumb.jpg', originalPath: 'private/original.bin', originalSha256: 'abc', originalMimeType: 'image/heic', originalBytes: 22000000, organizationId: 'org', clientId: 'client' };
  const map = { a: { front: [{ id: 'p', blobId: 'local', date: '2026-11-12', albumEdit: { rotate: 90 }, cloud }] } };
  const restored = restorePhotoMetadata(buildPhotoManifest(map));
  assert.equal(restored.a.front[0].blobId, undefined);
  assert.equal(restored.a.front[0].cloud.originalPath, cloud.originalPath);
  assert.equal(restored.a.front[0].cloud.originalSha256, 'abc');
  assert.equal(restored.a.front[0].albumEdit.rotate, 90);
});
test('a new edit queued during an in-flight upload is not silently acknowledged', async () => {
  const values = new Map();
  const queue = createPhotoQueue({ getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) }, 'user');
  queue.upsert([{ photoId: 'p' }]);
  await drainPhotoQueue(queue, async () => { queue.upsert([{ photoId: 'p' }]); });
  assert.equal(queue.read().length, 1);
  await drainPhotoQueue(queue, async () => {}); assert.equal(queue.read().length, 0);
});
test('touch drag and pinch preserve proportions and stay in bounded ranges', () => {
  const drag = gestureTransform([{ x: 10, y: 10 }], [{ x: 50, y: 70 }], { x: 0, y: 0, zoom: 1 }, 400, 600);
  assert.equal(drag.x, 10); assert.equal(drag.y, 10); assert.equal(drag.zoom, 1);
  const pinch = gestureTransform([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 0 }, { x: 200, y: 0 }], { zoom: 1 }, 400, 600);
  assert.equal(pinch.zoom, 2);
});
