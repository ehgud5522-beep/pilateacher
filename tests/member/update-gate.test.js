import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

/* 업데이트 안내 화면을 실제로 그린다 (2026-11-07, 지시서 11번). */

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

const gate = async (t) => {
  const vite = await createServer({
    root: projectRoot, configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, logLevel: "silent",
  });
  t.after(() => vite.close());
  const { UpdateGate } = await vite.ssrLoadModule("/member/src/update-gate.jsx");
  const { readMemberUpdateConfig } = await vite.ssrLoadModule("/member/src/app-update.js");
  return (prompt, values = {}) => renderToStaticMarkup(createElement(UpdateGate, {
    initialState: { prompt, platform: "android", config: readMemberUpdateConfig(values), store: { available: true } },
  }, createElement("p", { id: "app-below" }, "입력 중이던 화면")));
};

test("필수: 화면 전체를 덮고 [지금 업데이트] 만 — 닫기 · 나중에 없음, 아래 앱은 내리지 않고 가린다", async (t) => {
  const render = await gate(t);
  const html = render("required");
  assert.match(html, /class="updatewall"/);
  assert.match(html, /data-update-now/);
  assert.match(html, /업데이트하기/);
  assert.doesNotMatch(html, /data-update-later|나중에|닫기/);
  assert.match(html, /이 버전은 더 이상 사용할 수 없어요/);
  assert.match(html, /aria-hidden="true"[^>]*><p id="app-below">입력 중이던 화면/, "앱은 그대로 두고 가린다");
});

test("권유: [지금 업데이트] [나중에] · 콘솔 문구가 있으면 그 문구", async (t) => {
  const render = await gate(t);
  const html = render("optional", { member_update_title: "보니따 새 버전", member_update_message: "수업 취소 기능이 추가됐어요" });
  assert.match(html, /data-update-later/);
  assert.match(html, /나중에/);
  assert.match(html, /보니따 새 버전/);
  assert.match(html, /수업 취소 기능이 추가됐어요/);
  assert.doesNotMatch(html, /aria-hidden="true"/, "권유는 앱을 막지 않는다");
});

test("최신이면 아무것도 그리지 않는다", async (t) => {
  const render = await gate(t);
  const html = render("none");
  assert.doesNotMatch(html, /data-update-prompt/);
  assert.match(html, /입력 중이던 화면/);
});
