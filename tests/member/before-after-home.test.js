import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BEFORE_AFTER_PRIVACY, beforeAfterSummary, daysBetweenDates, dotDate } from '../../member/src/before-after-copy.js';

test('privacy note says only what is true: private, teacher and member only -- never "not stored on any server"', () => {
  assert.match(BEFORE_AFTER_PRIVACY, /비공개/);
  assert.match(BEFORE_AFTER_PRIVACY, /담당 선생님과 회원님 본인만/);
  assert.doesNotMatch(BEFORE_AFTER_PRIVACY, /저장되지 않|서버에.*없/);
});

test('summary counts records and unread ones; dates and period', () => {
  assert.deepEqual(beforeAfterSummary(), { count: 0, unread: 0, latest: null });
  const s = beforeAfterSummary([{ id: 'a', unread: true }, { id: 'b', unread: false }]);
  assert.equal(s.count, 2); assert.equal(s.unread, 1); assert.equal(s.latest.id, 'a');
  assert.equal(daysBetweenDates('2026-06-02', '2026-11-12'), 163);
  assert.equal(daysBetweenDates('', '2026-11-12'), null);
  assert.equal(dotDate('2026-06-02'), '2026.06.02');
});

test('home card is only wired when sharing is enabled, and the list no longer downloads every card', async () => {
  const app = await readFile(new URL('../../member/src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /beforeAfter=\{sharingEnabled \? beforeAfterSummaryState : null\}/);
  const screen = await readFile(new URL('../../member/src/before-after.jsx', import.meta.url), 'utf8');
  assert.ok(!/SharedBeforeAfter share=\{s\} api=\{api\} thumbnail/.test(screen), 'list rows must not fetch card media');
  assert.match(screen, /BEFORE_AFTER_PRIVACY/);
  const css = await readFile(new URL('../../member/src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.ba-privacy \{[^}]*font-size: 11px/);
});
