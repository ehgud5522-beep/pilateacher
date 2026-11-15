/* 2026-11-15 대표:
   ① "보니따 앱 설치 현황 지점별로 강사별로 아직 미연결된 거 정리해서 보이게"
   ② "비포애프터 공유 스위치가 안 보이는데 모든 강사들이 다 할 수 있게 켜줘" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { memberAppGroups, memberAppRows } from '../../src/features/members/member-app-status.js';

const require = createRequire(import.meta.url);
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const clients = [
  { id: 'a', name: '가', locationId: 'L1', instructorIds: ['t1'] },
  { id: 'b', name: '나', locationId: 'L1', instructorIds: ['t1', 't2'] },
  { id: 'c', name: '다', locationId: 'L1', instructorIds: ['t2'], userId: 'u3' },
  { id: 'd', name: '라', locationId: 'L2', instructorIds: ['t2'] },
  { id: 'e', name: '마', locationId: 'L2' },
];
const locations = [{ id: 'L1', name: '반송점' }, { id: 'L2', name: '해운대점' }];
const instructors = [{ userId: 't1', displayName: '김강사' }, { userId: 't2', displayName: '이강사' }];

test('members are grouped by branch, then by teacher; a member with two teachers shows under both', () => {
  const groups = memberAppGroups(memberAppRows(clients, []), { locations, instructors });
  assert.deepEqual(groups.map((g) => [g.name, g.counts.none, g.counts.all]), [['반송점', 2, 3], ['해운대점', 2, 2]]);
  const banseong = groups[0];
  assert.deepEqual(banseong.teachers.map((t) => [t.name, t.rows.map((r) => r.id).join('')]), [['김강사', 'ab'], ['이강사', 'bc']]);
  // 지점 합계는 회원 수 그대로(두 강사 아래 나온 '나' 를 두 번 세지 않음).
  assert.equal(banseong.counts.all, 3);
  // 담당 강사가 없는 회원도 빠지지 않는다.
  assert.ok(groups[1].teachers.some((t) => t.name === '담당 강사 없음' && t.rows[0].id === 'e'));
});

test('the place and teacher with the most unlinked members come first', () => {
  const groups = memberAppGroups(memberAppRows([...clients, { id: 'f', name: '바', locationId: 'L2', instructorIds: ['t2'] }], []), { locations, instructors });
  assert.equal(groups[0].name, '해운대점', 'three unlinked beat two');
  assert.equal(groups[0].teachers[0].name, '이강사');
});

test('the screen opens on branch · teacher with only the unlinked, and can switch to the full list', async () => {
  const vite = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'silent' });
  try {
    const { default: MemberAppStatus } = await vite.ssrLoadModule('/src/features/members/MemberAppStatus.jsx');
    const html = renderToStaticMarkup(createElement(MemberAppStatus, { organizationId: 'o', loadClients: async () => [], loadLocations: async () => [], fetchStatus: async () => ({}), initialState: { clients, usage: [], locations, instructors } }));
    for (const text of ['지점 · 강사별', '전체 목록', '반송점', '해운대점', '김강사', '이강사', '담당 강사 없음']) assert.ok(html.includes(text), text);
    assert.match(html, /aria-pressed="true"[^>]*>지점 · 강사별/);
    // 연결 안 함만: 연결된 '다' 는 안 보인다.
    assert.ok(!html.includes('<strong>다</strong>'));
  } finally { await vite.close(); }
  const app = await read('src/App.jsx');
  assert.match(app, /loadInstructors=\{\(\) => listInstructors\(organization\?\.organizationId \|\| "", \{ store: instructorStore \}\)\}/);
});

test('sharing switch: "all" opens it for every teacher and member; test keeps its lists; anything else is off', () => {
  const { enabled } = require('../../functions/src/before-after-sharing.js');
  assert.equal(enabled({ mode: 'all' }, 'any-teacher', null), true);
  assert.equal(enabled({ mode: 'all' }, null, 'any-member'), true);
  assert.equal(enabled({ mode: 'test', phase1Verified: true, teacherIds: ['t1'], memberIds: [] }, 't1', null), true);
  assert.equal(enabled({ mode: 'test', phase1Verified: true, teacherIds: ['t1'], memberIds: [] }, 't2', null), false);
  for (const flag of [{ mode: 'off' }, null, {}, { mode: 'ALL' }]) assert.equal(enabled(flag, 't1', null), false, JSON.stringify(flag));
});

test('the owner sees the switch in 운영 설정 and can only pick off or all', async () => {
  const { writeRuntimeConfig } = require('../../functions/src/runtime-config-admin.js');
  const store = new Map();
  const db = { collection: (name) => ({ doc: (id) => { const path = `${name}/${id || 'auto'}`; return { id: id || 'auto', get: async () => ({ exists: store.has(path), data: () => store.get(path) }), set: async (v) => { store.set(path, v); } }; } }) };
  const saved = await writeRuntimeConfig(db, { document: 'beforeAfterSharing', value: { mode: 'all', userIds: ['x'] }, actorId: 'boss' });
  assert.deepEqual(saved.value, { mode: 'all', phase1Verified: true });
  assert.equal(store.get('runtimeConfig/beforeAfterSharing').mode, 'all');
  await assert.rejects(writeRuntimeConfig(db, { document: 'beforeAfterSharing', value: { mode: 'listed' }, actorId: 'boss' }), /before_after_sharing_mode_invalid/);
  const app = await read('src/App.jsx');
  assert.match(app, /document="beforeAfterSharing" title="비포애프터 회원 공유" allowListed=\{false\}/);
});
