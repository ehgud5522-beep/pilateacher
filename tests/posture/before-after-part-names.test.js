/* 부위 이름 (2026-11-15 대표: 부위만 비포애프터하는 강사 → 사진에 이름을 붙이기로).
   목 사진과 골반 사진이 한 회원에게 섞여 있어도 같은 부위끼리 짝이 지어져야 한다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { ALBUM_PARTS, albumGroup, albumLabel, albumPart, albumPhotos, ghostCandidate, patchAlbumPhoto, suggestPair } from '../../src/features/photos/album-model.js';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const shot = (id, date, view = 'custom', part = '') => ({ id, bucket: 'custom', date, view, part, src: 'blob:x' });

test('a part name is optional, only known names are kept, and old photos read as before', () => {
  assert.equal(albumPart('neck'), 'neck');
  assert.equal(albumPart('unknown-part'), '');
  assert.equal(albumPart(undefined), '');
  const [old] = albumPhotos({ custom: [{ id: 'a', blobId: 'b', src: 'blob:x', date: '2026-06-02' }] });
  assert.equal(old.part, '');
  assert.equal(albumLabel(old), '기타', 'a photo saved before this change still says 기타');
  const [named] = albumPhotos({ custom: [{ id: 'a', blobId: 'b', src: 'blob:x', date: '2026-06-02', albumPart: 'hip' }] });
  assert.equal(named.part, 'hip');
  assert.equal(albumLabel(named), '고관절');
});

test('the name shows only on body-part photos -- a front photo never becomes "목"', () => {
  assert.equal(albumLabel({ view: 'front', part: 'neck' }), '정면');
  assert.equal(albumGroup({ view: 'front', part: 'neck' }), 'front');
  assert.equal(albumGroup({ view: 'custom', part: 'neck' }), 'custom:neck');
  assert.equal(albumGroup({ view: 'custom', part: '' }), 'custom:');
  assert.equal(new Set(ALBUM_PARTS.map(([key]) => key)).size, ALBUM_PARTS.length);
});

test('neck photos pair with neck photos even when pelvis photos sit between them', () => {
  const photos = [shot('neck1', '2026-06-02', 'custom', 'neck'), shot('pelvis1', '2026-06-03', 'custom', 'pelvis'), shot('pelvis2', '2026-10-01', 'custom', 'pelvis'), shot('neck2', '2026-11-14', 'custom', 'neck')];
  assert.deepEqual(suggestPair(photos).map((p) => p.id), ['neck1', 'neck2']);
  assert.equal(ghostCandidate(photos).id, 'neck1', 'the next neck photo is shot against the first neck photo');
  // 방금 찍은 것이 골반이면 골반끼리.
  assert.deepEqual(suggestPair(photos.slice(0, 3)).map((p) => p.id), ['pelvis1', 'pelvis2']);
  assert.equal(ghostCandidate(photos.slice(0, 3)).id, 'pelvis1');
});

test('unnamed part photos still pair with each other, apart from named ones', () => {
  const photos = [shot('plain1', '2026-05-01'), shot('neck1', '2026-06-02', 'custom', 'neck'), shot('plain2', '2026-11-14')];
  assert.deepEqual(suggestPair(photos).map((p) => p.id), ['plain1', 'plain2']);
});

test('editing stores the name on the record and clears it when the photo is given a direction', () => {
  const map = { m: { custom: [{ id: 'a', blobId: 'b', src: 'blob:x', date: '2026-06-02' }] } };
  const [photo] = albumPhotos(map.m);
  const named = patchAlbumPhoto(map, 'm', photo, { albumPart: 'neck' });
  assert.equal(albumPhotos(named.m)[0].part, 'neck');
  const cleared = patchAlbumPhoto(named, 'm', albumPhotos(named.m)[0], { albumView: 'front', albumPart: '' });
  assert.equal(albumPhotos(cleared.m)[0].part, '');
  assert.equal(albumLabel(albumPhotos(cleared.m)[0]), '정면');
});

test('the screens ask for the part only on 기타 photos, carry it through capture, and filter by it', async () => {
  const [album, app] = await Promise.all([read('src/features/photos/BeforeAfterAlbum.jsx'), read('src/App.jsx')]);
  assert.match(album, /\{item\.view === 'custom' && <select className="ba-import-part"/);
  assert.match(album, /\{direction === 'custom' && <label>부위<select value=\{part\}/);
  assert.match(album, /albumPart: direction === 'custom' \? part : ''/, 'changing the direction away from 기타 drops the name');
  // 겹쳐 찍은 새 사진은 겹친 사진과 같은 부위다.
  assert.match(album, /setShooting\(\{ view: p\.view, part: p\.part \|\| ''/);
  assert.match(app, /\.\.\.\(item\.view === "custom" && item\.part \? \{ albumPart: item\.part \} : \{\}\),/);
  // 방향 이름만 쓰던 자리가 남아 있지 않다 -- 사진이 있는 곳은 부위 이름까지 보여 준다.
  assert.doesNotMatch(album, /[^o]label\([A-Za-z0-9_.[\]]+\.view\)/);
  assert.match(album, /albumGroup\(pair\[0\]\) !== albumGroup\(pair\[1\]\)/, 'the "different direction" warning also fires for different parts');
});

test('the album shows the part name on the photo and offers a filter for parts that exist', async () => {
  const vite = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'silent' });
  try {
    const { default: Album } = await vite.ssrLoadModule('/src/features/photos/BeforeAfterAlbum.jsx');
    const photos = { m: { custom: [{ id: '0', blobId: 'b0', src: 'blob:fixture', date: '2026-06-02', albumPart: 'neck' }, { id: '1', blobId: 'b1', src: 'blob:fixture', date: '2026-11-14', albumPart: 'neck' }] } };
    const html = renderToStaticMarkup(createElement(Album, { accountId: 'teacher', members: [{ id: 'm', name: '테스트 회원' }], selectedId: 'm', hub: () => null, photos, capture: () => null }));
    assert.ok(html.includes('<b>26.06.02</b>목'), 'the tile says 목, not 기타');
    assert.ok(html.includes('부위 · 목'), 'a filter for the part that exists');
    assert.ok(!html.includes('부위 · 골반'), 'and none for parts that do not');
    assert.ok(html.includes('26.06.02 목 사진을 겹쳐 보며 같은 구도로 찍어요'));
  } finally { await vite.close(); }
});
