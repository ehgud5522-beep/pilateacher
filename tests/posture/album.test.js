import test from 'node:test';
import assert from 'node:assert/strict';
import { albumPhotos, chronologicalPair, patchAlbumPhoto, removeAlbumPhoto, exifDate } from '../../src/features/photos/album-model.js';
import { buildPhotoManifest, restorePhotoMetadata, buildPhotoGraph, mergePhotoGraph } from '../../src/features/backup/cloud-backup.js';
import { optimizePhotoBackup } from '../../src/features/backup/photo-optimizer.js';

const photo = (id, date = '2026-11-12') => ({ id, photoId: id, blobId: `blob_${id}`, date, memberId: 'm', albumVersion: 1, memberVisible: false });
test('album keeps every same-day same-direction photo and all legacy analyses untouched', () => {
  const bucket = { front: [photo('a'), photo('b'), photo('c')], leftSide: [photo('d'), photo('e')], poses: [{ ...photo('a'), metrics: [{ value: 3 }] }], sets: [{ id: 'legacy' }] };
  const before = structuredClone(bucket);
  assert.equal(albumPhotos(bucket).length, 5);
  assert.deepEqual(bucket, before);
  assert.equal(albumPhotos({ side: [photo('old')] })[0].view, 'leftSide');
});
test('free comparison orders any two dates without AI or a four-view set', () => {
  const a = photo('a', '2026-11-12'), b = photo('b', '2026-06-01');
  assert.deepEqual(chronologicalPair([a, b]).map((p) => p.id), ['b', 'a']);
  assert.equal(a.assessmentRole, undefined);
});
test('edits and metadata survive backup restore without replacing original bytes', () => {
  const map = { m: { front: [photo('a')], poses: [{ id: 'analysis', metrics: [{ value: 4 }] }] } };
  const p = albumPhotos(map.m)[0];
  const next = patchAlbumPhoto(map, 'm', p, { albumEdit: { brightness: 1.2, rotate: 90 }, albumDate: '2026-01-01', albumView: 'rightSide' });
  assert.equal(next.m.front[0].blobId, 'blob_a');
  assert.deepEqual(next.m.poses, map.m.poses);
  const manifest = buildPhotoManifest(next).map((x) => ({ ...x, storagePath: 'private/image.jpg', thumbnailPath: 'private/thumb.jpg' }));
  const restored = restorePhotoMetadata(manifest);
  assert.equal(albumPhotos(restored.m).find((x) => x.id === 'a').date, '2026-01-01');
  assert.equal(restored.m.front[0].albumEdit.rotate, 90);
  assert.equal(restored.m.front[0].memberVisible, false);
});
test('member reassignment is atomic and refuses detaching an existing assessment', () => {
  const map = { m: { front: [photo('a')] }, other: { front: [photo('b')] } };
  const next = patchAlbumPhoto(map, 'm', albumPhotos(map.m)[0], {}, 'other');
  assert.equal(next.m.front.length, 0); assert.equal(next.other.front.length, 2);
  assert.equal(next.other.front[1].memberId, 'other'); assert.equal(map.m.front.length, 1);
  const legacy = { m: { front: [{ ...photo('a'), assessmentId: 'set' }] } };
  assert.equal(patchAlbumPhoto(legacy, 'm', albumPhotos(legacy.m)[0], {}, 'other').other.front[0].assessmentId, 'set');
});
test('deleting a photo removes dangling saved comparisons, preserving other photos and analyses', () => {
  const map = { m: { front: [photo('a'), photo('b')], sets: [{ beforeId: 'a', afterId: 'b' }], poses: [{ id: 'analysis', metrics: [1] }] } };
  const next = removeAlbumPhoto(map, 'm', albumPhotos(map.m)[0]);
  assert.equal(next.m.front.length, 1); assert.equal(next.m.sets.length, 0);
  assert.deepEqual(next.m.poses, map.m.poses); assert.equal(map.m.front.length, 2);
});
test('EXIF accepts DateTimeOriginal and safely rejects malformed/non-JPEG data', () => {
  const bytes = new ArrayBuffer(80), v = new DataView(bytes);
  v.setUint16(0, 0xffd8); v.setUint16(2, 0xffe1); v.setUint16(4, 76); v.setUint32(6, 0x45786966);
  const base = 12; v.setUint16(base, 0x4949); v.setUint16(base + 2, 42, true); v.setUint32(base + 4, 8, true);
  v.setUint16(20, 1, true); v.setUint16(22, 0x8769, true); v.setUint32(30, 26, true);
  v.setUint16(38, 1, true); v.setUint16(40, 0x9003, true); v.setUint32(48, 44, true);
  new Uint8Array(bytes, 56, 10).set(new TextEncoder().encode('2026:06:05'));
  assert.equal(exifDate(bytes), '2026-06-05');
  assert.equal(exifDate(new ArrayBuffer(0)), null); assert.equal(exifDate(bytes.slice(0, 20)), null);
});
test('deleting an analysis image preserves metrics through cloud backup while removing its file manifest', () => {
  const map = { m: { front: [photo('a')], poses: [{ ...photo('a'), metrics: [{ angle: 4 }], cloud: { storagePath: 'private.jpg' } }] } };
  const next = removeAlbumPhoto(map, 'm', albumPhotos(map.m)[0]);
  assert.equal(albumPhotos(next.m).length, 0);
  assert.equal(buildPhotoManifest(next).length, 0);
  const restored = mergePhotoGraph({}, buildPhotoGraph(next));
  assert.deepEqual(restored.m.poses[0].metrics, [{ angle: 4 }]);
  assert.equal(restored.m.poses[0].blobId, undefined);
});
test('analysis preparation does not duplicate the album photo and deletion removes its copied media', () => {
  const original = photo('a');
  const map = { m: { custom: [original], front: [{ ...photo('copy'), sourcePhotoId: 'a', assessmentId: 'analysis_set' }], poses: [{ ...photo('result'), assessmentId: 'analysis_set', view: 'front', metrics: [3] }] } };
  assert.deepEqual(albumPhotos(map.m).map((p) => p.id), ['a']);
  const next = removeAlbumPhoto(map, 'm', albumPhotos(map.m)[0]);
  assert.equal(albumPhotos(next.m).length, 0); assert.deepEqual(next.m.poses[0].metrics, [3]);
  assert.equal(buildPhotoManifest(next).length, 0);
});
test('gallery backup strips metadata even for a small JPEG', async () => {
  const original = new Blob(['private GPS metadata'], { type: 'image/jpeg' });
  const encoded = new Blob(['canvas jpeg'], { type: 'image/jpeg' });
  const result = await optimizePhotoBackup(original, {
    stripMetadata: true,
    createBitmap: async () => ({ width: 500, height: 800, close() {} }),
    createCanvas: () => ({ getContext: () => ({ drawImage() {} }), toBlob: (done) => done(encoded) }),
  });
  assert.notEqual(result.image.blob, original); assert.equal(result.image.blob, encoded);
  assert.equal(result.image.width / result.image.height, 500 / 800);
});
