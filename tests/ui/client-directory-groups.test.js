/**
 * 회원 관리 — 지점 → 강사 → 회원 (2026-11-04)을 **실제로 그린다.**
 *
 * 역할별: 대표 · 총괄매니저는 전 지점의 강사 칩, FC매니저는 맡은 지점 회원으로만
 * 센 강사 칩, 강사에게는 이 화면이 메뉴에 없다. 그리고 담당을 바꾼 뒤 목록이
 * 다시 읽히는 배선.
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

const chips = (html) => [...html.matchAll(/data-instructor-group="([^"]+)" aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g)]
  .map((m) => ({ id: m[1], pressed: m[2] === "true", label: m[3].replace(/<!-- -->/g, "") }));
const labels = (html) => chips(html).map((chip) => chip.label);

test("대표 · 총괄매니저 — 전 지점 회원으로 센 강사 칩, 특별 묶음 둘", async () => {
  for (const name of ["회원 관리 · 강사 칩 · 대표", "회원 관리 · 강사 칩 · 총괄매니저"]) {
    const html = await markupOf(name);
    assert.deepEqual(labels(html), ["전체 5", "강사가 2", "강사나 2", "담당 미지정 1", "활성 회원권 없음 1"], name);
    assert.equal(chips(html).find((chip) => chip.pressed)?.id, "all");
    // 지점 칩의 숫자는 그대로 회원 수다.
    assert.match(html, /반송점 4/, name);
    // 활성 회원권이 없는 회원은 접힌 묶음으로 -- 기본은 접힘.
    assert.match(html, /aria-expanded="false"[^>]*>.*?활성 회원권 없음 1명/, name);
    assert.doesNotMatch(html, /이두리/, `${name}: 접힌 묶음 안의 회원은 그리지 않는다`);
    // 담당이 둘인 회원에게 표시.
    assert.match(html, /박셋[\s\S]*?담당 2명/, name);
  }
});

test("FC매니저 — 맡은 지점 회원으로만 센다", async () => {
  const html = await markupOf("회원 관리 · 강사 칩 · FC매니저");
  assert.deepEqual(labels(html), ["전체 4", "강사가 2", "강사나 1", "담당 미지정 1", "활성 회원권 없음 1"]);
  assert.doesNotMatch(html, /55556666|5666/, "센텀 회원은 없다");
});

test("강사 칩 하나 · 담당 미지정 · 활성 없음 펼침", async () => {
  const one = await markupOf("회원 관리 · 강사 칩 · 한 강사");
  assert.equal(chips(one).find((chip) => chip.pressed)?.id, "smoke-inst-a");
  assert.match(one, /김하나/);
  assert.match(one, /박셋/);
  assert.doesNotMatch(one, /최넷/);
  assert.doesNotMatch(one, /data-no-active-group/, "강사를 고르면 접힌 묶음이 없다");

  const unassigned = await markupOf("회원 관리 · 강사 칩 · 담당 미지정");
  assert.match(unassigned, /최넷/);
  assert.doesNotMatch(unassigned, /박셋/);

  const open = await markupOf("회원 관리 · 강사 칩 · 활성 없음 펼침");
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /이두리/);
});

test("이름 · 연락처 검색과 함께 걸린다 — 칩도 검색 결과로 센다", async () => {
  const html = await markupOf("회원 관리 · 강사 칩 · 검색");
  assert.deepEqual(labels(html), ["전체 1", "강사가 1", "강사나 1"]);
  assert.match(html, /박셋/);
  assert.doesNotMatch(html, /최넷/);
});

test("회원권을 못 읽으면 묶지 않고 목록은 그대로, 코드와 함께 말한다", async () => {
  const html = await markupOf("회원 관리 · 강사 칩 · 회원권 조회 실패");
  assert.doesNotMatch(html, /data-instructor-groups/);
  assert.match(html, /\(코드 permission-denied\)/);
  assert.match(html, /이두리/, "접지 않는다");
});

test("강사에게는 회원 관리가 메뉴에 없다", async () => {
  const instructor = await markupOf("더보기 탭 · 묶음 펼침 · 강사");
  assert.doesNotMatch(instructor, /회원 등록 · 검색/);
  for (const name of ["더보기 탭 · 묶음 펼침 · 매니저", "더보기 탭 · 묶음 펼침 · 총괄매니저"]) {
    assert.match(await markupOf(name), /회원 등록 · 검색/, name);
  }
});

test("담당을 바꾼 직후 회원 관리가 다시 읽힌다 — 배선", async () => {
  /* 담당 변경 → setRosterRevision → 더보기 탭 dataRevision → 회원 관리 refreshKey →
     reload. 한 고리라도 빠지면 방금 넘긴 회원이 옛 강사 칩에 남는다. 순수한 다시
     세기는 tests/members/instructor-groups.test.js 가 본다. */
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const handover = source.slice(source.indexOf("await transferPassInstructor(organizationContext.organizationId"));
  assert.match(handover.slice(0, 1200), /setRosterRevision\(\(value\) => value \+ 1\)/);
  assert.match(source, /<ReferenceSettingsTab .*dataRevision=\{rosterRevision\}/);
  assert.match(source, /<ClientDirectory[\s\S]{0,400}refreshKey=\{dataRevision\}/);
  assert.match(source, /useEffect\(\(\) => \{ if \(!locked\) reload\(\); else setLoading\(false\); \}, \[locked, reload, refreshKey\]\);/);
});
