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
    for (const text of ['비포애프터', '전체', '사진 있음', '비교 가능', '5장', '사진 추가']) assert.ok(list.includes(text), text);
    assert.ok(!list.includes('4/4')); assert.ok(!list.includes('검토 필요'));
    const album = renderToStaticMarkup(createElement(Album, { ...props, selectedId: 'm' }));
    assert.equal((album.match(/class="ba-thumb"/g) || []).length, 5);
    assert.ok(album.includes('· 5장')); assert.ok(album.includes('최신 순')); assert.ok(album.includes('오래된 순'));
    assert.ok(!album.includes('사진 백업 설정'));
    assert.ok(!album.includes('선택한 2장 비교'));
    assert.ok(!album.includes('AI 분석 · 기존 기록'));
    const empty = renderToStaticMarkup(createElement(Album, { ...props, photos: {}, selectedId: 'm' }));
    assert.ok(empty.includes('아직 등록된 사진이 없습니다.'));
    assert.ok(empty.includes('사진 추가하기'));
    assert.ok(!empty.includes('촬영 방향 필터'));
    const failure = { photoIdPrefix: 'photo001', category: 'permission', errorCode: 'functions/permission-denied', reasonCode: 'photo/scope-required', stage: 'prepare_access' };
    const failed = renderToStaticMarkup(createElement(Album, { ...props, backupStatus: { state: 'backing_up', processedPhotos: 2, photoFailures: [failure] } }));
    for (const text of ['성공 2장', '실패 1장', 'photo001', '권한', 'functions/permission-denied', 'photo/scope-required', 'prepare_access', '다시 시도']) assert.ok(failed.includes(text), text);
    const unknown = renderToStaticMarkup(createElement(Album, { ...props, backupStatus: { state: 'error' } }));
    assert.ok(unknown.includes('(unknown)'));
  } finally { await vite.close(); }
});
