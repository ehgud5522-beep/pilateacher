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
    "더보기 탭 · 월간 리포트",
    "더보기 탭 · 월간 리포트 · 개인 모드",
    "센터 회원 상세",
    "센터 회원 상세 · 일부 이력 실패",
    "센터 회원 상세 · 조회 실패",
    "센터 회원 상세 · 회원권 없음",
    "이달 예상 급여",
    "이달 예상 급여 · 빈 달",
    "이달 예상 급여 · 조회 실패",
    "예상 급여 카드",
    "예상 급여 카드 · 조회 실패",
    "출석 체크",
    "출석 체크 · 확인",
    "출석 체크 · 회원권 없음",
    "출석 체크 · 조회 실패",
    "회원 목록 · 강사",
    "회원 목록 · 강사 · 비어 있음",
    "회원권 발급",
    "회원권 발급 · 기준값과 다름",
    "회원권 발급 · 직접 단가",
    "회원권 발급 · 풀방금액 없음",
    "회원권 발급 · 확인",
    "회원권 발급 · 조회 실패",
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

/* 회원권 발급. 누른 뒤에 고칠 수 있는 것이 거의 없는 화면이라, 무엇이 저장될지가
   누르기 전에 보여야 한다. 단가 해석은 pay-rates 의 UNIT_PRICE_SOURCE 를 따른다. */
const issueScreens = async (t) => {
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
  return (name) => renderToStaticMarkup(byName.get(name));
};

test("the issue form asks only what the price source needs", async (t) => {
  const markupOf = await issueScreens(t);

  /* 표에서 단가가 오는 상품은 급여 단가를 묻지 않는다. 물으면 사람이 표와
     다른 값을 넣을 수 있고, 그것이 그대로 원장에 박힌다. */
  const fromTable = markupOf("회원권 발급 · 기준값과 다름");
  assert.doesNotMatch(fromTable, /급여 단가/);

  // 표 밖의 상품만 금액 칸을 띄운다.
  const manual = markupOf("회원권 발급 · 직접 단가");
  assert.match(manual, /급여 단가 \(만원\)/);
  assert.match(manual, /표에 단가가 없어 직접 넣습니다/);
});

test("changing a default leaves the default in sight", async (t) => {
  const markupOf = await issueScreens(t);
  const changed = markupOf("회원권 발급 · 기준값과 다름");
  // 20회 130만 상품을 22회 140만으로 고친 화면.
  assert.match(changed, /기준 20회/);
  assert.match(changed, /기준 130만/);

  // 기준값 그대로면 군더더기를 붙이지 않는다.
  const untouched = markupOf("회원권 발급 · 확인");
  assert.doesNotMatch(untouched, /기준 20회/);
});

test("a missing full-room rate is refused on the screen, before the rules", async (t) => {
  const markupOf = await issueScreens(t);
  const blocked = markupOf("회원권 발급 · 풀방금액 없음");
  /* 규칙도 막지만 permission-denied 한 줄로는 무엇을 해야 하는지 알 수 없다.
     화면이 누구의 무엇이 없는지, 어디서 고치는지 말한다. */
  assert.match(blocked, /박서연님의 풀방금액이 설정되지 않았습니다/);
  assert.match(blocked, /더보기 → 강사 단가/);

  // 표에서 오는 상품은 같은 강사여도 막히지 않는다.
  assert.doesNotMatch(markupOf("회원권 발급 · 기준값과 다름"), /풀방금액이 설정되지 않았습니다/);
});

test("the confirmation says exactly what will be written", async (t) => {
  const markupOf = await issueScreens(t);
  const confirm = markupOf("회원권 발급 · 확인");
  assert.match(confirm, /이대로 발급할까요\?/);
  assert.match(confirm, /발급한 뒤에는 대표만 취소할 수 있습니다/);

  assert.match(confirm, /김하나님 \/ 반송점/);
  assert.match(confirm, /1:1 · 1:1 20회 가을 이벤트 · 1:1 재등록\(이벤트\)/);
  // 서비스 회차도 차감되는 수업이라 총 회차에 들어간다.
  assert.match(confirm, /20회 \+ 서비스 2회 = 총 22회/);
  assert.match(confirm, /130만원 · 카드 · 2차/);
  assert.match(confirm, /담당 정예진/);
});

test("the issue screen is reachable for owners and managers only", async (t) => {
  const markupOf = await issueScreens(t);
  assert.match(markupOf("더보기 탭"), /회원권 발급/);
  assert.match(markupOf("더보기 탭 · 매니저"), /회원권 발급/);
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /회원권 발급/);
  assert.doesNotMatch(markupOf("더보기 탭 · 개인 모드"), /회원권 발급/);
  assert.doesNotMatch(markupOf("더보기 탭 · 소속 확인 실패"), /회원권 발급/);
});

test("a failed read closes the form instead of showing empty pickers", async (t) => {
  const markupOf = await issueScreens(t);
  const failed = markupOf("회원권 발급 · 조회 실패");
  /* 고를 수 없는 칸을 앞에 두면 사용자가 이유를 찾게 된다. 못 읽었다고 말하고
     추적 가능한 코드를 남긴다. */
  assert.match(failed, /발급에 필요한 정보를 불러오지 못했습니다/);
  assert.match(failed, /permission-denied/);
  assert.doesNotMatch(failed, /담당 강사/);
});

/* 출석 체크. 차감은 되돌릴 수 없으므로 무엇이 줄어드는지가 누르기 전에
   보여야 하고, 줄일 수 없는 회원권은 누를 수 없어야 한다. */
test("attendance shows what is left and what cannot be spent", async (t) => {
  const markupOf = await issueScreens(t);
  const list = markupOf("출석 체크");

  assert.match(list, /수업한 회원의 회원권에서 1회를 뺍니다/);
  assert.match(list, /잔여 8회/);
  assert.match(list, /1:1 재등록\(이벤트\)/);

  // 잔여 0 은 왜 못 누르는지 말한다.
  assert.match(list, /잔여 0회 — 차감할 수 없습니다/);
  assert.match(list, /disabled/);

  // 7일 창 안의 날짜만 고를 수 있다. 규칙이 그 밖을 막으므로 화면도 같은 범위다.
  assert.match(list, /오늘/);
  assert.match(list, /어제/);
  assert.equal((list.match(/<button[^>]*>(오늘|어제|\d+\.\d+)<\/button>/g) || []).length, 7);
});

test("attendance asks once before spending a session", async (t) => {
  const markupOf = await issueScreens(t);
  const confirm = markupOf("출석 체크 · 확인");
  assert.match(confirm, /1회 차감할까요\?/);
  assert.match(confirm, /차감은 되돌릴 수 없습니다/);
  // 무엇이 어떻게 줄어드는지 숫자로 보여준다.
  assert.match(confirm, /잔여 8회 → 7회/);
  assert.match(confirm, /2026-09-17 19:00 수업/);
});

test("no pass and a failed read are different screens", async (t) => {
  const markupOf = await issueScreens(t);
  const none = markupOf("출석 체크 · 회원권 없음");
  assert.match(none, /발급된 회원권이 없습니다/);
  assert.doesNotMatch(none, /불러오지 못했습니다/);

  const failed = markupOf("출석 체크 · 조회 실패");
  assert.match(failed, /회원권을 불러오지 못했습니다/);
  assert.match(failed, /permission-denied/);
  assert.doesNotMatch(failed, /발급된 회원권이 없습니다/);
});

test("an instructor is not offered a way to register a member", async (t) => {
  /* 소속 센터에서 회원 등록은 FC매니저와 대표의 일이다. 강사가 같은 사람을
     다시 등록하면 같은 회원이 둘이 되고 수업 기록이 갈라진다. */
  const markupOf = await issueScreens(t);
  const forInstructor = markupOf("회원 목록 · 강사");
  assert.doesNotMatch(forInstructor, /추가<\/button>/);
  assert.doesNotMatch(forInstructor, /회원 등록<\/button>/);

  // 목록이 비어 있을 때도 "등록하세요"가 아니라 어디서 등록되는지를 말한다.
  const emptyForInstructor = markupOf("회원 목록 · 강사 · 비어 있음");
  assert.match(emptyForInstructor, /회원 등록은 센터에서 합니다/);
  assert.doesNotMatch(emptyForInstructor, /회원 등록<\/button>/);

  // 개인 강사(legacy)는 자기 회원을 자기가 등록하므로 그대로 둔다.
  assert.match(markupOf("회원 목록"), /추가<\/button>/);
});

/* 강사 예상 급여. 강사가 앱을 여는 이유가 이 숫자이므로 일정 탭 맨 위에 있고,
   동시에 최종 급여가 아니라는 것이 같은 화면에 있어야 한다. */
test("the pay screen says what it counted and what it did not", async (t) => {
  const markupOf = await issueScreens(t);
  const detail = markupOf("이달 예상 급여");

  assert.match(detail, /2026년 9월/);
  assert.match(detail, /₩105,000/);
  assert.match(detail, /예상 급여/);

  /* 이 문구가 없으면 강사가 이 숫자를 받을 돈으로 읽고, 매달 정산 때 어긋난다. */
  assert.match(detail, /수업료만 자동으로 계산됩니다\. 인센티브와 노쇼는 별도로 정산됩니다\./);

  // 카테고리별 건수와 금액.
  assert.match(detail, /1:1 재등록\(정상\)/);
  assert.match(detail, /1건/);
  assert.match(detail, /₩45,000/);
  assert.match(detail, /1:1 재등록\(이벤트\)/);
  assert.match(detail, /2건/);
  assert.match(detail, /₩60,000/);
});

test("the recent list names the member, the day and the amount", async (t) => {
  const markupOf = await issueScreens(t);
  const detail = markupOf("이달 예상 급여");
  assert.match(detail, /최근 차감/);
  // 원장은 회원권만 가리키므로 회원권 → 회원으로 이어 붙인다.
  assert.match(detail, /김하나/);
  assert.match(detail, /9\.16/);
  assert.match(detail, /9\.4/);
  // 한 건의 금액은 그 항목에 박힌 단가다.
  assert.match(detail, /₩30,000/);
});

test("an empty month is not an error", async (t) => {
  const markupOf = await issueScreens(t);
  const empty = markupOf("이달 예상 급여 · 빈 달");
  assert.match(empty, /₩0/);
  assert.match(empty, /이번 달 차감된 수업이 없습니다/);
  assert.doesNotMatch(empty, /불러오지 못했습니다/);
  // 범위 안내는 0원일 때도 있어야 한다.
  assert.match(empty, /수업료만 자동으로 계산됩니다/);
});

test("a failed read never shows itself as zero won", async (t) => {
  /* 강사가 0원을 보고 "이번 달 수업이 없었나" 하고 넘어가면 그 달 정산에서야
     어긋난 것을 알게 된다. 인덱스가 아직 빌드 중이면 failed-precondition 이
     돌아오는데, 그것도 이 자리에 코드로 보인다. */
  const markupOf = await issueScreens(t);
  const failed = markupOf("이달 예상 급여 · 조회 실패");
  assert.match(failed, /급여를 불러오지 못했습니다/);
  assert.match(failed, /failed-precondition/);
  assert.match(failed, /다시 시도/);
  assert.doesNotMatch(failed, /이번 달 차감된 수업이 없습니다/);

  const card = markupOf("예상 급여 카드 · 조회 실패");
  assert.match(card, /불러오지 못했습니다/);
  assert.match(card, /failed-precondition/);
  assert.doesNotMatch(card, /₩0/);
});

test("the card shows the month total and nothing else", async (t) => {
  const markupOf = await issueScreens(t);
  const card = markupOf("예상 급여 카드");
  assert.match(card, /이달 예상 급여/);
  assert.match(card, /₩105,000/);
  // 카드는 총액만 말한다. 자세한 것은 눌러서 본다.
  assert.doesNotMatch(card, /최근 차감/);
});

test("the legacy monthly report says it counts something else in a centre", async (t) => {
  /* 같은 "예상 급여"라는 말이 두 곳에서 다른 뜻이면 강사가 어느 쪽을 믿어야
     할지 알 수 없다. 소속 모드에서는 이 화면이 무엇을 세는지 밝힌다. */
  const markupOf = await issueScreens(t);
  const inOrganization = markupOf("더보기 탭 · 월간 리포트");
  assert.match(inOrganization, /기기에 저장된 일정과 회원별 단가로 계산합니다/);
  assert.match(inOrganization, /일정 탭의 예상 급여/);

  // 미소속 개인 강사에게는 지금 문구 그대로다.
  const personal = markupOf("더보기 탭 · 월간 리포트 · 개인 모드");
  assert.match(personal, /완료·차감 처리된 수업과 센터\/회원별 단가를 기준으로 계산합니다/);
  assert.doesNotMatch(personal, /일정 탭의 예상 급여/);
});

/* 센터 회원 상세. 분쟁이 생겼을 때 여는 화면이라 "몇 회 남았나"와 "언제 무엇이
   일어났나"가 같은 곳에서 답해져야 한다. */
test("the member detail counts only sessions that can still be used", async (t) => {
  const markupOf = await issueScreens(t);
  const detail = markupOf("센터 회원 상세");

  assert.match(detail, /김하나/);
  assert.match(detail, /···5678/, "연락처는 뒷자리만");
  assert.match(detail, /반송점/);

  // 만료된 회원권(2026.7.1)의 3회는 합계에서 빠지고, 살아 있는 8회만 남는다.
  assert.match(detail, /회 남음/);
  assert.match(detail, />8</);
  assert.doesNotMatch(detail, />11</, "만료된 회차를 더하면 안 된다");
});

test("an expired pass is still listed, only marked", async (t) => {
  /* 목록에서 사라지면 회원이 "내가 산 게 어디 갔냐"고 묻게 된다. */
  const markupOf = await issueScreens(t);
  const detail = markupOf("센터 회원 상세");
  assert.match(detail, /2026\.7\.1 만료 \(지남\)/);
  assert.match(detail, /2027\.2\.1 만료/);
  // 발급 정보가 한 줄로 읽힌다.
  assert.match(detail, /20회 \+ 서비스 2회/);
  assert.match(detail, /130만원/);
  assert.match(detail, /2차/);
  assert.match(detail, /카드/);
});

test("the history reads issue, deduct and transfer differently", async (t) => {
  const markupOf = await issueScreens(t);
  const detail = markupOf("센터 회원 상세");

  // 교체는 숫자가 움직이지 않으므로 문장으로 읽혀야 건너뛰지 않는다.
  assert.match(detail, /담당 강사 변경 정예진 → 박서연/);
  assert.match(detail, /±0/);

  // 발급과 차감은 부호가 보인다.
  assert.match(detail, /\+22/);
  assert.match(detail, /-1/);

  // 수업일과 기록일이 다르면 기록일을 병기한다 -- 밤에 몰아 누른 건이다.
  assert.match(detail, /기록 9\.13 23:40/);
});

test("the history is newest first", async (t) => {
  const markupOf = await issueScreens(t);
  /* 카테고리 문구는 위쪽 회원권 목록에도 나오므로 이력 구간만 잘라서 본다. */
  const detail = markupOf("센터 회원 상세");
  const history = detail.slice(detail.lastIndexOf("이력"));
  const transferAt = history.search(/담당 강사 변경/);
  const deductAt = history.search(/기록 9\.13 23:40/);
  const issueAt = history.search(/\+22/);
  assert.ok(transferAt >= 0 && deductAt >= 0 && issueAt >= 0, "세 항목이 모두 있어야 한다");
  assert.ok(transferAt < deductAt, "9.16 교체가 9.12 차감보다 위에 있어야 한다");
  assert.ok(deductAt < issueAt, "9.12 차감이 8.1 발급보다 위에 있어야 한다");
});

test("a partly unreadable history says the total may be short", async (t) => {
  /* 합계가 실제보다 적을 수 있다는 사실이 분쟁 중에 드러나야 한다. */
  const markupOf = await issueScreens(t);
  const partial = markupOf("센터 회원 상세 · 일부 이력 실패");
  assert.match(partial, /회원권 1건의 이력을 읽지 못했습니다/);
  assert.match(partial, /아래 목록이 전부가 아닐 수 있습니다/);
});

test("a failed read is not an empty client", async (t) => {
  const markupOf = await issueScreens(t);
  const failed = markupOf("센터 회원 상세 · 조회 실패");
  assert.match(failed, /회원권을 불러오지 못했습니다/);
  assert.match(failed, /permission-denied/);
  assert.match(failed, /다시 시도/);
  assert.doesNotMatch(failed, /발급된 회원권이 없습니다/);

  const none = markupOf("센터 회원 상세 · 회원권 없음");
  assert.match(none, /발급된 회원권이 없습니다/);
  assert.match(none, /아직 기록이 없습니다/);
  assert.doesNotMatch(none, /불러오지 못했습니다/);
});

test("the issue form asks for the expiry from the contract", async (t) => {
  const markupOf = await issueScreens(t);
  const add = markupOf("회원권 발급 · 기준값과 다름");
  assert.match(add, /만료일/);
  assert.match(add, /계약서에 적힌 날짜입니다/);
  assert.match(add, /type="date"/);
});
