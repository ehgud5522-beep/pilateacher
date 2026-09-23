import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 회원이 실제로 보게 되는 화면들. 상태마다 다른 말을 하는지가 전부다.
 *
 * "불러오는 중" 과 "못 읽었어요" 와 "아직 수업이 없어요" 는 회원이 할 일이
 * 서로 다르다. 한 문구로 뭉개면 정상 상태를 고장으로, 고장을 정상으로 읽는다.
 *
 * 케이스는 tests/member/cases.jsx 에 있다 -- node --test 가 JSX 를 모르므로
 * vite 가 읽어 준다. 강사 앱 스모크와 같은 방식이다.
 */

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

const memberScreens = async (t) => {
  const vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [react()],
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    logLevel: "silent",
  });
  t.after(() => vite.close());
  const { memberScreenCases } = await vite.ssrLoadModule("/tests/member/cases.jsx");
  const cases = memberScreenCases();
  const byName = new Map(cases.map((item) => [item.name, item.element]));
  const markupOf = (name) => {
    const element = byName.get(name);
    assert.ok(element, `케이스가 없다: ${name}`);
    return renderToStaticMarkup(element);
  };
  markupOf.names = cases.map((item) => item.name);
  return markupOf;
};

test("모든 화면이 ReferenceError 없이 그려진다", async (t) => {
  const markupOf = await memberScreens(t);
  assert.ok(markupOf.names.length >= 20, "케이스가 너무 적다");
  for (const name of markupOf.names) {
    assert.ok(markupOf(name).length > 0, name);
  }
});

/* ── 홈 ──────────────────────────────────────────────────────────────── */

test("홈은 남은 횟수를 가장 크게 말한다", async (t) => {
  const markupOf = await memberScreens(t);
  const home = markupOf("홈");
  assert.match(home, /8/);
  assert.match(home, /남은 횟수/);
  assert.match(home, /김하나님/);
  assert.match(home, /반송점/);
  assert.match(home, /2027\. 1\. 31\.까지/);
});

test("임박은 말하되 재등록을 권하지 않는다", async (t) => {
  /* 판매는 센터가 한다. 앱이 파는 자리가 되면 회원이 열어 보는 이유가 달라진다. */
  const markupOf = await memberScreens(t);
  const soon = markupOf("홈 · 만료 임박");
  assert.match(soon, /만료까지 7일 남았어요/);
  for (const forbidden of ["재등록", "연장", "구매", "결제", "할인"]) {
    assert.doesNotMatch(soon, new RegExp(forbidden), `${forbidden} 가 홈에 있다`);
  }
});

test("잔여 0 과 종료 회원은 서로 다른 말을 한다", async (t) => {
  const markupOf = await memberScreens(t);
  assert.match(markupOf("홈 · 잔여 0"), /남은 횟수가 없어요/);
  const ended = markupOf("홈 · 종료 회원");
  assert.match(ended, /이용이 종료된/);
  assert.match(ended, /지난 기록은 그대로/);
});

/* ── 회원권 ──────────────────────────────────────────────────────────── */

test("회원권은 서비스 회차를 합쳐 총 회차로 보여준다", async (t) => {
  const markupOf = await memberScreens(t);
  const passes = markupOf("회원권");
  // 20 + 서비스 2 = 22회. 서비스도 회원이 쓰는 회차다.
  assert.match(passes, /22회 회원권/);
  assert.match(passes, /22회 중 <b>8회<\/b> 남았어요/);
});

test("내부 표현을 화면에 쓰지 않는다", async (t) => {
  /* "2차" 는 우리가 세는 방식이고 회원은 그렇게 세지 않는다. 분수도 쓰지
     않는다 -- "8/22회" 는 읽는 사람에게 남은 것을 말해 주지 않는다. */
  const markupOf = await memberScreens(t);
  const passes = markupOf("회원권");
  assert.match(passes, /2번째 회원권/);
  assert.doesNotMatch(passes, /2차/);
  assert.doesNotMatch(passes, /\d+\/\d+회/);
});

test("듀엣은 함께 쓴다는 것을 반드시 적는다", async (t) => {
  /* 각자 30회로 오해하면 계약 자체가 틀어진다. */
  const markupOf = await memberScreens(t);
  const duet = markupOf("회원권 · 듀엣");
  assert.match(duet, /김민정님과 함께 쓰는 회원권/);
  assert.match(duet, /수업 한 번에 1회 차감/);
});

test("회원권이 없으면 빈 상태를 그대로 보여준다", async (t) => {
  /* 예시 회원권을 그려 두면 회원은 그것을 자기 것으로 읽는다. */
  const markupOf = await memberScreens(t);
  const empty = markupOf("회원권 · 없음");
  assert.match(empty, /쓸 수 있는 회원권이 없어요/);
  assert.doesNotMatch(empty, /회권/);
});

/* ── 수업 이력 ───────────────────────────────────────────────────────── */

test("이력은 날짜와 강사 이름만 보여준다", async (t) => {
  const markupOf = await memberScreens(t);
  const history = markupOf("수업 이력");
  assert.match(history, /9월 18일/);
  // 2026-09-18 은 금요일이다. 요일을 날짜에서 계산하는지까지 본다.
  assert.match(history, /금/);
  assert.match(history, /정예진/);
});

test("되돌린 차감은 숨기지 않는다", async (t) => {
  /* 잘못 차감했다 되돌린 사실은 회원의 것이다. 숨기면 회차가 늘어난 이유를
     아무도 설명하지 못한다. */
  const markupOf = await memberScreens(t);
  assert.match(markupOf("수업 이력 · 되돌린 차감"), /차감 취소/);
});

test("아직 수업이 없으면 기다린다고 말한다", async (t) => {
  const markupOf = await memberScreens(t);
  const empty = markupOf("수업 이력 · 없음");
  assert.match(empty, /첫 수업을/);
  assert.match(empty, /기다리고 있어요/);
  // 빈 상태에 일러스트나 예시를 그리지 않는다. 여백이 문구를 받친다.
  assert.doesNotMatch(empty, /<img/);
});

/* ── 여정 ────────────────────────────────────────────────────────────── */

test("여정은 앱 이전 기록도 함께 센다", async (t) => {
  const markupOf = await memberScreens(t);
  const journey = markupOf("여정");
  assert.match(journey, /26/);
  assert.match(journey, /앱 이전 기록/);
  assert.match(journey, /12회 중 12회/);
  assert.match(journey, /2번째 회원권/);
});

test("여정은 다음 이정표까지 몇 번 남았는지 말한다", async (t) => {
  const markupOf = await memberScreens(t);
  const journey = markupOf("여정");
  // 26번이면 30회가 다음이다. 함께한 횟수를 세는 것이지 재등록을 권하는 것이 아니다.
  assert.match(journey, /30회까지 4번 남았어요/);
  for (const forbidden of ["재등록", "연장", "구매", "결제"]) {
    assert.doesNotMatch(journey, new RegExp(forbidden), `${forbidden} 가 여정에 있다`);
  }
});

test("여정이 없으면 빈 줄을 그리지 않는다", async (t) => {
  const markupOf = await memberScreens(t);
  const empty = markupOf("여정 · 없음");
  assert.match(empty, /쌓이면 보여 드릴게요/);
  assert.doesNotMatch(empty, /번 함께했어요/);
});

/* ── 상태 넷 ─────────────────────────────────────────────────────────── */

test("불러오는 중 · 실패 · 준비 중 · 준비 안 된 지점이 서로 다른 말을 한다", async (t) => {
  const markupOf = await memberScreens(t);

  assert.match(markupOf("불러오는 중"), /잠시만요/);

  /* 코드를 함께 보여준다. 코드 없는 "오류가 발생했습니다" 는 회원도 센터도
     아무것도 할 수 없게 만든다. */
  const failed = markupOf("조회 실패");
  assert.match(failed, /불러오지 못했어요/);
  assert.match(failed, /코드 permission-denied/);

  /* 연결 직후 트리거가 도는 몇 초다. "조회 실패" 로 말하면 정상 상태를
     고장으로 말하는 것이 된다. */
  const preparing = markupOf("준비 중");
  assert.match(preparing, /준비하고 있어요/);
  assert.doesNotMatch(preparing, /못했어요/);

  const notMigrated = markupOf("이관 안 된 지점");
  assert.match(notMigrated, /준비 중이에요/);
  assert.match(notMigrated, /센터에 문의/);
});

test("연결 안내는 결과마다 다른 문구를 그린다", async (t) => {
  const markupOf = await memberScreens(t);

  const ambiguous = markupOf("연결 안내 · 확인 필요");
  assert.match(ambiguous, /확인이 필요해요/);
  // 다시 눌러도 같은 답이 나오는 곳에는 버튼을 두지 않는다.
  assert.doesNotMatch(ambiguous, /다시 시도/);

  assert.match(markupOf("연결 안내 · 번호 없음"), /등록된 번호를 찾지 못했어요/);
  assert.match(markupOf("연결 안내 · 이미 연결됨"), /가족/);

  const unknown = markupOf("연결 안내 · 모르는 코드");
  assert.match(unknown, /코드 weird/);
  assert.match(unknown, /다시 시도/);
});

/* ── 금액은 어디에도 없다 ────────────────────────────────────────────── */

test("회원 화면 어디에도 금액이 없다", async (t) => {
  /* 확정 3번. 회원이 낸 돈이지만 할인·양도가 섞이면 계약서와 달라 보이고,
     문의만 는다. 투영에 애초에 담기지 않지만 화면도 다시 확인한다. */
  const markupOf = await memberScreens(t);
  const all = markupOf("전부");
  /* 낱말 "원" 하나로 세지 않는다 -- "회원권" 에 들어 있다. 돈으로 읽히는
     모양만 본다: ₩ · 숫자 뒤의 원 · 천 단위 쉼표. */
  assert.doesNotMatch(all, /₩/, "₩ 가 회원 화면에 있다");
  assert.doesNotMatch(all, /\d\s*원/, "금액이 회원 화면에 있다");
  assert.doesNotMatch(all, /\d,\d{3}/, "천 단위 금액이 회원 화면에 있다");
  for (const forbidden of ["단가", "부원장", "급여", "결제", "카드", "현금"]) {
    assert.doesNotMatch(all, new RegExp(forbidden), `${forbidden} 가 회원 화면에 있다`);
  }
});
