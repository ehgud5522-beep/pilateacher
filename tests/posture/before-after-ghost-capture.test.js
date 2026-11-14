/* 지난 사진에 맞춰 찍기 (2026-11-15 대표). 촬영 화면에 지난 사진을 반투명으로 얹는다.
   카메라 자체는 테스트로 볼 수 없다 -- 여기서는 고르는 규칙과 배선을 고정한다. 실기기 확인 대상이다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { ghostCandidate } from '../../src/features/photos/album-model.js';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const photo = (id, date, view = 'front', src = 'blob:x') => ({ id, bucket: 'front', date, view, src });
const screen = async () => {
  const source = await read('src/App.jsx');
  const start = source.indexOf('function PostureCaptureScreen(');
  return source.slice(start, source.indexOf('\nfunction PoseAnalyzer(', start));
};

test('the photo laid over the camera is the first shot of whatever the teacher photographed last', () => {
  const photos = [photo('front-new', '2026-11-13'), photo('part-old', '2026-05-01', 'custom'), photo('front-old', '2026-06-02'), photo('side', '2026-07-01', 'leftSide')];
  assert.equal(ghostCandidate(photos).id, 'front-old', 'last shot was 정면 → the oldest 정면');
  /* 대표: "전신이 아니더라도 부위를 비포애프터할 수도 있음". 부위 사진(기타)을 뒤로 미루지 않는다. */
  const parts = [...photos, photo('part-new', '2026-11-14', 'custom')];
  assert.equal(ghostCandidate(parts).id, 'part-old', 'last shot was a body part → the oldest body-part photo, not a full-body one');
  assert.equal(ghostCandidate([photo('misc', '2026-05-01', 'custom')]).id, 'misc');
  assert.equal(ghostCandidate([photo('nosrc', '2026-05-01', 'front', '')]), null, 'a photo that cannot be shown is not offered');
  assert.equal(ghostCandidate([]), null);
});

test('the overlay is drawn on screen only, in three steps, and survives into the confirm step', async () => {
  const source = await screen();
  assert.match(source, /const GHOST_LEVELS = \[\{ opacity: 0\.4, label: "겹침 연하게" \}, \{ opacity: 0\.65, label: "겹침 진하게" \}, \{ opacity: 0, label: "겹침 끔" \}\];/);
  // 미리보기가 켜져 있거나 방금 찍은 사진을 확인하는 동안에만 보인다.
  assert.match(source, /\{ghostOpacity > 0 && \(pendingCapture \|\| cameraStatus === "active"\) && <img src=\{ghost\.src\} alt="" aria-hidden="true" data-posture-ghost className="pointer-events-none absolute inset-0 h-full w-full object-contain"/);
  // 사진 위에서 손가락을 가로채지 않는다.
  assert.match(source, /data-posture-ghost className="pointer-events-none/);
  // 찍히는 사진은 카메라에서 바로 온다 -- 겹침이 섞여 들어갈 길이 없다.
  const capture = source.slice(source.indexOf('const captureBrowserFrame = async'), source.indexOf('const beginCountdown ='));
  assert.doesNotMatch(capture, /ghost/);
  // 겹칠 사진을 못 읽으면 조용히 끄고 촬영은 그대로 된다.
  assert.match(source, /onError=\{\(\) => setGhostBroken\(true\)\}/);
  assert.match(source, /const ghostOpacity = ghost\?\.src && !ghostBroken \? GHOST_LEVELS\[ghostLevel\]\.opacity : 0;/);
});

test('with the overlay on, the tall guide frame steps aside and the coach line says what to do', async () => {
  const source = await screen();
  assert.match(source, /\{!pendingCapture && !captureCompleteIdle && ghostOpacity === 0 && \(/);
  assert.match(source, /const directionGuide = ghostOpacity > 0 \? "지난 사진의 윤곽에 회원님을 맞춰 세워 주세요\." : \{/);
  // 수평이 안 맞으면 여전히 그 안내가 먼저다 (level-coaching.test.js 가 고정한 줄 그대로).
  assert.match(source, /\{sensor\.isLevel \? directionGuide : sensor\.message\}/);
});

test('an iPhone build without the live preview says so instead of pretending', async () => {
  const source = await screen();
  assert.match(source, /iosStableCaptureFallback \? \(ghost \? "이 빌드의 아이폰에서는 겹쳐 찍기를 쓸 수 없어요\. 기본 카메라로 찍은 뒤 변화 카드에서 \[자동으로 맞추기\]를 눌러 주세요\."/);
  assert.match(source, /\{ghost\?\.src && !ghostBroken && !iosStableCaptureFallback && /, 'no overlay switch where there is no preview');
});

test('the assessment capture flow is untouched: no ghost unless the album passes one', async () => {
  const source = await read('src/App.jsx');
  assert.match(source, /onContinue, onExit,\s*\r?\n\s*ghost = null,\s*\r?\n\}\) \{/);
  const analyzer = source.slice(source.indexOf('{analysisMethod && !analysisStarted && <PostureCaptureScreen'), source.indexOf('<input ref={albumRef} type="file"'));
  assert.doesNotMatch(analyzer, /ghost=/);
});

test('a failed save keeps the shot: the screen closes only after the album has stored it', async () => {
  const [app, album] = await Promise.all([read('src/App.jsx'), read('src/features/photos/BeforeAfterAlbum.jsx')]);
  const wrapper = app.slice(app.indexOf('function AlbumCaptureScreen('), app.indexOf('const EMPTY_OBJECT ='));
  assert.match(wrapper, /const stored = await onCaptured\(blob, view\);\s*\r?\n\s*if \(stored\) \{ setTaken\(true\); onClose\(\); \}\s*\r?\n\s*return stored;/);
  const save = album.slice(album.indexOf('const saveShot = async'), album.indexOf('const startCard ='));
  assert.match(save, /await onImport\(\{ kind: 'import', memberId: member\.id, items: \[\{ file, hash, date: today\(\), dateSource: 'capture', view: shotView, part: shooting\?\.part \|\| '' \}\] \}\);/);
  assert.match(save, /catch \(error\) \{ setMessage\(error\?\.message \|\| '사진 저장 실패 · 촬영 화면에서 다시 시도해 주세요\.'\); return false; \}/);
  // 겹칠 사진은 앨범 편집을 적용한 모습이고, 펜 · 자 표시는 뺀다.
  assert.match(album, /const \[e\] = renderInput\(p, null, p\.albumEdit\); src = \(await renderAlbumPhoto\(p\.src, e, 1080\)\)\.toDataURL\('image\/jpeg', 0\.85\);/);
  // 못 읽어도 촬영은 연다.
  assert.match(album, /catch \{ setMessage\('지난 사진을 불러오지 못해 겹쳐 보기 없이 촬영합니다\.'\); \}/);
});

test('the album offers it only where a camera screen is wired, from one photo up', async () => {
  const vite = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'silent' });
  try {
    const { default: Album } = await vite.ssrLoadModule('/src/features/photos/BeforeAfterAlbum.jsx');
    const base = { accountId: 'teacher', members: [{ id: 'm', name: '테스트 회원' }], selectedId: 'm', hub: () => null };
    const one = { m: { front: [{ id: '0', blobId: 'b0', src: 'blob:fixture', date: '2026-06-02' }] } };
    const wired = renderToStaticMarkup(createElement(Album, { ...base, photos: one, capture: () => null }));
    assert.ok(wired.includes('지난 사진에 맞춰 찍기'));
    assert.ok(wired.includes('26.06.02 정면 사진을 겹쳐 보며 같은 구도로 찍어요'), 'it says which photo will be laid over');
    assert.ok(!renderToStaticMarkup(createElement(Album, { ...base, photos: one })).includes('지난 사진에 맞춰 찍기'));
    assert.ok(!renderToStaticMarkup(createElement(Album, { ...base, photos: {}, capture: () => null })).includes('지난 사진에 맞춰 찍기'));
  } finally { await vite.close(); }
});
