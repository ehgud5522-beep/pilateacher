/**
 * 일정 등록 시트의 회원 칸 -- 이름 끝 글자가 잘리지 않는다 (2026-11-16 대표 제보).
 *
 * 안드로이드에서 새 수업을 등록하면 회원 이름 마지막 글자가 잘렸고, 다른 회원을 넣으면
 * 다시 다 보였다. 듀엣 두 칸이 폰에서도 나란히 서 있어서 한 칸에 이름이 들어갈 자리가
 * 360px 폰에서 90px 뿐이었고, 안드로이드 웹뷰는 기기 글자 크기 설정을 글자에 곱한다.
 * 130% 에서 넉 자 이름(약 73px)이 72px 칸을 넘어 마지막 글자가 "…" 로 바뀌었다.
 * 이름마다 폭이 달라서 회원에 따라 보였다 안 보였다 했다.
 *
 * 그래서 폰에서는 두 칸이 위아래로 서고(태블릿부터 나란히), 아래는 그것을 실제로 그려서
 * 본다. 숫자 검사는 그 칸에 이름이 들어갈 자리를 폰 폭 · 글자 배율별로 다시 셈한다.
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

const slotsContainer = (html) => html.match(/<div data-member-slots="[^"]*" class="([^"]*)"/)?.[1] ?? null;
/* 2026-11-17 개편: 칸 안에 이름 아래 잔여 줄 · [바꾸기] 가 함께 선다. 이름 줄(data-member-slot-name)만 읽는다. */
const slotButtons = (html) => [...html.matchAll(/<button[^>]*data-member-slot="(\d)"[^>]*>([\s\S]*?)<\/button>/g)]
  .map((match) => ({ slot: Number(match[1]), text: (match[2].match(/data-member-slot-name[^>]*>([^<]*)</)?.[1] || "") }));

test("듀엣 -- 두 이름이 그대로 다 그려지고, 폰에서는 두 칸이 위아래로 선다", async () => {
  const html = await markupOf("일정 등록 · 듀엣 회원 고름");
  const slots = slotButtons(html);
  assert.deepEqual(slots.map((item) => item.text), ["남궁하나", "박서연"], "이름을 자르거나 줄이지 않는다");
  const grid = slotsContainer(html);
  assert.ok(grid, "회원 칸 묶음(data-member-slots)이 있다");
  const classes = grid.split(/\s+/);
  assert.ok(classes.includes("grid-cols-1"), "폰 폭에서는 한 줄에 한 칸");
  assert.ok(!classes.includes("grid-cols-2"), "폰 폭에서 두 칸을 나란히 두지 않는다 -- 이름 자리가 90px 로 줄어든다");
  assert.ok(classes.includes("sm:grid-cols-2"), "태블릿부터는 전처럼 나란히");
});

test("개인 -- 고른 회원 이름이 그대로 한 칸에", async () => {
  const html = await markupOf("일정 등록 · 회원 고름");
  assert.deepEqual(slotButtons(html).map((item) => item.text), ["박서연"]);
  assert.match(slotsContainer(html) || "", /(^|\s)grid-cols-1(\s|$)/);
});

/* 칸 하나에 이름이 들어갈 자리. 시트 좌우 여백 16px 씩, 버튼 안 여백 12px 씩 + 테두리 1px 씩,
   사람 아이콘 14px · 펼침 표시 13px · 사이 8px 두 번. 안쪽 여백은 rem 이라 글자 배율을 함께 탄다.
   한글 한 자는 글자 크기만큼(14px) 넓다. */
const nameRoom = ({ width, scale, columns }) => {
  const sheetPadding = 16 * 2 * scale;
  const gap = columns > 1 ? 8 * scale : 0;
  const cell = (width - sheetPadding - gap) / columns;
  return cell - (12 * 2 * scale + 2) - 14 - 13 - 8 * 2 * scale;
};
const nameWidth = (syllables, scale) => syllables * 14 * scale;

test("셈으로도 -- 나란히 두면 잘리던 폭이고, 위아래로 두면 넉 자 이름이 150% 에서도 들어간다", () => {
  /* 이전 배치가 실제로 잘렸다는 것을 셈이 재현해야 이 셈을 믿을 수 있다. */
  assert.ok(nameWidth(4, 1.3) > nameRoom({ width: 320, scale: 1.3, columns: 2 }), "이전: 320px · 130% 에서 넉 자가 넘친다");
  for (const width of [320, 360, 375, 412]) {
    for (const scale of [1, 1.3, 1.5]) {
      const room = nameRoom({ width, scale, columns: 1 });
      assert.ok(nameWidth(4, scale) <= room, `${width}px · ${scale * 100}% 에서 넉 자 이름이 들어가야 한다 (자리 ${room.toFixed(1)}px)`);
    }
  }
});

test("유형 칸 -- 두 줄이 되어도 칸이 늘어나고 색 점이 글자와 함께 선다", async () => {
  const html = await markupOf("일정 등록 · 회원 고름");
  const careButton = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*디오사 관리 30분(?:(?!<\/button>)[\s\S])*<\/button>/)?.[0] || "";
  assert.ok(careButton, "디오사 관리 30분 칸이 그려진다");
  assert.match(careButton, /class="[^"]*\bmin-h-11\b/, "높이를 고정하지 않는다 -- 두 줄이면 늘어난다");
  assert.doesNotMatch(careButton, /class="[^"]*(?<![-\w])h-11\b/, "h-11 로 고정하지 않는다");
  assert.match(careButton, /<span class="[^"]*text-center[^"]*"><span aria-hidden="true" class="[^"]*inline-block/, "색 점은 글자 줄 안에 있다");
});
