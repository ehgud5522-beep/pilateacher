/**
 * 명단 갱신의 배선과 "마지막 갱신" 줄을 그린다 (2026-11-04, 1단계).
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
let vite = null;
const app = async () => {
  vite ||= await createServer({
    root: projectRoot, configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
    ssr: { noExternal: ["@capgo/camera-preview"] }, logLevel: "silent",
  });
  return vite.ssrLoadModule("/src/App.jsx");
};
test.after(async () => { if (vite) await vite.close(); });

test("마지막 갱신 줄 — 켜져 있을 때만, 시각과 새로고침 버튼", async () => {
  const { RosterFreshness, RosterRefreshContext } = await app();
  const render = (value) => renderToStaticMarkup(createElement(RosterRefreshContext.Provider, { value }, createElement(RosterFreshness)));
  const on = render({ enabled: true, refresh: () => {}, updatedAt: Date.now() - 3 * 60 * 1000, refreshing: false });
  assert.match(on, /마지막 갱신 3분 전/);
  assert.match(on, /새로고침/);
  assert.match(render({ enabled: true, refresh: () => {}, updatedAt: Date.now(), refreshing: true }), /새로 읽는 중/);
  assert.equal(render({ enabled: false, refresh: () => {}, updatedAt: null, refreshing: false }), "");
});

test("배선 — 시트 열기 · 당겨서 새로고침 · 복귀 · 진단", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  // 회원 선택 시트를 열면 새로 읽는다.
  assert.match(source, /if \(memberPickerOpen\) rosterRefresh\.refresh\("member_picker"\);/);
  assert.match(source, /title="회원 선택"[^\n]*\n\s+freshness /);
  // 회원 목록은 당겨서 새로고침 + 마지막 갱신 줄.
  assert.match(source, /usePullToRefresh\(\(\) => rosterRefresh\.refresh\("pull_member_list"\)/);
  assert.match(source, /\{organizationMode \? <RosterFreshness \/> : null\}/);
  // 30초 넘게 비활성이었다가 돌아오면.
  assert.match(source, /shouldRefreshOnResume\(\{ hiddenAt, now: Date\.now\(\) \}\)\) refreshRoster\("resume"\)/);
  assert.match(source, /CapacitorApp\.addListener\("appStateChange"/);
  // 읽은 문서 수를 진단에 남긴다 -- 2단계를 정할 근거.
  assert.match(source, /deviceLog\("roster_refresh", \{ feature: "centre_roster", stage: reason, count: outcome\.read \}\)/);
  assert.match(source, /<RosterRefreshContext\.Provider value=\{rosterRefreshValue\}>/);
});
