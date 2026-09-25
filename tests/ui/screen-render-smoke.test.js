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
    "일정 탭 · 소속 · 확정 전",
    "일정 탭 · 소속 · 예상 단가",
    "일정 탭 · 소속 · 예상 단가 · 서비스",
    "일정 탭 · 소속 · 확정됨",
    "일정 탭 · 소속 · 일부만 차감",
    "일정 탭 · 소속 · 차감할 회차 없음",
    "일정 탭 · 소속 · 차감 전원 실패",
    "일정 탭 · 소속 · 시작 전",
    "일정 탭 · 소속 · 시작 전 · 실패 기록",
    "일정 탭 · 소속 · 회원에게 보낼 말",
    "일정 탭 · 소속 · 회원에게 보낼 말 · 확정됨",
    "일정 탭 · 소속 · 확정됨 · 대표",
    "일정 탭 · 개인 모드 · 확정 없음",
    "회원 목록",
    "회원 상세",
    "회원 상세 · 소속",
    "회원 상세 · 강사",
    "회원 상세 · 대표",
    "회원 목록 · 강사",
    "회원 목록 · 대표",
    "회원 상세 · 여정",
    "체형분석 목록",
    "체형분석 상세 빈 이력",
    "변화 기록 상세 저장 이력",
    "더보기 탭",
    "더보기 탭 · 강사",
    "더보기 탭 · 개인 모드",
    "더보기 탭 · 소속 확인 실패",
    "더보기 탭 · 월간 리포트",
    "더보기 탭 · 월간 리포트 · 개인 모드",
    "더보기 탭 · 센터 정보",
    "더보기 탭 · 센터 정보 · 개인 모드",
    "센터 회원 상세",
    "센터 회원 상세 · 대표",
    "센터 회원 상세 · 차감 보정 확인",
    "센터 회원 상세 · 발급 취소 확인",
    "센터 회원 상세 · 연락처 수정",
    "센터 회원 상세 · 강사 · 연락처 수정",
    "센터 회원 상세 · 양도",
    "센터 회원 상세 · 양도 · 동명이인",
    "센터 회원 상세 · 양도 · 듀엣 차단",
    "센터 회원 상세 · 듀엣",
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
    "회원 목록 · 소속 강사",
    "회원 목록 · 소속 강사 · 전체",
    "회원 목록 · 소속 강사 · 명부 조회 실패",
    "회원 목록 · 강사 · 비어 있음",
    "회원권 발급",
    "회원권 발급 · 듀엣 꺼짐",
    "회원권 발급 · 듀엣",
    "회원권 발급 · 듀엣 · 상대 없음",
    "회원권 발급 · 듀엣 · 확인",
    "회원권 발급 · 듀엣 · 카테고리 어긋남",
    "회원권 발급 · 2:1 인데 듀엣 아님",
    "회원권 발급 · 듀엣 · 이미 회원권 있음",
    "회원권 발급 · 기준값과 다름",
    "회원권 발급 · 직접 단가",
    "회원권 발급 · 상품 단가",
    "회원권 발급 · 상품 단가 · 확인",
    "회원권 발급 · 풀방금액 없음",
    "회원권 발급 · 확인",
    "회원권 발급 · 확인 · 현금",
    "회원권 발급 · 조회 실패",
    "강사 관리",
    "강사 관리 · 수정",
    "강사 관리 · 부원장 지정",
    "강사 관리 · 본인",
    "강사 관리 · 퇴사자",
    "강사 관리 · 추가",
    "강사 관리 · 추가 · 계정 찾음",
    "강사 관리 · 추가 · 이미 소속",
    "강사 관리 · 추가 · 계정 없음",
    "강사 관리 · 조회 실패",
    "강사 관리 · 강사 없음",
    "회원 관리",
    "회원 관리 · 검색 결과 없음",
    "회원 관리 · 등록",
    "회원 관리 · 동명이인 확인",
    "회원 관리 · 지점 조회 실패",
    "회원 관리 · 지점 없음",
    "회원 관리 · 심사용 · 대표",
    "회원 관리 · 심사용 · FC매니저",
    "회원 관리 · 소속 확인 실패",
    "더보기 탭 · 매니저",
    "회원권 상품",
    "회원권 상품 · 소속 확인 실패",
    "번호 점검",
    "번호 점검 · 이상 없음",
    "번호 점검 · 조회 실패",
    "감사 로그",
    "감사 로그 · 전체 이력",
    "감사 로그 · 이상 없음",
    "감사 로그 · 조회 실패",
    "감사 로그 · 소속 확인 실패",
    "회원 앱",
    "회원 앱 · 대기 없음",
    "회원 앱 · 권한 없음",
    "회원 앱 · 조회 실패",
    "회원 앱 · 점검 어긋남",
    "발급 내역",
    "발급 내역 · 취소 · 이관 제외",
    "발급 내역 · 빈 달",
    "발급 내역 · 조회 실패",
    "발급 내역 · 이름 조회 실패",
    "급여 집계",
    "급여 집계 · 강사 펼침",
    "급여 집계 · 두 지점",
    "급여 집계 · 이관 전",
    "급여 집계 · 빈 달",
    "급여 집계 · 조회 실패",
    "급여 집계 · 이름 조회 실패",
    "급여 집계 · 소속 확인 실패",
    "엑셀 이관",
    "엑셀 이관 · 올리기 전 확인",
    "엑셀 이관 · 양식 열 없음",
    "엑셀 이관 · 업로드 결과",
    "엑셀 이관 · 센터 정보 조회 실패",
    "엑셀 이관 · 소속 확인 실패",
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

test("the october migration is the owner's alone and never writes before it has shown what it will write", async (t) => {
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

  /* 한 번 올리면 센터 전체의 회원과 회원권이 만들어진다. 매니저·강사에게는
     진입점이 없어야 하고, 항목이 없으면 setView 로 들어갈 길도 닫힌다. */
  assert.match(markupOf("더보기 탭"), /엑셀 이관/);
  assert.doesNotMatch(markupOf("더보기 탭 · 매니저"), /엑셀 이관/);
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /엑셀 이관/);
  assert.doesNotMatch(markupOf("더보기 탭 · 개인 모드"), /엑셀 이관/);
  assert.doesNotMatch(markupOf("더보기 탭 · 소속 확인 실패"), /엑셀 이관/);

  // 소속을 읽지 못하면 다른 센터에 회원을 올릴 수 있다. 그 상태는 잠근다.
  const locked = markupOf("엑셀 이관 · 소속 확인 실패");
  assert.match(locked, /소속을 확인하지 못했습니다/);
  assert.doesNotMatch(locked, /파일 고르기/, "잠긴 상태에서는 파일을 고를 수 없어야 한다");

  /* 지점과 강사를 못 읽은 채로 올리면 모든 행이 "찾을 수 없습니다"로
     실패하고, 대표는 자기 파일을 의심하게 된다. 그 전에 말한다. */
  const unreadable = markupOf("엑셀 이관 · 센터 정보 조회 실패");
  assert.match(unreadable, /센터 정보를 불러오지 못했습니다 \(코드 permission-denied\)/);
  assert.doesNotMatch(unreadable, /파일 고르기/);

  /* 쓰기 전에 몇 행이 올라가고 몇 행이 왜 안 되는지 먼저 보여준다 -- 원장은
     append-only 라 올린 뒤에는 되돌릴 수 없다. */
  const preview = markupOf("엑셀 이관 · 올리기 전 확인");
  assert.match(preview, /올리기 전에 확인/);
  assert.match(preview, /3행 올리기/);
  assert.match(preview, /지점을 찾을 수 없습니다/);
  assert.match(preview, /4행/, "고칠 줄 번호가 보여야 한다");

  // 열 하나가 없으면 그 열을 쓰는 모든 행이 실패한다. 한 번에 말하고 막는다.
  const missing = markupOf("엑셀 이관 · 양식 열 없음");
  assert.match(missing, /양식의 열이 없습니다: 연락처 · 지점/);
  assert.match(missing, /disabled=""[^<]*>0행 올리기<\/button>/, "올릴 행이 없으면 버튼이 잠겨 있어야 한다");

  // 성공과 실패를 한 화면에서 센다. 실패한 행만 고쳐 다시 올리면 된다.
  const result = markupOf("엑셀 이관 · 업로드 결과");
  assert.match(result, /118/);
  assert.match(result, /같은 이름의 강사가 둘 이상입니다/);
  assert.match(result, /이미 올라간 행입니다/);
  assert.match(result, /다시 올려도 두 번 저장되지 않습니다/);
});

test("a deputy's pay basis is stated instead of an amount that is never used", async (t) => {
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

  /* 부원장은 카테고리도 누적도 보지 않고 계약 금액의 5:5 를 받는다. 목록에
     풀방금액을 그대로 두면 그 금액이 지급되는 것으로 읽힌다. */
  const list = markupOf("강사 관리");
  assert.match(list, /풀방금액 4\.5만원 · 회당/, "부원장이 아닌 강사는 금액 그대로");
  /* 부원장 줄만 본다 -- "4.5만원"에도 "5만원"이 들어 있어, 화면 전체에서
     찾으면 다른 강사의 금액을 보고 통과한다. */
  const deputyRow = list.slice(list.indexOf("최소연"), list.indexOf("최소연") + 400);
  assert.match(deputyRow, /계약 금액의 5:5 \(공급가액 기준\)/);
  assert.doesNotMatch(deputyRow, /만원 · 회당/, "부원장 자리에 쓰이지 않는 금액이 남으면 안 된다");

  const editing = markupOf("강사 관리 · 부원장 지정");
  assert.match(editing, /부원장은 계약 금액의 50%를 회당 단가로 받습니다/);
  /* 카드 결제는 부가세를 뺀 공급가액이 기준이다. 결제 수단 하나로 회당 단가가
     9% 움직이므로, 지정하는 자리에서 그 사실이 보여야 한다. */
  assert.match(editing, /카드 결제는 부가세를 뺀 공급가액이 기준입니다/);
  // 체크하면 금액 칸은 잠긴다. 넣어도 쓰이지 않는 숫자를 받으면 안 된다.
  assert.match(editing, /disabled=""[^>]*placeholder="4\.5"|placeholder="4\.5"[^>]*disabled=""/);
  // 적용 시점을 말한다 -- 그 강사의 앱은 소속 정보를 다시 읽을 때부터 안다.
  assert.match(editing, /소속 정보를 다시 읽는 때부터/);

  /* 본인은 지정하지 못한다. 눌러도 거부되는 칸을 열어 두면 고장으로 보인다.
     퇴사 버튼도 없다 -- 대표가 자기 소속을 회수하면 그 센터에 대표가 없어지고
     되돌릴 문이 아무 데도 없다. */
  const self = markupOf("강사 관리 · 본인");
  assert.doesNotMatch(self, /부원장/);
  assert.doesNotMatch(self, /퇴사 처리/);
});

test("a deduction says why it was worth what it was worth", async (t) => {
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

  /* 같은 카테고리인데 금액이 다른 회차가 한 화면에 함께 온다. 사유가 없으면
     강사는 계산이 틀린 것으로 읽는다. 다시 계산할 수도 없다 -- 그때의 누적
     횟수는 계속 올라가 사라진다. */
  const pay = markupOf("이달 예상 급여");
  assert.match(pay, /누적 20회 미만 — 신규 단가/);
  assert.match(pay, /서비스 2회차 — 센터 지원 소진/);
  assert.match(pay, /부원장 5:5/);
  assert.match(pay, /기준 단가/);

  // 분쟁이 생겼을 때 여는 화면에도 같은 근거가 붙는다.
  assert.match(markupOf("센터 회원 상세"), /기준 단가/);
});

test("the payroll summary is the owner's, and says out loud what it did not count", async (t) => {
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

  /* 센터 전체의 급여는 한 사람의 것이 아니다. 항목이 없으면 setView 로 들어갈
     길도 함께 닫힌다. */
  assert.match(markupOf("더보기 탭"), /급여 집계/);
  assert.doesNotMatch(markupOf("더보기 탭 · 매니저"), /급여 집계/);
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /급여 집계/);
  assert.doesNotMatch(markupOf("더보기 탭 · 개인 모드"), /급여 집계/);
  assert.doesNotMatch(markupOf("더보기 탭 · 소속 확인 실패"), /급여 집계/);

  const summary = markupOf("급여 집계");

  /* 대표가 이 숫자를 최종 급여로 읽으면 매달 정산이 어긋난다. 빠진 항목을
     이름으로 적는다 -- "일부 항목 제외" 같은 문구로는 읽히지 않는다. */
  assert.match(summary, /수업료만 자동 계산됩니다\. 아래는 별도 정산입니다\./);
  for (const missing of ["개인매출 인센", "OT 인센", "간부 인센", "바우처 조정", "노쇼", "그룹 수업", "FC 수업료"]) {
    assert.match(summary, new RegExp(missing), missing);
  }
  // 숫자를 본 뒤에 읽는 단서는 이미 늦다. 안내가 합계보다 앞에 있어야 한다.
  assert.ok(
    summary.indexOf("별도 정산입니다") < summary.indexOf("수업료 합계"),
    "안내가 합계보다 앞에 와야 한다",
  );

  // 정산은 월이 끝난 뒤에 한다. 10월 3일에 열면 9월이 떠야 한다.
  assert.match(summary, /2026년 9월/);
  assert.match(summary, /₩665,000/);
  assert.match(summary, /수업 25건 · 강사 2명/);
  assert.match(summary, /CSV 내려받기/);

  /* 카테고리는 눌러야 나온다. 그리고 확정본 단가표의 순서로 선다 -- 금액순이면
     달마다 줄 순서가 달라지고, 옛 엑셀과 맞추던 눈이 줄을 잃는다. */
  assert.doesNotMatch(summary, /1:1 재등록\(이벤트\)/);
  const opened = markupOf("급여 집계 · 강사 펼침");
  const order = ["1:1 재등록(정상)", "1:1 재등록(이벤트)", "서비스"]
    .map((label) => opened.indexOf(label));
  assert.ok(order.every((at) => at >= 0), "펼치면 카테고리별 내역이 나온다");
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, "단가표 순서 그대로");
  assert.match(opened, /₩95,000/, "한 카테고리 안에서 단가가 섞여도 합계는 항목의 합이다");

  /* 카테고리만 보면 "이벤트페이 12건 36만원" 이고, 그 상품의 기준 단가는 30,000
     이라 계산이 틀린 것처럼 읽힌다. 왜 섞였는지는 판정이 답한다. */
  assert.match(opened, /적용된 단가 판정/);
  assert.match(opened, /누적 20회 미만 — 신규 단가/);
  assert.match(opened, /기준 단가/);

  /* 이관 전에는 모든 강사-회원 쌍이 0 에서 시작해 판정 3 이 먼저 걸린다. 그래서
     이벤트페이도 2:1 재등록도 전부 25,000 이 되는데, 화면이 말하지 않으면 대표는
     계산이 고장 났다고 읽는다. 실제로 그렇게 읽혔다. */
  const beforeMigration = markupOf("급여 집계 · 이관 전");
  assert.match(beforeMigration, /이 달은 모든 수업이 신규 단가\(25,000원\)입니다/);
  assert.match(beforeMigration, /누적 20회 미만이면 상품과 무관하게 신규 단가/);
  // 무엇을 하면 풀리는지까지 말한다. 이유만 알려 주고 끝내면 기다리게 된다.
  assert.match(beforeMigration, /강사누적진행/);

  /* 단가가 이미 갈리고 있는 달에는 붙이지 않는다 -- 붙이면 틀린 말이 된다. */
  assert.doesNotMatch(opened, /이 달은 모든 수업이 신규 단가/);
  assert.doesNotMatch(markupOf("급여 집계 · 빈 달"), /이 달은 모든 수업이 신규 단가/);

  /* 한 강사가 두 지점에서 수업하면 지점 묶음에 두 번 나온다. 급여는 한 번
     주므로 지급할 금액이 어느 줄인지 화면이 말해야 한다. */
  const branches = markupOf("급여 집계 · 두 지점");
  assert.match(branches, /반송점/);
  assert.match(branches, /센텀점/);
  assert.match(branches, /강사별 합계 \(전 지점\)/);
  assert.match(branches, /지급은 이 금액으로 합니다/);
  assert.doesNotMatch(markupOf("급여 집계"), /강사별 합계 \(전 지점\)/, "한 지점이면 묶지 않는다");

  /* 0원짜리 정산과 "읽지 못했다"가 같은 화면이면 대표는 그 달에 수업이 없었다고
     읽는다. */
  assert.match(markupOf("급여 집계 · 빈 달"), /이 달에 차감된 수업이 없습니다/);
  const failed = markupOf("급여 집계 · 조회 실패");
  assert.match(failed, /급여를 불러오지 못했습니다 \(코드 permission-denied\)/);
  assert.match(failed, /0원이 아니라 읽지 못한 것입니다/);
  assert.doesNotMatch(failed, /수업료 합계/);

  // 이름을 못 읽어도 금액은 보여준다. 이름 때문에 그날 정산을 못 하면 안 된다.
  const noNames = markupOf("급여 집계 · 이름 조회 실패");
  assert.match(noNames, /이름을 불러오지 못해 일부가 코드로 보입니다/);
  assert.match(noNames, /₩665,000/);

  // 다른 센터의 급여를 볼 수 있는 상태는 잠근다.
  const locked = markupOf("급여 집계 · 소속 확인 실패");
  assert.match(locked, /소속을 확인하지 못했습니다/);
  assert.doesNotMatch(locked, /CSV 내려받기/);
});

test("the audit log shows the odd ones first, and never a name it stored itself", async (t) => {
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

  // 센터 전체의 조작 이력은 한 사람의 것이 아니다. 매니저도 못 본다.
  assert.match(markupOf("더보기 탭"), /감사 로그/);
  assert.doesNotMatch(markupOf("더보기 탭 · 매니저"), /감사 로그/);
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /감사 로그/);
  assert.doesNotMatch(markupOf("더보기 탭 · 개인 모드"), /감사 로그/);

  const audit = markupOf("감사 로그");

  /* 전체 이력보다 목록이 먼저다. 백 줄을 눈으로 훑는 일은 아무도 하지 않고,
     3중 대조가 매달 늦어지는 이유가 그것이다. */
  for (const section of [
    "기준값 조정 발급", "바우처 결제", "장기 미차감 회원권",
    "발급 취소 · 보정", "부원장 · 단가 변경", "이관 업로드",
  ]) {
    assert.match(audit, new RegExp(section.replace(/ /g, "\\s*")), section);
  }
  assert.ok(audit.indexOf("기준값 조정 발급") < audit.indexOf("전체 이력"), "목록이 이력보다 위다");

  // 무엇이 기준과 다른지가 함께 있어야 고칠 수 있다.
  assert.match(audit, /회차 20 → 18/);
  assert.match(audit, /금액 130만원 → 110만원/);
  // 기준이 없는 이관분은 지어내지 않고 센다.
  assert.match(audit, /상품을 가리키지 않는 회원권 1건은 기준이 없어 대조하지 않았습니다/);
  assert.match(audit, /인센 10% 를 손으로 조정하는 대상입니다/);
  assert.match(audit, /잔여가 남았는데 30일 넘게 차감이 없는 건입니다/);

  /* 되돌린 건은 원장에서 읽는다 -- 감사 로그에 한 벌 더 쓰지 않는다. 원래
     기록이 남아 있다는 사실을 화면이 말해야, 대표가 "지웠다"로 읽지 않는다. */
  assert.match(audit, /원래 기록은 지워지지 않고 함께 남아 있습니다/);
  assert.match(audit, /차감 보정/);
  assert.match(audit, /발급 취소/);
  assert.match(audit, /강사가 다른 회원을 눌렀습니다/, "왜 되돌렸는지가 목록에 보인다");
  assert.match(audit, /20회 회수/);

  /* 기록에는 id 만 있고 이름은 화면이 붙인다. 이름이 보인다는 것은 join 이
     되고 있다는 뜻이고, 저장된 것이 아니라는 뜻이다. */
  assert.match(audit, /김하나/);
  assert.match(audit, /정예진/);

  const history = markupOf("감사 로그 · 전체 이력");
  // 감사 로그와 원장이 한 줄기로 합쳐진다.
  assert.match(history, /풀방금액 변경/);
  assert.match(history, /4\.5만원 → 5만원/);
  assert.match(history, /부원장/);
  assert.match(history, /이관 업로드/);
  assert.match(history, /성공 118 · 실패 2/);
  assert.match(history, /회원권 발급/);
  assert.match(history, /담당 강사 변경/);
  assert.match(history, /차감/);
  assert.match(history, /누적 20회 미만 — 신규 단가/, "왜 그 금액이었는지가 이력에도 온다");
  assert.match(history, /대표/, "누가 했는지에 역할이 붙는다");

  // 빈 목록은 좋은 소식이다. 그래서 그렇게 말해야 한다.
  const clean = markupOf("감사 로그 · 이상 없음");
  assert.ok((clean.match(/이상 없음/g) || []).length >= 4, "비어 있는 목록마다 말한다");

  /* "이상이 없다"와 "읽지 못했다"가 같은 화면이면 감사 화면은 아무것도 감사하지
     못한다. */
  const failed = markupOf("감사 로그 · 조회 실패");
  assert.match(failed, /이력을 불러오지 못했습니다 \(코드 permission-denied\)/);
  assert.match(failed, /이상이 없는 것이 아니라 읽지 못한 것입니다/);
  assert.doesNotMatch(failed, /이상 없음/);

  const locked = markupOf("감사 로그 · 소속 확인 실패");
  assert.match(locked, /소속을 확인하지 못했습니다/);
  assert.doesNotMatch(locked, /전체 이력/);
});

test("a mistake is undone by adding to the ledger, never by erasing it", async (t) => {
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

  /* 되돌리기는 대표만 한다. 강사가 스스로 되돌릴 수 있으면 기록의 의미가 없다 --
     잘못 누른 사람이 그것을 지울 수 있다는 뜻이기 때문이다. */
  const asInstructor = markupOf("센터 회원 상세");
  assert.doesNotMatch(asInstructor, />보정</);
  assert.doesNotMatch(asInstructor, /발급 취소/);

  const asOwner = markupOf("센터 회원 상세 · 대표");
  assert.match(asOwner, />보정</);
  assert.match(asOwner, /발급 취소/);

  /* 되돌려진 차감은 지우지 않는다. 취소선을 긋고 흐리게 둔다 -- 잘못 눌렀다는
     사실 자체가 사라지면 그것도 기록이 아니다. */
  assert.match(asOwner, /line-through/);
  assert.match(asOwner, /차감 보정/);
  assert.match(asOwner, /강사가 다른 회원을 눌렀습니다/, "왜 되돌렸는지가 이력에 남는다");
  assert.match(asOwner, /−₩30,000/, "급여에서 그만큼이 빠진다");

  /* 이미 차감이 있는 회원권은 취소할 수 없다. 그 수업은 실제로 일어났다.
     눌러도 거부되는 버튼을 두지 않고, 무엇을 먼저 해야 하는지 말한다. */
  assert.match(asOwner, /차감된 회차가 있어 취소할 수 없습니다/);
  assert.match(asOwner, /disabled=""[^<]*>발급 취소</);

  // 둘 다 사유를 받고 확인을 거친다.
  const correcting = markupOf("센터 회원 상세 · 차감 보정 확인");
  assert.match(correcting, /이 차감을 되돌릴까요\?/);
  assert.match(correcting, /사유 \(필수\)/);
  assert.match(correcting, /원래 기록은 지워지지 않습니다/);
  // 사유가 비어 있으면 확인이 열리지 않는다.
  assert.match(correcting, /disabled=""[^<]*>확인</);

  const cancelling = markupOf("센터 회원 상세 · 발급 취소 확인");
  assert.match(cancelling, /이 회원권을 취소할까요\?/);
  assert.match(cancelling, /남은 8회를 거두고/);
});

test("the audit screen's cancellations and corrections come from the ledger", async (t) => {
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

  /* 기능이 생겼으니 "취소할 방법이 없습니다"는 사라져야 한다. 그 문구가 남아
     있으면 대표가 있는 기능을 없다고 읽는다. */
  const audit = renderToStaticMarkup(byName.get("감사 로그"));
  assert.doesNotMatch(audit, /취소할 방법이 없습니다/);
  assert.match(audit, /원래 기록은 지워지지 않고 함께 남아 있습니다/);
});

test("an instructor sees the centre's members, so there is nothing to re-register", async (t) => {
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

  const mine = markupOf("회원 목록 · 소속 강사");

  /* 기본값은 "내 회원"이다. 120명에서 자기 8명을 찾게 만들면 그 화면은 쓰이지
     않고, 강사는 자기 명단을 따로 만들기 시작한다. */
  assert.match(mine, /내 회원 1명 · 전체 3명/);
  assert.match(mine, /김하나/, "내 회원은 보인다");
  assert.doesNotMatch(mine, /박서연/, "다른 강사의 회원은 기본값에서 빠진다");

  /* 잔여는 조직 회원권에서만 온다. 기기에 있던 9회(정규 7 + 서비스 2)가 아니라
     회원권의 8회여야 한다 -- 두 숫자가 함께 보이면 어느 것이 맞는지 아무도
     모른다. */
  assert.match(mine, /8/);
  assert.doesNotMatch(mine, /잔여 9/);

  /* 이관 직후에는 연락처가 달라 못 맞춘 같은 사람이 섞인다. 강사가 대표에게
     말할 수 있어야 하므로 수를 먼저 말한다. */
  assert.match(mine, /센터에 등록되지 않은 회원 1명/);
  assert.match(mine, /연락처가 다르게 적혀 못 맞춘 것입니다/);
  assert.match(mine, /기록과 사진은 그대로 남아 있습니다/);

  // 전체로 바꾸면 센터의 모든 회원이 보인다. 경계가 아니라 편의다.
  const all = markupOf("회원 목록 · 소속 강사 · 전체");
  assert.match(all, /내 회원 0명 · 전체 3명/);

  /* 못 읽었으면 빈 목록을 보여주지 않는다. 빈 목록은 "센터에 회원이 없다"로
     읽히고, 그 다음 행동이 바로 다시 등록이다. */
  const failed = markupOf("회원 목록 · 소속 강사 · 명부 조회 실패");
  assert.match(failed, /센터 회원을 불러오지 못했습니다 \(코드 permission-denied\)/);
  assert.match(failed, /아래는 이 기기에 저장된 목록입니다/);
  assert.match(failed, /다시 시도/);
});

test("the schedule settles the lesson, and says what that will cost before it does", async (t) => {
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

  /* 출석 · 노쇼 · 취소는 화면 상태만 바꾼다. 확정을 눌러야 차감이 나가고, 그
     무게를 누르기 전에 말해야 한다. */
  const before = markupOf("일정 탭 · 소속 · 확정 전");
  assert.match(before, /수업 확정 · 2명 차감/);
  assert.match(before, /확정하면 회원권이 차감되고, 되돌리려면 대표 확인이 필요합니다/);
  // 확정 전에는 출석 · 노쇼 · 취소를 자유롭게 바꿀 수 있다.
  assert.doesNotMatch(before, /disabled=""[^<]*>출석</, "확정 전에는 잠기지 않는다");
  assert.match(before, /전체 출석/, "여러 명은 전원을 정한 뒤 한 번에 확정한다");

  /* 확정 후에는 버튼이 잠긴다. 상태를 바꿔도 이미 나간 차감은 따라오지 않고,
     둘이 어긋나면 어느 것이 맞는지 알 수 없다. */
  const after = markupOf("일정 탭 · 소속 · 확정됨");
  assert.match(after, /확정됨 · 회원권 차감 완료/);
  assert.match(after, /회원권 1회 차감됨/);
  assert.doesNotMatch(after, /수업 확정/);
  assert.match(after, /disabled=""[^<]*>출석</, "확정 후에는 출석을 바꿀 수 없다");
  assert.doesNotMatch(after, /전체 출석/);

  /* 되돌리기는 대표만 본다. 강사가 방금 누른 것을 스스로 지울 수 있으면
     확정이라는 문턱이 의미를 잃는다. 이름도 출석 상태를 되돌리는 버튼과
     구분한다 -- 무게가 다르다. */
  assert.doesNotMatch(after, /차감 되돌리기/);
  assert.match(markupOf("일정 탭 · 소속 · 확정됨 · 대표"), /차감 되돌리기/);

  /* 전원 성공 · 일부 성공 · 차감할 것 없음이 서로 다른 문구여야 한다. "0명
     차감"에도 "차감 완료"가 나오면 강사는 끝난 줄 알고 넘어가고, 그 회차는
     아무에게도 지급되지 않는다. */
  const partial = markupOf("일정 탭 · 소속 · 일부만 차감");
  assert.match(partial, /확정됨 · 일부만 차감됨/);
  assert.doesNotMatch(partial, /회원권 차감 완료/);
  /* 토스트가 "아래에서 이유를 확인해 주세요"라고 말하는 그 자리다. 카드에 없으면
     그 안내는 강사를 빈 화면으로 보내는 것이다. */
  assert.match(partial, /박서연/);
  assert.match(partial, /회원권이 없습니다\. 발급 후 출석 체크에서 차감해 주세요/);

  const nothing = markupOf("일정 탭 · 소속 · 차감할 회차 없음");
  assert.match(nothing, /확정됨 · 차감할 회차 없음/);
  assert.doesNotMatch(nothing, /회원권 차감 완료/);

  /* 한 건도 나가지 않았으면 잠그지 않는다. 두 번 차감할 것이 없으므로 다시
     시도해도 안전하고, 잠그면 카드가 굳고 큐가 조용해지는 대가만 남는다. */
  const failed = markupOf("일정 탭 · 소속 · 차감 전원 실패");
  assert.doesNotMatch(failed, /확정됨/);
  assert.match(failed, /차감이 한 건도 나가지 않았습니다/);
  assert.match(failed, /다시 확정/);
  // 원본 코드를 버리지 않는다. 없으면 무엇을 고쳐야 하는지 알 수 없다.
  assert.match(failed, /Missing baseUnitPrice/);
  assert.match(failed, /이 수업은 급여에 들어가지 않습니다/);
  // 잠기지 않았으니 출석도 그대로 바꿀 수 있어야 한다.
  assert.doesNotMatch(failed, /disabled=""[^<]*>출석</);

  // 개인 모드에는 조직 회원권이 없다. 확정할 것이 없으므로 블록도 없다.
  const personal = markupOf("일정 탭 · 개인 모드 · 확정 없음");
  assert.doesNotMatch(personal, /수업 확정/);
  assert.doesNotMatch(personal, /대표 확인이 필요합니다/);
  assert.match(personal, /처리 되돌리기/, "개인 모드는 지금 동작 그대로다");
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

  // 대표와 FC매니저가 들어갈 수 있다 (2026-09-23).
  assert.match(markupOf("더보기 탭"), /회원 관리/);
  assert.match(markupOf("더보기 탭 · 매니저"), /회원 관리/);
  assert.match(markupOf("더보기 탭 · 매니저"), /회원권 상품/);

  /* 나머지에게는 진입점 자체가 없다. 항목이 없으면 setView 로 들어갈 길도
     닫힌다. 규칙이 같은 경계를 지킨다 (canRegisterClient) -- 보여 주면 눌러도
     거부되는 화면만 나온다. */
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /회원 관리/);
  assert.doesNotMatch(markupOf("더보기 탭 · 개인 모드"), /회원 관리/);
  assert.doesNotMatch(markupOf("더보기 탭 · 소속 확인 실패"), /회원 관리/);
  // 급여와 강사 관리는 여전히 대표만이다.
  assert.doesNotMatch(markupOf("더보기 탭 · 매니저"), /급여 집계/);
  assert.doesNotMatch(markupOf("더보기 탭 · 매니저"), /강사 관리/);

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

/* 강사 관리. 대표만 보고, 대표만 바꾼다 -- 규칙도 같은 경계를 지킨다.
   풀방금액은 1:1 재등록(정상) 한 카테고리의 단가이므로, 화면이 "모든 단가"처럼
   보이면 안 된다. */
test("the instructor screen says what it changes and what it does not", async (t) => {
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

  const list = markupOf("강사 관리");
  const editing = markupOf("강사 관리 · 수정");
  // 지난달 급여가 움직이지 않는다는 약속이 화면에 있어야 한다.
  assert.match(editing, /이후 차감분부터 적용됩니다/);
  assert.match(editing, /이미 기록된 수업의 급여는 바뀌지 않습니다/);

  assert.match(list, /정예진/);
  assert.match(list, /4\.5만원/, "저장은 원 단위, 표시는 만원 단위다");
  // 직함과 지점과 상태가 한 줄에 선다 -- 대표가 목록에서 판단할 수 있어야 한다.
  assert.match(list, /팀장 · 반송점 · 재직/);

  assert.match(list, /박서연/);
  /* 미설정과 0 은 둘 다 발급을 막는 상태다. 셋인 것은 퇴사자 한 줄이 아래에
     함께 서기 때문이다 -- 목록에서 빼면 복직시킬 길이 사라진다. */
  assert.equal((list.match(/풀방금액 미설정/g) || []).length, 3, "미설정 · 0원 · 퇴사자");
  assert.match(list, /1:1 재등록\(정상\) 발급 불가/);

  // 이름이 아직 없는 강사는 uid 로 보인다 -- 안 보이는 것보다 낫다.
  assert.match(list, /u3/);

  assert.match(editing, /풀방금액 \(만원\)/);
  assert.match(editing, /1:1 재등록\(정상\) 회당 단가/);
  assert.match(editing, /value="4\.5"/);

  // 퇴사자는 아래에 따로 선다. 섞이면 지금 일하는 사람을 찾는 데 목록을 훑는다.
  assert.match(list, /김하나/);
  assert.ok(list.indexOf("김하나") > list.indexOf("정예진"), "퇴사자가 아래");
});

/* 강사를 붙이는 자리. uid 를 옮겨 적게 하지 않는 것이 요점이다 -- 28자를 카톡으로
   옮기면 오타가 나고, 틀리면 조용히 매칭되지 않는다. */
test("adding an instructor asks for the e-mail, never a uid", async (t) => {
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

  const adding = markupOf("강사 관리 · 추가");
  assert.match(adding, /가입한 이메일/);
  assert.match(adding, /강사가 앱에 먼저 로그인한 뒤/);
  // 찾기 전에는 이름·직함 칸이 없다. 붙일 대상이 없는데 채우게 하면 안 된다.
  assert.doesNotMatch(adding, /직함/);

  const found = markupOf("강사 관리 · 추가 · 계정 찾음");
  assert.match(found, /계정을 찾았습니다 · 한지우/);
  assert.match(found, /직함/);
  /* 부원장은 추가할 때 고르지 못한다. 급여 판정을 바꾸는 일이라 이력이 함께
     남아야 하고, 그 문은 수정 쪽에 있다. */
  assert.doesNotMatch(found, /부원장<\/button>/);
  assert.match(found, /부원장 지정과 풀방금액은 추가한 뒤 수정에서 정합니다/);

  /* 이미 있는 사람은 규칙이 거부한다. 왜인지 화면이 먼저 말한다 --
     permission-denied 한 줄로는 알 수 없다. */
  const already = markupOf("강사 관리 · 추가 · 이미 소속");
  assert.match(already, /이미 이 센터에 있는 계정입니다 \(재직\)/);
  assert.doesNotMatch(already, /추가<\/button>/);

  /* 오타와 미가입은 서로 다른 할 일이다. 한 문구로 뭉개면 대표가 무엇을 해야
     하는지 알 수 없다. */
  const missing = markupOf("강사 관리 · 추가 · 계정 없음");
  assert.match(missing, /그 이메일로 가입한 계정이 없습니다/);
  assert.match(missing, /강사가 앱에 먼저 로그인해야 합니다/);
});

test("retiring says what it keeps, and the retired can come back", async (t) => {
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

  /* 퇴사가 기록을 지우는 것으로 읽히면 대표가 누르지 못한다. 원장은 append-only
     이고 각 항목이 그때의 instructorId 를 들고 있어 그대로 남는다. */
  const working = markupOf("강사 관리 · 수정");
  assert.match(working, /퇴사 처리/);
  assert.match(working, /퇴사해도 이 강사가 한 수업과 급여 기록은 그대로 남습니다/);

  // 되돌릴 수 있어야 한다. 잘못 눌렀을 때 콘솔을 열게 하면 안 된다.
  const retired = markupOf("강사 관리 · 퇴사자");
  assert.match(retired, /복직 처리/);
  assert.doesNotMatch(retired, /퇴사 처리/);
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

  const failed = markupOf("강사 관리 · 조회 실패");
  assert.match(failed, /강사 목록을 불러오지 못했습니다/);
  assert.match(failed, /permission-denied/, "추적 가능한 코드가 화면에 있어야 한다");
  assert.doesNotMatch(failed, /등록된 강사가 없습니다/);

  const empty = markupOf("강사 관리 · 강사 없음");
  assert.match(empty, /등록된 강사가 없습니다/);
  assert.doesNotMatch(empty, /불러오지 못했습니다/);
  assert.doesNotMatch(empty, /코드/, "없는 것은 오류가 아니므로 코드가 붙지 않는다");
});

test("only the owner reaches the instructor admin screen", async (t) => {
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

  assert.match(markupOf("더보기 탭"), /강사 관리/);
  /* 규칙이 대표만 허용하므로 보여 주면 눌러도 거부되는 화면만 나온다. 매니저의
     운영·설정에는 이제 남는 항목이 없다 -- 회원 관리와 회원권 발급도 대표로
     좁혔다. */
  assert.doesNotMatch(markupOf("더보기 탭 · 매니저"), /강사 관리/);
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /강사 관리/);
  assert.doesNotMatch(markupOf("더보기 탭 · 개인 모드"), /강사 관리/);
  assert.doesNotMatch(markupOf("더보기 탭 · 소속 확인 실패"), /강사 관리/);
});

/* 센터를 운영하는 일과 이 기기를 쓰는 일이 한 그룹에 섞여 목록이 길었다.
   나누되, 강사에게 빈 머리글만 남기지 않는 것이 요점이다. */
test("the centre group stands only where there is something in it", async (t) => {
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

  const owner = markupOf("더보기 탭");
  assert.match(owner, /센터 운영/);
  assert.match(owner, /내 설정/);
  // 센터 운영은 통째로 대표의 것이다. 업무와 기타는 그대로 남는다.
  assert.ok(owner.indexOf("센터 운영") < owner.indexOf("내 설정"), "운영이 위");

  /* 대표가 아니면 그 그룹에 들어갈 항목이 하나도 없다. 머리글만 남기면
     "여기 뭔가 있어야 하는데 안 보인다"가 된다. */
  // FC매니저에게는 센터 운영 묶음이 선다 -- 회원권 발급 · 회원 관리 · 상품 (2026-09-23).
  assert.match(markupOf("더보기 탭 · 매니저"), /센터 운영/);
  for (const name of ["더보기 탭 · 강사", "더보기 탭 · 개인 모드", "더보기 탭 · 소속 확인 실패"]) {
    const markup = markupOf(name);
    assert.doesNotMatch(markup, /센터 운영/, name);
    assert.match(markup, /내 설정/, `${name} — 내 설정은 모두에게`);
    assert.match(markup, /화면 설정/, name);
  }

  /* 센터 정보는 내 설정 쪽이다. 이름은 "센터"지만 세 값 모두 기기에 저장되고
     이 기기의 일정과 레거시 급여 추정에만 쓰인다. */
  assert.match(markupOf("더보기 탭 · 강사"), /센터 정보/);
  assert.match(owner, /이 기기의 센터명 · 담당자 · 그룹 단가/);
  const legacyHub = markupOf("더보기 탭 · 개인 모드");
  assert.match(legacyHub, /센터명 · 담당자 · 그룹 단가/);
  // 미소속 강사에게는 다른 센터 설정이 없다. "이 기기의"는 그때만 붙는 구별이다.
  assert.doesNotMatch(legacyHub, /이 기기의 센터명/);

  const centre = markupOf("더보기 탭 · 센터 정보");
  assert.match(centre, /이 기기에만 저장되는 값입니다/);
  assert.match(centre, /회원권 상품과 강사 관리에서 정해집니다/);
  // 미소속 개인 강사에게는 지금 문구 그대로다. 그쪽에는 다른 자리가 없다.
  const personal = markupOf("더보기 탭 · 센터 정보 · 개인 모드");
  assert.match(personal, /일정과 회원 관리에 사용하는 기존 저장값입니다/);
  assert.doesNotMatch(personal, /이 기기에만 저장되는 값입니다/);
});

test("the monthly report and the payroll roll-up do not read alike", async (t) => {
  /* 둘 다 "급여"라는 말을 쓰는데 세는 것이 다르다. 월간 리포트는 기기에 저장된
     일정이고, 급여 집계는 회원권 원장이다. 메뉴에서 구별되지 않으면 강사와
     대표가 서로 다른 숫자를 같은 것으로 읽는다. */
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

  const owner = markupOf("더보기 탭");
  assert.match(owner, /이달 수업 · 성과 · 기기 기준 추정/);
  assert.match(owner, /강사별 수업료 · 원장 기준 월말 정산/);
  assert.doesNotMatch(owner, /이달 수업 · 성과 · 예상 급여/);

  // 미소속 개인 강사에게는 급여 집계가 없다. 헷갈릴 짝이 없으니 문구도 그대로다.
  const personal = markupOf("더보기 탭 · 개인 모드");
  assert.match(personal, /이달 수업 · 성과 · 예상 급여/);
  assert.doesNotMatch(personal, /급여 집계/);
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

  /* 표 밖의 상품 중에서도, 회당 단가가 붙기 전에 만들어진 것만 금액 칸을 띄운다.
     빈 값을 0 으로 흘려보내면 그 수업들이 통째로 무보수가 된다. */
  const manual = markupOf("회원권 발급 · 직접 단가");
  assert.match(manual, /급여 단가 \(만원\)/);
  assert.match(manual, /표에 단가가 없어 직접 넣습니다/);

  /* 상품이 회당 단가를 들고 있으면 묻지 않는다. 물으면 같은 상품이 사람마다
     다른 단가로 나가고, 원장은 append-only 라 고칠 수 없다. */
  const priced = markupOf("회원권 발급 · 상품 단가");
  assert.doesNotMatch(priced, /급여 단가/);

  /* 묻지 않은 값이라 발급 직전에 한 번은 보여야 한다. 원장에 박히고 나면 고칠 수
     없는 숫자를 확인 없이 지나가게 두지 않는다. */
  const confirm = markupOf("회원권 발급 · 상품 단가 · 확인");
  assert.match(confirm, /급여 단가 회당 28,000원/);
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
  assert.match(blocked, /더보기 → 강사 관리/);

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

test("the issue screen is reachable for the owner and the FC manager only", async (t) => {
  /* 발급은 그 순간 급여의 근거를 만들고, 원장은 append-only 라 고칠 수 없다.
     FC매니저에게는 2026-09-23 에 다시 열었다 -- 규칙도 같은 경계다(canIssuePass). */
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
  assert.match(detail, /₩130,000/);
  assert.match(detail, /예상 급여/);

  /* 이 문구가 없으면 강사가 이 숫자를 받을 돈으로 읽고, 매달 정산 때 어긋난다. */
  assert.match(detail, /수업료만 자동으로 계산됩니다\. 인센티브와 노쇼는 별도로 정산됩니다\./);

  // 카테고리별 건수와 금액.
  assert.match(detail, /1:1 재등록\(정상\)/);
  assert.match(detail, /1건/);
  assert.match(detail, /₩45,000/);
  assert.match(detail, /1:1 재등록\(이벤트\)/);
  assert.match(detail, /3건/);
  /* 같은 카테고리의 세 회차가 30,000 + 25,000 + 0 이다. 회차마다 판정이
     다르면 이렇게 되고, 합계만 보면 계산이 틀린 것처럼 보인다 -- 사유 줄이
     있어야 하는 이유가 이것이다. */
  assert.match(detail, /₩85,000/);
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
  assert.match(card, /₩130,000/);
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

test("the confirm card shows the net price when VAT is inside the contract", async (t) => {
  /* 부원장의 5:5 는 계약 금액이 아니라 공급가액을 반으로 접는다. 결제 수단
     하나로 그 강사의 회당 단가가 9% 움직이므로 누르기 전에 보여야 한다. */
  const markupOf = await issueScreens(t);
  const card = markupOf("회원권 발급 · 확인");
  // 130만 카드 → 공급가액 1,181,818.
  assert.match(card, /공급가액 1,181,818원/);
  assert.match(card, /부원장 단가는 이 금액을 기준으로 합니다/);

  /* 현금·계좌는 계약 금액이 곧 공급가액이라 줄을 붙이지 않는다. 같은 숫자를
     두 번 쓰면 무엇이 다른지 읽는 사람이 찾게 된다. */
  const cash = markupOf("회원권 발급 · 확인 · 현금");
  assert.doesNotMatch(cash, /공급가액/);
});

/* 소속 센터의 회원 상세. 강사가 못 하는 일이 화면에서 사라지고, 이용권 카드가
   조직 회원권에서 채워진다. */
test("an instructor cannot delete, hold or reprice a centre member", async (t) => {
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

  const org = markupOf("회원 상세 · 소속");

  /* 삭제하면 그 회원의 수업 기록과 사진이 함께 사라지는데, 그 데이터는 센터가
     아니라 이 기기에만 있다. 숨김은 데이터를 남긴다. */
  assert.doesNotMatch(org, /회원 삭제/);
  assert.match(org, /내 목록에서 숨기기/);
  assert.match(org, /센터 회원은 삭제할 수 없습니다/);
  assert.match(org, /수업 기록과 사진은 그대로 남습니다/);
  // 되돌리는 길을 말한다. 되돌릴 수 없는 숨김은 삭제와 다를 바가 없다.
  assert.match(org, /숨긴 회원 다시 보기/);

  // 홀딩은 센터가 정한다. 강사가 임의로 걸면 회원권 유효기간과 어긋난다.
  assert.doesNotMatch(org, /홀딩 설정/);

  /* 단가는 대표만 정한다. 게다가 이 값은 소속 모드에서 급여에 닿지 않는다 --
     급여는 회원권 기록에서 나온다. 고쳐도 아무 일이 없는 칸이었다. */
  assert.doesNotMatch(org, /단가 수정/);
  assert.doesNotMatch(org, /강사 정산 단가/);

  /* 이용권 카드의 세 칸. 회원권에 다 있는데 명부가 옮겨 오지 않아 비어 있었다 --
     잔여만 적혀 있는 옆에서. */
  /* "미등록" 으로는 보지 않는다 -- 연락처가 없는 회원에게도 나오는 말이라
     이 카드가 채워졌는지를 가리지 못한다. 채워진 값 자체를 본다. */
  assert.doesNotMatch(org, /결제 내역 없음/);
  assert.match(org, /22회/, "누적 등록 = 정규 20 + 서비스 2");
  assert.match(org, /2027\. 02\. 01/, "만료일");
  assert.match(org, /₩65,000/, "회당 = 130만 ÷ 정규 20회");
  assert.doesNotMatch(org, /이용권 없음/);

  /* 개인 모드에는 셋 다 그대로다. 그쪽에서는 payRate 가 실제로 월간 리포트
     계산에 쓰이고, 회원도 홀딩도 강사 자신의 것이다. */
  const personal = markupOf("회원 상세");
  assert.match(personal, /회원 삭제/);
  assert.match(personal, /홀딩 설정/);
  assert.match(personal, /단가 수정/);
  assert.doesNotMatch(personal, /내 목록에서 숨기기/);
});

/* 회원의 여정 줄과 수업의 예상 단가. 둘 다 "나중에 묻지 않게" 하는 화면이다. */
test("the journey line shows the whole road, not just this pass", async (t) => {
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

  const journey = markupOf("회원 상세 · 여정");
  /* 20 + 30 + 32 = 82, 그중 쓴 것 64. 이관 기록은 74 − 64 = 10 회.
     숫자는 보조지만 줄만으로는 "얼마나" 를 읽을 수 없어 한 줄은 남긴다. */
  assert.match(journey, /누적 74 \/ 92회/);
  assert.match(journey, /3차 진행중/);
  // 담당이 바뀐 회원은 이 구간이 실제보다 짧다. 기준을 밝혀야 오해가 없다.
  assert.match(journey, /앱 이전 기록 \(담당 강사 기준\) 10회/);

  /* 현재 위치를 나타내는 점. 차감할 때마다 한 칸 오른쪽으로 기어간다 -- 회원이
     지금 어디쯤 와 있는지가 줄에서 읽혀야 하고, 그것이 이 줄의 요점이다. */
  assert.match(journey, /aria-label="누적 74회 \/ 총 92회 · 3차 진행중"/);
  assert.match(journey, /left:80\.4\d*%/, "74 / 92 = 80.4%");
  /* 서비스 구간은 색을 덮는 대신 빗금을 얹는다 -- 아직 쓰지 않은 서비스도
     "여기는 서비스" 로 읽혀야 한다. 급여도 성격도 다른 회차다. */
  assert.match(journey, /repeating-linear-gradient/);

  // 회원권이 하나도 없으면 빈 줄을 그리지 않는다.
  assert.doesNotMatch(markupOf("회원 상세"), /누적 \d+ \/ \d+회/);
});

test("a lesson says what it will be worth before it is settled", async (t) => {
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

  /* 눌러 본 뒤에 아는 것과 누르기 전에 아는 것은 다르다 -- 원장은 append-only 라
     누른 뒤에는 고칠 수 없다. */
  const preview = markupOf("일정 탭 · 소속 · 예상 단가");
  assert.match(preview, /30,000원 · 기준 단가/);
  /* 회원권이 없는 것과 다 쓴 것은 고칠 방법이 다르다. 같은 자리에 그 사실을 쓴다. */
  assert.match(preview, /회원권 없음 · 발급이 필요합니다/);

  const service = markupOf("일정 탭 · 소속 · 예상 단가 · 서비스");
  assert.match(service, /10,000원/);
  // 0원도 금액이다. 빈칸으로 두면 "계산이 안 됐나" 로 읽힌다.
  assert.match(service, /0원 · 서비스 2회차 — 센터 지원 소진/);

  /* 확정 뒤에는 예상이 아니라 결과가 있다. 이미 박힌 금액 옆에 "예상" 을 또 쓰면
     둘 중 어느 것이 실제인지 알 수 없다. */
  assert.doesNotMatch(markupOf("일정 탭 · 소속 · 확정됨"), /원 · 기준 단가/);
});

/* ── 듀엣 ─────────────────────────────────────────────────────────────────
   회원권 하나를 둘이 쓴다. 그 사실이 화면에 없으면 대표는 잔여 29회를 한 사람
   몫으로 읽고 재등록 시점을 잘못 센다. */

test("a shared pass says it is shared, and with whom", async (t) => {
  const markupOf = await issueScreens(t);
  const duet = markupOf("센터 회원 상세 · 듀엣");
  assert.match(duet, /듀엣/);
  assert.match(duet, /박두리 님과 함께 씁니다/);
  assert.match(duet, /수업 한 번에 1회 차감/);
});

test("the screen names the way out, because the door for it does not exist yet", async (t) => {
  /* 회원권에서 한 사람만 떼어내는 문은 아직 없다 -- 환불·정산 규칙이 먼저
     정해져야 한다. 화면이 그 길을 말해 두지 않으면 대표는 방법이 없다고 여기고
     엉뚱한 곳을 고친다. */
  const markupOf = await issueScreens(t);
  const duet = markupOf("센터 회원 상세 · 듀엣");
  assert.match(duet, /취소하고 각자에게 다시 발급/);
});

test("a 1:1 pass says nothing about duets", async (t) => {
  // 1:1 이 센터의 대부분이다. 그 줄에 듀엣 이야기가 서면 안 된다.
  const markupOf = await issueScreens(t);
  const solo = markupOf("센터 회원 상세 · 대표");
  assert.doesNotMatch(solo, /함께 씁니다/);
  assert.doesNotMatch(solo, /각자에게 다시 발급/);
});

/* ── 듀엣 발급 ────────────────────────────────────────────────────────────

   이관으로만 듀엣을 만들 수 있으면 새 계약은 앱에서 팔 수 없고, 듀엣만 다시
   종이로 돌아간다. */

test("the duet switch is off until a member is chosen, and off by default", async (t) => {
  const markupOf = await issueScreens(t);
  /* 1:1 이 대부분이라 켜져 있으면 발급할 때마다 끄는 손이 하나 더 든다. 그리고
     회원을 고르기 전에 보이면 무엇에 대한 듀엣인지 알 수 없다. */
  const fresh = markupOf("회원권 발급");
  assert.doesNotMatch(fresh, /듀엣으로 발급/);

  const chosen = markupOf("회원권 발급 · 듀엣 꺼짐");
  assert.match(chosen, /듀엣으로 발급/);
  assert.match(chosen, /회원 두 명이 한 회원권을 함께 씁니다/);
  // 꺼져 있으면 상대 칸이 없다.
  assert.doesNotMatch(chosen, /듀엣 상대/);
});

test("turning it on asks for a second member, chosen from those already registered", async (t) => {
  const markupOf = await issueScreens(t);
  const on = markupOf("회원권 발급 · 듀엣");
  assert.match(on, /듀엣 상대/);
  assert.match(on, /이두리님/, "고른 상대가 확인되어야 한다");
});

test("a partner the centre does not have sends the owner to register them first", async (t) => {
  /* 여기서 새로 만들면 연락처 없이 회원이 생기고, 그 회원은 동명이인과
     구분되지 않는다. */
  const markupOf = await issueScreens(t);
  const missing = markupOf("회원권 발급 · 듀엣 · 상대 없음");
  assert.match(missing, /찾는 회원이 없습니다/);
  assert.match(missing, /회원 관리에서 먼저 등록해 주세요/);
});

test("the confirmation says the sessions are shared, not doubled", async (t) => {
  // 대표가 각자 30회로 오해하면 계약 자체가 틀어진다.
  const markupOf = await issueScreens(t);
  const confirm = markupOf("회원권 발급 · 듀엣 · 확인");
  assert.match(confirm, /김하나님 · 이두리님/, "두 사람 이름이 요약에 있어야 한다");
  assert.match(confirm, /듀엣/);
  assert.match(confirm, /30회를 두 분이 함께 씁니다/);
  assert.match(confirm, /수업 한 번에 1회 차감/);
});

test("a 1:1 confirmation says nothing about sharing", async (t) => {
  const markupOf = await issueScreens(t);
  assert.doesNotMatch(markupOf("회원권 발급 · 확인"), /두 분이 함께 씁니다/);
});

test("a product and a duet that disagree are shown, in both directions", async (t) => {
  /* 둘이 어긋나면 급여가 틀린다. 막지는 않는다 -- 2:1 상품을 혼자 쓰는 계약도,
     1:1 상품을 둘이 쓰기로 한 계약도 실제로 있다. */
  const markupOf = await issueScreens(t);
  const duetOnSolo = markupOf("회원권 발급 · 듀엣 · 카테고리 어긋남");
  assert.match(duetOnSolo, /2:1 상품이 아닙니다/);
  assert.match(duetOnSolo, /급여가 이 상품의 카테고리로 계산됩니다/);
  // 그래도 발급 버튼은 살아 있다.
  assert.match(duetOnSolo, /발급<\/button>/);

  const soloOnDuet = markupOf("회원권 발급 · 2:1 인데 듀엣 아님");
  assert.match(soloOnDuet, /2:1 상품인데 듀엣으로 발급하지 않습니다/);
  assert.match(soloOnDuet, /회원 한 명의 회원권이 됩니다/);
  assert.match(soloOnDuet, /발급<\/button>/);
});

test("an existing usable pass is said before the button, and does not disable it", async (t) => {
  /* 재등록은 만료 전에 미리 하는 일이 잦다. 막으면 그 정당한 계약을 팔 수 없고,
     회원을 잘못 골랐으면 여기서 드러난다. */
  const markupOf = await issueScreens(t);
  const held = markupOf("회원권 발급 · 듀엣 · 이미 회원권 있음");
  assert.match(held, /이두리님에게 이미 쓸 수 있는 회원권이 있습니다/);
  assert.match(held, /잔여 4회/);
  assert.match(held, /발급<\/button>/);
});

/* ── 발급 내역 ────────────────────────────────────────────────────────────

   급여 집계와 같은 원장을 읽지만 묻는 것이 다르다 -- "무엇이 팔렸는가" 다.
   한 화면에 매출과 급여가 같이 있으면 둘 중 하나를 다른 하나로 읽는 사람이
   반드시 나온다. */

test("the issue report is the owner's, exactly like payroll", async (t) => {
  const markupOf = await issueScreens(t);
  assert.match(markupOf("더보기 탭"), /발급 내역/);
  /* FC매니저는 발급을 하지만 센터 전체의 매출은 한 사람의 것이 아니다. 자기
     실적만 보는 화면은 따로 필요하고, 아직 없다. */
  assert.doesNotMatch(markupOf("더보기 탭 · 매니저"), /발급 내역/);
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /발급 내역/);
  assert.doesNotMatch(markupOf("더보기 탭 · 개인 모드"), /발급 내역/);
  assert.doesNotMatch(markupOf("더보기 탭 · 소속 확인 실패"), /발급 내역/);
});

test("the report shows what was sold, and never what it pays", async (t) => {
  const markupOf = await issueScreens(t);
  const report = markupOf("발급 내역");
  assert.match(report, /김하나/);
  assert.match(report, /1:1 20회 가을 이벤트/);
  assert.match(report, /20회/);
  assert.match(report, /₩1,300,000/);
  assert.match(report, /카드/);
  assert.match(report, /신규/);
  /* 단가와 급여 판정은 이 화면에 오지 않는다. "급여" 라는 낱말 자체는 화면에
     있다 -- "급여가 아니라 무엇이 팔렸는지를 봅니다" 라고 먼저 말하기 때문이다.
     그래서 낱말이 아니라 실제로 새면 안 되는 것을 본다. */
  assert.match(report, /급여가 아니라 무엇이 팔렸는지를 봅니다/);
  for (const forbidden of ["단가", "풀방", "25,000", "1,181,818", "누적 20회 미만", "부원장"]) {
    assert.doesNotMatch(report, new RegExp(forbidden), forbidden + " 가 발급 내역에 있다");
  }
});

test("the totals separate new contracts, which is what FC is measured by", async (t) => {
  const markupOf = await issueScreens(t);
  const report = markupOf("발급 내역");
  assert.match(report, /2건 · ₩2,200,000/);
  assert.match(report, /그중 신규 1건 · ₩1,300,000/);
});

test("a cancelled issue is struck through, dated, and out of the totals", async (t) => {
  const markupOf = await issueScreens(t);
  const report = markupOf("발급 내역 · 취소 · 이관 제외");
  assert.match(report, /line-through/);
  assert.match(report, /10\/5 취소/);
  assert.match(report, /취소 1건 \(합계에서 제외\)/);
  // 이관은 엑셀에서 옮겨 온 것이라 이 달의 매출이 아니다.
  assert.match(report, /이관 3건 제외/);
  assert.match(report, /이전 달 발급 취소 1건/);
});

test("an empty month says so, and a failed read says its code", async (t) => {
  /* 빈 달과 못 읽은 달은 대표가 할 일이 다르다. 한 문구로 뭉개면 안 된다. */
  const markupOf = await issueScreens(t);
  const empty = markupOf("발급 내역 · 빈 달");
  assert.match(empty, /이번 달 발급이 없습니다/);
  assert.doesNotMatch(empty, /불러오지 못했습니다/);

  const failed = markupOf("발급 내역 · 조회 실패");
  assert.match(failed, /발급 내역을 불러오지 못했습니다/);
  assert.match(failed, /permission-denied/);
  assert.match(failed, /다시 시도/);
  assert.doesNotMatch(failed, /이번 달 발급이 없습니다/);
});

test("names failing does not hide the numbers", async (t) => {
  // 이름 때문에 화면 전체를 막으면 그날 매출을 못 본다.
  const markupOf = await issueScreens(t);
  const report = markupOf("발급 내역 · 이름 조회 실패");
  assert.match(report, /이름을 불러오지 못했습니다/);
  assert.match(report, /unavailable/);
  assert.match(report, /₩1,300,000/, "숫자는 그대로 선다");
});

/* ── 회원 앱 연결 ──────────────────────────────────────────────────────────

   회원과 계정을 잇고 끊는 화면이다. 규칙이 memberLinks 를 본인에게만 열어 두므로
   대표는 서버 함수로만 대기 목록을 볼 수 있고, 그래서 이 화면이 없으면 손으로
   잇는 문은 부를 수 없는 문이 된다. */

test("the member-app screen is the owner's, exactly like payroll", async (t) => {
  const markupOf = await issueScreens(t);
  assert.match(markupOf("더보기 탭"), /회원 앱/);
  /* 남의 계정과 회원을 잇고 끊는 일이다. 급여보다 좁으면 좁았지 넓지 않다. */
  assert.doesNotMatch(markupOf("더보기 탭 · 매니저"), /회원 앱/);
  assert.doesNotMatch(markupOf("더보기 탭 · 강사"), /회원 앱/);
  assert.doesNotMatch(markupOf("더보기 탭 · 개인 모드"), /회원 앱/);
});

test("a waiting link shows both candidates by name, never auto-joined", async (t) => {
  const markupOf = await issueScreens(t);
  const screen = markupOf("회원 앱");
  assert.match(screen, /연결 대기/);
  assert.match(screen, /후보 2명/);
  // 이름이 보여야 대표가 고를 수 있다. id 만으로는 누구인지 모른다.
  assert.match(screen, /김하나/);
  assert.match(screen, /이 회원으로 잇기/);
  // 자동으로 이었다고 말하지 않는다 -- 잇지 않았다.
  assert.doesNotMatch(screen, /연결했습니다/);
});

test("no waiting links reads differently from a failed read", async (t) => {
  /* 할 일이 없는 것과 못 읽은 것은 대표가 할 일이 다르다. 한 문구로 뭉개면
     대표는 조용한 고장을 정상으로 읽는다. */
  const markupOf = await issueScreens(t);
  const empty = markupOf("회원 앱 · 대기 없음");
  assert.match(empty, /확인이 필요한 연결이 없습니다/);
  assert.doesNotMatch(empty, /불러오지 못했습니다/);

  const denied = markupOf("회원 앱 · 권한 없음");
  assert.match(denied, /대표만 볼 수 있습니다/);
  assert.match(denied, /permission-denied/);
  assert.doesNotMatch(denied, /확인이 필요한 연결이 없습니다/);

  const failed = markupOf("회원 앱 · 조회 실패");
  assert.match(failed, /연결 대기 목록을 불러오지 못했습니다/);
  assert.match(failed, /unavailable/);
  assert.match(failed, /다시 시도/);
  assert.doesNotMatch(failed, /대표만 볼 수 있습니다/);
});

test("the check says where it stopped and what was wrong, in words", async (t) => {
  const markupOf = await issueScreens(t);
  const screen = markupOf("회원 앱 · 점검 어긋남");
  assert.match(screen, /읽기만 하고/, "점검이 고치지 않는다는 것을 먼저 말한다");
  assert.match(screen, /5명 확인/);
  // 코드만 보여주면 대표가 할 일을 알 수 없다.
  assert.match(screen, /잔여 횟수가 회원권과 다릅니다/);
  assert.match(screen, /8 != 3/);
  assert.match(screen, /에서 멈췄습니다/);
});

test("the member-app screen never shows a price", async (t) => {
  /* 회원 화면의 값을 다루는 자리다. 여기에 단가가 서면 그 다음은 회원 화면이다. */
  const markupOf = await issueScreens(t);
  for (const name of ["회원 앱", "회원 앱 · 점검 어긋남"]) {
    const screen = markupOf(name);
    for (const forbidden of ["단가", "₩", "부원장", "급여"]) {
      assert.doesNotMatch(screen, new RegExp(forbidden), `${forbidden} 가 ${name} 에 있다`);
    }
  }
});

/* ── 강사가 명부에서 무엇을 보는가 ────────────────────────────────────────

   **경계가 아니다.** 규칙은 지금도 강사에게 센터 전체 명부를 열어 준다
   (`clients` list 가 owner·manager·instructor·staff). 여기서 고정하는 것은
   화면이 먼저 보여 주지 않는다는 것이고, 규칙 차단은 대타 경로를 설계한
   뒤다 (docs/handoff.md).

   그래도 이 줄들이 값어치가 있는 이유: 노출의 대부분은 악의가 아니라 그냥
   거기 있어서 일어난다. */

test("an instructor sees only the last four digits, an owner sees the number", async (t) => {
  const markupOf = await issueScreens(t);

  const instructor = markupOf("회원 상세 · 강사");
  assert.match(instructor, /···5678/, "뒤 4자리가 없다");
  // 앞자리가 붙은 어떤 모양도 나오면 안 된다.
  assert.doesNotMatch(instructor, /010-\*\*\*\*-5678/, "강사 화면에 앞자리가 있다");
  assert.doesNotMatch(instructor, /01012345678/, "강사 화면에 전체 번호가 있다");
  assert.doesNotMatch(instructor, /010-1234-5678/, "강사 화면에 전체 번호가 있다");

  /* 대표와 FC매니저는 지금과 같다. 등록·연락·정산을 하는 사람들이다. */
  const owner = markupOf("회원 상세 · 대표");
  assert.match(owner, /010-\*\*\*\*-5678/, "대표 화면이 바뀌었다");
});

test("the instructor's list has no way to browse the whole centre", async (t) => {
  const markupOf = await issueScreens(t);

  const instructor = markupOf("회원 목록 · 강사");
  /* "전체 N" 칩이 없다. 있으면 한 번 눌러 120명을 스크롤하게 된다. */
  assert.doesNotMatch(instructor, /전체 \d+<\/button>/, "강사에게 전체 보기 칩이 있다");
  assert.doesNotMatch(instructor, /01012345678/);
  assert.doesNotMatch(instructor, /01055556666/);

  // 대표에게는 그대로 있다.
  const owner = markupOf("회원 목록 · 대표");
  assert.match(owner, /내 회원 \d+/);
  assert.match(owner, /전체 \d+/);
});

/* ── 아직 시작하지 않은 수업 ──────────────────────────────────────────────

   시각으로 확정 카드를 통째로 감췄다가 되돌렸다. 감췄더니 **이미 실패한
   수업의 사유와 [다시 확정]까지 사라졌고**, 토스트는 "아래 이유를 보고 다시
   시도해 주세요" 라고 말하는데 아래에 아무것도 없었다.

   카드를 세우는 판정과 버튼을 잠그는 판정은 다른 일이다. 잠긴 버튼은 이유를
   말할 수 있지만 없는 버튼은 아무 말도 못 한다. */

test("a lesson that has not started keeps its card and locks the button", async (t) => {
  const markupOf = await issueScreens(t);
  const before = markupOf("일정 탭 · 소속 · 시작 전");

  assert.match(before, /수업 확정/, "카드가 통째로 사라졌다");
  assert.match(before, /아직 시작하지 않은 수업입니다/);
  assert.match(before, /disabled=""/, "버튼이 잠기지 않았다");
});

test("a failed lesson keeps its reason and its retry even before it starts", async (t) => {
  /* 여기가 감췄을 때 가장 크게 잃던 자리다 -- 강사는 무엇이 막았는지도,
     다시 누를 곳도 잃었다. */
  const markupOf = await issueScreens(t);
  const failed = markupOf("일정 탭 · 소속 · 시작 전 · 실패 기록");

  assert.match(failed, /차감이 한 건도 나가지 않았습니다/);
  assert.match(failed, /다시 확정/);
  // 코드가 사람 말로 바뀌어 있다.
  assert.match(failed, /아직 시작하지 않은 수업입니다/);
  assert.match(failed, /occurred_at_future/, "원본 코드가 사라졌다");
});

/* ── 회원에게 보낼 말 ────────────────────────────────────────────────────

   수업기록은 강사가 다음 수업을 준비하려고 쓰는 글이고, 이 칸은 회원을 향해
   따로 적는 한 줄이다. 두 칸이 나뉘어 있다는 것이 이 기능의 전부다. */

test("the member-facing note sits beside the lesson record, not inside it", async (t) => {
  const markupOf = await issueScreens(t);
  const sheet = markupOf("일정 탭 · 소속 · 회원에게 보낼 말");

  assert.match(sheet, /회원에게 보낼 말/);
  // 강사가 자기를 위해 쓰는 기록도 그 자리에 그대로 있다 -- 한쪽이 다른 쪽을
  // 밀어내면 강사는 둘 중 하나를 포기한다.
  assert.match(sheet, /기록하기/);
  assert.match(sheet, /직접입력/);
  // 회원에게 가는 칸이라는 것을 칸 자체가 말한다.
  assert.match(sheet, /data-member-note/);
});

test("before the note is loaded the box says so instead of looking empty", async (t) => {
  /* 빈 칸으로 보이면 강사는 아직 안 썼다고 읽고 그 위에 덮어쓴다 -- 먼젓번에
     보낸 말이 소리 없이 사라진다. */
  const markupOf = await issueScreens(t);
  const sheet = markupOf("일정 탭 · 소속 · 회원에게 보낼 말");

  assert.match(sheet, /불러오는 중…/);
  assert.match(sheet, /disabled=""/, "읽어 오기 전인데 입력이 열려 있다");
});

test("the note says when the member will actually see it", async (t) => {
  /* 확정 전에 저장하면 회원 앱에는 아직 없다 -- 회원의 수업 이력은 차감으로
     만들어지기 때문이다. 말하지 않으면 강사는 저장하고 나서 안 보인다고 한다.
     실제로 그 일이 있었고, 그래서 이 기능이 생겼다. */
  const markupOf = await issueScreens(t);

  const before = markupOf("일정 탭 · 소속 · 회원에게 보낼 말");
  assert.match(before, /수업을 확정해 회원권이 차감되면 회원 앱에 보입니다/);

  const after = markupOf("일정 탭 · 소속 · 회원에게 보낼 말 · 확정됨");
  assert.match(after, /회원 앱의 수업 탭에 이 수업과 함께 보입니다/);
  assert.doesNotMatch(after, /확정해 회원권이 차감되면/);
});

test("the note is not offered where there is no member app", async (t) => {
  /* 개인 모드에는 조직 회원이 없다. 보낼 곳이 없는 칸을 그려 두면 강사는
     쓰고 나서 아무 데도 가지 않은 것을 나중에 안다. */
  const markupOf = await issueScreens(t);
  assert.doesNotMatch(markupOf("일정 탭 · 개인 모드 · 확정 없음"), /회원에게 보낼 말/);
});

/* ── 회원권 양도 ─────────────────────────────────────────────────────────

   원장은 append-only 다. 누른 뒤에는 고칠 수 없으므로, 무엇이 일어나는지를
   누르기 **전에** 화면이 말해야 한다. */

test("the transfer sheet prices the move before it happens", async (t) => {
  const markupOf = await issueScreens(t);
  const sheet = markupOf("센터 회원 상세 · 양도");

  assert.match(sheet, /회원권 양도/);
  // 서비스 회차를 뺀 유료 잔여다. 잔여 8 중 서비스 2 를 뺀 6.
  assert.match(sheet, /남은 유료 회차 6회/);
  assert.match(sheet, /서비스 회차는 넘어가지 않습니다/);
  // 1회 기준 미리보기가 이미 서 있다. 금액과 부원장 단가를 함께 적는다.
  assert.match(sheet, /계약 금액/);
  assert.match(sheet, /부원장 회당/);
  assert.match(sheet, /1:1 신규/);
  assert.match(sheet, /만료일은 원본 그대로/);
});

test("the transfer sheet says the move cannot be undone", async (t) => {
  /* 되돌릴 수 없다는 사실을 누르기 전에 말한다. 차감 보정처럼 되돌리는 문이
     양도에는 없다 -- 받는 회원의 회원권이 이미 자기 이력을 쌓기 시작한다. */
  const markupOf = await issueScreens(t);
  assert.match(markupOf("센터 회원 상세 · 양도"), /넘긴 회차는 되돌릴 수 없습니다/);
});

test("the receiving member is typed in full, never browsed", async (t) => {
  /* 명부를 스크롤하며 고르게 두면 "누가 회원인지" 가 화면에 깔린다. 강사에게
     명부를 좁혀 둔 것과 같은 선이다. */
  const markupOf = await issueScreens(t);
  const sheet = markupOf("센터 회원 상세 · 양도");

  assert.match(sheet, /이름 전체 입력/);
  // 후보 이름이 미리 깔려 있으면 안 된다.
  assert.doesNotMatch(sheet, /정세인/);
  assert.doesNotMatch(sheet, /<select/);
});

test("a duet transfer is not offered at all", async (t) => {
  /* 열어 두고 거부하면 대표는 방법이 있다고 여기고 계속 누른다. */
  const markupOf = await issueScreens(t);
  const blocked = markupOf("센터 회원 상세 · 양도 · 듀엣 차단");
  assert.match(blocked, /듀엣 회원권은 양도할 수 없습니다/);
  // 미리보기도 확인 버튼의 활성도 없다.
  assert.doesNotMatch(blocked, /부원장 회당/);
  assert.match(blocked, /disabled=""/);
});

test("only the owner sees the transfer button", async (t) => {
  /* 회원 사이에 돈이 오가는 일이라 차감 보정·취소와 같은 선이다. */
  const markupOf = await issueScreens(t);
  assert.match(markupOf("센터 회원 상세 · 대표"), />양도</);
  assert.doesNotMatch(markupOf("센터 회원 상세"), />양도</);
});

/* ── 연락처 수정 ─────────────────────────────────────────────────────────

   번호는 회원의 정체다. 고치는 것과 보는 것은 다른 일이라, 고치는 창에서도
   전체 번호를 보여 주지 않는다. */

test("the phone edit sheet never shows the whole current number", async (t) => {
  /* 강사에게 명부는 뒤 4자리로 가려져 있다. 수정 창에서 전체를 보여 주면
     그 창이 곧 번호를 보는 길이 된다. */
  const markupOf = await issueScreens(t);
  const sheet = markupOf("센터 회원 상세 · 연락처 수정");

  assert.match(sheet, /연락처 수정/);
  assert.match(sheet, /새 연락처/);
  // 가운데를 가린 모양만 보인다.
  assert.doesNotMatch(sheet, /01012345678/);
  assert.doesNotMatch(sheet, /010-1234-5678/);
});

test("the phone edit sheet says the app login will break", async (t) => {
  /* 번호가 바뀐 계정은 더 이상 그 회원이 아니다. 누르기 전에 말한다. */
  const markupOf = await issueScreens(t);
  const sheet = markupOf("센터 회원 상세 · 연락처 수정");
  assert.match(sheet, /새 번호로 다시 로그인/);
  // 회원 id 가 그대로라는 것도 말한다 -- 대표가 가장 걱정하는 자리다.
  assert.match(sheet, /회원 번호\(ID\)는 바뀌지 않습니다/);
});

test("the instructor sees the edit button for their own member", async (t) => {
  /* 번호가 틀려 있으면 수업이 끝난 자리에서 바로 고치는 편이 낫다. 서버가
     담당인지 다시 본다. */
  const markupOf = await issueScreens(t);
  assert.match(markupOf("센터 회원 상세 · 강사 · 연락처 수정"), />연락처 수정</);
});

test("the edit button is absent where nothing can save it", async (t) => {
  // onChangePhone 이 없으면 누를 곳을 만들지 않는다.
  const markupOf = await issueScreens(t);
  assert.doesNotMatch(markupOf("센터 회원 상세 · 대표"), />연락처 수정</);
});

test("the owner sees who changed whose number, with the digits masked", async (t) => {
  /* 강사도 바꿀 수 있게 된 뒤로 대표가 따로 봐야 하는 줄이다 -- 번호는
     회원의 정체라, 누가 남의 번호를 건드렸는지가 묻히면 안 된다. */
  const markupOf = await issueScreens(t);
  const audit = markupOf("감사 로그");

  assert.match(audit, /연락처 변경/);
  assert.match(audit, /이두리/);
  // 가운데를 가린다. 전체 번호는 감사 화면에도 늘어놓지 않는다.
  assert.match(audit, /010····4444 → 010····8888/);
  assert.doesNotMatch(audit, /01033334444/);
  assert.doesNotMatch(audit, /01099998888/);
  // 누가 바꿨는지 -- 강사가 바꾼 줄을 알아볼 수 있어야 한다.
  assert.match(audit, /강사/);
});

/* ── 번호 점검 ───────────────────────────────────────────────────────────

   이 번호로는 회원 앱에 로그인해도 명부에서 찾지 못한다. 한꺼번에
   정규화하지 않는 이유는 아예 틀린 번호가 섞여 있기 때문이다 -- 고치면 그것이
   "정상" 이 되어 더 찾기 어려워진다. */

test("the phone check shows the stored spelling, untouched", async (t) => {
  const markupOf = await issueScreens(t);
  const screen = markupOf("번호 점검");

  assert.match(screen, /번호 점검/);
  // 저장된 그대로다. 대표가 고쳐야 할 것이 바로 이 철자다.
  assert.match(screen, /010-1234-5678/);
  assert.match(screen, /02-1234-5678/);
  assert.match(screen, /연락처 수정/);
  // 연결된 회원은 번호를 바꾸면 로그인이 끊긴다. 미리 말한다.
  assert.match(screen, /앱 연결됨/);
});

test("nothing wrong and could not read are different screens", async (t) => {
  /* 한 문구로 뭉개면 고장을 정상으로 읽는다. */
  const markupOf = await issueScreens(t);
  assert.match(markupOf("번호 점검 · 이상 없음"), /깨진 번호가 없습니다/);

  const failed = markupOf("번호 점검 · 조회 실패");
  assert.match(failed, /불러오지 못했습니다/);
  assert.match(failed, /코드 permission-denied/);
  assert.doesNotMatch(failed, /깨진 번호가 없습니다/);
});

/* ── 심사용 회원 ─────────────────────────────────────────────────────────

   스토어 심사관이 로그인해서 볼 가짜 회원이다. 한 군데라도 새면 가짜가 진짜
   숫자에 섞이고, 그 숫자로 강사 급여가 나간다. */

test("the review demo member shows only to the owner, with a badge", async (t) => {
  /* 대표는 그 회원이 거기 있다는 것을 알아야 한다. 안 보이면 왜 숫자가
     안 맞는지 물을 곳이 없다. */
  const markupOf = await issueScreens(t);
  const owner = markupOf("회원 관리 · 심사용 · 대표");
  assert.match(owner, /심사용 회원/);
  assert.match(owner, />심사용</, "배지가 없다");
});

test("nobody else sees the review demo member at all", async (t) => {
  const markupOf = await issueScreens(t);
  const manager = markupOf("회원 관리 · 심사용 · FC매니저");
  assert.doesNotMatch(manager, /심사용 회원/);
  // 실제 회원은 그대로 보인다 -- 목록이 통째로 사라진 것이 아니다.
  assert.match(manager, /김하나/);
});

test("the location chip does not count the review demo member", async (t) => {
  /* 보이는 문제가 아니라 세는 문제다. 대표에게도 뺀다. */
  const markupOf = await issueScreens(t);
  const owner = markupOf("회원 관리 · 심사용 · 대표");
  const manager = markupOf("회원 관리 · 심사용 · FC매니저");
  const counts = (markup) => (markup.match(/반송점[^<]*<\/span><span[^>]*>(\d+)/) || [])[1];
  assert.equal(counts(owner), counts(manager), "대표 화면의 인원수가 다르다");
});
