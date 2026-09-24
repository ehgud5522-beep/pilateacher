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
  /* 화면이 쓰는 순수 계산들. 그림으로만 확인하면 126회·0회 같은 자리를
     케이스로 일일이 그려야 하고, 그래도 경계는 빠진다. */
  markupOf.screens = await vite.ssrLoadModule("/member/src/screens.jsx");
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
  assert.match(passes, /22회 중 <b>8회<\/b> 남았어요/);
  // 계약할 때 들은 이름이 먼저다.
  assert.match(passes, /1:1 퍼스널 20회/);
});

test("이름이 없는 회원권은 회차로 부른다", async (t) => {
  /* 상품 문서가 지워졌거나 아주 옛 회원권이다. 빈 칸을 두면 회원은 무슨
     회원권인지 알 수 없다. */
  const markupOf = await memberScreens(t);
  const duet = markupOf("회원권 · 듀엣");
  assert.match(duet, /30회 듀엣 회원권/);
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

test("강사가 보낸 말은 그 수업 줄에 붙는다", async (t) => {
  const markupOf = await memberScreens(t);
  const said = markupOf("수업 이력 · 강사의 말");
  assert.match(said, /어깨 내리는 게 한결 편해 보이셨어요/);
  assert.match(said, /벽 스트레칭/);
});

test("말이 없는 수업은 빈 자리를 그리지 않는다", async (t) => {
  /* "메시지 없음" 을 그리면 빈 줄이 기록처럼 쌓이고, 회원은 강사가 무언가
     빠뜨렸다고 읽는다. 없으면 줄 자체가 없어야 한다. */
  const markupOf = await memberScreens(t);
  const said = markupOf("수업 이력 · 강사의 말");
  assert.equal((said.match(/class="note"/g) || []).length, 1);
  assert.doesNotMatch(said, /메시지 없음|남긴 말 없음/);
});

test("강사 혼자 보는 기록은 회원 화면에 오지 않는다", async (t) => {
  /* 투영이 이미 막지만 화면도 확인한다. 이 두 칸이 섞이는 순간 강사가 쓰는
     방식이 바뀌어야 한다 -- 그때는 이 앱이 기록을 망가뜨린 것이다. */
  const markupOf = await memberScreens(t);
  const all = markupOf("전부");
  for (const forbidden of ["코어근육", "수업기록", "lessonRecord", "rawTranscript"]) {
    assert.doesNotMatch(all, new RegExp(forbidden), `${forbidden} 가 회원 화면에 있다`);
  }
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

test("다음 이정표는 언제나 하나 있다", async (t) => {
  /* 이 함수가 null 을 돌려주는 순간이 곧 결승선이다. 어떤 숫자에도 다음이
     있어야 한다. */
  const markupOf = await memberScreens(t);
  const { lastMilestone, nextMilestone } = markupOf.screens;

  const rows = [
    [0, 0, 10], [9, 0, 10], [10, 10, 30], [26, 10, 30], [30, 30, 50],
    [50, 50, 100], [99, 50, 100], [100, 100, 150], [126, 100, 150],
    [150, 150, 200], [999, 950, 1000], [1000, 1000, 1050],
  ];
  for (const [used, past, next] of rows) {
    assert.equal(lastMilestone(used), past, `lastMilestone(${used})`);
    assert.equal(nextMilestone(used), next, `nextMilestone(${used})`);
    assert.ok(next > used, `${used} 에 다음이 없다`);
  }
});

test("지나온 하나와 앞으로 넷을 그린다", async (t) => {
  const markupOf = await memberScreens(t);
  const { milestoneTrail } = markupOf.screens;

  assert.deepEqual(milestoneTrail(26).map((mark) => mark.at), [10, 30, 50, 100, 150]);
  // 아직 하나도 지나지 않았으면 과거 자리를 비운다 -- 0회 구슬을 그리지 않는다.
  assert.deepEqual(milestoneTrail(3).map((mark) => mark.at), [10, 30, 50, 100]);
  assert.deepEqual(milestoneTrail(126).map((mark) => mark.at), [100, 150, 200, 250, 300]);
  // 바로 다음 하나에만 soon 이 붙는다.
  assert.deepEqual(milestoneTrail(26).map((mark) => mark.soon), [false, true, false, false, false]);
  assert.deepEqual(milestoneTrail(26).map((mark) => mark.done), [true, false, false, false, false]);
});

test("모자란 만큼만 말한다", async (t) => {
  const markupOf = await memberScreens(t);
  const { shortfallNote } = markupOf.screens;

  assert.equal(shortfallNote(4, 2), "지금 회원권으로는 2번 하실 수 있어요");
  assert.equal(shortfallNote(4, 0), "지금은 남은 횟수가 없어요");
  assert.equal(shortfallNote(10, 3), "지금 회원권으로는 3번 하실 수 있어요");
  // 딱 맞거나 넉넉하면 아무 말도 하지 않는다.
  assert.equal(shortfallNote(4, 4), "");
  assert.equal(shortfallNote(4, 8), "");
  assert.equal(shortfallNote(0, 0), "");
  /* 다음이 아직 멀면 말하지 않는다. 24번 남은 사람에게 "8번 하실 수 있어요"
     는 정보가 아니라 잔소리다. */
  assert.equal(shortfallNote(11, 3), "");
  assert.equal(shortfallNote(24, 8), "");
  assert.equal(shortfallNote(24, 0), "");
});

test("이정표는 끝나지 않는다", async (t) => {
  /* 100회를 넘긴 회원의 화면이 비면 안 된다. 예전에는 구슬 넷이 전부 채워지고
     "다음" 줄이 사라졌다 -- 가장 오래 온 사람에게 "끝났다" 고 말하는 화면이었다. */
  const markupOf = await memberScreens(t);
  const far = markupOf("여정 · 100회 넘음");
  assert.match(far, /126/);
  assert.match(far, /150회까지 24번 남았어요/);
  // 다음이 아직 머니 회원권 이야기는 꺼내지 않는다.
  assert.doesNotMatch(far, /하실 수 있어요/);
  // 다음 이정표들이 계속 그려진다.
  for (const mark of ["150회", "200회", "250회"]) {
    assert.match(far, new RegExp(mark), `${mark} 가 없다`);
  }
});

test("지나온 이정표는 하나만 남긴다", async (t) => {
  /* 전부 남기면 줄이 과거로 길어지고 다음이 화면 밖으로 밀린다. 회원이 봐야
     하는 것은 지나온 자리가 아니라 다음이다. */
  const markupOf = await memberScreens(t);
  const far = markupOf("여정 · 100회 넘음");
  for (const past of ["10회", "30회", "50회"]) {
    assert.doesNotMatch(far, new RegExp(`>${past}<`), `${past} 가 아직 줄에 있다`);
  }
  assert.match(far, />100회</);
});

test("회원권이 모자랄 때만 그 사실을 곁들인다", async (t) => {
  /* 파는 말은 하지 않는다 -- 판매는 센터가 한다. 두 사실을 나란히 놓을 뿐이고
     셈은 회원이 한다. */
  const markupOf = await memberScreens(t);

  const tight = markupOf("여정 · 회원권 모자람");
  assert.match(tight, /30회까지 4번 남았어요/);
  assert.match(tight, /지금 회원권으로는 2번 하실 수 있어요/);
  for (const forbidden of ["재등록", "연장", "구매", "결제", "할인"]) {
    assert.doesNotMatch(tight, new RegExp(forbidden), `${forbidden} 가 여정에 있다`);
  }

  // 넉넉하면 적지 않는다. 매번 적으면 그것이 파는 말이 된다.
  assert.doesNotMatch(markupOf("여정"), /하실 수 있어요/);
});

test("잔여 0 은 다른 말을 한다", async (t) => {
  /* "0번 하실 수 있어요" 는 읽는 사람에게 아무것도 말해 주지 않는다. */
  const markupOf = await memberScreens(t);
  const none = markupOf("여정 · 잔여 0");
  assert.match(none, /지금은 남은 횟수가 없어요/);
  assert.doesNotMatch(none, /0번 하실 수 있어요/);
});

/* ── 의견 보내기 ─────────────────────────────────────────────────────── */

test("여정은 제목 대신 회원을 부른다", async (t) => {
  const markupOf = await memberScreens(t);
  const journey = markupOf("여정");
  assert.match(journey, /김하나 님/);
  // 탭이 이미 어느 화면인지 말한다. 제목을 한 번 더 적지 않는다.
  assert.doesNotMatch(journey, /class="title serif">여정</);
});

test("이름이 없으면 그 자리를 비운다", async (t) => {
  /* "회원님" 같은 것을 채우지 않는다. 투영에 이름이 없다는 것은 무언가
     잘못됐다는 뜻이고, 지어낸 말로 덮으면 아무도 모른다. */
  const markupOf = await memberScreens(t);
  const nameless = markupOf("여정 · 이름 없음");
  assert.doesNotMatch(nameless, /님/);
  // 이름이 없어도 의견 보내기는 그대로 있다.
  assert.match(nameless, /의견 보내기/);
});

test("의견 보내기는 오픈채팅을 새 창으로 연다", async (t) => {
  const markupOf = await memberScreens(t);
  const journey = markupOf("여정");
  assert.match(journey, /href="https:\/\/open\.kakao\.com\/o\/sBfqlBTh"/);
  assert.match(journey, /target="_blank"/);
  /* rel 이 없으면 새 창이 window.opener 로 이 앱을 건드릴 수 있다. 잔여
     횟수를 보여 주는 화면이라 더더욱 끊어 둔다. */
  assert.match(journey, /rel="noopener noreferrer"/);
});

test("링크에 회원 정보를 붙이지 않는다", async (t) => {
  /* 익명으로 보낼 수 있다고 적어 두고 주소로 누구인지 흘리면 그것은
     거짓말이다. 주소는 상수 하나이고 물음표 뒤가 없다. */
  const markupOf = await memberScreens(t);
  const journey = markupOf("여정");
  const href = journey.match(/href="(https:\/\/open\.kakao\.com[^"]*)"/)?.[1];
  assert.equal(href, "https://open.kakao.com/o/sBfqlBTh");
  assert.doesNotMatch(String(href), /[?#]/);
});

test("익명으로 보낼 수 있다고 적는다", async (t) => {
  const markupOf = await memberScreens(t);
  const journey = markupOf("여정");
  assert.match(journey, /칭찬·건의 모두 좋아요/);
  assert.match(journey, /익명으로도 보낼 수 있어요/);
});

test("의견 보내기는 여정에만 있고 입력 폼을 만들지 않는다", async (t) => {
  /* 앱 안에 폼을 두면 저장할 곳·읽을 사람·지울 규칙이 따라오고, 그 셋이
     정해지기 전에 회원의 글부터 쌓인다. 링크 하나로 끝낸 이유다. */
  const markupOf = await memberScreens(t);
  for (const name of ["홈", "회원권", "수업 이력"]) {
    assert.doesNotMatch(markupOf(name), /의견 보내기/, name);
  }
  const journey = markupOf("여정");
  assert.doesNotMatch(journey, /<textarea/);
  assert.doesNotMatch(journey, /<form/);
});

test("여정이 비어 있어도 의견은 보낼 수 있다", async (t) => {
  /* 아직 수업이 없는 회원이 할 말이 없는 것은 아니다. */
  const markupOf = await memberScreens(t);
  assert.match(markupOf("여정 · 없음"), /의견 보내기/);
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
