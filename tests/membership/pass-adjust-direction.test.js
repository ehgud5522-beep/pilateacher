/* 잔여 조정 방향 (2026-11-15 대표: "아이폰에 횟수 잔여 조정하는 게 마이너스 입력칸이 없다고 함").
   아이폰 숫자 자판에는 '-' 키가 없다. 방향은 버튼으로 고르고 칸에는 횟수만 넣는다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { JSDOM } from 'jsdom';

const appSource = () => readFile(new URL('../../src/App.jsx', import.meta.url), 'utf8');

test('direction is chosen by buttons; the count field never needs a minus key', async () => {
  const source = await appSource();
  const sheet = source.slice(source.indexOf('function PassEditSheet('), source.indexOf('function PassEditSheet(') + 9000);
  assert.match(sheet, /\[\[-1, "줄이기 −"\], \[1, "늘리기 \+"\]\]\.filter\(\(\[value\]\) => canIncrease \|\| value < 0\)/);
  assert.match(sheet, /<input inputMode="numeric" pattern="\[0-9\]\*" value=\{delta\} placeholder="횟수 \(예: 2\)"/);
  assert.doesNotMatch(sheet, /placeholder=\{canIncrease \? "\+3 또는 -2" : "-2"\}/);
  // 늘리기를 못 하는 사람(FC매니저)은 처음부터 줄이기.
  assert.match(sheet, /\(canIncrease \? 0 : -1\)/);
  // 방향을 안 골랐으면 말한다 -- 저장이 그냥 막히지 않게.
  assert.match(sheet, /줄일지 늘릴지 위에서 골라 주세요\./);
});

test('on screen: pick 줄이기, type 2 → the preview goes down by two; type +3 on a PC → up by three', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'HTMLElement', 'Node', 'localStorage'];
  const saved = Object.fromEntries(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, localStorage: dom.window.localStorage })) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  const vite = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, ssr: { noExternal: ['@capgo/camera-preview'] }, logLevel: 'silent' });
  let root;
  try {
    // react-dom 은 처음 불러올 때 화면(window)이 있는지 본다 -- 가짜 화면을 만든 뒤에 불러와야 입력 이벤트를 듣는다.
    const { createRoot } = await import('react-dom/client');
    const { createAppScreenSmokeCases } = await vite.ssrLoadModule('/src/App.jsx');
    const element = createAppScreenSmokeCases().find((item) => item.name === '센터 회원 상세 · 잔여 조정').element;
    root = createRoot(dom.window.document.getElementById("root"));
    await act(async () => root.render(element));
    const sheet = () => dom.window.document.querySelector("[data-pass-edit]");
    const preview = () => sheet().textContent.match(/(\d+)회 → (\d+)회|지금 (\d+)회/);
    const start = Number(preview()[3]);
    const input = sheet().querySelector('input[aria-label="조정할 횟수"]');
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    const type = async (value) => { await act(async () => { setValue.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); };
    const press = async (label) => { await act(async () => [...sheet().querySelectorAll('button')].find((b) => b.textContent === label).click()); };

    await type('2');
    assert.match(sheet().textContent, /줄일지 늘릴지 위에서 골라 주세요/, 'a bare number asks for the direction first');
    await press('줄이기 −');
    assert.deepEqual([Number(preview()[1]), Number(preview()[2])], [start, start - 2]);
    await press('늘리기 +');
    assert.deepEqual([Number(preview()[1]), Number(preview()[2])], [start, start + 2]);
    await type('-1');
    assert.deepEqual([Number(preview()[1]), Number(preview()[2])], [start, start - 1], 'a typed sign (PC keyboard) still wins');
  } finally {
    if (root) await act(async () => root.unmount());
    await vite.close(); dom.window.close();
    for (const [k, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k]; }
  }
});
