const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCard, digest, deleteShareCard } = require('../src/share-card');
const { shareDiagnostic } = require('../src/share-diagnostics');
const bytes = Buffer.from([255,216,255,192,0,11,8,3,232,4,176,1,1,17,0,255,218,0,2,255,217]);
const input = { cardBase64: bytes.toString('base64'), sha256: digest(bytes), width: 1200, height: 1000, comment: '자세 변화', dates: ['2026-06-01','2026-11-14'] };
test('card validation preserves exact JPEG bytes', () => assert.deepEqual(validateCard(input), bytes));
for (const [name, patch, reason] of [
  ['size', { cardBase64: 'A'.repeat(6 * 1024 * 1024) }, 'card-too-large'],
  ['format', { cardBase64: Buffer.from('not jpeg').toString('base64') }, 'card-not-jpeg'],
  ['hash', { sha256: '0'.repeat(64) }, 'card-hash-mismatch'],
  ['comment', { comment: '가'.repeat(121) }, 'card-comment-too-long'],
  ['width', { width: 600 }, 'card-dimensions'],
  ['forged dimensions', { height: 1200 }, 'card-dimensions'],
  ['date', { dates: ['2026-02-31', '2026-11-14'] }, 'card-dates'],
]) test(`card rejects ${name} with its own reason`, () => assert.throws(() => validateCard({ ...input, ...patch }), new RegExp(reason)));
test('card cleanup uses only canonical share path and ignores absent files', async () => {
  const seen = [];
  const bucket = { file: (path) => ({ delete: async (options) => seen.push({ path, options }) }) };
  await deleteShareCard(bucket, { id: 'abc', shareType: 'card', card: { path: 'users/private/original.bin' } });
  await deleteShareCard(bucket, { id: 'old', shareType: 'comparison' });
  assert.deepEqual(seen, [{ path: 'beforeAfterShares/abc/card.jpg', options: { ignoreNotFound: true } }]);
});
test('server share diagnosis includes codes but no payload, identity or free text', () => {
  const diagnostic = shareDiagnostic({ code: 'share/card-too-large', httpsCode: 'failed-precondition', message: 'Private Person 010-1234-5678' }, { action: 'prepare', ...input, cardBase64: 'secret', uid: 'private', name: 'Private Person', comment: 'private note', token: 'token', platform: 'android', appBuild: '1.1.50 (84)' });
  assert.equal(diagnostic.reasonCode, 'share/card-too-large');
  assert.equal(diagnostic.feature, 'before_after_share');
  for (const value of ['Private Person', '010-', 'secret', 'private note', 'token']) assert.ok(!JSON.stringify(diagnostic).includes(value));
});
