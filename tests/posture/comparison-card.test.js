import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { brandFor, cardDate, cardLayout, daysBetween } from '../../src/features/photos/comparison-card.js';

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
