import assert from "node:assert/strict";
import test from "node:test";

import {
  clientBreakdown, clientsOnEntry, monthChoices, payrollRows, payrollWeeks,
  weekStartOf, weeksTotal,
} from "../../src/features/schedule/payroll-weeks.js";
import { summarizeInstructorPay } from "../../src/data/repositories/payroll-repository.js";

/**
 * 급여 상세의 차감 목록.
 *
 * ── 이 파일이 지키는 것 ──
 * 하나. **그 달의 전부가 보인다.** 목록이 slice(0, 20) 이라 10월 16일에
 *       10월 13일 이전이 사라졌다 -- 그 달의 급여를 설명하는 화면에서.
 * 둘.  **상단 합계와 목록 합계가 언제나 같다.** 다르면 둘 중 하나가 틀렸는데
 *       화면만 보고는 어느 쪽인지 알 수 없다.
 * 셋.  **듀엣은 두 이름이 함께 뜬다.** 원장 항목은 대표 한 명만 들고 있다.
 */

const at = (day, hour = 10) => new Date(2026, 9, day, hour, 0);

const entry = (overrides = {}) => ({
  id: `e-${overrides.day ?? 1}`, passId: "p1", clientId: "c1",
  type: "deduct", delta: -1, category: "pt_1_1_new", unitPrice: 25000,
  occurredAt: at(overrides.day ?? 1), ...overrides,
});

const NAMES = { c1: "김하나", c2: "이두리" };
const PASSES = { p1: { id: "p1", clientId: "c1" }, duet: { id: "duet", clientId: "c1", clientIds: ["c1", "c2"] } };
const LABELS = { p1: "1:1 20회 2차", duet: "2:1 30회", p2: "1:1 10회 3차" };

const rowsOf = (entries) => payrollRows({
  entries,
  passOf: (id) => PASSES[id] || null,
  clientNameOf: (id) => NAMES[id] || "",
  passLabelOf: (id) => LABELS[id] || "",
});

/* ── 그 달의 전부 ────────────────────────────────────────────────────────── */

test("every deduction of the month is listed, however many there are", () => {
  /* 전에는 스물한 번째부터 조용히 사라졌다. 그 달의 급여를 설명하는 화면에서
     그 달의 절반이 없었다. */
  const many = Array.from({ length: 40 }, (_, index) => entry({ id: `e${index}`, day: 1 + (index % 28) }));
  const weeks = payrollWeeks({ rows: rowsOf(many), now: at(16) });
  assert.equal(weeks.reduce((sum, week) => sum + week.rows.length, 0), 40);
});

test("the list total always equals the header total", () => {
  /* 상단은 summarizeInstructorPay 가 내고 목록은 여기가 낸다. 같은 식으로
     세는 것이 유일한 보장이다 -- 다르면 어느 쪽이 틀렸는지 알 수 없다. */
  const entries = [
    entry({ day: 1, unitPrice: 25000 }),
    entry({ id: "e2", day: 8, unitPrice: 30000 }),
    entry({ id: "e3", day: 15, unitPrice: 31000 }),
    // 보정은 빼는 쪽이다. 절댓값을 쓰면 되돌린 회차가 한 번 더 세어진다.
    entry({ id: "e4", day: 16, type: "correction", delta: 1, unitPrice: 25000 }),
    // 서비스는 0원이지만 회차는 센다.
    entry({ id: "e5", day: 16, category: "service", unitPrice: 0 }),
  ];
  const header = summarizeInstructorPay(entries);
  const weeks = payrollWeeks({ rows: rowsOf(entries), now: at(16) });
  assert.equal(weeksTotal(weeks), header.total);
  assert.equal(weeks.reduce((sum, week) => sum + week.sessions, 0), header.sessions);
});

/* ── 주 묶음 ─────────────────────────────────────────────────────────────── */

test("a week starts on Monday, so a Sunday lesson does not sit alone", () => {
  /* getDay() 는 일요일이 0 이다. 그대로 빼면 일요일이 다음 주의 시작이 되고,
     일요일 수업 하나가 혼자 한 주를 이룬다. */
  const monday = weekStartOf(new Date(2026, 9, 12));
  const sunday = weekStartOf(new Date(2026, 9, 18));
  assert.equal(monday.getTime(), sunday.getTime(), "10/12 월 ~ 10/18 일은 한 주다");
  assert.equal(monday.getDate(), 12);
});

test("the newest week is first, and this week opens expanded", () => {
  /* 강사가 먼저 보고 싶은 것이 이번 주다. 전부 펼치면 스크롤이 길어 안 읽히고,
     전부 접으면 가장 자주 보는 줄을 한 번 더 눌러야 한다. */
  const weeks = payrollWeeks({
    rows: rowsOf([entry({ day: 2 }), entry({ id: "e2", day: 9 }), entry({ id: "e3", day: 16 })]),
    now: at(16),
  });
  assert.deepEqual(weeks.map((week) => week.start.getDate()), [12, 5, 28]);
  assert.deepEqual(weeks.map((week) => week.current), [true, false, false]);
});

test("looking at a past month opens the newest week, not nothing", () => {
  /* 지난달에는 "이번 주" 가 없다. 전부 접히면 빈 화면으로 보이고, 무엇을
     눌러야 하는지도 알 수 없다 -- 월 선택을 붙인 의미가 사라진다. */
  const weeks = payrollWeeks({
    rows: rowsOf([entry({ day: 2 }), entry({ id: "e2", day: 9 })]),
    now: new Date(2026, 11, 1),
  });
  assert.deepEqual(weeks.map((week) => week.current), [true, false]);
  assert.equal(weeks[0].start.getDate(), 5, "가장 최근 주가 열린다");
});

test("each week carries its own subtotal", () => {
  const weeks = payrollWeeks({
    rows: rowsOf([
      entry({ day: 13, unitPrice: 25000 }),
      entry({ id: "e2", day: 14, unitPrice: 30000 }),
      entry({ id: "e3", day: 6, unitPrice: 31000 }),
    ]),
    now: at(16),
  });
  assert.equal(weeks[0].amount, 55000);
  assert.equal(weeks[0].sessions, 2);
  assert.equal(weeks[1].amount, 31000);
});

/* ── 듀엣 이름 ───────────────────────────────────────────────────────────── */

test("a duet shows both names on one line, and is paid once", () => {
  /* 2:1 은 원장 항목이 **하나**다 -- 회원권 하나를 둘이 나눠 쓰므로 차감도
     하나이고, 급여가 두 번 세어질 일은 애초에 없다. 문제는 그 항목이 대표
     한 명만 들고 있어 화면에 한 이름만 뜬 것이다. */
  const [row] = rowsOf([entry({ passId: "duet", category: "pt_2_1_repurchase", unitPrice: 35000 })]);
  assert.deepEqual(row.clientIds, ["c1", "c2"]);
  assert.equal(row.title, "김하나 · 이두리");
  assert.equal(row.isDuet, true);
  assert.equal(row.amount, 35000, "급여는 한 번만");
});

test("the anchor member comes first, so the same lesson reads the same every time", () => {
  const [row] = rowsOf([entry({ passId: "duet", clientId: "c2" })]);
  assert.equal(row.title, "이두리 · 김하나");
});

test("a pass we could not read leaves the one member we know", () => {
  // 짝을 지어내지 않는다. 없는 사람이 급여 줄에 서면 그 줄을 못 믿는다.
  const [row] = rowsOf([entry({ passId: "gone" })]);
  assert.deepEqual(row.clientIds, ["c1"]);
  assert.equal(row.title, "김하나");
});

test("a member whose name we could not read falls back to the pass, not to a blank", () => {
  const [row] = payrollRows({
    entries: [entry({ clientId: "c9" })],
    passOf: () => null, clientNameOf: () => "", passLabelOf: () => "1:1 20회 2차",
  });
  assert.equal(row.title, "1:1 20회 2차");
});

/* ── 줄을 눌렀을 때 ──────────────────────────────────────────────────────── */

test("tapping a row says which pass each member was charged from", () => {
  /* "3회 차감" 만으로는 어느 계약에서 빠졌는지 알 수 없다. 분쟁 때 여는
     화면이라 그 구분이 곧 근거가 된다. */
  const entries = [
    entry({ id: "a", day: 1, passId: "p1" }),
    entry({ id: "b", day: 8, passId: "p1" }),
    entry({ id: "c", day: 9, passId: "p2", unitPrice: 30000 }),
  ];
  const [found] = clientBreakdown({
    clientIds: ["c1"], entries,
    passOf: (id) => PASSES[id] || null,
    clientNameOf: (id) => NAMES[id] || "",
    passLabelOf: (id) => LABELS[id] || "",
  });
  assert.equal(found.name, "김하나");
  assert.deepEqual(found.passes.map((item) => [item.label, item.sessions]), [
    ["1:1 20회 2차", 2], ["1:1 10회 3차", 1],
  ]);
  assert.equal(found.passes[0].amount, 50000);
});

test("both halves of a duet get their own breakdown", () => {
  const entries = [entry({ id: "d", passId: "duet", unitPrice: 35000 })];
  const found = clientBreakdown({
    clientIds: ["c1", "c2"], entries,
    passOf: (id) => PASSES[id] || null,
    clientNameOf: (id) => NAMES[id] || "",
    passLabelOf: (id) => LABELS[id] || "",
  });
  assert.deepEqual(found.map((item) => item.name), ["김하나", "이두리"]);
  for (const item of found) {
    assert.deepEqual(item.passes.map((p) => [p.label, p.sessions]), [["2:1 30회", 1]]);
  }
});

/* ── 달 고르기 ───────────────────────────────────────────────────────────── */

test("the month picker walks back from this month", () => {
  assert.deepEqual(monthChoices(at(16), 3), ["2026-10", "2026-09", "2026-08"]);
});

test("the month picker crosses a year boundary", () => {
  // 문자열로 빼면 2026-00 이 된다.
  assert.deepEqual(monthChoices(new Date(2026, 0, 5), 2), ["2026-01", "2025-12"]);
});

/* ── 회원 찾기 ───────────────────────────────────────────────────────────── */

test("clientsOnEntry never invents a partner", () => {
  assert.deepEqual(clientsOnEntry(entry(), (id) => PASSES[id] || null), ["c1"]);
  assert.deepEqual(clientsOnEntry(entry({ passId: "duet" }), (id) => PASSES[id] || null), ["c1", "c2"]);
  assert.deepEqual(clientsOnEntry(entry(), () => null), ["c1"]);
  assert.deepEqual(clientsOnEntry({ clientId: "" }, () => null), []);
});
