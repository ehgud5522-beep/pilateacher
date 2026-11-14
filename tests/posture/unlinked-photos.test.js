import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { patchAlbumPhoto, unlinkedAlbumPhotos } from '../../src/features/photos/album-model.js';

const photo = (id, extra = {}) => ({ id, photoId: id, blobId: `blob_${id}`, date: '2026-11-13', view: 'custom', ...extra });

test('photos stored under a key that is not a centre member are listed; linked and already-scoped photos are not', () => {
  const map = {
    member_linked: { custom: [photo('a')] },
    member_old: { custom: [photo('b'), photo('c', { cloud: { clientId: 'client-x' } })] },
    device_only: { front: [photo('d')] },
  };
  const members = [{ id: 'member_linked', orgClientId: 'client-1' }, { id: 'device_only', orgClientId: '' }];
  const found = unlinkedAlbumPhotos(map, members).map((e) => `${e.memberKey}:${e.photo.id}`).sort();
  assert.deepEqual(found, ['device_only:d', 'member_old:b']);
});

test('assigning moves the photo to the centre member so the next backup has a member scope', () => {
  const map = { member_old: { custom: [photo('b', { backupExcluded: true })] }, target: { custom: [] } };
  const [entry] = unlinkedAlbumPhotos(map, [{ id: 'target', orgClientId: 'client-9' }]);
  const next = patchAlbumPhoto(map, entry.memberKey, entry.photo, { backupExcluded: false }, 'target');
  assert.equal(next.member_old.custom.length, 0);
  assert.equal(next.target.custom[0].memberId, 'target');
  assert.equal(next.target.custom[0].backupExcluded, false);
  assert.deepEqual(unlinkedAlbumPhotos(next, [{ id: 'target', orgClientId: 'client-9' }]), []);
});

test('only owner-level accounts see and reassign unlinked photos; excluded photos leave the queue and are never deleted', async () => {
  const app = await readFile(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /const unlinkedPhotoOwnerView = isOwnerLevelRole\(/);
  assert.match(app, /const assignUnlinkedPhoto = async[\s\S]{0,80}if \(!unlinkedPhotoOwnerView\) return false;/);
  assert.match(app, /item\.record\?\.backupExcluded === true\) return;/);
  assert.match(app, /item\.blobId && item\.record\?\.backupExcluded !== true/);
  const album = await readFile(new URL('../../src/features/photos/BeforeAfterAlbum.jsx', import.meta.url), 'utf8');
  const panel = album.slice(album.indexOf('function UnlinkedPhotos'), album.indexOf('export default function BeforeAfterAlbum'));
  assert.ok(panel.includes('ownerView && open'), 'thumbnails only for owner view');
  assert.ok(!/삭제|onDelete/.test(panel), 'no delete action for unlinked photos');
});
