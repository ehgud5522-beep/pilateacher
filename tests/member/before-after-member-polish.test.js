/* 보니따 비포애프터 (2026-11-15 대표 폰 화면):
   ① 이미 동의했는데 들어갈 때마다 동의 화면이 순간 떴다 사라짐
   ② "공유 자료를 처리하지 못했습니다 (코드 functions/internal)" 뒤 기록이 사라지고 새로고침해야 돌아옴
   ③ 카드를 눌러도 크게 볼 수 없음  ④ 탭 순서  ⑤ 글자 균형
   ⑥ 카드: 기본 흰색 · BONITA 만 핫핑크 · 강사가 꾸밀 수 있게 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONSENT_CACHE_KEY, RETRY_DELAYS, readConsent, rememberConsent, scopeKey } from '../../member/src/before-after-state.js';
import { isTransientSharingError, sharingMessage } from '../../src/features/photos/sharing-errors.js';
import { ZOOM_MAX, clampView, zoomAt } from '../../src/features/photos/zoom-view.js';
import { CARD_ACCENTS, CARD_THEMES, DEFAULT_CARD_STYLE, cardStyle } from '../../src/features/photos/comparison-card.js';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const memoryStorage = () => { const map = new Map(); return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), map }; };

/* ------------------------------ ① 동의 화면 깜빡임 ------------------------------ */

test('the consent answer is remembered per member, and only the status word is stored', () => {
  const storage = memoryStorage();
  const key = scopeKey({ organizationId: 'bonita', clientId: 'c1' });
  assert.equal(readConsent(storage, key), '', 'nothing remembered yet → the screen says "확인하고 있어요"');
  rememberConsent(storage, key, 'granted');
  assert.equal(readConsent(storage, key), 'granted');
  rememberConsent(storage, key, 'nonsense');
  assert.equal(readConsent(storage, key), 'granted', 'unknown values are ignored');
  assert.deepEqual(JSON.parse(storage.map.get(CONSENT_CACHE_KEY)), { 'bonita:c1': 'granted' });
  // 저장소가 깨져 있거나 막혀 있어도 화면은 돈다.
  assert.equal(readConsent({ getItem: () => '{oops' }, key), '');
  assert.doesNotThrow(() => rememberConsent({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, key, 'granted'));
});

test('until the server answers, the screen never shows the consent form to someone who already agreed', async () => {
  const screen = await read('member/src/before-after.jsx');
  assert.match(screen, /useState\(\(\) => seen\?\.consent \|\| readConsent\(storage, key\) \|\| 'loading'\)/);
  // 2026-11-28: 기다림은 로딩 동그라미로 (대표 "기다려야 하는 것들 다 로딩 동그라미로"). 뜻은 같다 -- 모르는 동안 동의 화면을 그리지 않는다.
  assert.match(screen, /\{consent === 'loading' \? \(error \? null : <Spinner size=\{30\} label="확인하고 있어요" \/>\)/);
  // 목록은 메모리에만 -- 기기(localStorage)에는 동의 한 단어뿐.
  assert.match(screen, /const lastSeen = new Map\(\);/);
  assert.doesNotMatch(screen, /setItem\(/);
});

/* ------------------------------ ② 한 번의 실패에 기록이 사라짐 ------------------------------ */

test('a dropped connection is retried; a decided answer is not', () => {
  for (const code of ['functions/internal', 'functions/unavailable', 'functions/deadline-exceeded', 'functions/network-request-failed']) {
    assert.equal(isTransientSharingError({ code, message: 'internal' }), true, code);
  }
  assert.equal(isTransientSharingError(new Error('offline')), true);
  // 서버가 이유를 말한 실패는 결정된 것이다.
  for (const reason of ['share/consent-required', 'share/revoked', 'share/disabled', 'share/member-not-linked']) {
    assert.equal(isTransientSharingError({ code: 'functions/failed-precondition', details: { reasonCode: reason } }), false, reason);
  }
  assert.equal(isTransientSharingError({ code: 'functions/permission-denied' }), false);
  assert.equal(isTransientSharingError({ code: 'functions/invalid-argument' }), false);
  // 서버가 모르는 오류를 감싸 보낸 unavailable 은 다시 해 볼 만하다.
  assert.equal(isTransientSharingError({ code: 'functions/unavailable', details: { reasonCode: 'share/temporarily-unavailable' } }), true);
  assert.deepEqual([...RETRY_DELAYS], [2000, 5000, 10000]);
});

test('the words match the code: functions/internal reads as a connection problem, with the code kept', () => {
  const text = sharingMessage({ code: 'functions/internal', message: 'internal' });
  assert.match(text, /네트워크 연결/);
  assert.match(text, /코드 functions\/internal/);
  assert.doesNotMatch(text, /처리하지 못했습니다/);
});

test('the list keeps what it had through a dropped connection and only clears on a decided failure', async () => {
  const screen = await read('member/src/before-after.jsx');
  const start = screen.indexOf('const refresh = useCallback(');
  const refresh = screen.slice(start, screen.indexOf('refreshRef.current = refresh;', start));
  const transient = refresh.slice(refresh.indexOf('if (isTransientSharingError(e)) {'), refresh.indexOf('// 결정된 실패'));
  assert.doesNotMatch(transient, /setShares\(\[\]\)|setSelected\(null\)|lastSeen\.delete/, 'a dropped connection never wipes the list');
  assert.match(transient, /retry\.current\.timer = setTimeout\(\(\) => refreshRef\.current\(\), RETRY_DELAYS\[attempt\]\);/);
  assert.match(refresh.slice(refresh.indexOf('// 결정된 실패')), /lastSeen\.delete\(key\);\s*\r?\n\s*setShares\(\[\]\); setSelected\(null\);/);
  // 돌아오면(연결 · 화면) 바로 다시 확인한다 -- 새로고침을 누를 필요가 없다.
  assert.match(screen, /window\.addEventListener\('online', again\)/);
  assert.match(screen, /document\.addEventListener\('visibilitychange', visible\)/);
  // 카드 화면도 같다: 15초 확인이 잠깐 실패해도 카드를 지우지 않는다.
  const card = await read('src/features/photos/SharedBeforeAfter.jsx');
  assert.match(card, /catch \(e\) \{ if \(active && current === serial && !isTransientSharingError\(e\)\) \{ clear\(\); setError\(sharingMessage\(e\)\); \} \}/);
});

/* ------------------------------ ③ 크게 보기 ------------------------------ */

test('zoom keeps the point under the fingers, stays inside the screen, and never shrinks below the fitted card', () => {
  const size = { width: 400, height: 600 };
  const point = { x: 100, y: -50 };
  const zoomed = zoomAt({ scale: 1, x: 0, y: 0 }, 2, point, size);
  assert.equal(zoomed.scale, 2);
  // 손가락 아래 사진의 점: 1배에서 u = p, 2배에서 x + 2u = p
  assert.equal(zoomed.x + 2 * point.x, point.x); assert.equal(zoomed.y + 2 * point.y, point.y);
  assert.deepEqual(clampView({ scale: 0.3, x: 50, y: 50 }, size), { scale: 1, x: 0, y: 0 });
  assert.equal(clampView({ scale: 99, x: 0, y: 0 }, size).scale, ZOOM_MAX);
  const pushed = clampView({ scale: 2, x: 5000, y: -5000 }, size);
  assert.deepEqual([pushed.x, pushed.y], [200, -300], 'cannot drag the card off screen');
});

test('the member card opens a zoom view; the teacher preview does not', async () => {
  const [shared, member] = await Promise.all([read('src/features/photos/SharedBeforeAfter.jsx'), read('member/src/before-after.jsx')]);
  assert.match(shared, /zoomable \? <button type="button" className="private-share-zoom" aria-label="카드 크게 보기"/);
  assert.match(member, /<SharedBeforeAfter key=\{selected\.id\} share=\{selected\} api=\{api\} zoomable \/>/);
  const teacher = await read('src/features/photos/TeacherPhotoSharing.jsx');
  assert.doesNotMatch(teacher, /zoomable/);
  // 크게 보기는 같은 이미지를 보여 줄 뿐 -- 내려받기 · 새 주소를 만들지 않는다.
  const viewer = await read('src/features/photos/ZoomViewer.jsx');
  assert.doesNotMatch(viewer, /download|createObjectURL|toDataURL|localStorage/);
});

/* ------------------------------ ④ 탭 · ⑤ 글자 ------------------------------ */

test('tabs read 홈 · 수업기록 · 비포애프터 · 마이페이지', async () => {
  const app = await read('member/src/App.jsx');
  assert.match(app, /TABS\.flatMap\(\(item\) => item\.key === 'mypage' \? \[BEFORE_AFTER_TAB, item\] : \[item\]\)/);
  const order = [...app.matchAll(/\{ key: "(home|records|mypage)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['home', 'records', 'mypage'], 'mypage stays last in the base list');
});

test('the before-after screens use the app type scale, and the checkbox sits on the same line as its words', async () => {
  const css = await read('member/src/styles.css');
  assert.match(css, /\.ba-member h1 \{ font-size: var\(--t-heading\); font-weight: 800;/);
  assert.match(css, /\.ba-consent h2 \{ font-size: var\(--t-title\);/);
  assert.match(css, /\.ba-consent p \{ font-size: 14px; line-height: 1\.65;/);
  // 공용 .private-member-sharing label { display:block } 을 이긴다.
  assert.match(css, /\.ba-member \.ba-check \{ display: flex;/);
  assert.match(css, /\.ba-privacy \{[^}]*font-size: 11px/);
});

/* ------------------------------ ⑥ 카드 꾸미기 ------------------------------ */

test('default card: white, with hot pink on BONITA only; teachers can pick a background and a colour', async () => {
  assert.deepEqual(DEFAULT_CARD_STYLE, { theme: 'white', accent: '#F0137F' });
  assert.equal(CARD_THEMES.white.bg, '#FFFFFF');
  assert.deepEqual(Object.keys(CARD_THEMES), ['white', 'ivory', 'black']);
  assert.equal(CARD_ACCENTS[0][0], '#F0137F', 'the Bonita app pink comes first');
  assert.deepEqual(cardStyle({ theme: 'neon', accent: '#123456' }), DEFAULT_CARD_STYLE, 'unknown values fall back');
  assert.deepEqual(cardStyle({ theme: 'black', accent: '#3E5BA9' }), { theme: 'black', accent: '#3E5BA9' });
  const source = await read('src/features/photos/comparison-card.js');
  // 포인트 색은 BONITA 에만: 그 바로 뒤 PILATES 는 먹색.
  assert.match(source, /ctx\.fillStyle = accent;\s*\r?\n\s*ctx\.font = `800 38px \$\{FONT\}`; ctx\.fillText\(brand\.primary, start, 76\);\s*\r?\n\s*ctx\.fillStyle = t\.ink;/);
  // 보니따 카드의 AFTER 표시와 기간 숫자는 먹색 -- 분홍이 퍼지지 않는다.
  assert.match(source, /afterPill = brand \? /);
  assert.match(source, /drawFooter\(ctx, layout\.height, pair, t, brand \? t\.ink : accent\);/);
  // 강사가 고른 꾸미기는 이 기기에 기억한다.
  const album = await read('src/features/photos/BeforeAfterAlbum.jsx');
  assert.match(album, /const CARD_STYLE_KEY = 'pilateacher\.beforeAfter\.cardStyle\.v1';/);
  assert.match(album, /drawComparisonCard\(ref\.current, \{ images, pair, mode, align, split, guides, brand, comment, style: look \}\)/);
  // 바탕 · 색을 바꾸면 카드를 다시 그린다 -- 이 값이 빠져 있어 고른 색이 카드에 안 나오던 적이 있다(화면 확인에서 잡음).
  assert.match(album, /\}, \[images, pair, mode, split, align, guides, brand, comment, look\]\);/);
});
