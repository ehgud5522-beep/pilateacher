/* 2026-11-15 대표:
   ① "보니따 앱에서 수업 끝나고 하는 평가를 귀찮아하는 사람이 있을 수 있으니 끄는 버튼"
   ② "필라티쳐에 누가 아직 안 깔았는지 깔았는지 확인하는 거 더보기에" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { APP_STATUS, countByStatus, memberAppRows, shortSeen } from '../../src/features/members/member-app-status.js';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const withVite = async (run) => {
  const vite = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'silent' });
  try { return await run(vite); } finally { await vite.close(); }
};

/* ------------------------------ ① 평가 끄기 ------------------------------ */

test('the rating card offers "앞으로 묻지 않기" only when it can actually turn rating off', async () => {
  await withVite(async (vite) => {
    const { LessonRatingCard } = await vite.ssrLoadModule('/member/src/lesson-rating.jsx');
    const base = { lesson: { lessonId: 'l1' }, place: { organizationId: 'o', clientId: 'c' }, api: async () => ({}), onSeen: () => {}, initialPhase: 'ready' };
    assert.match(renderToStaticMarkup(createElement(LessonRatingCard, { ...base, onStopAsking: () => {} })), /앞으로 묻지 않기/);
    assert.doesNotMatch(renderToStaticMarkup(createElement(LessonRatingCard, base)), /앞으로 묻지 않기/);
  });
});

test('one switch turns rating off everywhere: the push, the home card, and the web settings', async () => {
  const [app, card] = await Promise.all([read('member/src/App.jsx'), read('member/src/lesson-rating.jsx')]);
  // 카드의 버튼 → 알림 설정과 같은 스위치(lessonRating)를 끈다.
  assert.match(app, /onStopAsking=\{\(\) => savePushPref\(PUSH_KIND\.LESSON_RATING, false\)\}/);
  // 꺼져 있으면 홈에 카드를 그리지 않는다. (알림은 서버가 이미 prefs.lessonRating 을 보고 안 보낸다.)
  assert.match(app, /const ratingOff = push\.prefs\?\.\[PUSH_KIND\.LESSON_RATING\] === false;/);
  assert.match(app, /const rateLesson = state\.offlineAt \|\| ratingOff \? null :/);
  // 실수로 누르지 않게 한 번 묻고, 다시 켜는 곳을 알려 준다.
  assert.match(card, /window\.confirm\("수업 후 평가를 앞으로 묻지 않을까요\?\\n마이페이지 › 알림 설정에서 다시 켤 수 있어요\."\)/);
});

test('the web settings card (no push there) still lets a member turn the rating card off', async () => {
  await withVite(async (vite) => {
    const { PushSettings } = await vite.ssrLoadModule('/member/src/screens.jsx');
    const html = renderToStaticMarkup(createElement(PushSettings, { push: { support: 'unsupported', prefs: { lessonRating: false }, onToggle: () => {} } }));
    assert.match(html, /수업 알림은 보니따 앱에서만 받을 수 있어요/);
    assert.match(html, /role="switch" aria-checked="false" aria-label="수업 후 평가 묻기"/);
    assert.match(html, /꺼짐/);
  });
});

/* ------------------------------ ② 설치 현황 ------------------------------ */

const clients = [
  { id: 'a', name: '가', userId: 'u1', locationId: 'L1' },
  { id: 'b', name: '나', userId: 'u2', locationId: 'L1' },
  { id: 'c', name: '다', locationId: 'L2' },
  { id: 'd', name: '라', userId: 'u4', archived: true },
];
const usage = [
  { clientId: 'a', app: true, platforms: ['android'], notifications: false, lastSeenAt: '2026-11-14T15:30:00Z', lastPlatform: 'android' },
  { clientId: 'b', app: false, platforms: [], notifications: false, lastSeenAt: '2026-11-10T01:00:00Z', lastPlatform: 'web' },
];

test('three states from the roster and the server answer; unlinked first; archived members left out', () => {
  const rows = memberAppRows(clients, usage);
  assert.deepEqual(rows.map((r) => [r.id, r.status]), [['c', APP_STATUS.NONE], ['b', APP_STATUS.LINKED], ['a', APP_STATUS.APP]]);
  assert.match(rows.find((r) => r.id === 'a').detail, /안드로이드 · 마지막 11\.15 안드로이드 · 알림 꺼짐/, 'KST date');
  assert.match(rows.find((r) => r.id === 'b').detail, /마지막 11\.10 웹/);
  assert.deepEqual(countByStatus(rows), { all: 3, app: 1, linked: 1, none: 1 });
  // 서버를 못 읽으면 연결 여부만: 이어진 회원은 "앱 확인 전", 앱 사용으로 지어내지 않는다.
  assert.deepEqual(memberAppRows(clients, []).map((r) => r.status), ['none', 'linked', 'linked']);
  assert.equal(shortSeen('nope'), '');
});

test('the screen never says "not installed" for a linked member, and shows its codes when it cannot read', async () => {
  await withVite(async (vite) => {
    const { default: MemberAppStatus } = await vite.ssrLoadModule('/src/features/members/MemberAppStatus.jsx');
    const props = { organizationId: 'o', loadClients: async () => [], loadLocations: async () => [], fetchStatus: async () => ({ members: [] }) };
    const html = renderToStaticMarkup(createElement(MemberAppStatus, { ...props, initialState: { clients, usage, locations: [{ id: 'L1', name: '반송점' }, { id: 'L2', name: '해운대점' }] } }));
    for (const label of ['아직 연결 안 함', '연결됨 · 앱 확인 전', '앱 사용 중', '모든 지점', '반송점']) assert.ok(html.includes(label), label);
    assert.ok(!html.includes('라'), 'archived member hidden');
    assert.doesNotMatch(html, /설치 안 함|안 깔았음/);
    const failed = renderToStaticMarkup(createElement(MemberAppStatus, { ...props, initialState: { clients, usage: [], usageError: 'functions/permission-denied' } }));
    assert.match(failed, /앱 사용 기록을 읽지 못해 연결 여부만 보여요\. \(코드 functions\/permission-denied\)/);
  });
});

test('the menu entry is for the same people as the member-app admin (owner level)', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /\.\.\.\(showMemberApp \? \[\{ key: "member-app-status", title: "보니따 앱 설치 현황"/);
  assert.match(app, /\{view === "member-app-status" && showMemberApp && \(/);
  // 회원 앱은 켜질 때 어디서 켰는지 함께 보낸다(서버가 12시간에 한 번만 적음).
  const member = await read('member/src/App.jsx');
  assert.match(member, /action: "get", seenPlatform: platformOf\(\) \|\| "web",/);
});
