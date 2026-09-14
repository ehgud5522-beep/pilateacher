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
    "일정 탭 · 하루 11건 혼합",
    "회원 목록",
    "회원 상세",
    "체형분석 목록",
    "체형분석 상세 빈 이력",
    "변화 기록 상세 저장 이력",
    "더보기 탭",
    "더보기 탭 · 강사",
    "더보기 탭 · 개인 모드",
    "더보기 탭 · 소속 확인 실패",
    "회원권 상품",
    "회원권 상품 · 소속 확인 실패",
  ]);
  for (const item of cases) {
    await t.test(item.name, () => {
      let markup = "";
      assert.doesNotThrow(() => { markup = renderToStaticMarkup(item.element); }, ReferenceError);
      assert.ok(markup.length > 0, `${item.name} rendered empty markup`);
    });
  }
});

test("the product catalog is reachable only where it should be", async (t) => {
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
  const byName = new Map(createAppScreenSmokeCases().map((item) => [item.name, item.element]));
  const markupOf = (name) => renderToStaticMarkup(byName.get(name));

  // 대표는 들어갈 수 있다.
  assert.match(markupOf("더보기 탭"), /회원권 상품/);

  // 강사와 개인 모드 사용자에게는 진입점 자체가 없다. 항목이 없으면
  // setView 로 들어갈 길도 함께 닫힌다.
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /회원권 상품/);
  assert.doesNotMatch(markupOf("더보기 탭 · 개인 모드"), /회원권 상품/);

  // 소속을 읽지 못한 상태는 역할도 모르는 상태라, 항목을 남기면 강사에게도
  // 대표 전용 메뉴가 드러난다. 항목은 숨기고 배너 한 자리에서만 말한다.
  const unknown = markupOf("더보기 탭 · 소속 확인 실패");
  assert.doesNotMatch(unknown, /회원권 상품/);
  assert.match(unknown, /소속 정보를 불러오지 못했습니다/);
  assert.match(unknown, /다시 시도/);

  // 재시도가 성공해 대표로 확정되면 같은 화면에 항목이 돌아오고 배너는 사라진다.
  const recovered = markupOf("더보기 탭");
  assert.match(recovered, /회원권 상품/);
  assert.doesNotMatch(recovered, /소속 정보를 불러오지 못했습니다/);

  // 배너는 역할과 무관하다 -- 강사도 같은 안내를 받는다.
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /소속 정보를 불러오지 못했습니다/);
  const locked = markupOf("회원권 상품 · 소속 확인 실패");
  assert.match(locked, /소속을 확인하지 못했습니다/);
  assert.match(locked, /다시 시도/);
  assert.doesNotMatch(locked, /추가/, "잠긴 상태에서는 추가 버튼이 없어야 한다");
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
  assert.match(source, /"recentCard", "surface"/);
  assert.match(guard, /surface === "변화 기록" \? \{ message:/);
  assert.doesNotMatch(guard, /deviceLog\([^)]*msg/);
});

/* deviceLog 는 화이트리스트에 없는 필드를 조용히 버린다. 소속 조회가 실패해도
   errorDomain·errorCode 가 버려지면 어느 계층의 무슨 코드였는지 알 수 없다 --
   원본 코드를 잃는 것은 CLAUDE.md §2 가 금지한 그것이다. 진단이 내보내는
   필드와 화이트리스트가 어긋나면 여기서 실패한다. */
test("every field the organization lookup emits survives deviceLog", async (t) => {
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
  const { ORGANIZATION_CONTEXT_LOG_FIELDS, isDeviceLogField } = await vite.ssrLoadModule("/src/App.jsx");
  const dropped = ORGANIZATION_CONTEXT_LOG_FIELDS.filter((field) => !isDeviceLogField(field));
  assert.deepEqual(dropped, [], `deviceLog 가 버리는 필드: ${dropped.join(", ")}`);

  // 개인정보는 반대로 절대 통과하면 안 된다 (§7).
  for (const forbidden of ["userId", "email", "name", "token", "identityToken"]) {
    assert.equal(isDeviceLogField(forbidden), false, `${forbidden} 는 진단에 남으면 안 된다`);
  }

  // uid 지문은 값이 아니라 모양이므로 통과해야 한다.
  for (const allowed of ["uidLength", "uidPrefix", "uidSuffix"]) {
    assert.equal(isDeviceLogField(allowed), true, `${allowed} 가 버려지면 세션 uid 를 확정할 수 없다`);
  }
});
