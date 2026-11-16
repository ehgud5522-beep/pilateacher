/**
 * 회원 상세 정리 (2026-11-16 대표: "체형변화 빼주고 더 깔끔하게 보일 수 있고 정리되게").
 *  - 체형 변화 카드는 지우지 않고 MEMBER_DETAIL_BODY_CARD 하나로 끈다 (360° 바디뷰와 같은 방식)
 *  - 맨 위 상태는 한 줄 이어 쓰기가 아니라 잔여 · 다음 예약 · 만료 세 칸
 *  - 이용권 카드 안의 상자 속 상자 · 센터 회원권에 맞지 않는 설명 · 빈 이력 칸을 걷는다
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const detail = source.slice(source.indexOf("function ReferenceMemberDetail("), source.indexOf("\nfunction ChangeSummary("));

test("체형 변화 카드는 플래그 하나로 꺼져 있다 -- 코드는 남는다", () => {
  assert.match(source, /const MEMBER_DETAIL_BODY_CARD = false;/);
  assert.match(detail, /\{MEMBER_DETAIL_BODY_CARD && <section data-member-management-card="posture"/);
  assert.match(detail, /\{MEMBER_DETAIL_BODY_CARD && detailStatus\.risk !== "normal" && bodyPhotoSurface\.latest/, "상태 칸의 체형사진 줄도 같이");
});

test("상태는 세 칸 · 이용권 카드는 상자 하나 · 센터 회원권에는 회당 금액 설명이 없다", () => {
  assert.match(detail, /\["잔여", `\$\{detailStatus\.remaining\}회`, true\]/);
  assert.match(detail, /\["다음 예약",/);
  assert.match(detail, /\["만료",/);
  assert.match(detail, /<section data-member-section="membership" style=\{\{ padding: "2px 2px 4px" \}\}>/);
  assert.match(detail, /\{!passCards && <p className="mt-2"[^>]*>회원 회당 금액은/);
  assert.match(detail, /\(!organizationMode \|\| \(member\.payments \|\| \[\]\)\.length > 0/, "센터 소속이면 빈 이력 칸을 세우지 않는다");
});

test("실제로 그려 보면 체형 변화가 없다 (강사 · 대표)", async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
    ssr: { noExternal: ["@capgo/camera-preview"] }, logLevel: "silent",
  });
  try {
    const { createAppScreenSmokeCases } = await vite.ssrLoadModule("/src/App.jsx");
    const byName = new Map(createAppScreenSmokeCases().map((item) => [item.name, item.element]));
    for (const name of ["회원 상세 · 강사", "회원 상세 · 대표"]) {
      const html = renderToStaticMarkup(byName.get(name));
      assert.doesNotMatch(html, /체형 변화|첫 사진 촬영|비교 카드 만들어 보내기|최근 체형사진/, name);
      assert.match(html, /data-member-section="status"/, name);
      assert.match(html, /다음 수업 준비/, name);
      assert.match(html, /수업 기록/, name);
      assert.match(html, /이용권·결제/, name);
      assert.match(html, /기본정보·상담메모/, name);
    }
  } finally {
    await vite.close();
  }
});
