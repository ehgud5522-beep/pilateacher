import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  installFocusVisibilityGuard,
  isOutsideVisibleViewport,
  visibleViewportBounds,
} from "../../src/features/ui/focus-visibility.js";

const readSource = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");

test("visible viewport bounds include visualViewport offset and only flag clipped controls", () => {
  const bounds = visibleViewportBounds({ offsetTop: 24, height: 500 }, 844);
  assert.deepEqual(bounds, { top: 24, bottom: 524 });
  assert.equal(isOutsideVisibleViewport({ top: 80, bottom: 120 }, bounds), false);
  assert.equal(isOutsideVisibleViewport({ top: 500, bottom: 540 }, bounds), true);
});

test("focus guard scrolls only hidden controls and cleans up every listener", () => {
  const documentListeners = new Map();
  const viewportListeners = new Map();
  const windowListeners = new Map();
  const properties = new Map();
  const documentRef = {
    documentElement: { style: {
      setProperty: (key, value) => properties.set(key, value),
      removeProperty: (key) => properties.delete(key),
    } },
    addEventListener: (name, fn) => documentListeners.set(name, fn),
    removeEventListener: (name) => documentListeners.delete(name),
  };
  const windowRef = {
    innerHeight: 844,
    visualViewport: {
      offsetTop: 0,
      height: 500,
      addEventListener: (name, fn) => viewportListeners.set(name, fn),
      removeEventListener: (name) => viewportListeners.delete(name),
    },
    addEventListener: (name, fn) => windowListeners.set(name, fn),
    removeEventListener: (name) => windowListeners.delete(name),
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
  };
  let scrollCount = 0;
  const target = {
    tagName: "INPUT",
    type: "text",
    matches: () => true,
    getBoundingClientRect: () => ({ top: 100, bottom: 144 }),
    scrollIntoView: () => { scrollCount += 1; },
  };

  const cleanup = installFocusVisibilityGuard({ documentRef, windowRef, delay: 0 });
  assert.equal(properties.get("--pt-keyboard-inset"), "344px");
  documentListeners.get("focusin")({ target });
  assert.equal(scrollCount, 0);
  target.getBoundingClientRect = () => ({ top: 480, bottom: 524 });
  documentListeners.get("focusin")({ target });
  assert.equal(scrollCount, 1);

  cleanup();
  assert.equal(documentListeners.size, 0);
  assert.equal(viewportListeners.size, 0);
  assert.equal(windowListeners.size, 0);
  assert.equal(properties.has("--pt-keyboard-inset"), false);
});

test("member registration uses one safe-area header and a separate safe footer", async () => {
  const app = await readSource("src/App.jsx");
  const sheet = app.slice(app.indexOf("function Sheet("), app.indexOf("function ScheduleBottomSheet("));
  const register = app.slice(app.indexOf("function MemberRegisterSheet("), app.indexOf("function ReferenceMemberDetail("));

  assert.match(sheet, /safeTop \? "calc\(env\(safe-area-inset-top, 0px\) \+ 12px\)/);
  assert.match(sheet, /className="pt-scroll min-h-0 flex-1"/);
  assert.match(sheet, /footer && <div[\s\S]*calc\(env\(safe-area-inset-bottom, 0px\) \+ 12px\)/);
  assert.match(register, /wide safeTop/);
  assert.match(register, /footer=\{<button[\s\S]*>회원 등록<\/button>\}/);
  assert.match(register, /grid w-full min-w-0 grid-cols-3 gap-2/);
  assert.match(register, /className="min-w-0 whitespace-nowrap px-1"/);
});

test("posture details retain capture data and actions without repeating their outer title", async () => {
  const app = await readSource("src/App.jsx");
  const start = app.indexOf('data-member-management-card="posture"');
  const end = app.indexOf('data-member-management-card="membership"', start);
  const posture = app.slice(start, end);

  assert.equal((posture.match(/체형변화·사진/g) || []).length, 2, "visible outer title plus aria-label only");
  assert.match(posture, /마지막 촬영/);
  assert.match(posture, /새 체형분석/);
  assert.match(posture, /과거 이력/);
});

test("Capacitor keyboard uses native resize and form controls have a 16px floor", async () => {
  const [app, config] = await Promise.all([readSource("src/App.jsx"), readSource("capacitor.config.json")]);
  const parsed = JSON.parse(config);
  assert.deepEqual(parsed.plugins.Keyboard, { resize: "native", resizeOnFullScreen: true });
  assert.match(app, /input:not\(\[type=range\]\), \.app-root textarea, \.app-root select \{ font-size: 16px; \}/);
  assert.equal((app.match(/installFocusVisibilityGuard\(\{/g) || []).length, 1);
});
