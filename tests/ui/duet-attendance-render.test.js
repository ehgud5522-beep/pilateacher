/**
 * 듀엣 출석을 **실제로 그린다** -- 한 명 미표시면 확정 버튼이 잠기고 이유가 서는지,
 * "둘 다 출석" 이 있는지, 대표 확인 목록이 대표 · 총괄매니저에게만 메뉴에 있는지.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const settleButton = (html) => html.match(/<button[^>]*data-lesson-confirm[^>]*>[\s\S]*?<\/button>/)?.[0] || "";

/* 2026-11-17 개편: 출석은 기본값이다. 아직 안 고른 사람은 "출석으로 처리됩니다" 로 보이고, [수업 확정] 이
   그 사람을 출석으로 적은 뒤에 확정한다 -- 한 명이 "예약" 으로 남은 채 확정되는 일(60일 125건 중 48건)은
   버튼을 잠그지 않고도 생기지 않는다. 확정 진입점의 안전망(settleLesson 의 duet_unmarked)은 그대로다. */
test("듀엣 한 명 미표시 — 그 사람은 출석으로 처리된다고 말하고, 확정은 2명 차감, '전체 출석' 이 있다", async () => {
  const html = await markupOf("일정 탭 · 소속 · 2:1 한 명 미표시");
  assert.match(html, /data-duet-attendance/);
  assert.match(html, /출석으로 처리됩니다/);
  assert.match(settleButton(html), /수업 확정 · 2명 차감/);
  assert.doesNotMatch(settleButton(html), /disabled=""/);
  assert.match(html, /data-all-attended=""[^>]*>전체 출석/);
});

test("둘 다 정해진 듀엣 — 막지 않는다", async () => {
  const ready = await markupOf("일정 탭 · 소속 · 확정 전");
  assert.doesNotMatch(settleButton(ready), /disabled=""/);
  const bothNoshow = await markupOf("일정 탭 · 소속 · 2:1 둘 다 노쇼");
  assert.match(settleButton(bothNoshow), /노쇼 처리 · 2명 차감/, "노쇼는 기본 1회 차감");
  assert.doesNotMatch(settleButton(bothNoshow), /disabled=""/);
});

test("1:1 은 회원별 출석 묶음도 '둘 다 출석' 도 없다", async () => {
  const html = await markupOf("일정 탭 · 소속 · 1:1 노쇼");
  assert.doesNotMatch(html, /data-duet-attendance/);
  assert.doesNotMatch(html, /data-all-attended/);
});

test("대표 확인 목록 — 날짜 · 지점 · 강사 · 미표시 수만, 고치는 버튼 없음", async () => {
  const html = await markupOf("듀엣 출석 확인");
  assert.match(html, /듀엣 출석 확인 1건/);
  assert.match(html, /반송점 · 정예진/);
  assert.match(html, /2명 중 1명 미표시/);
  assert.doesNotMatch(html, /<button/, "읽기만 하는 목록이다");
});

test("메뉴: 대표 · 총괄매니저에게만 있다", async () => {
  for (const name of ["더보기 탭 · 묶음 펼침 · 총괄매니저"]) {
    assert.match(await markupOf(name), /확정됐는데 한 명이 미표시인 듀엣/, name);
  }
  for (const name of ["더보기 탭 · 묶음 펼침 · 매니저", "더보기 탭 · 묶음 펼침 · 강사"]) {
    assert.doesNotMatch(await markupOf(name), /확정됐는데 한 명이 미표시인 듀엣/, name);
  }
});

test("배선 — 확정 진입점(시트 · 출석 화면 · 큐)이 모두 지나는 settleLesson 에서도 막는다", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const settle = source.slice(source.indexOf("const settleLesson = async (lessonId) => {"));
  assert.match(settle.slice(0, 900), /unmarkedSettleMessage\(lesson,/);
  assert.match(settle.slice(0, 900), /errorCode: "duet_unmarked"/);
  assert.match(source, /data-all-attended=\{option\.k === "done" \? "" : undefined\} onClick=\{\(\) => onStatusAll\?\.\(draft\.id, option\.k\)\}/);
  const status = source.slice(source.indexOf("const setStatus = (id, status, memberId, options = {}) => {"));
  assert.match(status.slice(0, 600), /status === "done" && lessonTypeKeyOf\(s0\) === "duet" && !options\.single\) return setStatusAll\(id, status\)/);
});
