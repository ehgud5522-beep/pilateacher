import assert from "node:assert/strict";
import test from "node:test";
import {
  NEXT_DEDUCT, isUsablePass, isoDay, memberUnitPrice, passCard, passCardList,
  passListSummary, passSummary, remainingSplit,
} from "../../src/features/membership/pass-cards.js";

const NOW = new Date(2026, 9, 1);

const pass = (overrides = {}) => ({
  id: "pass-a", productId: "1:1 PT 50회", category: "pt_1_1_repurchase_event",
  totalSessions: 50, serviceSessions: 0, remainingCount: 11,
  contractPrice: 3181800, status: "active",
  expiresAt: new Date(2026, 11, 18), createdAt: new Date(2026, 0, 22),
  ...overrides,
});

/* ── 정규 · 서비스 ────────────────────────────────────────────────────────
   화면이 쓰던 regular/service 는 기기의 레거시 칸이고 roster-bridge 가 0 으로
   누른다. 그래서 잔여 194 옆에 "정규 0 · 서비스 0" 이 섰다. */

test("서비스를 먼저 쓴 것으로 세고, 세 숫자만으로 정해진다", () => {
  /* serviceUsed 를 읽지 않는다 -- 회원 투영에 그 칸이 없고, 한쪽만 다른 식으로
     세면 같은 회원권이 두 화면에서 다른 숫자가 된다. */
  assert.deepEqual(remainingSplit({ totalSessions: 20, serviceSessions: 2, remainingCount: 22 }),
    { regular: 20, service: 2 }, "한 번도 안 썼다");
  assert.deepEqual(remainingSplit({ totalSessions: 20, serviceSessions: 2, remainingCount: 21 }),
    { regular: 20, service: 1 }, "서비스부터 빠진다");
  assert.deepEqual(remainingSplit({ totalSessions: 20, serviceSessions: 2, remainingCount: 20 }),
    { regular: 20, service: 0 }, "서비스를 다 썼다");
  assert.deepEqual(remainingSplit({ totalSessions: 20, serviceSessions: 2, remainingCount: 8 }),
    { regular: 8, service: 0 }, "그다음은 정규만 줄어든다");
});

test("정규와 서비스를 더하면 언제나 잔여가 된다", () => {
  /* 이 둘이 잔여와 안 맞는 것이 지금 화면의 증상이다. 어떤 입력에서도 맞아야
     한다 -- 이관분은 총 횟수와 잔여가 따로 적혀 와서 서로 어긋난 행이 있다. */
  const cases = [
    { totalSessions: 100, serviceSessions: 0, remainingCount: 13 },
    { totalSessions: 50, serviceSessions: 5, remainingCount: 52 },
    { totalSessions: 0, serviceSessions: 0, remainingCount: 0 },
    { totalSessions: 10, serviceSessions: 3, remainingCount: 99 },
    { totalSessions: 10, serviceSessions: 30, remainingCount: 5 },
  ];
  for (const item of cases) {
    const split = remainingSplit(item);
    assert.equal(split.regular + split.service, item.remainingCount, JSON.stringify(item));
    assert.ok(split.regular >= 0 && split.service >= 0, JSON.stringify(item));
  }
});

/* ── 사용 중 / 끝남 ──────────────────────────────────────────────────── */

test("잔여 0 · 만료 · 취소는 끝난 것이고, 사유를 따로 말한다", () => {
  assert.equal(isUsablePass(pass(), NOW), true);
  assert.equal(passCard(pass({ remainingCount: 0 }), { now: NOW }).endedReason, "모두 사용");
  assert.equal(passCard(pass({ expiresAt: new Date(2026, 8, 1) }), { now: NOW }).endedReason, "기간 만료");
  assert.equal(passCard(pass({ status: "cancelled" }), { now: NOW }).endedReason, "취소됨");
  // 재등록 상담이 다르다 -- 다 쓴 사람과 기간이 지난 사람은 할 말이 같지 않다.
  assert.equal(passCard(pass(), { now: NOW }).endedReason, "");
});

test("만료일이 없는 회원권은 만료로 보지 않는다", () => {
  assert.equal(isUsablePass(pass({ expiresAt: null }), NOW), true);
});

/* ── 카드 한 장 ──────────────────────────────────────────────────────── */

test("상품명과 급여카테고리는 서로 다른 칸이다", () => {
  const card = passCard(pass(), { now: NOW });
  assert.equal(card.name, "1:1 PT 50회");
  assert.equal(card.categoryLabel, "1:1 재등록(이벤트)");
});

test("급여카테고리가 없으면 그 줄을 비워 둔다 -- 회원에게는 가지 않는 칸이다", () => {
  const card = passCard({ passId: "p1", displayName: "20회 회원권", remainingCount: 5, totalSessions: 20 });
  assert.equal(card.categoryLabel, "");
  assert.equal(card.name, "20회 회원권", "회원 투영은 displayName 을 쓴다");
  assert.equal(card.unitPrice, 0, "계약 금액이 없으면 금액을 지어내지 않는다");
});

test("회당 금액은 정규 유료 횟수로만 나눈다", () => {
  // 공짜로 받은 회차까지 나누면 회원이 실제로 낸 단가보다 낮게 나온다.
  assert.equal(memberUnitPrice({ contractPrice: 1000000, totalSessions: 20, serviceSessions: 5 }), 50000);
  assert.equal(memberUnitPrice({ contractPrice: 0, totalSessions: 20 }), 0);
});

test("듀엣은 두 가지 모양 모두에서 읽힌다", () => {
  assert.equal(passCard({ clientIds: ["a", "b"] }).isDuet, true, "강사 앱의 passes 문서");
  assert.equal(passCard({ isDuet: true, partnerName: "김민정" }).isDuet, true, "회원 투영");
  assert.equal(passCard({ clientIds: ["a"] }).isDuet, false);
});

/* ── 목록과 순서 ─────────────────────────────────────────────────────── */

const FOUR = [
  pass({ id: "solo-50", productId: "1:1 PT 50회", remainingCount: 11, totalSessions: 50, expiresAt: new Date(2026, 11, 18) }),
  pass({ id: "solo-100", productId: "1:1 PT 100회", remainingCount: 100, totalSessions: 100, expiresAt: new Date(2027, 11, 31) }),
  pass({ id: "duet-100", productId: "2:1 PT 33->100", category: "pt_2_1_new", clientIds: ["a", "b"], remainingCount: 13, totalSessions: 100, expiresAt: new Date(2026, 10, 9) }),
  pass({ id: "duet-70", productId: "2:1 PT 70회", category: "pt_2_1_new", clientIds: ["a", "b"], remainingCount: 70, totalSessions: 70, expiresAt: new Date(2027, 8, 30) }),
];

test("사용 중은 만료가 가까운 순으로 선다", () => {
  const { active } = passCardList({ passes: FOUR, now: NOW });
  assert.deepEqual(active.map((card) => card.passId), ["duet-100", "solo-50", "duet-70", "solo-100"]);
});

test("끝난 것은 최근에 끝난 것부터 -- 삼 년 전 것이 맨 위에 설 이유가 없다", () => {
  const ended = [
    pass({ id: "old", remainingCount: 0, expiresAt: new Date(2024, 0, 1) }),
    pass({ id: "recent", remainingCount: 0, expiresAt: new Date(2026, 7, 1) }),
  ];
  const list = passCardList({ passes: ended, now: NOW });
  assert.deepEqual(list.active, []);
  assert.deepEqual(list.ended.map((card) => card.passId), ["recent", "old"]);
});

test("다음 차감은 받아서 표시만 한다 -- 여기서 다시 고르지 않는다", () => {
  /* 한 줄이라도 다르게 고르면 화면이 가리키는 회원권과 실제로 빠지는 회원권이
     갈라지고, 그때는 되돌릴 수도 없다. */
  const { active } = passCardList({
    passes: FOUR, now: NOW, nextSoloPassId: "solo-50", nextDuetPassId: "duet-100",
  });
  const marked = Object.fromEntries(active.map((card) => [card.passId, card.nextDeduct]));
  assert.equal(marked["solo-50"], NEXT_DEDUCT.SOLO);
  assert.equal(marked["duet-100"], NEXT_DEDUCT.DUET);
  assert.equal(marked["solo-100"], NEXT_DEDUCT.NONE);
  assert.equal(marked["duet-70"], NEXT_DEDUCT.NONE);
});

test("고른 것이 없으면 아무 카드도 표시되지 않는다", () => {
  const { active } = passCardList({ passes: FOUR, now: NOW });
  assert.equal(active.every((card) => card.nextDeduct === NEXT_DEDUCT.NONE), true);
});

/* ── 요약 줄 ─────────────────────────────────────────────────────────── */

test("요약은 종류별로만 말한다 -- 한 숫자로 합치지 않는다", () => {
  /* 1:1 과 2:1 은 다른 수업에서 쓰이므로 더해도 쓸 데가 없다. 합치는 순간
     지금 지우려는 바로 그 화면이 된다. */
  const { summary } = passCardList({ passes: FOUR, now: NOW });
  assert.equal(summary, "사용 중 4장 · 1:1 111회 · 2:1 83회");
});

test("끝난 회원권은 요약에 들어가지 않는다", () => {
  const { summary } = passCardList({
    passes: [...FOUR, pass({ id: "spent", remainingCount: 0 })], now: NOW,
  });
  assert.equal(summary, "사용 중 4장 · 1:1 111회 · 2:1 83회");
});

test("한 종류만 있으면 그 종류만 적는다", () => {
  assert.equal(passSummary([passCard(pass(), { now: NOW })]), "사용 중 1장 · 1:1 11회");
  assert.equal(passCardList({ passes: [], now: NOW }).summary, "사용 중인 회원권 없음");
  assert.equal(passCardList({ passes: [pass({ remainingCount: 0 })], now: NOW }).summary,
    "사용 중인 회원권 없음");
});

/* ── 날짜 ─────────────────────────────────────────────────────────────── */

test("표시용 날짜 문자열을 함께 내보낸다 -- Date 를 화면에 넘기면 죽는다", () => {
  /* 배포 563 이 여기서 터졌다. 화면의 ymd() 는 문자열을 받아 slice 하는데
     Date 에는 slice 가 없어 회원 상세가 통째로 에러 화면이 됐다. */
  const card = passCard(pass({ expiresAt: new Date(2026, 10, 9) }), { now: NOW });
  assert.equal(card.expiresOn, "2026-11-09");
  assert.equal(typeof card.expiresOn, "string", "화면이 쓰는 값은 문자열이어야 한다");
  assert.ok(card.expiresAt instanceof Date, "판정이 쓰는 값은 Date 그대로다");
});

test("읽지 못하는 날짜는 빈 문자열이다 -- 지어내지 않는다", () => {
  for (const bad of [null, undefined, "", "어제", {}]) {
    assert.equal(isoDay(bad), "", JSON.stringify(bad));
  }
  assert.equal(passCard(pass({ expiresAt: null }), { now: NOW }).expiresOn, "");
});

/* ── 목록 카드 요약 ───────────────────────────────────────────────────── */

test("목록 요약도 종류별이고, 가장 빠른 만료는 몇 회가 끝나는지 함께 말한다", () => {
  /* 날짜만 적으면 합계 전부가 그날 끝나는 것으로 읽힌다 -- 고치려던 오해다. */
  const { active, ended } = passCardList({ passes: FOUR, now: NOW });
  const summary = passListSummary([...active, ...ended]);
  assert.deepEqual(summary, {
    count: 4, solo: 111, duet: 83,
    soonestOn: "2026-11-09", soonestRemaining: 13,
  });
});

test("끝난 회원권만 있으면 목록 요약이 없다", () => {
  const { active, ended } = passCardList({ passes: [pass({ remainingCount: 0 })], now: NOW });
  assert.equal(passListSummary([...active, ...ended]), null);
  assert.equal(passListSummary([]), null);
});

test("만료일 없는 회원권은 가장 빠른 만료로 서지 않는다", () => {
  const summary = passListSummary(passCardList({
    passes: [pass({ id: "no-date", expiresAt: null }), pass({ id: "dated", expiresAt: new Date(2027, 0, 1) })],
    now: NOW,
  }).active);
  assert.equal(summary.soonestOn, "2027-01-01");
  assert.equal(summary.count, 2);
});
