/* 앨범 화면 배치 (2026-11-15 대표 폰 화면):
   ① "1장 선택" 띠가 사진 판 가운데에 떠서 사진을 가림
   ② 상세에서 [사진 선택] 을 눌러도 아무것도 안 변해 보임 -- 스크롤해서 찾아야 함
   ③ 상세 창 아래 [사진 선택] 버튼이 탭 막대에 잘림
   ④ "펜 · 자" 라는 이름 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OVERLAY_LAYER } from '../../src/features/ui/overlay-stack.js';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the selection band stands in the filter row and sticks under the header -- never floats over the photos', async () => {
  const [album, css] = await Promise.all([read('src/features/photos/BeforeAfterAlbum.jsx'), read('src/features/photos/album.css')]);
  assert.match(album, /\{selected\.length > 0 \? <div className="ba-selection" role="toolbar"/);
  assert.equal((album.match(/className="ba-selection"/g) || []).length, 1, 'only one band, in the filter row');
  assert.match(css, /\.ba-selection\{position:sticky;top:var\(--ba-head,56px\);/);
  assert.doesNotMatch(css, /\.ba-selection\{[^}]*;bottom:/, 'no longer pinned to the bottom of the scroll area');
  // 머리 띠 높이는 재서 넘긴다 -- 이름 · 표시 줄이 길어도 띠가 머리 밑으로 숨지 않는다.
  assert.match(album, /root\.style\.setProperty\('--ba-head'/);
  // 버튼이 많아도 줄을 바꾸지 않고 옆으로 민다.
  assert.match(css, /\.ba-selection-actions\{[^}]*overflow-x:auto/);
});

test('choosing a photo in the viewer moves to that photo and flashes it, and motion can be turned down', async () => {
  const [album, css] = await Promise.all([read('src/features/photos/BeforeAfterAlbum.jsx'), read('src/features/photos/album.css')]);
  assert.match(album, /if \(!chosen\) setFocusKey\(key\);/);
  assert.match(album, /scroller\.scrollTo\(\{ top, behavior: still \? 'auto' : 'smooth' \}\)/);
  // 부드러운 이동이 시작조차 안 하는 웹뷰가 있다(이 PC 의 미리보기 창이 그랬다) -- 그때는 바로 옮긴다.
  assert.match(album, /const arrive = setTimeout\(\(\) => \{ if \(Math\.abs\(scroller\.scrollTop - top\) > 2\) scroller\.scrollTop = top; \}, 700\);/);
  // 반짝임을 끄는 타이머는 따로 산다 -- 같은 효과 안에 두면 focusKey 를 비우는 순간 지워져 계속 반짝였다.
  assert.match(album, /if \(!flashKey\) return undefined;\s*\r?\n\s*const timer = setTimeout\(\(\) => setFlashKey\(''\), 1100\);/);
  assert.match(album, /matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.ba-grid article\.is-flash\{animation:none\}\}/);
  // 이미 고른 사진이면 버튼이 [선택 해제] 가 된다.
  assert.match(album, /\{selected\.includes\(photoKey\(preview\)\) \? '선택 해제' : '사진 선택'\}/);
});

test('the viewer and the editor open above the tab bar, below the toast', async () => {
  const [album, css] = await Promise.all([read('src/features/photos/BeforeAfterAlbum.jsx'), read('src/features/photos/album.css')]);
  assert.match(album, /createPortal\(<div className="ba-root ba-layer">\{node\}<\/div>, document\.body\)/);
  assert.match(album, /\{preview && !editing && layer\(<section ref=\{dialog\} className="ba-viewer ba-panel"/);
  assert.match(album, /\{editing && layer\(<section ref=\{dialog\} className="ba-editor ba-panel"/);
  const z = Number(/\.ba-root\.ba-layer\{[^}]*z-index:(\d+)/.exec(css)?.[1]);
  assert.ok(z > 40, `above the tab bar (z-40): ${z}`);
  assert.ok(z > OVERLAY_LAYER.ACTION && z < OVERLAY_LAYER.TOAST, `between ACTION and TOAST: ${z}`);
  // 상세는 사진이 남는 자리를 쓰고, 버튼 줄은 늘 화면 안에 있다.
  assert.match(css, /\.ba-root \.ba-viewer\{display:flex;flex-direction:column;overflow:hidden\}/);
  assert.match(css, /\.ba-viewer \.ba-edit-preview\{flex:1 1 0;min-height:0;/);
});

test('"펜 · 자" is now called 그리기 everywhere a teacher reads it', async () => {
  const [album, app] = await Promise.all([read('src/features/photos/BeforeAfterAlbum.jsx'), read('src/App.jsx')]);
  // 주석은 남아도 된다. 화면 글자(>…< 와 label 값)에서만 본다.
  assert.doesNotMatch(album, />펜 · 자</);
  assert.equal((album.match(/>그리기<\/Button>/g) || []).length, 2, 'selection band and viewer');
  assert.doesNotMatch(app, /label=\{`\$\{photo\.date \|\| ""\} · 펜 · 자`\}/);
  // 두 장을 골랐을 때의 버튼도 앞의 [변화 카드 만들기] 와 같은 이름이다.
  assert.match(album, />변화 카드 만들기<\/Button>\}/);
  assert.doesNotMatch(album, />비포애프터 비교</);
});

test('success notices clear themselves; failures stay until the teacher acts', async () => {
  const album = await read('src/features/photos/BeforeAfterAlbum.jsx');
  assert.match(album, /notifyTimer\.current = setTimeout\(\(\) => setMessage\(\(current\) => current === text \? '' : current\), 4000\);/);
  assert.match(album, /notify\('사진을 저장했습니다\.'\)/);
  assert.doesNotMatch(album, /AI 분석은 선택 사항입니다/);
  // 실패 문구는 스스로 걷히지 않는다.
  assert.doesNotMatch(album, /notify\('[^']*(실패|못했)[^']*'\)/);
});
