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
    "강사 단가",
    "강사 단가 · 단가 입력",
    "강사 단가 · 조회 실패",
    "강사 단가 · 강사 없음",
    "회원 관리",
    "회원 관리 · 검색 결과 없음",
    "회원 관리 · 등록",
    "회원 관리 · 동명이인 확인",
    "회원 관리 · 지점 조회 실패",
    "회원 관리 · 지점 없음",
    "회원 관리 · 소속 확인 실패",
    "더보기 탭 · 매니저",
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

  // 리포지토리 조회 실패가 내보내는 필드(repository-read.js). 하나라도 버려지면
  // "무엇이 어디서 어떤 코드로 실패했는지"가 끊긴다.
  for (const allowed of ["feature", "stage", "path", "errorDomain", "errorCode", "message"]) {
    assert.equal(isDeviceLogField(allowed), true, `${allowed} 가 버려지면 조회 실패를 추적할 수 없다`);
  }
});

test("the member directory shows who is there and who is not", async (t) => {
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

  const list = markupOf("회원 관리");
  assert.match(list, /김하나/);
  assert.match(list, /이두리/);
  assert.match(list, /반송점/, "지점 이름이 붙어야 한다");

  // 연락처는 뒷 4자리만. 전체 번호가 목록에 늘어서면 곁에서 보는 누구에게나
  // 그대로 읽힌다.
  assert.match(list, /5678/);
  assert.doesNotMatch(list, /01012345678/, "전체 번호가 목록에 드러나면 안 된다");
  assert.doesNotMatch(list, /01099998888/);

  // 상태는 저장값이 아니라 문구로 나온다.
  assert.match(list, /종료/);
  assert.doesNotMatch(list, /ended/);

  // 검색이 빗나가는 것과 아무도 없는 것은 다른 화면이다.
  const empty = markupOf("회원 관리 · 검색 결과 없음");
  assert.match(empty, /검색 결과가 없습니다/);
  assert.doesNotMatch(empty, /등록된 회원이 없습니다/);
  assert.doesNotMatch(empty, /김하나/);
});

test("registration asks for three things and warns about a namesake", async (t) => {
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

  const add = markupOf("회원 관리 · 등록");
  for (const label of ["이름", "연락처", "지점"]) assert.match(add, new RegExp(label));
  assert.match(add, /반송점/, "지점은 고를 수 있어야 한다");
  assert.match(add, /센텀점/, "매니저도 대표처럼 지점을 고른다");
  /* 생년월일·주소는 받지 않는다 -- 종이 계약서에 있고, 서버에 둘수록 관리
     부담만 는다. 문구로 확인하면 안내문에 걸려 통과해 버리므로, 입력칸 수를
     센다. 이름과 연락처 둘뿐이고 지점은 버튼이다. */
  assert.equal((add.match(/<input/g) || []).length, 2, "등록 화면의 입력칸은 이름·연락처 둘뿐이다");

  const duplicate = markupOf("회원 관리 · 동명이인 확인");
  assert.match(duplicate, /김하나님이 이미 있습니다/);
  assert.match(duplicate, /연락처 뒷자리/);
  assert.match(duplicate, /5678/);
  assert.match(duplicate, /6666/, "같은 이름이 여럿이면 모두 보여준다");
  // 막지 않는다 -- 거부하면 사람이 이름 뒤에 1, 2 를 붙이기 시작한다.
  assert.match(duplicate, /그래도 등록/);
});

test("the member directory is reachable only where it should be", async (t) => {
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

  // 대표와 매니저는 들어갈 수 있다.
  assert.match(markupOf("더보기 탭"), /회원 관리/);
  assert.match(markupOf("더보기 탭 · 매니저"), /회원 관리/);

  // 강사에게는 진입점 자체가 없다. 항목이 없으면 setView 로 들어갈 길도 닫힌다.
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /회원 관리/);
  assert.doesNotMatch(markupOf("더보기 탭 · 개인 모드"), /회원 관리/);
  assert.doesNotMatch(markupOf("더보기 탭 · 소속 확인 실패"), /회원 관리/);

  // 매니저는 회원 관리만 본다. 상품은 대표 전용이다.
  assert.doesNotMatch(markupOf("더보기 탭 · 매니저"), /회원권 상품/);

  // 소속을 읽지 못하면 목록을 그리지 않고 잠근다 -- 잘못된 센터에 회원이
  // 쌓이는 것이 못 보는 것보다 나쁘다.
  const locked = markupOf("회원 관리 · 소속 확인 실패");
  assert.match(locked, /소속을 확인하지 못했습니다/);
  assert.match(locked, /다시 시도/);
  assert.doesNotMatch(locked, /등록/, "잠긴 상태에서는 등록 버튼이 없어야 한다");
});

/* 조회 실패와 빈 결과가 같은 화면이면, 사용자는 무엇을 해야 할지 알 수 없고
   우리는 원인을 찾을 수 없다. memberships 도 locations 도 그래서 하루씩 걸렸다. */
test("a failed location read does not look like an empty one", async (t) => {
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

  const failed = markupOf("회원 관리 · 지점 조회 실패");
  assert.match(failed, /지점을 불러오지 못했습니다/);
  assert.match(failed, /permission-denied/, "추적 가능한 코드가 화면에 있어야 한다");
  assert.doesNotMatch(failed, /등록된 지점이 없습니다/);

  const empty = markupOf("회원 관리 · 지점 없음");
  assert.match(empty, /등록된 지점이 없습니다/);
  assert.doesNotMatch(empty, /불러오지 못했습니다/);
  assert.doesNotMatch(empty, /코드/, "없는 것은 오류가 아니므로 코드가 붙지 않는다");
});

/* 강사 단가. 대표만 보고, 대표만 바꾼다 -- 규칙도 같은 경계를 지킨다.
   풀방금액은 1:1 재등록(정상) 한 카테고리의 단가이므로, 화면이 "모든 단가"처럼
   보이면 안 된다. */
test("the instructor rate screen says what it changes and what it does not", async (t) => {
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

  const list = markupOf("강사 단가");
  // 지난달 급여가 움직이지 않는다는 약속이 화면에 있어야 한다.
  assert.match(list, /이후 발급분부터 적용됩니다/);
  assert.match(list, /이미 기록된 수업의 급여는 바뀌지 않습니다/);

  assert.match(list, /정예진/);
  assert.match(list, /4\.5만원/, "저장은 원 단위, 표시는 만원 단위다");

  // 미설정과 0 은 둘 다 발급을 막는 상태다. 그것이 목록에서 보여야 한다.
  assert.match(list, /박서연/);
  assert.equal((list.match(/풀방금액 미설정/g) || []).length, 2, "이름 없는 강사(0원)와 미설정 강사 둘 다");
  assert.match(list, /1:1 재등록\(정상\) 발급 불가/);

  // 이름이 아직 없는 강사는 uid 로 보인다 -- 안 보이는 것보다 낫다.
  assert.match(list, /u3/);

  const editing = markupOf("강사 단가 · 단가 입력");
  assert.match(editing, /정예진 풀방금액/);
  assert.match(editing, /다른 카테고리는 이 금액과 무관합니다/);
  assert.match(editing, /value="4\.5"/);
});

test("a failed instructor read does not look like an empty centre", async (t) => {
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

  const failed = markupOf("강사 단가 · 조회 실패");
  assert.match(failed, /강사 목록을 불러오지 못했습니다/);
  assert.match(failed, /permission-denied/, "추적 가능한 코드가 화면에 있어야 한다");
  assert.doesNotMatch(failed, /등록된 강사가 없습니다/);

  const empty = markupOf("강사 단가 · 강사 없음");
  assert.match(empty, /등록된 강사가 없습니다/);
  assert.doesNotMatch(empty, /불러오지 못했습니다/);
  assert.doesNotMatch(empty, /코드/, "없는 것은 오류가 아니므로 코드가 붙지 않는다");
});

test("only the owner reaches the instructor rate screen", async (t) => {
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

  assert.match(markupOf("더보기 탭"), /강사 단가/);
  /* 매니저는 회원 관리는 보지만 강사 단가는 못 본다. 규칙이 대표만 허용하므로
     보여 주면 눌러도 거부되는 화면만 나온다. */
  assert.doesNotMatch(markupOf("더보기 탭 · 매니저"), /강사 단가/);
  assert.match(markupOf("더보기 탭 · 매니저"), /회원 관리/);
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /강사 단가/);
  assert.doesNotMatch(markupOf("더보기 탭 · 개인 모드"), /강사 단가/);
  assert.doesNotMatch(markupOf("더보기 탭 · 소속 확인 실패"), /강사 단가/);
});
