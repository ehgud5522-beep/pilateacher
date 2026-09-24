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

/* ── 더보기 — 달력과 빈도 ────────────────────────────────────────────

   이정표는 걷어냈다. 10·30·50·100 이라는 사다리에는 끝이 있었고, 100회를
   넘긴 회원은 다 채운 화면을 보게 됐다 -- 가장 오래 온 사람에게 "끝났다" 고
   말하는 화면이었다. 회원이 알고 싶은 것은 누적이 아니라 요즘 얼마나
   나오고 있는가였다. */

test("달력이 나온 날을 표시한다", async (t) => {
  const markupOf = await memberScreens(t);
  const more = markupOf("더보기");
  assert.match(more, /2026년 9월/);
  // 나온 날은 로즈로 도드라진다.
  assert.equal((more.match(/class="day on"/g) || []).length, 7, "9월 24일은 오늘이라 따로 센다");
  assert.match(more, /class="day on today"/);
});

test("이번 달과 지난달을 나란히 말한다", async (t) => {
  const markupOf = await memberScreens(t);
  const more = markupOf("더보기");
  assert.match(more, /8<span>번<\/span>/);
  assert.match(more, /지난달 7번/);
});

test("꾸준하면 몇 주째인지 말한다", async (t) => {
  /* 8월 첫 주부터 이번 주까지 한 주도 거르지 않았다. 그 숫자가 커지는 것을
     보는 것이 이 탭의 보상이다. */
  const markupOf = await memberScreens(t);
  assert.match(markupOf("더보기"), /8주째 쉬지 않고 나오고 있어요/);
});

test("뜸해지면 며칠 지났는지 말하고, 다시 할 일을 준다", async (t) => {
  /* 끊긴 주 수를 0 으로 보여주지 않는다. 혼내면 앱을 안 열고, 할 일을
     말해야 온다. */
  const markupOf = await memberScreens(t);
  const fading = markupOf("더보기 · 뜸해짐");
  assert.match(fading, /마지막 수업에서 18일 지났어요/);
  assert.match(fading, /이번 주에 한 번 나오면 다시 이어져요/);
  assert.doesNotMatch(fading, /0주/);
  assert.doesNotMatch(fading, /주째 쉬지 않고/);
});

test("달마다 몇 번인지 여섯 달치를 그린다", async (t) => {
  /* 빈도가 줄고 있으면 여기서 먼저 보인다. 사람은 "지난달보다 줄었다" 를
     문장보다 모양으로 먼저 안다. */
  const markupOf = await memberScreens(t);
  const fading = markupOf("더보기 · 뜸해짐");
  assert.match(fading, /최근 여섯 달/);
  for (const label of ["4월", "5월", "6월", "7월", "8월", "9월"]) {
    assert.match(fading, new RegExp(`>${label}<`), `${label} 막대가 없다`);
  }
});

test("아직 수업이 없어도 달력은 서고, 없는 숫자를 지어내지 않는다", async (t) => {
  const markupOf = await memberScreens(t);
  const first = markupOf("더보기 · 첫 회원");
  assert.match(first, /2026년 9월/);
  assert.doesNotMatch(first, /class="day on"/);
  // 누적이 없으면 그 줄 자체가 없다.
  assert.doesNotMatch(first, /함께했어요/);
  assert.doesNotMatch(first, /주째|지났어요/);
});

test("기록이 없는 달과 안 나온 달을 구분해 말한다", async (t) => {
  /* 빈 달력을 말없이 그리면 회원은 그때 안 나온 것으로 읽는다. */
  const markupOf = await memberScreens(t);
  assert.match(markupOf("더보기 · 기록 끝"), /이 앱에 남은 기록은 여기까지예요/);
  // 상한에 닿지 않은 회원에게는 그 말을 하지 않는다.
  assert.doesNotMatch(markupOf("더보기"), /남은 기록은 여기까지/);
});

test("앱 이전 기록은 날짜가 없어 한 줄로만 남는다", async (t) => {
  const markupOf = await memberScreens(t);
  assert.match(markupOf("더보기"), /지금까지 <b class="num">26번<\/b> 함께했어요/);
  /* 홈에서는 뺐다. 같은 숫자가 두 번 나오면 홈의 주인공이 흐려진다 --
     홈은 남은 횟수가 주인공이어야 한다. */
  assert.doesNotMatch(markupOf("홈"), /함께했어요/);
});

test("재등록을 권하지 않는다", async (t) => {
  /* 판매는 센터가 한다. 앱이 파는 자리가 되면 회원이 열어 보는 이유가
     달라진다. */
  const markupOf = await memberScreens(t);
  for (const name of ["더보기", "더보기 · 뜸해짐"]) {
    for (const forbidden of ["재등록", "연장", "구매", "결제", "할인"]) {
      assert.doesNotMatch(markupOf(name), new RegExp(forbidden), `${forbidden} 가 ${name} 에 있다`);
    }
  }
});

/* ── 그 계산들 ───────────────────────────────────────────────────────

   그림으로만 확인하면 달 경계·주 경계·빈 이력 같은 자리를 케이스로 일일이
   그려야 하고, 그래도 빠진다. */

test("수업한 날만 센다", async (t) => {
  const markupOf = await memberScreens(t);
  const { attendedDates } = markupOf.screens;
  const rows = [
    { occurredAt: new Date(2026, 8, 18, 19, 30), type: "deduct" },
    { occurredAt: new Date(2026, 8, 10, 7, 0), type: "deduct" },
    // 발급·취소·담당 변경은 수업이 아니다.
    { occurredAt: new Date(2026, 8, 20), type: "issue" },
    { occurredAt: new Date(2026, 8, 21), type: "transfer" },
    { occurredAt: null, type: "deduct" },
  ];
  const dates = attendedDates(rows);
  assert.equal(dates.length, 2);
  // 오래된 것이 앞이고, 시각은 떨어져 자정이다.
  assert.equal(dates[0].getDate(), 10);
  assert.equal(dates[0].getHours(), 0);
  assert.equal(dates[1].getDate(), 18);
});

test("달력 칸은 앞의 빈 칸까지 만든다", async (t) => {
  const markupOf = await memberScreens(t);
  const { monthCells } = markupOf.screens;
  // 2026년 9월 1일은 화요일이라 앞에 빈 칸이 둘이다.
  const cells = monthCells(2026, 8, [new Date(2026, 8, 3)], new Date(2026, 8, 24));
  assert.equal(cells.length, 2 + 30);
  assert.equal(cells.filter((cell) => cell.blank).length, 2);
  assert.equal(cells.find((cell) => cell.day === 3).attended, true);
  assert.equal(cells.find((cell) => cell.day === 4).attended, false);
  assert.equal(cells.find((cell) => cell.day === 24).today, true);
});

test("2월도, 윤달도 칸 수가 맞는다", async (t) => {
  const markupOf = await memberScreens(t);
  const { monthCells } = markupOf.screens;
  const days = (year, month) => monthCells(year, month, [], new Date(year, month, 1))
    .filter((cell) => !cell.blank).length;
  assert.equal(days(2026, 1), 28);
  assert.equal(days(2028, 1), 29, "2028년은 윤년이다");
  assert.equal(days(2026, 11), 31);
});

test("몇 주째인지 센다", async (t) => {
  const markupOf = await memberScreens(t);
  const { weekStreak } = markupOf.screens;
  const now = new Date(2026, 8, 24);
  const at = (day) => new Date(2026, 8, day);

  // 9월 24일은 목요일. 그 주(20~26)·앞의 세 주에 하나씩 있다.
  assert.equal(weekStreak([at(2), at(9), at(15), at(22)], now), 4);
  /* 이번 주가 비어 있어도 지난주까지로 센다 -- 수요일에 열어 본 사람에게
     "0주" 라고 말할 이유가 없다. */
  assert.equal(weekStreak([at(2), at(9), at(15)], now), 3);
  // 중간이 비면 거기서 끊긴다.
  assert.equal(weekStreak([at(2), at(15), at(22)], now), 2);
  // 지난주도 비었으면 0 이고, 화면은 며칠 지났는지를 대신 말한다.
  assert.equal(weekStreak([at(2), at(6)], now), 0);
  assert.equal(weekStreak([], now), 0);
});

test("마지막 수업으로부터 며칠인지 센다", async (t) => {
  const markupOf = await memberScreens(t);
  const { daysSinceLast } = markupOf.screens;
  const now = new Date(2026, 8, 24, 21, 0);
  assert.equal(daysSinceLast([new Date(2026, 8, 6)], now), 18);
  // 오늘 수업했으면 0 이다. 시각이 섞여도 같은 날은 같은 날이다.
  assert.equal(daysSinceLast([new Date(2026, 8, 24, 7, 0)], now), 0);
  assert.equal(daysSinceLast([], now), null);
});

test("2주가 지나야 쉬었다고 말한다", async (t) => {
  /* 그 아래는 그냥 이 사람의 주기일 수 있다. 일주일에 한 번 오는 회원에게
     8일 만에 "쉬고 있다" 고 하면 틀린 말이다. */
  const markupOf = await memberScreens(t);
  const { AWAY_DAYS, rhythmNote } = markupOf.screens;
  const now = new Date(2026, 8, 24);
  assert.equal(AWAY_DAYS, 14);

  const weekly = [3, 10, 17].map((day) => new Date(2026, 8, day));
  assert.equal(rhythmNote(weekly, now).tone, "steady");

  const away = [new Date(2026, 8, 6)];
  const said = rhythmNote(away, now);
  assert.equal(said.tone, "away");
  assert.match(said.line, /18일/);
  assert.match(said.hint, /다시 이어져요/);

  // 수업이 한 번도 없으면 아무 말도 하지 않는다.
  assert.equal(rhythmNote([], now).tone, "none");
});

test("달마다 세는 것은 그 달 것만 센다", async (t) => {
  const markupOf = await memberScreens(t);
  const { countInMonth, monthlyCounts } = markupOf.screens;
  const dates = [
    new Date(2026, 7, 31), new Date(2026, 8, 1), new Date(2026, 8, 30), new Date(2026, 9, 1),
  ];
  assert.equal(countInMonth(dates, 2026, 8), 2, "달 경계가 샜다");

  const rows = monthlyCounts(dates, new Date(2026, 8, 24));
  assert.equal(rows.length, 6);
  // 오래된 것이 앞이고 마지막이 이번 달이다.
  assert.deepEqual(rows.map((row) => row.label), ["4월", "5월", "6월", "7월", "8월", "9월"]);
  assert.equal(rows[5].count, 2);
  assert.equal(rows[4].count, 1);
});

test("해를 넘어가도 달 이름이 맞는다", async (t) => {
  const markupOf = await memberScreens(t);
  const { monthlyCounts } = markupOf.screens;
  const rows = monthlyCounts([], new Date(2027, 1, 10));
  assert.deepEqual(rows.map((row) => row.label), ["9월", "10월", "11월", "12월", "1월", "2월"]);
  assert.equal(rows[0].year, 2026);
  assert.equal(rows[5].year, 2027);
});

test("투영이 싣고 오는 상한과 같은 값을 쓴다", async (t) => {
  /* 어긋나면 달력이 "기록 없음" 을 말해야 할 자리에서 조용히 빈 달을
     그린다 -- 안 나온 것과 기록이 없는 것은 다르다. */
  const markupOf = await memberScreens(t);
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { HISTORY_LIMIT } = require("../../functions/src/member-view-triggers.js");
  assert.equal(markupOf.screens.HISTORY_KEPT, HISTORY_LIMIT);
});

/* ── 의견 보내기 ─────────────────────────────────────────────────────── */

test("더보기는 제목 대신 회원을 부른다", async (t) => {
  const markupOf = await memberScreens(t);
  // 탭이 이미 어느 화면인지 말한다. 제목을 한 번 더 적지 않는다.
  assert.doesNotMatch(markupOf("더보기"), /class="title serif">더보기</);
});

test("의견 보내기는 오픈채팅을 새 창으로 연다", async (t) => {
  const markupOf = await memberScreens(t);
  const more = markupOf("더보기");
  assert.match(more, /href="https:\/\/open\.kakao\.com\/o\/sBfqlBTh"/);
  assert.match(more, /target="_blank"/);
  /* rel 이 없으면 새 창이 window.opener 로 이 앱을 건드릴 수 있다. 잔여
     횟수를 보여 주는 화면이라 더더욱 끊어 둔다. */
  assert.match(more, /rel="noopener noreferrer"/);
});

test("링크에 회원 정보를 붙이지 않는다", async (t) => {
  /* 익명으로 보낼 수 있다고 적어 두고 주소로 누구인지 흘리면 그것은
     거짓말이다. 주소는 상수 하나이고 물음표 뒤가 없다. */
  const markupOf = await memberScreens(t);
  const href = markupOf("더보기").match(/href="(https:\/\/open\.kakao\.com[^"]*)"/)?.[1];
  assert.equal(href, "https://open.kakao.com/o/sBfqlBTh");
  assert.doesNotMatch(String(href), /[?#]/);
});

test("익명으로 보낼 수 있다고 적는다", async (t) => {
  const markupOf = await memberScreens(t);
  const more = markupOf("더보기");
  assert.match(more, /칭찬도 건의도 좋고/);
  assert.match(more, /익명으로도 보낼 수 있어요/);
});

test("의견 보내기는 더보기에만 있고 입력 폼을 만들지 않는다", async (t) => {
  /* 앱 안에 폼을 두면 저장할 곳·읽을 사람·지울 규칙이 따라오고, 그 셋이
     정해지기 전에 회원의 글부터 쌓인다. 링크 하나로 끝낸 이유다. */
  const markupOf = await memberScreens(t);
  for (const name of ["홈", "회원권", "수업 이력"]) {
    assert.doesNotMatch(markupOf(name), /의견 보내기/, name);
  }
  const more = markupOf("더보기");
  assert.doesNotMatch(more, /<textarea/);
  assert.doesNotMatch(more, /<form/);
});

test("수업이 없어도 의견은 보낼 수 있다", async (t) => {
  /* 아직 수업이 없는 회원이 할 말이 없는 것은 아니다. */
  const markupOf = await memberScreens(t);
  assert.match(markupOf("더보기 · 첫 회원"), /의견 보내기/);
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
