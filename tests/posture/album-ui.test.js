import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('album renders compact filters, all same-day photos, and optional AI without capture prerequisites', async () => {
  const vite = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'silent' });
  try {
    const { default: Album } = await vite.ssrLoadModule('/src/features/photos/BeforeAfterAlbum.jsx');
    const props = { accountId: 'teacher', members: [{ id: 'm', name: '테스트 회원' }], photos: { m: { front: Array.from({ length: 5 }, (_, i) => ({ id: String(i), blobId: `blob_${i}`, src: 'blob:fixture', date: '2026-11-12' })) } }, hub: () => { throw new Error('AI must not mount by default'); } };
    const list = renderToStaticMarkup(createElement(Album, props));
    for (const text of ['비포애프터', '전체 회원', '사진 있음', '비교 가능', '5장', '사진 추가']) assert.ok(list.includes(text), text);
    assert.ok(!list.includes('4/4')); assert.ok(!list.includes('검토 필요'));
    const album = renderToStaticMarkup(createElement(Album, { ...props, selectedId: 'm' }));
    assert.equal((album.match(/class="ba-thumb"/g) || []).length, 5);
    assert.ok(album.includes('총 5장')); assert.ok(album.includes('최신 순')); assert.ok(album.includes('오래된 순'));
  } finally { await vite.close(); }
});
