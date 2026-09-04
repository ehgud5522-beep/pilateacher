import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  installFocusVisibilityGuard,
  isOutsideVisibleViewport,
  visibleFrameBounds,
} from "../../src/features/ui/focus-visibility.js";
import {
  clippingAncestorChain,
  createMemberLayoutSnapshot,
  scheduleMemberLayoutSnapshots,
} from "../../src/features/ui/member-layout-diagnostics.js";

const readSource = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");

test("native-resized document clientHeight is the only focus visibility boundary", () => {
  const bounds = visibleFrameBounds(500);
  assert.deepEqual(bounds, { top: 0, bottom: 500 });
  assert.equal(isOutsideVisibleViewport({ top: 80, bottom: 120 }, bounds), false);
  assert.equal(isOutsideVisibleViewport({ top: 480, bottom: 504 }, bounds), true);
});

test("focus guard scrolls only controls hidden outside the native-resized frame", () => {
  const documentListeners = new Map();
  const documentRef = {
    documentElement: { clientHeight: 500 },
    addEventListener: (name, fn) => documentListeners.set(name, fn),
    removeEventListener: (name) => documentListeners.delete(name),
  };
  const windowRef = {
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
  documentListeners.get("focusin")({ target });
  assert.equal(scrollCount, 0);
  target.getBoundingClientRect = () => ({ top: 480, bottom: 524 });
  documentListeners.get("focusin")({ target });
  assert.equal(scrollCount, 1);
  cleanup();
  assert.equal(documentListeners.size, 0);
});

test("keyboard model has no visualViewport height or manual inset compensation", async () => {
  const [app, focus, config] = await Promise.all([
    readSource("src/App.jsx"),
    readSource("src/features/ui/focus-visibility.js"),
    readSource("capacitor.config.json"),
  ]);
  assert.deepEqual(JSON.parse(config).plugins.Keyboard, { resize: "native", resizeOnFullScreen: true });
  assert.doesNotMatch(focus, /visualViewport|innerHeight|pt-keyboard-inset/);
  assert.doesNotMatch(app, /--pt-keyboard-inset/);
  assert.match(app, /padding: "4px 16px 20px"/);
  assert.equal((app.match(/installFocusVisibilityGuard\(\{/g) || []).length, 1);
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

test("16px form-control floor is scoped to iOS Capacitor only", async () => {
  const app = await readSource("src/App.jsx");
  assert.match(app, /Capacitor\.isNativePlatform\(\) && Capacitor\.getPlatform\(\) === "ios" \? " pt-native-ios"/);
  assert.match(app, /\.app-root\.pt-native-ios input:not\(\[type=range\]\), \.app-root\.pt-native-ios textarea, \.app-root\.pt-native-ios select \{ font-size: 16px; \}/);
  assert.doesNotMatch(app, /\.app-root input:not\(\[type=range\]\), \.app-root textarea, \.app-root select \{ font-size: 16px; \}/);
});

test("member detail removes ineffective scrollPaddingTop without adding a guessed layout patch", async () => {
  const app = await readSource("src/App.jsx");
  const detail = app.slice(app.indexOf("function ReferenceMemberDetail("), app.indexOf("function ChangeSummary("));
  assert.doesNotMatch(detail, /scrollPaddingTop/);
  assert.match(detail, /ref=\{scrollContainerRef\}[\s\S]*padding: "8px 12px calc\(18px \+ max\(env\(safe-area-inset-bottom, 0px\), 12px\)\)"/);
});

const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const element = (tagName, className, bounds, style = {}, parentElement = null) => ({
  tagName, className, parentElement, styleSnapshot: style,
  getBoundingClientRect: () => bounds,
});

test("member layout snapshot uses elementFromPoint and collects clipping ancestors", () => {
  const html = element("HTML", "", rect(0, 0, 390, 844), { transform: "matrix(1, 0, 0, 1, 0, 0)" });
  const root = element("DIV", "member-root", rect(0, 0, 390, 844), { overflow: "hidden" }, html);
  const actionBar = element("DIV", "member-actions", rect(0, 52, 390, 121), {}, root);
  const scrollContainer = element("MAIN", "pt-scroll", rect(0, 112, 390, 800), { overflowY: "auto" }, root);
  scrollContainer.scrollTop = 12;
  scrollContainer.clientHeight = 688;
  scrollContainer.scrollHeight = 1200;
  const firstSummary = element("SECTION", "summary", rect(12, 120, 378, 190), {}, scrollContainer);
  const recentCard = element("SECTION", "memory-card", rect(12, 108, 378, 220), {}, scrollContainer);
  const hitChild = element("DIV", "memory-row", rect(12, 108, 378, 130), {}, recentCard);
  recentCard.contains = (candidate) => candidate === hitChild;
  let hitPoint = null;
  const documentRef = { elementFromPoint: (x, y) => { hitPoint = { x, y }; return hitChild; } };
  const windowRef = { getComputedStyle: (target) => ({
    overflow: "visible", overflowX: "visible", overflowY: "visible", position: "static",
    paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", transform: "none",
    clipPath: "none", mask: "none", zIndex: "auto", ...target.styleSnapshot,
  }) };
  const snapshot = createMemberLayoutSnapshot({
    elements: { root, actionBar, scrollContainer, firstSummary, recentCard }, documentRef, windowRef,
  });
  assert.deepEqual(hitPoint, { x: 195, y: 112 });
  assert.equal(snapshot.hitIsCard, true);
  assert.equal(snapshot.hitInsideCard, true);
  assert.equal(snapshot.cardAboveContainer, true);
  assert.equal(snapshot.actionBarOverlapsContainer, true);
  assert.equal(snapshot.ancestorHasClip, true);
  assert.equal(snapshot.ancestorHasTransform, true);
  assert.deepEqual(snapshot.clippingAncestors.map((entry) => entry.tagName), ["DIV", "HTML"]);
  assert.equal(snapshot.scrollHeight, 1200);
  assert.equal(clippingAncestorChain(scrollContainer, windowRef.getComputedStyle).length, 2);
});

test("member layout diagnostic distinguishes first and second animation frames", () => {
  const frames = [];
  const snapshots = [];
  const target = element("DIV", "target", rect(0, 0, 100, 100));
  target.contains = () => false;
  const windowRef = {
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ overflow: "visible", overflowX: "visible", overflowY: "visible", transform: "none", clipPath: "none", mask: "none" }),
  };
  scheduleMemberLayoutSnapshots({
    elements: { root: target, actionBar: target, scrollContainer: target, firstSummary: target, recentCard: target },
    documentRef: { elementFromPoint: () => target }, windowRef, onSnapshot: (snapshot) => snapshots.push(snapshot),
  });
  frames[0]();
  assert.deepEqual(snapshots.map((snapshot) => snapshot.frame), ["first"]);
  frames[1]();
  assert.deepEqual(snapshots.map((snapshot) => snapshot.frame), ["first", "settled"]);
});
