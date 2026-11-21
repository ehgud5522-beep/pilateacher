/**
 * 누름 반응 시간 재기 (2026-11-21 대표: "눌렀을 때 반응이 0.5초 느림").
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TAP_REPORT_GAP_MS, TAP_REPORT_MAX, installTapLatencyProbe, shouldReportTap, tapTargetKey } from "../../src/features/ui/tap-latency.js";

const element = (attrs, tagName = "BUTTON") => ({ tagName, getAttribute: (key) => attrs[key] ?? null });
const target = (button) => ({ closest: () => button });

test("이름표는 안전한 data 열쇠만 -- 글자(회원 이름)는 쓰지 않는다", () => {
  assert.equal(tapTargetKey(target(element({ "data-wide-nav-item": "payroll" }))), "wide-nav-item:payroll");
  assert.equal(tapTargetKey(target(element({ "data-member-name": "김하나" }))), "button");
  assert.equal(tapTargetKey({ closest: () => null }), "other");
  assert.equal(tapTargetKey(null), "other");
});

test("느린 것만 · 최대 20건 · 10초에 한 건", () => {
  assert.equal(shouldReportTap({ tapDelayMs: 50, renderMs: 100 }, { count: 0, lastAt: 0 }, 1000), false);
  assert.equal(shouldReportTap({ tapDelayMs: 300, renderMs: 20 }, { count: 0, lastAt: 0 }, 1000), true);
  assert.equal(shouldReportTap({ tapDelayMs: 0, renderMs: 400 }, { count: TAP_REPORT_MAX, lastAt: 0 }, 1000), false);
  assert.equal(shouldReportTap({ tapDelayMs: 0, renderMs: 400 }, { count: 1, lastAt: 1000 }, 1000 + TAP_REPORT_GAP_MS - 1), false);
});

test("손 뗌 → 누름 대기와 누름 → 그림을 따로 잰다", () => {
  const listeners = {};
  let now = 0;
  const frames = [];
  const win = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: () => {},
    requestAnimationFrame: (fn) => frames.push(fn),
    performance: { now: () => now },
  };
  const reports = [];
  installTapLatencyProbe({ report: (fields) => reports.push(fields), win });
  now = 100; listeners.pointerup();
  now = 450; listeners.click({ target: target(element({ "data-stage-tab": "post" })) });
  now = 470; frames.shift()();
  now = 480; frames.shift()();
  assert.deepEqual(reports, [{ target: "stage-tab:post", tapDelayMs: 350, renderMs: 30 }]);
});

test("배선: 앱이 한 번 걸고 진단으로 남긴다 · 누름 표시 · 두 번 누르기 확대 끄기", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.ok(app.includes("installTapLatencyProbe({"));
  assert.ok(app.includes('deviceLog("ui_tap_slow"'));
  const css = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8");
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /button:not\(:disabled\):active/);
});
