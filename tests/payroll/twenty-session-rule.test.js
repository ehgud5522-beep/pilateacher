import assert from "node:assert/strict";
import test from "node:test";

import {
  NEW_TO_INSTRUCTOR_THRESHOLD, NEW_TO_INSTRUCTOR_UNIT_PRICE, PRICING_RULE,
  SENIOR_TITLE_EVENT_UNIT_PRICE, newToInstructorUnitPrice, resolveDeductionUnitPrice,
} from "../../functions/shared/deduction-pricing.mjs";
import { PAY_CATEGORY } from "../../src/data/schema/constants.js";
import { PAY_RATES } from "../../functions/shared/pay-rates.mjs";

/**
 * 20회 규칙 — **대표 확정본 (2026-10-13).**
 *
 * 이 파일은 한 회원권을 **처음부터 끝까지 걸어 본다.** 판정 하나씩을 보는
 * 것은 deduction-pricing.test.js 가 하고, 여기는 "회원권 한 장이 실제로
 * 이렇게 나가는가" 를 본다 -- 전환점 하나가 어긋나면 그 회원권 전체가
 * 틀리는데, 판정별 테스트로는 그 경계가 보이지 않는다.
 *
 * ── 확정된 것 ──
 *   1:1   1~20번째 25,000 → 21번째부터 카테고리 단가
 *         재등록(이벤트): 일반 30,000 / 점장·팀장 31,000
 *   2:1   1~20번째 2:1 신규 단가 → 21번째부터 카테고리 단가
 *         재등록(이벤트): 32,000 고정
 *   디오사 20회 규칙 없음. 1회차부터 고정
 *   서비스 누적에 세지 않는다 (그 증명은 pass-repository 쪽 테스트에 있다)
 *   인수인계 이 강사와의 누적으로 판단한다 -- 영영 신규 단가가 아니다
 */

/** 누적 n 회인 상태에서 한 회차의 단가. */
const rateAt = (priorSessions, overrides = {}) => resolveDeductionUnitPrice({
  category: PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT,
  baseUnitPrice: 30000,
  priorSessions,
  serviceUsedCount: 0,
  ...overrides,
});

/** 누적 `from` 부터 `count` 회를 연달아 한다. 회원권 한 장을 걷는 것이다. */
const walk = (from, count, overrides = {}) => Array.from(
  { length: count },
  (_, index) => rateAt(from + index, overrides),
);

const pricesOf = (results) => results.map((item) => item.unitPrice);
const rulesOf = (results) => [...new Set(results.map((item) => item.rule))];

/* ── 1:1 ─────────────────────────────────────────────────────────────────── */

test("신규 10회를 한 회원이 재등록(이벤트) 30회를 끊으면 11~20번째가 신규 단가다", () => {
  /* 대표 확정본의 예시다. 신규 회원권 10회를 이미 한 회원이 30회를 재등록
     했다 -- 누적은 10 에서 시작한다.

     11~20번째(누적 10~19)는 아직 스무 번을 못 채웠으므로 25,000 이고,
     21번째(누적 20)부터 이벤트 단가 30,000 이다. */
  const found = walk(10, 30);

  assert.deepEqual(pricesOf(found.slice(0, 10)), Array(10).fill(25000), "11~20번째");
  assert.deepEqual(pricesOf(found.slice(10)), Array(20).fill(30000), "21~40번째");
  assert.deepEqual(rulesOf(found.slice(0, 10)), [PRICING_RULE.NEW_TO_INSTRUCTOR]);
  assert.deepEqual(rulesOf(found.slice(10)), [PRICING_RULE.BASE_CATEGORY]);
});

test("전환점은 스무 번째와 스물한 번째 사이 한 곳뿐이다", () => {
  /* 경계를 한 칸 틀리면 회원권마다 한 회차씩 어긋나고, 원장은 append-only 라
     고칠 수 없다. */
  assert.equal(rateAt(NEW_TO_INSTRUCTOR_THRESHOLD - 1).unitPrice, NEW_TO_INSTRUCTOR_UNIT_PRICE);
  assert.equal(rateAt(NEW_TO_INSTRUCTOR_THRESHOLD).unitPrice, 30000);
});

test("인계받은 회원권도 이 강사와의 누적으로 판단한다", () => {
  /* 이 강사와 누적 5회인 회원을 넘겨받았다. 15회를 더 하면 스무 번을
     채우고, 그 다음부터 카테고리 단가다.

     전에는 인수인계가 판정을 가로채 **영영** 25,000 이었다 (2026-10-13 폐지). */
  const found = walk(5, 16, { handedOver: true });

  assert.deepEqual(pricesOf(found.slice(0, 15)), Array(15).fill(25000), "6~20번째");
  assert.equal(found[15].unitPrice, 30000, "21번째");
  assert.equal(found[15].rule, PRICING_RULE.BASE_CATEGORY);
  assert.equal(rulesOf(found).includes(PRICING_RULE.HANDED_OVER), false);
});

test("점장·팀장도 스무 번째까지는 신규 단가이고, 31,000 은 그 뒤다", () => {
  /* 직급 수당이 20회 판정보다 앞에 있던 때가 있다 -- 그때는 1회차부터
     31,000 이었다. 2026-10-13 에 뒤로 옮겼다. */
  for (const title of ["branch_manager", "team_lead"]) {
    const found = walk(0, 21, { title });
    assert.deepEqual(pricesOf(found.slice(0, 20)), Array(20).fill(25000), `${title} 1~20번째`);
    assert.equal(found[20].unitPrice, SENIOR_TITLE_EVENT_UNIT_PRICE, `${title} 21번째`);
    assert.equal(found[20].rule, PRICING_RULE.SENIOR_TITLE_EVENT, title);
  }

  // 같은 자리의 일반 강사는 30,000 이다. 그 1,000원이 직급에 붙는 금액이다.
  assert.equal(rateAt(20, { title: "instructor" }).unitPrice, 30000);
});

/* ── 2:1 ─────────────────────────────────────────────────────────────────── */

test("2:1 재등록(이벤트)는 스무 번째까지 2:1 신규 단가, 그 뒤 32,000 이다", () => {
  /* 2:1 은 수업 한 번에 두 사람을 가르친다. 처음 스무 회차를 1:1 값으로
     주면 같은 노동이 한 사람 값으로 나간다.

     전에는 디오사와 같은 자리에 서서 1회차부터 32,000 이었다 (2026-10-13
     에 20회 판정 뒤로 옮겼다). */
  const duet = { category: PAY_CATEGORY.PT_2_1_REPURCHASE_EVENT, baseUnitPrice: 32000 };
  const found = walk(0, 21, duet);

  assert.deepEqual(
    pricesOf(found.slice(0, 20)),
    Array(20).fill(PAY_RATES[PAY_CATEGORY.PT_2_1_NEW]),
    "1~20번째는 2:1 신규 단가",
  );
  assert.deepEqual(rulesOf(found.slice(0, 20)), [PRICING_RULE.NEW_TO_INSTRUCTOR]);
  assert.equal(found[20].unitPrice, 32000, "21번째");
  assert.equal(found[20].rule, PRICING_RULE.DUET_EVENT_FIXED);
});

test("2:1 신규 단가는 표에서 온다 — 1:1 값을 베끼지 않는다", () => {
  /* 두 값이 지금 다르고(25,000 / 30,000), 표가 움직이면 2:1 쪽만 따라가야
     한다. 상수 하나로 묶으면 그날 2:1 이 1:1 값으로 나간다. */
  assert.equal(newToInstructorUnitPrice(PAY_CATEGORY.PT_1_1_NEW), NEW_TO_INSTRUCTOR_UNIT_PRICE);
  assert.equal(newToInstructorUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT), NEW_TO_INSTRUCTOR_UNIT_PRICE);
  for (const category of [
    PAY_CATEGORY.PT_2_1_NEW, PAY_CATEGORY.PT_2_1_REPURCHASE, PAY_CATEGORY.PT_2_1_REPURCHASE_EVENT,
  ]) {
    assert.equal(newToInstructorUnitPrice(category), PAY_RATES[PAY_CATEGORY.PT_2_1_NEW], category);
  }
  assert.notEqual(
    newToInstructorUnitPrice(PAY_CATEGORY.PT_2_1_NEW),
    newToInstructorUnitPrice(PAY_CATEGORY.PT_1_1_NEW),
    "둘이 같아지면 이 테스트가 아무것도 지키지 않는다",
  );
});

test("every 2:1 category is recognised as 2:1 under the threshold", () => {
  /* ── 2026-10-16 에 대표가 본 것 ──────────────────────────────────────
     "2:1 재등록" 이 20회 미만에서 25,000 으로 찍혔다. 그것은 **옛 규칙**이다
     ("누적 20회 미만이면 카테고리와 무관하게 25,000") -- 새 규칙이 아직
     배포되지 않은 폰과 웹이 그 값을 쓰고 있었다.

     세 카테고리를 한 줄씩 못 박는다. 하나라도 2:1 로 안 읽히면 그 상품의
     처음 스무 회차가 1:1 값으로 나가고, 수업 한 번에 두 사람을 가르치는데
     금액은 한 사람 값이 된다. */
  const duetRate = PAY_RATES[PAY_CATEGORY.PT_2_1_NEW];
  for (const [category, base] of [
    [PAY_CATEGORY.PT_2_1_NEW, 30000],
    [PAY_CATEGORY.PT_2_1_REPURCHASE, 35000],
    [PAY_CATEGORY.PT_2_1_REPURCHASE_EVENT, 32000],
  ]) {
    const early = rateAt(19, { category, baseUnitPrice: base });
    assert.equal(early.unitPrice, duetRate, `${category} 20회차`);
    assert.equal(early.rule, PRICING_RULE.NEW_TO_INSTRUCTOR, category);
    assert.notEqual(early.unitPrice, NEW_TO_INSTRUCTOR_UNIT_PRICE, `${category} 가 1:1 값으로 샜다`);
  }
});

test("each 2:1 category lands on its own rate once the threshold passes", () => {
  /* 스물한 번째부터는 셋이 갈린다. 하나로 뭉치면 재등록(35,000)과
     이벤트(32,000)의 3,000원 차이가 사라진다. */
  assert.equal(rateAt(20, { category: PAY_CATEGORY.PT_2_1_NEW, baseUnitPrice: 30000 }).unitPrice, 30000);
  assert.equal(rateAt(20, { category: PAY_CATEGORY.PT_2_1_REPURCHASE, baseUnitPrice: 35000 }).unitPrice, 35000);
  assert.equal(rateAt(20, { category: PAY_CATEGORY.PT_2_1_REPURCHASE_EVENT, baseUnitPrice: 32000 }).unitPrice, 32000);
});

test("2:1 new pays the same rate on every session, before and after twenty", () => {
  /* 대표 확정: 2:1 신규는 20회와 무관하게 30,000 이다.

     **두 길로 같은 값에 닿는다** -- 20회 전에는 판정 3 의 "2:1 신규 단가" 이고
     그 뒤에는 판정 4 의 기준 단가다. 둘이 같은 숫자인 것은 우연이 아니라, 판정
     3 이 그 표값을 읽기 때문이다 (newToInstructorUnitPrice).

     그래서 **발급 때 표와 다른 단가를 박은 회원권은 21번째부터 그 값으로
     간다.** 표를 따르지 않은 계약이라 그것이 맞다 -- 아래가 그 경우다. */
  const walked = walk(0, 25, { category: PAY_CATEGORY.PT_2_1_NEW, baseUnitPrice: 30000 });
  assert.deepEqual(new Set(pricesOf(walked)), new Set([30000]), "1~25번째가 전부 같다");

  const custom = rateAt(20, { category: PAY_CATEGORY.PT_2_1_NEW, baseUnitPrice: 28000 });
  assert.equal(custom.unitPrice, 28000, "표와 다르게 팔린 회원권은 그 값으로 간다");
  assert.equal(rateAt(19, { category: PAY_CATEGORY.PT_2_1_NEW, baseUnitPrice: 28000 }).unitPrice, 30000,
    "20회 전에는 표값이다 -- 그 구간은 상품이 아니라 강사 기준이기 때문이다");
});

test("a 1:1 category never borrows the 2:1 rate", () => {
  // 반대 방향도 막는다. 1:1 이 30,000 을 받으면 그만큼 더 나간다.
  for (const category of [
    PAY_CATEGORY.PT_1_1_NEW, PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT,
    PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, PAY_CATEGORY.LETMEIN, PAY_CATEGORY.ETC,
  ]) {
    assert.equal(
      rateAt(19, { category, baseUnitPrice: 45000 }).unitPrice,
      NEW_TO_INSTRUCTOR_UNIT_PRICE,
      category,
    );
  }
});

/* ── 디오사 ──────────────────────────────────────────────────────────────── */

test("디오사는 1회차부터 고정 단가다 — 20회 규칙을 타지 않는다", () => {
  /* 관리 수업이다. "이 강사에게 처음인 회원" 이라는 말이 성립하지 않는다 --
     30분/50분 수업의 값은 누가 몇 번째로 하든 같다.

     20회 판정 뒤에 두면 20,000 짜리 관리 수업의 처음 스무 회차가 25,000 으로
     나간다 -- 센터가 받는 돈보다 강사에게 주는 돈이 많아진다. */
  for (const [category, price] of [[PAY_CATEGORY.DIOSA_A, 20000], [PAY_CATEGORY.DIOSA_B, 35000]]) {
    const found = walk(0, 21, { category, baseUnitPrice: price });
    assert.deepEqual(pricesOf(found), Array(21).fill(price), category);
    assert.deepEqual(rulesOf(found), [PRICING_RULE.DIOSA_FIXED], category);
  }
});

test("디오사는 직급도 인수인계도 타지 않는다", () => {
  const found = resolveDeductionUnitPrice({
    category: PAY_CATEGORY.DIOSA_A, baseUnitPrice: 20000,
    priorSessions: 0, title: "branch_manager", handedOver: true, serviceUsedCount: 0,
  });
  assert.equal(found.unitPrice, 20000);
  assert.equal(found.rule, PRICING_RULE.DIOSA_FIXED);
});

/* ── 부원장은 여전히 맨 앞이다 ───────────────────────────────────────────── */

test("부원장 5:5 는 20회 규칙보다 앞이다", () => {
  /* 5:5 는 그 회원권이 실제로 팔린 금액에서 나온다. 신규 단가로 덮으면
     비싼 계약일수록 부원장이 손해를 본다. */
  const found = resolveDeductionUnitPrice({
    category: PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT, baseUnitPrice: 30000,
    isDeputyDirector: true, netContractPrice: 2100000, totalSessions: 30,
    priorSessions: 0, serviceUsedCount: 0,
  });
  assert.equal(found.unitPrice, 35000, "2,100,000 ÷ 30 ÷ 2");
  assert.equal(found.rule, PRICING_RULE.DEPUTY_DIRECTOR);
});
