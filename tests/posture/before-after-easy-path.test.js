/* 강사가 편하게 (2026-11-15 대표): ① 보낼 수 없는 이유를 보내기 전에 ② 처음엔 [변화 카드 만들기] 한 길. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { suggestPair } from '../../src/features/photos/album-model.js';
import { SHARE_STATES, memberAppName, shareBadge, shareBlocker, shareState } from '../../src/features/photos/share-readiness.js';
import { sharingDiagnostic } from '../../src/features/photos/sharing-errors.js';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const photo = (id, date, view = 'front') => ({ id, bucket: 'front', date, view });

/* ------------------------------ ① 동의 안내 ------------------------------ */

test('an unknown or unreadable state never blocks -- the old flow stays as it was', () => {
  for (const value of [undefined, '', 'unknown', 'something-new', null]) {
    assert.equal(shareState(value), 'unknown');
    assert.equal(shareBlocker(shareState(value)), null);
    assert.equal(shareBadge(shareState(value)), null);
  }
  assert.equal(shareBlocker('ready'), null, 'ready does not block either');
  assert.deepEqual(shareBadge('ready'), { label: '앱 공유 가능', tone: 'good' });
});

test('every blocked state says why and what to do next, each in its own words', () => {
  const texts = new Set();
  for (const state of SHARE_STATES.filter((s) => s !== 'ready')) {
    const blocker = shareBlocker(state, '보니따 앱');
    assert.ok(blocker.title && blocker.help, state);
    assert.match(blocker.help, /\[이미지 저장\]/, `${state}: the card is never lost -- it can still be saved`);
    assert.ok(shareBadge(state), state);
    texts.add(blocker.title);
  }
  assert.equal(texts.size, 3, 'three different reasons are not collapsed into one sentence');
});

test('only the consent case offers a message to send, and it names where to tap', () => {
  const { message } = shareBlocker('consent_needed', '보니따 앱');
  assert.match(message, /보니따 앱 → 비포애프터 탭/);
  assert.match(message, /사진 공유 동의/);
  assert.equal(shareBlocker('not_linked').message, '');
  assert.equal(shareBlocker('not_open').message, '');
  // 다른 센터에서는 보니따라는 이름이 나오지 않는다.
  assert.equal(memberAppName('bonita'), '보니따 앱');
  assert.equal(memberAppName('other'), '회원 앱');
  assert.ok(!shareBlocker('consent_needed', memberAppName('other')).message.includes('보니따'));
});

test('a failed readiness check is logged under its own stage, not as "unknown"', () => {
  const diagnostic = sharingDiagnostic({ code: 'functions/failed-precondition', details: { reasonCode: 'share/invalid-action' } }, { action: 'teacherConsent' });
  assert.equal(diagnostic.stage, 'teacherConsent');
  assert.equal(diagnostic.errorCode, 'functions/failed-precondition');
});

/* ------------------------------ ② 한 길 ------------------------------ */

test('the suggested pair is the photo just taken and the first one of the same direction', () => {
  const photos = [photo('a', '2026-06-02'), photo('b', '2026-08-01', 'leftSide'), photo('c', '2026-09-01'), photo('d', '2026-11-13'), photo('e', '2026-11-14', 'leftSide')];
  assert.deepEqual(suggestPair(photos).map((p) => p.id), ['b', 'e'], 'the last shot was a side view → side ↔ side');
  assert.deepEqual(suggestPair(photos.slice(0, 4)).map((p) => p.id), ['a', 'd'], 'the last shot was a front view → front ↔ front');
  /* 대표: "전신이 아니더라도 부위를 비포애프터할 수도 있음". 부위 사진("기타")도 같은 규칙이다. */
  const parts = [photo('full', '2026-05-01'), photo('neck1', '2026-06-02', 'custom'), photo('full2', '2026-09-01'), photo('neck2', '2026-11-14', 'custom')];
  assert.deepEqual(suggestPair(parts).map((p) => p.id), ['neck1', 'neck2'], 'body-part photos are paired with each other, not pushed behind full-body ones');
  // 방금 찍은 방향이 한 장뿐이면 같은 방향끼리 가장 오래 떨어진 짝.
  const lone = [photo('a', '2026-06-02'), photo('d', '2026-11-13'), photo('s', '2026-11-14', 'leftSide')];
  assert.deepEqual(suggestPair(lone).map((p) => p.id), ['a', 'd']);
});

test('with no same-direction pair it falls back to oldest and newest; fewer than two gives nothing', () => {
  const mixed = [photo('new', '2026-11-13', 'back'), photo('old', '2026-06-02'), photo('mid', '2026-08-01', 'custom')];
  assert.deepEqual(suggestPair(mixed).map((p) => p.id), ['old', 'new']);
  // 같은 날 찍은 같은 방향 두 장은 "변화" 가 아니다.
  const sameDay = [photo('x', '2026-11-13'), photo('y', '2026-11-13'), photo('z', '2026-06-01', 'back')];
  assert.deepEqual(suggestPair(sameDay).map((p) => p.date), ['2026-06-01', '2026-11-13']);
  assert.deepEqual(suggestPair([photo('only', '2026-11-13')]), []);
  assert.deepEqual(suggestPair([]), []);
});

test('the album offers one way in once there are two photos, and tucks the rest behind "더보기"', async () => {
  const vite = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'silent' });
  try {
    const { default: Album } = await vite.ssrLoadModule('/src/features/photos/BeforeAfterAlbum.jsx');
    const base = { accountId: 'teacher', members: [{ id: 'm', name: '테스트 회원' }], selectedId: 'm', hub: () => null };
    const shots = (n) => ({ m: { front: Array.from({ length: n }, (_, i) => ({ id: String(i), blobId: `b${i}`, src: 'blob:fixture', date: `2026-1${i}-01` })) } });
    const two = renderToStaticMarkup(createElement(Album, { ...base, photos: shots(2) }));
    assert.ok(two.includes('변화 카드 만들기'));
    assert.ok(two.includes('<details class="ba-more">'), 'the secondary links sit behind one menu');
    const one = renderToStaticMarkup(createElement(Album, { ...base, photos: shots(1) }));
    assert.ok(!one.includes('변화 카드 만들기'));
    assert.ok(one.includes('사진이 한 장 더 있으면 변화 카드를 만들 수 있어요.'));
    assert.ok(!renderToStaticMarkup(createElement(Album, { ...base, photos: {} })).includes('변화 카드 만들기'));
  } finally { await vite.close(); }
});

test('the card screen shows its three steps and swaps the send button for the reason when blocked', async () => {
  const album = await read('src/features/photos/BeforeAfterAlbum.jsx');
  assert.match(album, /<ol className="ba-steps"[^>]*><li>사진 확인<\/li><li>한마디<\/li><li>\{onShare && !blocker \? '보내기' : '저장'\}<\/li><\/ol>/);
  assert.match(album, /\{onShare && blocker && <div className="ba-share-gate" role="status">/);
  assert.match(album, /\{onShare && !blocker && <Button className="ba-primary ba-export"/);
  // 막혀 있어도 [이미지 저장] 은 그대로 있고, 그때는 그것이 주 버튼이다.
  assert.match(album, /className=\{onShare && !blocker \? 'ba-export' : 'ba-primary ba-export'\}/);
  // 복사가 막힌 기기에서는 문구를 펼쳐 보여 준다.
  assert.match(album, /catch \{ setCopied\('manual'\); \}/);
  // 상태는 앨범을 열 때 묻고, 못 읽으면 막지 않으며 진단을 남긴다.
  assert.match(album, /sharingApi\(\{ action: 'teacherConsent', organizationId, clientId: memberClientId \}\)/);
  assert.match(album, /setShareState\('unknown'\); logSharingFailure\(e, \{ action: 'teacherConsent'/);
});
