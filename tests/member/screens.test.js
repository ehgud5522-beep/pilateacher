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

test("홈은 달력 → 그날 수업 → 남은 횟수 → 최근 수업 기록 순서다", async (t) => {
  const markupOf = await memberScreens(t);
  const home = markupOf("홈");
  const order = ["2026년 9월", "오늘 수업", "내 회원권", "최근 수업 기록"].map((word) => home.indexOf(word));
  assert.ok(order.every((at) => at >= 0), `빠진 칸: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "순서가 다르다");
  assert.match(home, /김하나님/);
});

test("달력은 오늘과 수업 있는 날을 다르게 그린다", async (t) => {
  const markupOf = await memberScreens(t);
  const home = markupOf("홈");
  // 24일(오늘)은 수업도 있었다.
  assert.match(home, /class="day on today picked"[^>]*><b>24<\/b><i><\/i>/);
  assert.match(home, /aria-label="9월 22일 · 수업 있음"/);
  assert.match(home, /aria-label="9월 23일"/);
  assert.match(home, /이번 달 8번/);
});

test("오늘 수업 카드는 시각 · 수업 이름 · 강사 · 지점이고, 그룹 표기는 없다", async (t) => {
  const markupOf = await memberScreens(t);
  const home = markupOf("홈");
  assert.match(home, /class="time num">10:00</);
  assert.match(home, /<b>1:1 필라테스 수업<\/b>/);
  assert.match(home, /<i>정예진 강사<\/i><i>반송점<\/i>/);
  assert.doesNotMatch(home, /그룹/);
});

test("오늘 받은 수업이 없으면 예정이 없다고 하지 않는다", async (t) => {
  /* 예정 수업은 아직 회원 데이터에 없다 -- 없다고 말하면 모르는 것을 단정한다. */
  const markupOf = await memberScreens(t);
  const quiet = markupOf("홈 · 오늘 수업 없음");
  assert.match(quiet, /오늘 받은 수업은 끝나면 여기에 보여요/);
  assert.doesNotMatch(quiet, /예정된 수업이 없/);
});

test("남은 횟수는 '남은 N회 · 서비스 M회', 서비스가 0 이면 뒤를 뺀다", async (t) => {
  const markupOf = await memberScreens(t);
  // 갓 받은 20 + 서비스 2 회원권: 정규 20 · 서비스 2.
  assert.match(markupOf("홈 · 새 회원권"), /남은 20회 · 서비스 2회/);
  /* 22회 중 14회를 썼다 -- 서비스가 먼저 쓰이므로 남은 서비스는 없다
     (remainingSplit, 강사 앱과 같은 계산). 0 이면 칩에서 뺀다. */
  const used = markupOf("홈");
  assert.match(used, /class="chip on num">남은 8회</);
  assert.doesNotMatch(used, /남은 8회 · 서비스/);
});

test("최근 수업 기록은 두 건, 한마디가 있는 것만 말풍선", async (t) => {
  const markupOf = await memberScreens(t);
  const home = markupOf("홈");
  const recent = home.slice(home.indexOf("최근 수업 기록"));
  assert.equal((recent.match(/<li>/g) || []).length, 2);
  assert.match(recent, /class="note">오늘도 자세가 좋아졌어요/);
  assert.match(recent, /더보기 ›/);
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

test("아직 수업이 없으면 기다린다고 말한다", async (t) => {
  const markupOf = await memberScreens(t);
  assert.match(markupOf("홈 · 첫 회원"), /첫 수업을 기다리고 있어요/);
  assert.match(markupOf("홈 · 첫 회원"), /이번 달 0번/);
});

test("기록이 없는 달과 안 나온 달을 구분해 말한다", async (t) => {
  const markupOf = await memberScreens(t);
  assert.match(markupOf("홈 · 기록 끝"), /이 앱에 남은 기록은 여기까지예요/);
  assert.doesNotMatch(markupOf("홈"), /여기까지예요/);
});

test("진행 링은 없다 — 남은 횟수 칩이 대신한다", async (t) => {
  const markupOf = await memberScreens(t);
  assert.doesNotMatch(markupOf("홈"), /class="ring"/);
});

/* ── 수업기록 ────────────────────────────────────────────────────────── */

test("수업기록은 수업 이름과 강사, 한마디가 있는 수업만 말풍선", async (t) => {
  const markupOf = await memberScreens(t);
  const records = markupOf("수업기록");
  assert.match(records, /지금까지 <b>26번<\/b> 함께했어요/);
  assert.match(records, /1:1 필라테스 수업 · 정예진 강사/);
  assert.equal((records.match(/class="note"/g) || []).length, 2, "한마디는 두 건뿐이다");
  // 말이 없는 수업에 빈 자리를 그리지 않는다.
  assert.doesNotMatch(records, /메시지 없음|class="note"><\/p>/);
});

test("되돌린 차감은 숨기지 않는다", async (t) => {
  const markupOf = await memberScreens(t);
  assert.match(markupOf("수업기록 · 되돌린 차감"), /차감 취소/);
});

test("수업기록이 없으면 기다린다고 말한다", async (t) => {
  const markupOf = await memberScreens(t);
  assert.match(markupOf("수업기록 · 없음"), /첫 수업을/);
});

test("강사 혼자 보는 기록은 회원 화면에 오지 않는다", async (t) => {
  /* 투영에 notes 가 없지만, 화면도 memberNote 하나만 그린다. */
  const markupOf = await memberScreens(t);
  const all = markupOf("전부");
  for (const forbidden of ["수업기록 원문", "코어근육이 많이 약해짐"]) {
    assert.doesNotMatch(all, new RegExp(forbidden));
  }
});

/* ── 마이페이지 ──────────────────────────────────────────────────────── */

test("마이페이지는 회원권(사용 중 · 지난)과 로그아웃", async (t) => {
  const markupOf = await memberScreens(t);
  const me = markupOf("마이페이지");
  assert.match(me, /사용 중/);
  assert.match(me, /1:1 필라테스 수업 20회/);
  assert.match(me, /서비스 2회/);
  assert.match(me, /<b>8회<\/b> 남았어요/);
  assert.match(me, />로그아웃</);
});

test("듀엣은 함께 쓴다는 것을 반드시 적는다", async (t) => {
  /* 각자 30회로 오해하면 계약 자체가 틀어진다. */
  const markupOf = await memberScreens(t);
  const duet = markupOf("마이페이지 · 듀엣");
  assert.match(duet, /2:1 필라테스 수업 30회/);
  assert.match(duet, /김민정님과 함께 쓰는 회원권/);
  assert.match(duet, /수업 한 번에 1회 차감/);
  assert.doesNotMatch(duet, /서비스 \d+회/);
});

test("회원권이 없으면 빈 상태를 그대로 보여준다", async (t) => {
  const markupOf = await memberScreens(t);
  assert.match(markupOf("마이페이지 · 회원권 없음"), /쓸 수 있는 회원권이 없어요/);
});

test("관리용 값은 어느 회원 화면에도 없다", async (t) => {
  /* 차수 · 상품명 · 세션업 · 급여카테고리 · 단가는 FC · 강사 · 대표 화면에서만
     쓴다. "2차" 같은 우리 셈법도, 분수 표기도 쓰지 않는다. */
  const markupOf = await memberScreens(t);
  const all = markupOf.names.map((name) => markupOf(name)).join("\n");
  for (const hidden of [/번째 회원권/, /첫 회원권/, /\d차\b/, /퍼스널/, /세션업/, /신규|재등록/, /\d+\/\d+회/, /깍두기|양도권|세일즈/]) {
    assert.doesNotMatch(all, hidden, String(hidden));
  }
});

test("투영이 싣고 오는 상한과 같은 값을 쓴다", async (t) => {
  const markupOf = await memberScreens(t);
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { HISTORY_LIMIT } = require("../../functions/src/member-view-triggers.js");
  assert.equal(markupOf.screens.HISTORY_KEPT, HISTORY_LIMIT);
});

/* ── 의견 보내기 ─────────────────────────────────────────────────────── */

test("의견 보내기는 오픈채팅을 새 창으로 열고, 링크에 회원 정보를 붙이지 않는다", async (t) => {
  const markupOf = await memberScreens(t);
  const me = markupOf("마이페이지");
  const href = me.match(/href="(https:\/\/open\.kakao\.com[^"]*)"/)?.[1];
  assert.equal(href, "https://open.kakao.com/o/sBfqlBTh");
  assert.match(me, /target="_blank"/);
  /* rel 이 없으면 새 창이 window.opener 로 이 앱을 건드릴 수 있다. */
  assert.match(me, /rel="noopener noreferrer"/);
  assert.match(me, /익명으로도 보낼 수 있어요/);
});

test("의견 보내기는 마이페이지에만 있고 입력 폼을 만들지 않는다", async (t) => {
  const markupOf = await memberScreens(t);
  for (const name of ["홈", "수업기록"]) {
    assert.doesNotMatch(markupOf(name), /의견 보내기/, name);
  }
  const me = markupOf("마이페이지");
  assert.doesNotMatch(me, /<textarea/);
  assert.doesNotMatch(me, /<form/);
  // 회원권이 없어도 보낼 수 있다.
  assert.match(markupOf("마이페이지 · 회원권 없음"), /의견 보내기/);
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
  /* 확정 3번. 투영에 애초에 담기지 않지만 화면도 다시 확인한다. */
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

/* ── 계정 삭제 ───────────────────────────────────────────────────────── */

test("계정 삭제는 마이페이지 맨 아래에만 있다", async (t) => {
  /* 홈이나 수업기록에 두면 지나가다 누른다. */
  const markupOf = await memberScreens(t);
  const me = markupOf("마이페이지 · 계정 삭제 있음");
  const signOut = me.indexOf(">로그아웃<");
  assert.ok(signOut >= 0 && me.indexOf("계정 삭제") > signOut, "로그아웃보다 아래다");
  // 넘겨주지 않으면 아예 그리지 않는다 -- 오프라인 사본을 보는 중이 그렇다.
  assert.doesNotMatch(markupOf("마이페이지"), /계정 삭제/);
  for (const name of ["홈", "수업기록"]) assert.doesNotMatch(markupOf(name), /계정 삭제/, name);
});

test("첫 화면에서는 지우는 버튼이 안 나온다", async (t) => {
  const markupOf = await memberScreens(t);
  const first = markupOf("계정 삭제 · 첫 화면");
  assert.doesNotMatch(first, /네, 지울게요/);
  assert.match(first, /센터에 등록된 회원 정보와 남은 회원권은 그대로/);
});

test("계정 삭제 요청 URL — 로그인 없이 방법과 지워지는 것 · 남는 것을 말한다", async (t) => {
  const markupOf = await memberScreens(t);
  const guide = markupOf("계정 삭제 안내 (스토어 URL)");
  // 스토어는 앱 이름이 페이지에 보이기를 요구한다.
  assert.match(guide, /보니따필라테스 계정 삭제/);
  assert.match(guide, /마이페이지/);
  const { DELETED_ITEMS, KEPT_ITEMS } = await import("../../member/src/delete-account.js");
  for (const item of [...DELETED_ITEMS, ...KEPT_ITEMS]) assert.ok(guide.includes(item), item);
  assert.doesNotMatch(guide, /김하나|010-|uid/);
});

/* ── 멈췄을 때 보는 화면 ─────────────────────────────────────────────── */

test("늦을 때 무엇을 하라고 말한다", async (t) => {
  const markupOf = await memberScreens(t);
  const slow = markupOf("연결이 늦다");
  assert.match(slow, /연결이 늦어요/);
  assert.match(slow, /10초째/);
  assert.match(slow, /다시 시도/);
  assert.match(slow, /다섯 번/);
});

test("진단은 회원 정보를 그리지 않는다", async (t) => {
  const markupOf = await memberScreens(t);
  const diag = markupOf("진단 · 기록 있음");
  assert.match(diag, /auth_init \/ auth_state_timeout/);
  assert.match(diag, /firebase_auth:auth_state_never_fired/);
  assert.match(diag, /5be3511/);
  assert.match(diag, /이름·번호는 들어 있지 않아요/);
});

test("기록이 없으면 없다고 말한다", async (t) => {
  const markupOf = await memberScreens(t);
  assert.match(markupOf("진단 · 비어 있음"), /기록이 없습니다/);
});

/* ── 달력 계산 ───────────────────────────────────────────────────────── */

test("수업한 날만 센다 · 같은 날 두 번은 한 칸", async (t) => {
  const markupOf = await memberScreens(t);
  const { attendedDates, countInMonth } = markupOf.screens;
  const dates = attendedDates([
    { occurredAt: new Date(2026, 8, 2, 9), type: "deduct" },
    { occurredAt: new Date(2026, 8, 2, 19), type: "deduct" },
    { occurredAt: new Date(2026, 8, 3), type: "correction" },
    { occurredAt: new Date(2026, 8, 4), type: "transfer" },
  ]);
  assert.equal(dates.length, 2);
  assert.equal(countInMonth(dates, 2026, 8), 2);
});

test("달력 칸은 앞의 빈 칸까지 만들고, 2월 · 윤년도 맞는다", async (t) => {
  const markupOf = await memberScreens(t);
  const { monthCells } = markupOf.screens;
  // 2026-09-01 은 화요일 -- 앞에 빈 칸 둘.
  const sep = monthCells(2026, 8, [], new Date(2026, 8, 24));
  assert.equal(sep.filter((cell) => cell.blank).length, 2);
  assert.equal(sep.filter((cell) => !cell.blank).length, 30);
  assert.equal(monthCells(2027, 1, []).filter((cell) => !cell.blank).length, 28);
  assert.equal(monthCells(2028, 1, []).filter((cell) => !cell.blank).length, 29);
});

test("그날 수업은 이른 시각부터, 시각을 모르는 옛 기록은 시각을 지어내지 않는다", async (t) => {
  const markupOf = await memberScreens(t);
  const { lessonsOn, timeLabel } = markupOf.screens;
  const day = new Date(2026, 8, 24);
  const rows = lessonsOn([
    { occurredAt: new Date(2026, 8, 24, 19, 0), type: "deduct" },
    { occurredAt: new Date(2026, 8, 24, 9, 30), type: "deduct" },
    { occurredAt: new Date(2026, 8, 23, 9, 0), type: "deduct" },
    { occurredAt: new Date(2026, 8, 24, 8, 0), type: "correction" },
  ], day);
  assert.deepEqual(rows.map((row) => timeLabel(row.occurredAt)), ["09:30", "19:00"]);
  assert.equal(timeLabel(new Date(2026, 8, 24)), "");
});

test("남은 횟수 칩은 쓸 수 있는 회원권 전부를 더한다", async (t) => {
  const markupOf = await memberScreens(t);
  const { remainingChip } = markupOf.screens;
  const NOW = new Date(2026, 8, 24);
  const active = (extra) => ({ status: "active", expiresAt: new Date(2027, 0, 1), ...extra });
  assert.equal(remainingChip([
    active({ totalSessions: 10, serviceSessions: 2, remainingCount: 12 }),
    active({ totalSessions: 20, serviceSessions: 0, remainingCount: 15 }),
    active({ totalSessions: 10, serviceSessions: 0, remainingCount: 0 }),
  ], NOW), "남은 25회 · 서비스 2회");
  assert.equal(remainingChip([], NOW), "남은 0회");
});

/* ── 서버 계산부터 화면까지 (2026-10-30 병합 전 확인) ─────────────────────

   투영(functions/src/member-view.js)이 만든 문서를 그대로 세 화면에 넣는다.
   한쪽만 시험하면 "서버는 막았는데 화면이 다른 칸을 읽는" 틈이 남는다. */

async function screensFromProjection(t, input) {
  const markupOf = await memberScreens(t);
  const { createRequire } = await import("node:module");
  const { createElement } = await import("react");
  const require = createRequire(import.meta.url);
  const { buildMemberView } = require("../../functions/src/member-view.js");
  const view = buildMemberView({ now: new Date(2026, 9, 30, 12), ...input });
  const { Home, Records, MyPage } = markupOf.screens;
  const render = (Screen, props = {}) => renderToStaticMarkup(createElement(Screen, {
    view, now: new Date(2026, 9, 30, 12), ...props,
  }));
  return {
    view,
    home: render(Home, { onOpenRecords: () => {} }),
    records: render(Records),
    mypage: render(MyPage, { onSignOut: () => {}, onDeleteAccount: async () => {} }),
  };
}

const EVENT_MEMBER = {
  client: { id: "client-a", organizationId: "center-a", userId: "uid-1", name: "김하나", status: "active" },
  locationName: "반송점",
  passes: [
    /* 이관분: 상품명이 productId 에 그대로 들어 있다. */
    { id: "p-kkak", clientId: "client-a", productId: "1:1 깍두기 이벤트 10회", category: "pt_1_1_repurchase_event",
      purchaseRound: 3, totalSessions: 10, serviceSessions: 2, remainingCount: 12, status: "active",
      expiresAt: new Date(2027, 0, 31) },
    /* 상품 문서에 이벤트명이 있는 회원권. */
    { id: "p-trans", clientId: "client-a", productId: "prod-transfer", category: "pt_2_1_new",
      purchaseRound: 1, totalSessions: 20, serviceSessions: 0, remainingCount: 0, status: "active",
      expiresAt: new Date(2026, 5, 1) },
  ],
  productNames: { "prod-transfer": "2:1 양도권 세일즈 특가" },
  productSessionTypes: { "prod-transfer": "pt_2_1" },
  ledger: [
    { passId: "p-kkak", lessonId: "lesson-1", type: "deduct", occurredAt: new Date(2026, 9, 30, 10, 0),
      instructorId: "u1", lessonRecord: "코어근육이 많이 약해짐 · 요추 통증", notes: "강사 내부 메모" },
    { passId: "p-trans", lessonId: "lesson-0", type: "deduct", occurredAt: new Date(2026, 4, 20, 19, 0), instructorId: "u1" },
  ],
  memberNotes: { "lesson-1": "오늘 자세가 한결 편해 보이셨어요." },
  instructorNames: { u1: "정예진" },
};

test("한마디는 '회원에게 보낼 말'(memberNote)에서만 온다 — 내부 기록은 어디에도 없다", async (t) => {
  const { view, home, records } = await screensFromProjection(t, EVENT_MEMBER);
  for (const markup of [home, records]) {
    assert.match(markup, /오늘 자세가 한결 편해 보이셨어요/);
    assert.doesNotMatch(markup, /코어근육|요추 통증|강사 내부 메모/);
  }
  // 투영 문서 자체에도 없다 -- 화면이 실수로 다른 칸을 읽을 재료가 없다.
  assert.doesNotMatch(JSON.stringify(view), /코어근육|요추 통증|강사 내부 메모|lessonRecord|"notes"/);
  // 한마디가 없는 수업에는 말풍선이 없다.
  assert.equal((records.match(/class="note"/g) || []).length, 1);
});

test("이벤트 회원권(깍두기 · 양도권) 계정 — 홈 · 수업기록 · 마이페이지에 이벤트명이 없다", async (t) => {
  const { view, home, records, mypage } = await screensFromProjection(t, EVENT_MEMBER);
  for (const [name, markup] of [["홈", home], ["수업기록", records], ["마이페이지", mypage]]) {
    for (const hidden of [/깍두기/, /양도권/, /세일즈/, /이벤트/, /특가/, /\d차\b/, /번째 회원권/]) {
      assert.doesNotMatch(markup, hidden, `${name} 에 ${hidden}`);
    }
  }
  // 이름은 규칙대로 지어진다.
  assert.match(mypage, /1:1 필라테스 수업 10회/);
  assert.match(mypage, /2:1 필라테스 수업 20회/);
  assert.match(records, /1:1 필라테스 수업 · 정예진 강사/);
  assert.match(home, /<b>1:1 필라테스 수업<\/b>/);
  // 투영 문서에도 없다.
  assert.doesNotMatch(JSON.stringify(view), /깍두기|양도권|세일즈|특가|purchaseRound|displayName/);
});
