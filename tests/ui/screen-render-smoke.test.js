import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

test("all primary tabs and detail surfaces render without a ReferenceError", async (t) => {
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
  const cases = createAppScreenSmokeCases();
  assert.deepEqual(cases.map((item) => item.name), [
    "일정 탭",
    "회원 목록",
    "회원 상세",
    "체형분석 목록",
    "체형분석 상세 빈 이력",
    "더보기 탭",
  ]);
  for (const item of cases) {
    await t.test(item.name, () => {
      let markup = "";
      assert.doesNotThrow(() => { markup = renderToStaticMarkup(item.element); }, ReferenceError);
      assert.ok(markup.length > 0, `${item.name} rendered empty markup`);
    });
  }
});

test("ErrorBoundary hides diagnostics in production and records a privacy-safe diagnostic event", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const start = source.indexOf("class Guard extends Component");
  const end = source.indexOf("const inputCls", start);
  const guard = source.slice(start, end);
  assert.match(guard, /!import\.meta\.env\.PROD/);
  assert.match(guard, /일시적인 문제가 발생했어요/);
  assert.match(guard, /showInternalDetails && <button[\s\S]*오류 복사/);
  assert.match(guard, /deviceLog\("ui_render_failed"/);
  assert.doesNotMatch(guard, /deviceLog\([^)]*msg/);
});
