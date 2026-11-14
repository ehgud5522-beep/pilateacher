import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SESSION_UP_VALUE, sessionUpNotice } from '../../member/src/session-up-copy.js';
import { sessionUpWindowOf } from '../../functions/shared/session-up.mjs';

const NOW = new Date('2026-11-15T12:00:00+09:00');
const pass = (o = {}) => ({ status: 'active', totalSessions: 10, serviceSessions: 0, remainingCount: 8, expiresAt: '2027-03-01', ...o });

test('the notice says the session-up is cheaper than buying a new pass', () => {
  assert.match(SESSION_UP_VALUE, /새로 등록하는 것보다/);
  assert.match(SESSION_UP_VALUE, /저렴/);
});

test('counts the chances left the same way as the instructor screen (10+ → up to the 6th lesson)', () => {
  const n = sessionUpNotice(pass(), NOW); // 2회 사용
  assert.equal(n.limit, 6); assert.equal(n.used, 2); assert.equal(n.left, sessionUpWindowOf(pass()).left);
  assert.equal(n.title, '세션업 기회 5회 남았어요');
  assert.match(n.detail, /6회차 수업까지/);
});

test('small passes close at the 3rd lesson; the last chance is called out; closed passes show nothing', () => {
  const small = sessionUpNotice(pass({ totalSessions: 5, remainingCount: 3 }), NOW); // 2회 사용, 3회차까지
  assert.equal(small.limit, 3); assert.equal(small.left, 2);
  const last = sessionUpNotice(pass({ remainingCount: 4 }), NOW); // 6회 사용
  assert.equal(last.last, true); assert.match(last.title, /마지막 기회/);
  assert.equal(sessionUpNotice(pass({ remainingCount: 3 }), NOW), null); // 7회 사용 → 끝
});

test('service sessions do not eat into the window', () => {
  const n = sessionUpNotice(pass({ serviceSessions: 2, remainingCount: 10 }), NOW); // 서비스 2회만 씀
  assert.equal(n.used, 0);
});

test('the server projection wins when present; inactive, used up or expired passes show nothing', () => {
  assert.equal(sessionUpNotice(pass({ sessionUpLimit: 6, sessionUpLeft: 1 }), NOW).last, true);
  assert.equal(sessionUpNotice(pass({ sessionUpLimit: 6, sessionUpLeft: 0 }), NOW), null);
  assert.equal(sessionUpNotice(pass({ status: 'expired' }), NOW), null);
  assert.equal(sessionUpNotice(pass({ remainingCount: 0 }), NOW), null);
  assert.equal(sessionUpNotice(pass({ expiresAt: '2026-11-01' }), NOW), null);
  assert.equal(sessionUpNotice(pass({ totalSessions: 0, serviceSessions: 2, remainingCount: 2 }), NOW), null);
});

test('the pass card renders the note only on live cards', async () => {
  const screen = await readFile(new URL('../../member/src/screens.jsx', import.meta.url), 'utf8');
  assert.match(screen, /\{dim \? null : <SessionUpNote pass=\{pass\} now=\{now\} \/>\}/);
});
