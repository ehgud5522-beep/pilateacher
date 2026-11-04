/**
 * 회원권 이력 — 달 묶음 · 회원권 칩 · 급여 합계의 역할별 표시 (2026-11-04)를
 * **실제로 그린다.** 픽스처는 9월 17일 기준: 9월에 차감 3 · 보정 1, 8월에 발급.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
let vite = null;
let cases = null;
const markupOf = async (name) => {
  if (!cases) {
    vite = await createServer({
      root: projectRoot, configFile: false, plugins: [react()], appType: "custom",
      optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
      ssr: { noExternal: ["@capgo/camera-preview"] }, logLevel: "silent",
    });
    const loaded = await vite.ssrLoadModule("/src/App.jsx");
    cases = new Map(loaded.createAppScreenSmokeCases().map((item) => [item.name, item.element]));
  }
  const element = cases.get(name);
  assert.ok(element, `${name} 픽스처가 없습니다`);
  return renderToStaticMarkup(element);
};
test.after(async () => { if (vite) await vite.close(); });

const historyOf = (html) => html.slice(html.indexOf("data-pass-history"));
const months = (html) => [...historyOf(html).matchAll(/data-history-month="([^"]+)"[\s\S]*?aria-expanded="(true|false)"/g)]
  .map((m) => ({ key: m[1], open: m[2] === "true" }));

test("최근 달만 펼치고 나머지는 접는다", async () => {
  const html = await markupOf("센터 회원 상세");
  assert.deepEqual(months(html), [{ key: "2026-09", open: true }, { key: "2026-08", open: false }]);
  assert.match(historyOf(html), /9월 · 차감 3회 · 보정 1건/);
  assert.match(historyOf(html), /8월 · 차감 0회 · 보정 0건/);
  assert.doesNotMatch(historyOf(html), /\+22/, "접힌 8월의 발급 줄은 그리지 않는다");
  // 보정 줄과 그 사유는 그대로 보인다.
  assert.match(historyOf(html), /차감 보정/);
  assert.match(historyOf(html), /강사가 다른 회원을 눌렀습니다/);
});

test("급여 합계는 대표 · 총괄매니저에게만", async () => {
  for (const name of ["센터 회원 상세 · 이력 · 대표", "센터 회원 상세 · 이력 · 총괄매니저"]) {
    assert.match(historyOf(await markupOf(name)), /9월 · 차감 3회 · 보정 1건 · 급여 ₩55,000/, name);
  }
  for (const name of ["센터 회원 상세 · 이력 · FC매니저", "센터 회원 상세"]) {
    const html = historyOf(await markupOf(name));
    assert.match(html, /9월 · 차감 3회 · 보정 1건/, name);
    assert.doesNotMatch(html, /· 급여 ₩/, `${name}: 강사 · FC매니저에게는 합계가 없다`);
  }
});

test("회원권 칩: 전체와 회원권마다, 고르면 그 회원권 줄만", async () => {
  const all = historyOf(await markupOf("센터 회원 상세 · 이력 · 대표"));
  const chips = [...all.matchAll(/data-history-pass="([^"]+)" aria-pressed="(true|false)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(chips, [["all", "true"], ["smoke-pass-a", "false"], ["smoke-pass-old", "false"]]);

  const old = historyOf(await markupOf("센터 회원 상세 · 이력 · 회원권 칩"));
  assert.match(old, /data-history-pass="smoke-pass-old" aria-pressed="true"/);
  assert.match(old, /9월 · 차감 1회 · 보정 0건 · 급여 ₩25,000/);
  assert.doesNotMatch(old, /담당 강사 변경/, "다른 회원권의 줄은 빠진다");
  assert.doesNotMatch(old, /data-history-month="2026-08"/);
});

test("펼치면 8월 발급 줄이 보인다", async () => {
  const html = historyOf(await markupOf("센터 회원 상세 · 이력 전부 펼침"));
  assert.deepEqual(months(html).map((month) => month.open), [true, true]);
  assert.match(html, /\+22/);
});

test("줄별 금액과 단가는 대표 · 총괄매니저에게만 — FC매니저 · 강사는 숨긴다", async () => {
  /* 2026-11-04 대표. 금액(₩) · 보정의 −₩ · 세션업의 +₩ · 판정 이름(단가의 근거) 모두. */
  for (const name of ["센터 회원 상세 · 이력 · 대표", "센터 회원 상세 · 이력 · 총괄매니저"]) {
    const html = historyOf(await markupOf(name));
    assert.match(html, /₩30,000/, name);
    assert.match(html, /−₩30,000/, `${name}: 보정의 금액`);
    assert.match(html, /기준 단가/, `${name}: 판정 이름`);
  }
  for (const name of ["센터 회원 상세 · 이력 · FC매니저", "센터 회원 상세"]) {
    const html = historyOf(await markupOf(name));
    assert.doesNotMatch(html, /₩/, `${name}: 금액이 하나도 없어야 한다`);
    assert.doesNotMatch(html, /기준 단가|신규 단가|부원장/, `${name}: 판정 이름도 숨긴다`);
    // 줄 자체와 보정 사유는 그대로 보인다.
    assert.match(html, /차감 보정/, name);
    assert.match(html, /강사가 다른 회원을 눌렀습니다/, name);
  }
});
