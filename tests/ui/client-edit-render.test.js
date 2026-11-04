/**
 * 회원 이름 수정 · 보관을 역할별로 그린다 (2026-11-04).
 * 대표 · 총괄매니저 · FC매니저에게는 버튼이, 강사에게는 없다.
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

test("대표 · 총괄매니저 · FC매니저는 이름 수정을 보고, 강사는 못 본다", async () => {
  for (const name of ["센터 회원 상세 · 대표", "센터 회원 상세 · 이력 · 총괄매니저", "센터 회원 상세 · 매니저"]) {
    const html = await markupOf(name);
    assert.match(html, /data-client-edit/, name);
    assert.match(html, />이름 수정</, name);
  }
  const instructor = await markupOf("센터 회원 상세");
  assert.doesNotMatch(instructor, /data-client-edit/);
  assert.doesNotMatch(instructor, />이름 수정</);
  assert.doesNotMatch(instructor, />보관</);
});

test("쓸 수 있는 회원권이 남은 회원은 보관 불가를 코드와 함께, 끝난 회원은 보관 버튼", async () => {
  const active = await markupOf("센터 회원 상세 · 대표");
  assert.match(active, /data-archive-blocked/);
  assert.match(active, /코드 active_pass/);
  const ended = await markupOf("센터 회원 상세 · 보관 가능");
  assert.doesNotMatch(ended, /data-archive-blocked/);
  assert.match(ended, />보관</);
});

test("보관 확인은 지우는 것이 아니라고 말하고, 보관된 회원은 배지와 되살리기", async () => {
  const confirm = await markupOf("센터 회원 상세 · 보관 확인");
  assert.match(confirm, /data-client-archive/);
  assert.match(confirm, /지우는 것이 아니에요/);
  assert.match(confirm, /보관하기/);
  const archived = await markupOf("센터 회원 상세 · 보관됨");
  assert.match(archived, /data-archived-badge/);
  assert.match(archived, />되살리기</);
  assert.doesNotMatch(archived, />보관</);
});

test("이름 수정 화면: 지금 이름이 채워져 있고, 같은 이름이면 저장 버튼이 꺼진다", async () => {
  const html = await markupOf("센터 회원 상세 · 이름 수정");
  assert.match(html, /data-client-name/);
  assert.match(html, /value="김하나"/);
  assert.match(html, /<button type="button" disabled=""[^>]*>이름 저장</);
  assert.match(html, /지난 일정에는 예전 이름이 남을 수 있어요/);
});

test("회원 관리: 보관된 회원은 목록 · 칩 숫자에서 빠지고 아래 묶음에만", async () => {
  const html = await markupOf("회원 관리 · 보관된 회원");
  const list = html.slice(0, html.indexOf("data-archived-group"));
  assert.doesNotMatch(list, /보관회원/, "본 목록에는 없다");
  assert.match(html, /data-instructor-group="all" aria-pressed="true"[^>]*>전체 5</, "강사 칩 '전체' 숫자에 안 센다");
  assert.match(html, /반송점 4/, "지점 칩 숫자에도 안 센다");
  assert.match(html, /보관된 회원 1명/);
  assert.match(html.slice(html.indexOf("data-archived-group")), /보관회원[\s\S]*보관됨/);
});
