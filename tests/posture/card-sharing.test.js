import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { captureShareCard } from '../../src/features/photos/share-card-payload.js';
import { sharingDiagnostic, sharingMessage } from '../../src/features/photos/sharing-errors.js';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

test('Compare snapshot, teacher preview and upload share one JPEG encoding; member card has no slider', async () => {
  const bytes = Buffer.from([255,216,255,192,0,11,8,3,232,4,176,1,1,17,0,255,218,0,2,255,217]);
  let encodings = 0;
  const canvas = { width: 1200, height: 1000, toDataURL: (type, quality) => { encodings++; assert.equal(type, 'image/jpeg'); assert.equal(quality, 0.9); return `data:image/jpeg;base64,${bytes.toString('base64')}`; } };
  const card = await captureShareCard(canvas, [{ id: 'one', date: '2026-06-01' }, { id: 'two', date: '2026-11-14' }], '변화 코멘트');
  assert.equal(encodings, 1);
  assert.equal(card.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(card.preview.split(',')[1], card.cardBase64);
  assert.equal(card.comment, '변화 코멘트');
  const vite = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'silent' });
  try {
    const { default: Teacher } = await vite.ssrLoadModule('/src/features/photos/TeacherPhotoSharing.jsx');
    const { CardImage } = await vite.ssrLoadModule('/src/features/photos/SharedBeforeAfter.jsx');
    const markup = renderToStaticMarkup(createElement(Teacher, { api: async () => ({}), card, member: { name: 'Synthetic', orgClientId: 'member' }, organizationId: 'org' }));
    assert.ok(markup.includes(card.preview));
    assert.ok(markup.includes('공유하기')); assert.ok(markup.includes('checkbox'));
    assert.ok(!markup.includes('textarea'), 'comment is not asked twice');
    const member = renderToStaticMarkup(createElement(CardImage, { src: card.preview, share: { teacherName: 'Teacher', dates: card.dates } }));
    assert.ok(member.includes(card.preview)); assert.ok(member.includes('Teacher'));
    for (const forbidden of ['range', '슬라이더', '<canvas', 'download=', '변화 코멘트']) assert.ok(!member.includes(forbidden), forbidden);
  } finally { await vite.close(); }
});
test('sharing errors retain SDK codes and distinct reasons without sensitive text', () => {
  const context = { action: 'prepare', shareId: 'a'.repeat(64), bytes: 100, appBuild: '1.1.50 (84)', platform: 'android', cardBase64: 'SECRET_IMAGE', comment: 'SECRET_NOTE', name: 'SECRET_NAME' };
  for (const reason of ['card-too-large', 'card-not-jpeg', 'card-hash-mismatch', 'card-comment-too-long', 'consent-required', 'teacher-access-revoked']) {
    const error = { code: 'functions/failed-precondition', message: 'SECRET_NAME 010-1234-5678', details: { reasonCode: `share/${reason}` } };
    const diagnostic = sharingDiagnostic(error, context);
    assert.equal(diagnostic.errorCode, error.code); assert.equal(diagnostic.reasonCode, `share/${reason}`);
    assert.equal(diagnostic.shareIdPrefix, 'aaaaaaaa');
    assert.ok(sharingMessage(error).includes(reason));
    assert.ok(!JSON.stringify(diagnostic).includes('SECRET')); assert.ok(!JSON.stringify(diagnostic).includes('010-'));
  }
  assert.ok(sharingMessage({ code: 'functions/unavailable' }).includes('네트워크'));
  assert.ok(sharingMessage({ code: 'functions/permission-denied' }).includes('권한'));
});

test('synthetic DOM flow: confirm teacher card, member sees same bytes, revoke removes visible card', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const saved = Object.fromEntries(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  const vite = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'silent' });
  let root;
  try {
    const { default: Teacher } = await vite.ssrLoadModule('/src/features/photos/TeacherPhotoSharing.jsx');
    const { SharedBeforeAfter } = await vite.ssrLoadModule('/src/features/photos/SharedBeforeAfter.jsx');
    const base64 = Buffer.from([255,216,255,217]).toString('base64');
    const card = { preview: `data:image/jpeg;base64,${base64}`, cardBase64: base64, sha256: 'test', width: 1200, height: 1000, comment: 'Synthetic note', dates: ['2026-06-01','2026-11-14'], photoIds: ['one','two'] };
    let share = null, submitted;
    const api = async (input) => {
      if (input.action === 'teacherList') return { shares: share && share.status !== 'revoked' ? [share] : [] };
      if (input.action === 'prepare') { submitted = input; share = { id: 'synthetic', shareType: 'card', status: 'draft', teacherName: 'Teacher', dates: card.dates }; return share; }
      if (input.action === 'activate') { assert.equal(input.confirmed, true); share = { ...share, status: 'active' }; return share; }
      if (input.action === 'revoke') { share = { ...share, status: 'revoked' }; return share; }
      if (share.status !== 'active') throw new Error('share/revoked');
      if (input.action === 'detail') return share;
      if (input.action === 'media') return { base64: submitted.cardBase64 };
      throw new Error('unexpected action');
    };
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(createElement(Teacher, { api, card, member: { name: 'Synthetic', orgClientId: 'member' }, organizationId: 'org' })));
    assert.equal(submitted, undefined, 'preview does not prepare or publish');
    const publish = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '공유하기');
    assert.equal(publish.disabled, true);
    assert.equal(document.querySelector('img').src, card.preview);
    await act(async () => document.querySelector('input[type=checkbox]').click());
    await act(async () => publish.click());
    assert.equal(submitted.cardBase64, card.preview.split(',')[1]);
    assert.equal(submitted.comment, card.comment); assert.equal(share.status, 'active');
    await act(async () => root.render(createElement(SharedBeforeAfter, { api, share })));
    const image = document.querySelector('img');
    assert.ok(image); assert.equal(document.querySelector('input[type=range]'), null);
    assert.deepEqual(Buffer.from(await (await fetch(image.src)).arrayBuffer()), Buffer.from(base64, 'base64'));
    await api({ action: 'revoke', shareId: share.id });
    await act(async () => window.dispatchEvent(new window.Event('online')));
    assert.equal(document.querySelector('img'), null); assert.ok(document.body.textContent.includes('share/revoked'));
  } finally {
    if (root) await act(async () => root.unmount());
    await vite.close(); dom.window.close();
    for (const [k, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k]; }
  }
});
