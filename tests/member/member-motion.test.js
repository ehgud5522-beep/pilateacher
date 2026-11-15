/* 보니따 앱의 움직임 (2026-11-15 대표: "넘기거나 누를 때 부드럽게, 창 열고 닫을 때 · 별점 달 때 스무스하게").
   움직임 자체는 테스트로 볼 수 없다 -- 여기서는 규칙을 고정한다: 움직임 줄이기에서는 전부 꺼지는가,
   닫히는 움직임이 끝나기 전에 화면을 걷지 않는가, 가는 방향이 맞는가. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const withVite = async (run) => {
  const vite = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'silent' });
  try { return await run(vite); } finally { await vite.close(); }
};

test('every animation and transition is switched off for people who asked for reduced motion', async () => {
  const css = (await read('member/src/motion.css')).replace(/\r\n/g, '\n');
  const start = css.indexOf('@media (prefers-reduced-motion: no-preference) {');
  assert.ok(start > 0);
  // 블록 끝: 줄 맨 앞의 닫는 중괄호.
  const end = css.indexOf('\n}\n', start);
  const outside = css.slice(0, start) + css.slice(end + 3);
  const rulesOutside = outside.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  assert.doesNotMatch(rulesOutside, /animation\s*:|transition\s*:/, 'no motion outside the media block');
  const inside = css.slice(start, end);
  for (const piece of ['.btn:active:not(:disabled)', '.member-page[data-dir="forward"]', '.sheetwrap .sheet', '.ratecard .star.on svg', '.zoom-viewer[data-closing]']) assert.ok(inside.includes(piece), piece);
});

test('closing motions finish inside the time the screen waits before removing the element', async () => {
  const [css, hook] = await Promise.all([read('member/src/motion.css'), read('src/features/ui/use-motion-close.js')]);
  const out = Number(/--m-out:\s*(\d+)ms/.exec(css)[1]);
  const wait = Number(/EXIT_TIMEOUT_MS = (\d+)/.exec(hook)[1]);
  assert.ok(out <= wait, `${out}ms motion vs ${wait}ms wait`);
  // 닫히는 움직임은 전부 그 시간을 쓴다.
  assert.match(css, /\.sheetwrap\[data-closing\] \.sheet \{ animation: member-sheet-out var\(--m-out\)/);
  assert.match(css, /\.ratewrap \{[^}]*transition: grid-template-rows var\(--m-out\)/);
});

test('moving to a tab on the right slides in from the right, to the left from the left', async () => {
  await withVite(async (vite) => {
    const { pageDirection } = await vite.ssrLoadModule('/member/src/App.jsx');
    assert.equal(pageDirection('home'), 'none', 'first paint does not slide');
    assert.equal(pageDirection('home'), 'none');
    assert.equal(pageDirection('records'), 'forward');
    assert.equal(pageDirection('mypage'), 'forward');
    assert.equal(pageDirection('mypage'), 'forward', 're-render keeps the direction (no flip mid-animation)');
    assert.equal(pageDirection('beforeAfter'), 'back');
    assert.equal(pageDirection('home'), 'back');
  });
  const app = await read('member/src/App.jsx');
  assert.match(app, /<div key=\{tab\} className="app-motion-content member-page" data-dir=\{pageDirection\(tab\)\}>/);
});

test('the rating card folds away before the parent is told -- the parent removes it the moment it hears', async () => {
  const card = await read('member/src/lesson-rating.jsx');
  assert.match(card, /const \{ closing, close \} = useMotionClose\(\(\) => \{\s*\r?\n\s*setPhase\("hidden"\);\s*\r?\n\s*onSeen\?\.\(lessonId\);\s*\r?\n\s*if \(stopping\.current\) onStopAsking\?\.\(\);/);
  assert.match(card, /const later = \(\) => close\(\);/);
  // 접히는 동안에는 눌리지 않는다.
  assert.match(card, /inert=\{closing \? "" : undefined\}/);
  await withVite(async (vite) => {
    const { LessonRatingCard } = await vite.ssrLoadModule('/member/src/lesson-rating.jsx');
    const html = renderToStaticMarkup(createElement(LessonRatingCard, { lesson: { lessonId: 'l' }, place: { organizationId: 'o', clientId: 'c' }, api: async () => ({}), onSeen: () => {}, initialPhase: 'ready' }));
    assert.match(html, /^<div class="ratewrap"><div class="ratewrap-clip"><section class="card ratecard"/);
  });
});

test('stars: only newly lit stars pop, the tapped one first; the app loads its motion after the shared one', async () => {
  const [css, main, viewer, list] = await Promise.all([read('member/src/motion.css'), read('member/src/main.jsx'), read('src/features/photos/ZoomViewer.jsx'), read('member/src/before-after.jsx')]);
  assert.match(css, /\.ratecard \.star\.on svg \{ animation: member-star-pop 360ms var\(--m-pop\) backwards; animation-delay: calc\(var\(--star-i, 0\) \* 28ms\); \}/);
  assert.match(css, /\.ratecard \.star\[aria-checked="true"\] svg \{ animation-delay: 0ms; \}/);
  assert.ok(main.indexOf('features/ui/motion.css') < main.indexOf('"./motion.css"'), 'member motion wins ties');
  // 아이폰 웹뷰가 눌림 모양을 그리게.
  assert.match(main, /document\.addEventListener\("touchstart", \(\) => \{\}, \{ passive: true \}\);/);
  // 크게 보기도 닫힐 때 사라지는 움직임을 기다린다. 기록을 열면 앞으로, 목록으로 돌아오면 뒤로.
  assert.match(viewer, /const \{ closing, close \} = useMotionClose\(onClose\);/);
  assert.match(list, /ba-member member-push"/);
  assert.match(list, /cameBack\.current \? ' member-pop' : ''/);
});
