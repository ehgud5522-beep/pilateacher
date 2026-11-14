import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COMMENT_MAX, brandFor, cardDate, cardLayout, daysBetween, wrapComment } from '../../src/features/photos/comparison-card.js';

test('teacher comment wraps to at most three lines, never past the box, and adds height only when present', () => {
  const measure = (t) => t.length * 10; // 글자 하나 10px 로 가정
  assert.deepEqual(wrapComment(measure, '', 100), []);
  assert.deepEqual(wrapComment(measure, '짧은 말', 100), ['짧은 말']);
  const long = '가'.repeat(60);
  const lines = wrapComment(measure, long, 100);
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => measure(l) <= 100), 'no line overflows');
  assert.ok(lines[2].endsWith('…'), 'overflow is marked');
  assert.deepEqual(wrapComment(measure, '골반 정렬 좋아요', 60), ['골반 정렬', '좋아요'], 'breaks at spaces first');
  assert.equal(wrapComment(measure, 'x'.repeat(COMMENT_MAX + 50), 10_000)[0].length, COMMENT_MAX, 'input capped');
  assert.ok(cardLayout('side', 4 / 3, null, 2).height > cardLayout('side', 4 / 3, null, 0).height);
  assert.equal(cardLayout('side', 4 / 3, null, 0).commentH, 0);
});

test('brand header is shorter than before so the photos get the space', () => {
  const branded = cardLayout('side', 4 / 3, brandFor('bonita'));
  assert.ok(branded.top <= 210, `header ${branded.top}`);
  assert.ok(branded.cellW >= 560, `photo cell ${branded.cellW}`);
});

test('only the Bonita centre gets the Bonita mark; other centres and personal accounts get none', () => {
  assert.deepEqual(brandFor('bonita'), { primary: 'BONITA', secondary: 'PILATES', logo: null });
  for (const id of ['other', '', null, undefined]) assert.equal(brandFor(id), null, String(id));
});

test('card dates and the period between them', () => {
  assert.equal(cardDate('2026-06-02'), '2026.06.02');
  assert.equal(daysBetween('2026-06-02', '2026-11-12'), 163);
  assert.equal(daysBetween('2026-11-12', '2026-06-02'), 163, 'order does not matter');
  assert.equal(daysBetween('2026-11-13', '2026-11-13'), 0);
  assert.equal(daysBetween('', '2026-11-13'), null, 'unknown dates never invent a period');
});

test('card height follows the photo ratio instead of a fixed frame', () => {
  const portrait = cardLayout('side', 4 / 3), landscape = cardLayout('side', 3 / 4);
  assert.equal(portrait.width, 1200);
  assert.ok(portrait.cellH > landscape.cellH, 'portrait photos get taller cells');
  assert.ok(cardLayout('overlay', 4 / 3).height < 1500, 'slider card stays a reasonable height');
  assert.equal(cardLayout('side', 99).cellH, cardLayout('side', 1.6).cellH, 'extreme ratios are clamped');
});

test('the comparison image never carries the member name', async () => {
  const source = await readFile(new URL('../../src/features/photos/comparison-card.js', import.meta.url), 'utf8');
  assert.ok(!/member\.name|memberName|\.name\b/.test(source));
});

test('cancelling an edit clears the edit draft so editing is not locked afterwards', async () => {
  const source = await readFile(new URL('../../src/features/photos/BeforeAfterAlbum.jsx', import.meta.url), 'utf8');
  assert.match(source, /onClick=\{cancelEdit\}>취소</);
  assert.match(source, /const cancelEdit = \(\) => \{[\s\S]*?persist\(null\)/);
  assert.match(source, /편집 초안 버리기/);
});
