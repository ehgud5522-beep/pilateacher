import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * 더보기 → 백업 카드 (2026-10-31, 백업 안전망).
 *
 * 크기 경고 · 한도 넘음이 **코드와 함께** 보이는지, 스냅샷 버튼이 "사진 원본은
 * 뺀다" 고 말하는지 실제로 그려서 본다.
 */
test("백업 카드 — 크기 경고 · 한도 넘음 · 스냅샷", async (t) => {
  const vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [react()],
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    ssr: { noExternal: ["@capgo/camera-preview"] },
    logLevel: "silent",
  });
  t.after(() => vite.close());

  const { createAppScreenSmokeCases } = await vite.ssrLoadModule("/src/App.jsx");
  const render = (name) => {
    const screen = createAppScreenSmokeCases().find((item) => item.name === name);
    assert.ok(screen, `화면이 없습니다: ${name}`);
    return renderToStaticMarkup(screen.element);
  };

  const normal = render("더보기 탭 · 백업");
  assert.ok(normal.includes("지금 스냅샷 남기기"));
  assert.ok(normal.includes("사진 원본은 빼고 사진 목록만"), "스냅샷이 무엇을 담는지 말한다");
  assert.equal(normal.includes("한도(1MB)"), false, "작은 백업에는 크기 문구가 없다");

  const warn = render("더보기 탭 · 백업 · 크기 경고");
  assert.ok(warn.includes("850.0 KB"));
  assert.ok(warn.includes("한도(1MB)에 가까워요"));

  const tooLarge = render("더보기 탭 · 백업 · 한도 넘음");
  assert.ok(tooLarge.includes("한도(1MB)를 넘어 올리지 못했어요"));
  assert.ok(tooLarge.includes("코드 backup/too-large"), "코드 없이 실패를 말하지 않는다");
  assert.ok(tooLarge.includes("기기의 기록은 그대로"), "잃은 것이 없다는 것도 말한다");
});
