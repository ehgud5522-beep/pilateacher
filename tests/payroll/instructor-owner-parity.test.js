import assert from "node:assert/strict";
import test from "node:test";

import {
  loadInstructorMonthlyPay, loadOrganizationMonthlyPayroll,
} from "../../src/data/repositories/payroll-repository.js";
import { canonicalInstructorIdFrom } from "../../functions/shared/instructor-swap.mjs";
import { upcomingPayPreview, unsettledLessonsOf } from "../../src/features/schedule/upcoming-pay.js";

/**
 * 강사가 보는 "이달 예상 급여" 와 대표의 급여 집계.
 *
 * **같은 원장, 같은 줄, 같은 금액이어야 한다.** 두 화면이 다른 숫자를 말하면
 * 월말에 누구 말이 맞는지 가릴 방법이 없다 -- 원장은 append-only 라 지난 달을
 * 다시 계산해 맞춰 볼 수도 없다.
 *
 * 금액은 원장 항목에 박힌 unitPrice 다. 디오사·서비스·노쇼·부원장·인수인계가
 * 전부 **차감할 때** 정해져 그 자리에 들어가 있으므로, 세는 쪽은 더하기만
 * 하면 되고 두 화면이 갈라질 자리는 **거르는 줄** 하나뿐이다.
 */

const MONTH = "2026-10";
const at = (day, hour = 10) => new Date(2026, 9, day, hour, 0);

const entry = (overrides = {}) => ({
  organizationId: "bonita",
  passId: "p1",
  clientId: "c1",
  locationId: "bansong",
  type: "deduct",
  delta: -1,
  category: "pt_1_1_new",
  unitPrice: 25000,
  instructorId: "u-me",
  occurredAt: at(5),
  ...overrides,
});

/** 두 리포지토리에 같은 원장을 물려 주는 가짜 저장소. */
const storeOf = (entries) => ({
  listDeductions: async ({ instructorId }) => entries.filter(
    (item) => String(item.instructorId) === String(instructorId),
  ),
  listOrganizationDeductions: async () => entries,
});

const bothTotals = async (entries, options = {}) => {
  const store = storeOf(entries);
  const mine = await loadInstructorMonthlyPay("bonita", {
    instructorId: "u-me", month: MONTH, store,
    previousUids: options.previousUids || [],
    excludedClientIds: options.excludedClientIds || null,
  });
  const centre = await loadOrganizationMonthlyPayroll("bonita", {
    month: MONTH, store,
    excludedClientIds: options.excludedClientIds || null,
    canonicalInstructorId: options.canonicalInstructorId || null,
  });
  const row = centre.byInstructor.find((item) => item.instructorId === "u-me");
  return { mine, centre, row };
};

/* ── 같은 숫자 ───────────────────────────────────────────────────────────── */

test("the instructor's total is the owner's line for that instructor", async () => {
  const { mine, row } = await bothTotals([
    entry(),
    entry({ passId: "p2", unitPrice: 30000, category: "pt_1_1_repurchase_event", occurredAt: at(7) }),
    // 남의 차감. 대표 집계에는 있고 내 줄에는 없다.
    entry({ instructorId: "u-other", unitPrice: 99000 }),
  ]);
  assert.equal(mine.total, 55000);
  assert.equal(row.total, mine.total);
  assert.equal(row.sessions, mine.sessions);
});

test("diosa, service and a no-show all land the same on both screens", async () => {
  /* 금액은 차감할 때 정해져 원장에 박힌다. 세는 쪽이 다시 판정하지 않으므로
     종류가 늘어도 두 화면이 갈라지지 않는다 -- 그것을 못으로 박는다. */
  const { mine, row } = await bothTotals([
    entry({ category: "diosa_a", unitPrice: 20000, occurredAt: at(3) }),
    entry({ category: "diosa_b", unitPrice: 35000, occurredAt: at(4) }),
    // 서비스 회차는 0원이지만 회차는 센다.
    entry({ category: "service", unitPrice: 0, occurredAt: at(5) }),
    // 노쇼도 출석과 같은 단가로 박힌다 (2026-10-04 대표 결정).
    entry({ category: "pt_1_1_new", unitPrice: 25000, occurredAt: at(6) }),
  ]);
  assert.equal(mine.total, 80000);
  assert.equal(mine.sessions, 4);
  assert.equal(row.total, mine.total);
  assert.equal(row.sessions, mine.sessions);
});

test("a correction takes the same amount off both", async () => {
  const { mine, row } = await bothTotals([
    entry({ occurredAt: at(5) }),
    entry({ type: "correction", delta: 1, occurredAt: at(6) }),
  ]);
  assert.equal(mine.total, 0, "차감과 그 보정이 서로를 지운다");
  assert.equal(row.total, mine.total);
});

test("an account swap is one person on both screens", async () => {
  /* 원장은 append-only 라 옛 uid 를 고쳐 쓸 수 없다. 강사 쪽은 두 uid 를 모두
     읽고, 대표 쪽은 읽은 뒤 합친다 -- 둘 중 하나만 하면 그날 이전의 수업료가
     한쪽에서 사라진다. */
  const canonical = canonicalInstructorIdFrom([
    { organizationId: "bonita", userId: "u-me", previousUids: ["u-old"], status: "active" },
  ]);
  const { mine, row } = await bothTotals([
    entry({ instructorId: "u-old", occurredAt: at(2) }),
    entry({ instructorId: "u-me", occurredAt: at(9) }),
  ], { previousUids: ["u-old"], canonicalInstructorId: canonical });

  assert.equal(mine.total, 50000, "바꾸기 전 수업료도 내 화면에 있다");
  assert.equal(row.total, mine.total);
});

/* ── 갈라질 수 있었던 한 자리 ────────────────────────────────────────────── */

test("the review-demo member is excluded from both, not just the owner's", async () => {
  /* **2026-10-11 까지 강사 화면만 이것을 세고 있었다.** 심사용 회원은 사람이
     아니라서 대표의 집계는 거르는데, 강사 화면은 거르지 않아 그만큼 더 컸다 --
     월말에 두 숫자가 맞지 않는 이유를 아무도 짚지 못한다. */
  const excludedClientIds = new Set(["c-demo"]);
  const entries = [
    entry({ occurredAt: at(5) }),
    entry({ clientId: "c-demo", unitPrice: 45000, occurredAt: at(6) }),
  ];

  const { mine, row } = await bothTotals(entries, { excludedClientIds });
  assert.equal(mine.total, 25000, "심사용 회차는 내 급여가 아니다");
  assert.equal(row.total, mine.total);

  // 거르지 않으면 둘이 갈라진다는 것도 함께 박아 둔다.
  const unfiltered = await bothTotals(entries);
  assert.equal(unfiltered.mine.total, 70000);
  assert.equal(unfiltered.row.total, unfiltered.mine.total, "거르는 줄은 양쪽에서 같이 움직인다");
});

test("a month boundary cuts both the same way", async () => {
  const { mine, row } = await bothTotals([
    entry({ occurredAt: new Date(2026, 8, 30, 23, 0) }),
    entry({ occurredAt: at(1, 0) }),
    entry({ occurredAt: new Date(2026, 10, 1, 0, 0) }),
  ]);
  assert.equal(mine.sessions, 1, "그 달에 일어난 것만");
  assert.equal(row.sessions, mine.sessions);
});

/* ── 확정 전은 따로 센다 ─────────────────────────────────────────────────── */

const lesson = (overrides = {}) => ({
  id: "l1", date: "2026-10-20", start: "10:00",
  attendees: [{ memberId: "m1", status: "booked" }], ...overrides,
});
const ratesOf = (rows) => () => new Map(Object.entries(rows));

test("an unsettled lesson is counted as planned, never as confirmed", async () => {
  /* 확정한 순간 그 수업은 원장으로 간다. 양쪽에서 세면 **두 번 센다.** */
  const found = unsettledLessonsOf([
    lesson(),
    lesson({ id: "l2", orgSettledAt: "2026-10-20T01:00:00.000Z" }),
  ], MONTH);
  assert.deepEqual(found.map((item) => item.id), ["l1"]);
});

test("the planned total uses the preview the schedule card already shows", () => {
  const found = upcomingPayPreview({
    schedule: [lesson()], month: MONTH,
    rateOf: ratesOf({ m1: { unitPrice: 30000, deducts: true } }),
  });
  assert.equal(found.total, 30000);
  assert.equal(found.sessions, 1);
  assert.equal(found.lessons, 1);
});

test("a lesson that cannot be deducted is not money the instructor will see", () => {
  /* 회원권이 없으면 확정해도 한 푼도 나가지 않는다. 예정에 넣으면 강사는
     받을 수 없는 돈을 보고, 월말에 그만큼 비는 이유를 아무도 설명 못 한다. */
  const found = upcomingPayPreview({
    schedule: [lesson()], month: MONTH,
    rateOf: ratesOf({ m1: { skip: "no_pass" } }),
  });
  assert.equal(found.total, 0);
  assert.equal(found.blocked, 1);
});

test("a duet counts one session, not two", () => {
  /* 회원권 하나를 둘이 나눠 쓴다. 차감하는 쪽에만 금액이 붙는다. */
  const found = upcomingPayPreview({
    schedule: [lesson({ attendees: [{ memberId: "m1" }, { memberId: "m2" }] })],
    month: MONTH,
    rateOf: ratesOf({
      m1: { unitPrice: 30000, deducts: true, shared: true },
      m2: { unitPrice: 30000, deducts: false, shared: true },
    }),
  });
  assert.equal(found.total, 30000);
  assert.equal(found.sessions, 1);
});

test("the add-on care session is its own money on the planned line too", () => {
  // 한 수업에서 회원권 둘이 빠지고 금액도 둘이다. 한쪽만 세면 그만큼 모자란다.
  const found = upcomingPayPreview({
    schedule: [lesson()], month: MONTH,
    rateOf: ratesOf({
      m1: { unitPrice: 30000, deducts: true, care: { unitPrice: 20000, deducts: true } },
    }),
  });
  assert.equal(found.total, 50000);
  assert.equal(found.sessions, 2);
});

test("another month's lessons are not this month's plan", () => {
  const found = upcomingPayPreview({
    schedule: [lesson({ date: "2026-11-02" }), lesson({ id: "l2", date: "2026-09-30" })],
    month: MONTH,
    rateOf: ratesOf({ m1: { unitPrice: 30000, deducts: true } }),
  });
  assert.equal(found.total, 0);
  assert.equal(found.lessons, 0);
});

test("personal time, samples and a cancelled group are not pay", () => {
  const found = unsettledLessonsOf([
    lesson({ id: "off", personal: true }),
    lesson({ id: "sample", isSample: true }),
    lesson({ id: "cancelled", groupCancelled: true }),
    lesson({ id: "empty", attendees: [] }),
  ], MONTH);
  assert.deepEqual(found, []);
});
