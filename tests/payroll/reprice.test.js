import assert from "node:assert/strict";
import test from "node:test";

import {
  changedOnly, isServiceDeduction, repriceEntries, sessionsAtStart, summarizeReprice,
} from "../../tools/payroll/reprice.js";

/**
 * 이미 찍힌 차감을 새 규칙으로 다시 계산한다.
 *
 * 어려운 자리는 하나다: **단가를 정한 것은 그 순간의 누적인데, 원장 항목은
 * 그 숫자를 들고 있지 않다.** 지금 저장된 누적에서 그 뒤에 일어난 증감을
 * 되짚어 출발점을 잡고, 거기서부터 날짜 순으로 걷는다.
 *
 * 되짚기는 **옛 코드 기준**이다 -- 서비스도 올렸고 보정은 내렸다. 그것이
 * 실제로 일어난 일이기 때문이다. 걷는 동안의 증가만 새 규칙을 따른다.
 */

const PASS = {
  baseUnitPrice: 30000, netContractPrice: 2100000, totalSessions: 30,
};
const at = (day) => new Date(2026, 9, day, 10, 0);

const entry = (overrides = {}) => ({
  id: `e-${overrides.day ?? 1}`,
  type: "deduct",
  passId: "p1",
  clientId: "c1",
  instructorId: "u-me",
  category: "pt_1_1_repurchase_event",
  unitPrice: 25000,
  rule: "new_to_instructor",
  occurredAt: at(overrides.day ?? 1),
  ...overrides,
});

const reprice = (entries, startingSessions) => repriceEntries({
  entries, startingSessions, passOf: () => PASS,
});

/* ── 출발점 되짚기 ───────────────────────────────────────────────────────── */

test("the starting count is the stored one minus what the app added since", () => {
  /* 옛 코드는 차감마다 +1, 보정마다 −1 했다. 그것을 그대로 되짚는다. */
  const found = sessionsAtStart({
    storedSessions: 25,
    entriesSince: [entry(), entry({ day: 2 }), entry({ day: 3, type: "correction" })],
  });
  assert.equal(found, 24, "25 − 차감 2 + 보정 1");
});

test("service deductions are subtracted too, because the old code added them", () => {
  /* **새 규칙이 아니라 그때 돌던 코드를 되짚는다.** 서비스를 빼지 않으면
     출발점이 그만큼 높아지고, 그 뒤 모든 줄의 20회 경계가 밀린다. */
  const found = sessionsAtStart({
    storedSessions: 10,
    entriesSince: [entry({ category: "service" }), entry({ day: 2 })],
  });
  assert.equal(found, 8);
});

test("the starting count never goes below zero", () => {
  // 음수로 계속 세면 그 뒤가 전부 틀린다. 0 에서 멈춘다.
  assert.equal(sessionsAtStart({ storedSessions: 1, entriesSince: [entry(), entry({ day: 2 })] }), 0);
});

/* ── 다시 계산 ───────────────────────────────────────────────────────────── */

test("a session that crossed the twentieth is repriced and the difference shown", () => {
  /* 누적 19 에서 두 번 한다. 첫 번째는 20회째라 신규 단가, 두 번째는
     21회째라 카테고리 단가다. */
  const rows = reprice([entry({ day: 1 }), entry({ day: 2 })], 19);

  assert.equal(rows[0].newUnitPrice, 25000);
  assert.equal(rows[0].difference, 0, "원래도 25,000 이었다");
  assert.equal(rows[1].newUnitPrice, 30000);
  assert.equal(rows[1].difference, 5000);
  assert.equal(rows[1].newRule, "base_category");
});

test("a service session does not push the count forward any more", () => {
  /* 새 규칙에서는 서비스가 누적을 올리지 않는다. 가운데 서비스가 끼어도
     그 뒤 회차의 누적은 그만큼 뒤에 있다. */
  const rows = reprice([
    entry({ day: 1 }),
    entry({ day: 2, category: "service", unitPrice: 10000, rule: "service_first" }),
    entry({ day: 3 }),
  ], 18);

  assert.equal(rows[0].priorSessions, 18);
  assert.equal(rows[1].priorSessions, 19, "서비스 자신은 그 자리에서 센다");
  assert.equal(rows[2].priorSessions, 19, "서비스는 올리지 않았다");
});

test("a handed-over pass is repriced by the count, and the old amount shows the gap", () => {
  /* 옛 규칙은 인수인계면 영영 25,000 이었다. 누적 30 이면 새 규칙은 카테고리
     단가이고, 그 차액이 강사가 못 받은 돈이다. */
  const rows = reprice([entry({ unitPrice: 25000, rule: "handed_over" })], 30);
  assert.equal(rows[0].newUnitPrice, 30000);
  assert.equal(rows[0].newRule, "base_category");
  assert.equal(rows[0].difference, 5000);
});

test("a senior title that used to be paid from the first session now waits", () => {
  /* 옛 규칙은 1회차부터 31,000 이었다. 누적 3 이면 새 규칙은 25,000 --
     **차액이 음수다.** 올라간 것과 내려간 것을 섞으면 안 되는 이유다. */
  const rows = repriceEntries({
    entries: [entry({ unitPrice: 31000, rule: "senior_title_event" })],
    startingSessions: 3,
    passOf: () => PASS,
    titleOf: () => "branch_manager",
  });
  assert.equal(rows[0].newUnitPrice, 25000);
  assert.equal(rows[0].difference, -6000);
});

test("the deputy rule is read back from the entry, not from today's membership", () => {
  /* 지금 소속 문서를 읽으면 그 사이에 부원장이 된 사람의 지난 회차가 전부
     5:5 로 다시 계산된다 -- 그 사람은 그때 부원장이 아니었다. */
  const rows = reprice([entry({ unitPrice: 35000, rule: "deputy_director" })], 0);
  assert.equal(rows[0].newRule, "deputy_director");
  assert.equal(rows[0].newUnitPrice, 35000);
  assert.equal(rows[0].difference, 0);
});

test("entries are walked in time order, so the boundary lands on one row", () => {
  /* 순서가 흔들리면 20회째가 어느 회차인지 실행할 때마다 달라진다. */
  const rows = reprice([entry({ day: 3, id: "c" }), entry({ day: 1, id: "a" }), entry({ day: 2, id: "b" })], 18);
  assert.deepEqual(rows.map((row) => row.entryId), ["a", "b", "c"]);
  assert.deepEqual(rows.map((row) => row.priorSessions), [18, 19, 20]);
});

test("a pass we could not read is reported, not guessed", () => {
  /* baseUnitPrice 와 계약 금액이 거기 있다. 지어내면 그 줄의 차액이 거짓이
     되고, 그 거짓이 보정 금액이 된다. */
  const rows = repriceEntries({ entries: [entry()], startingSessions: 0, passOf: () => null });
  assert.equal(rows[0].skipped, "pass_missing");
  assert.equal(rows[0].newUnitPrice, null);
  assert.equal(rows[0].difference, null);
});

test("issues, transfers and corrections are not repriced", () => {
  // 다시 계산할 단가가 없는 종류다.
  const rows = reprice([
    entry({ type: "issue", delta: 20 }),
    entry({ day: 2, type: "correction" }),
    entry({ day: 3, type: "transfer" }),
  ], 0);
  assert.deepEqual(rows, []);
});

/* ── 무엇을 보여 주는가 ──────────────────────────────────────────────────── */

test("only the rows that moved are reported, and the skipped ones", () => {
  const rows = reprice([entry({ day: 1 }), entry({ day: 2 })], 19);
  const found = changedOnly(rows);
  assert.equal(found.length, 1, "첫 줄은 금액이 같다");
  assert.equal(found[0].entryId, "e-2");
});

test("the summary separates what went up from what went down", () => {
  /* 합계만 보면 서로 지워져 "차이 없음" 으로 보이는데, 강사마다는 받을 돈과
     돌려줄 돈이 따로 있다. */
  const rows = [
    ...reprice([entry({ unitPrice: 25000, rule: "handed_over" })], 30),
    ...repriceEntries({
      entries: [entry({ id: "e-2", day: 2, unitPrice: 31000, rule: "senior_title_event" })],
      startingSessions: 3, passOf: () => PASS, titleOf: () => "team_lead",
    }),
  ];
  const found = summarizeReprice(rows);
  assert.equal(found.increased, 1);
  assert.equal(found.decreased, 1);
  assert.equal(found.totalDifference, -1000, "5,000 − 6,000");
});

test("a service deduction is recognised by its category", () => {
  assert.equal(isServiceDeduction(entry({ category: "service" })), true);
  assert.equal(isServiceDeduction(entry()), false);
  assert.equal(isServiceDeduction(entry({ type: "correction", category: "service" })), false);
});
