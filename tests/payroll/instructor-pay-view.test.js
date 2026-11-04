import assert from "node:assert/strict";
import test from "node:test";

import {
  loadInstructorMonthlyPay, summarizeInstructorPay,
} from "../../src/data/repositories/payroll-repository.js";
import { payHeadline, unitPriceSummary } from "../../src/features/schedule/instructor-pay-view.js";

/**
 * 강사 급여 화면을 쉽게 바꾼 것 (2026-11-04) — **숫자는 하나도 안 바뀐다.**
 *
 * 화면이 새로 보여 주는 단가별 요약은 같은 항목을 묶어 보여 줄 뿐이고, 금액은
 * summarizeInstructorPay 가 낸다. 그래서 여기서 지키는 것은 둘이다:
 *   하나. 기존 함수가 같은 원장에서 전과 같은 숫자를 낸다 (고정값).
 *   둘.  새 묶음의 합이 언제나 그 숫자와 같다.
 * 그리고 셋. 강사 화면에는 그 강사의 항목만 들어온다.
 */

const MONTH = "2026-10";
const at = (day, hour = 10) => new Date(2026, 9, day, hour, 0);
const entry = (overrides = {}) => ({
  organizationId: "bonita", passId: "p1", clientId: "c1", locationId: "bansong",
  type: "deduct", delta: -1, category: "pt_1_1_new", unitPrice: 25000,
  instructorId: "u-me", occurredAt: at(5), ...overrides,
});

/* 한 달치. 같은 구분에 단가가 셋, 센터 지원 한 건, 0원 서비스 한 건, 보정 한 건. */
const MONTH_ENTRIES = [
  entry({ id: "a1", category: "pt_1_1_repurchase_event", unitPrice: 30000, rule: "base_category", occurredAt: at(3) }),
  entry({ id: "a2", category: "pt_1_1_repurchase_event", unitPrice: 30000, rule: "base_category", occurredAt: at(4) }),
  entry({ id: "a3", category: "pt_1_1_repurchase_event", unitPrice: 25000, rule: "new_to_instructor", occurredAt: at(6) }),
  entry({ id: "b1", category: "pt_1_1_new", unitPrice: 25000, occurredAt: at(7) }),
  entry({ id: "s1", category: "pt_1_1_repurchase_event", unitPrice: 15000, rule: "service_first", occurredAt: at(8) }),
  entry({ id: "s2", category: "service", unitPrice: 0, rule: "service_already_used", occurredAt: at(9) }),
  entry({ id: "d1", category: "duet_new", unitPrice: 31000, rule: "base_category", occurredAt: at(10) }),
  entry({ id: "a2_correction", type: "correction", delta: 1, category: "pt_1_1_repurchase_event", unitPrice: 30000, correctsEntryId: "a2", occurredAt: at(11) }),
];

test("기존 급여 합계는 전과 같다 — 고정값", () => {
  /* 30,000 × 2 + 25,000 + 25,000 + 15,000 + 0 + 31,000 − 30,000 = 126,000.
     이 숫자가 바뀌면 화면이 아니라 계산이 바뀐 것이다. */
  const summary = summarizeInstructorPay(MONTH_ENTRIES);
  assert.equal(summary.total, 126000);
  assert.equal(summary.sessions, 6);
  assert.deepEqual(
    summary.byCategory.map((row) => [row.category, row.sessions, row.amount]),
    [["pt_1_1_repurchase_event", 3, 70000], ["duet_new", 1, 31000], ["pt_1_1_new", 1, 25000], ["service", 1, 0]],
  );
});

test("단가별 요약의 합은 언제나 기존 합계와 같다", () => {
  const view = unitPriceSummary(MONTH_ENTRIES);
  const summary = summarizeInstructorPay(MONTH_ENTRIES);
  assert.equal(view.total, summary.total);
  const rowsTotal = view.rows.reduce((sum, row) => sum + row.amount, 0) + view.correction.amount;
  assert.equal(rowsTotal, summary.total, "줄을 다 더하면 합계");
  const rowsSessions = view.rows.reduce((sum, row) => sum + row.sessions, 0) + view.correction.sessions;
  assert.equal(rowsSessions, summary.sessions);
});

test("단가별 요약: 구분 · 단가마다 한 줄, 센터 지원은 따로, 보정은 음수", () => {
  const view = unitPriceSummary(MONTH_ENTRIES);
  assert.deepEqual(view.rows.map((row) => [row.kind, row.category, row.unitPrice, row.sessions, row.amount]), [
    ["lesson", "pt_1_1_repurchase_event", 30000, 2, 60000],
    ["lesson", "duet_new", 31000, 1, 31000],
    // 금액 · 단가가 같으면 원장 순서 그대로.
    ["lesson", "pt_1_1_repurchase_event", 25000, 1, 25000],
    ["lesson", "pt_1_1_new", 25000, 1, 25000],
    ["lesson", "service", 0, 1, 0],
    ["support", "pt_1_1_repurchase_event", 15000, 1, 15000],
  ]);
  assert.deepEqual(view.correction, { count: 1, sessions: -1, amount: -30000 });
});

test("빈 달은 0 이고 줄이 없다", () => {
  assert.deepEqual(unitPriceSummary([]), { rows: [], correction: { count: 0, sessions: 0, amount: 0 }, total: 0 });
  assert.deepEqual(unitPriceSummary(undefined).total, 0);
});

test("맨 위 두 숫자: 확정과 확정 대기는 따로, 합친 값은 더하기만", () => {
  assert.deepEqual(payHeadline({ total: 342000 }, { total: 25000, lessons: 1 }), {
    confirmed: 342000, pendingAmount: 25000, pendingLessons: 1, withPending: 367000,
  });
  assert.deepEqual(payHeadline(null, null), { confirmed: 0, pendingAmount: 0, pendingLessons: 0, withPending: 0 });
});

test("강사 화면에는 그 강사의 항목만 — 남의 급여는 섞이지 않는다", async () => {
  /* 저장소가 잘못해 남의 항목을 돌려줘도(색인 · 질의를 잘못 고친 경우) 화면의
     숫자에는 들어가지 않는다. */
  const leaky = {
    listDeductions: async () => [
      ...MONTH_ENTRIES,
      entry({ id: "other-1", instructorId: "u-other", unitPrice: 99000 }),
      entry({ id: "other-2", instructorId: "u-other", unitPrice: 88000, rule: "service_first" }),
    ],
  };
  const pay = await loadInstructorMonthlyPay("bonita", { instructorId: "u-me", month: MONTH, store: leaky });
  assert.equal(pay.total, 126000);
  assert.ok(pay.entries.every((item) => item.instructorId === "u-me"));
  const view = unitPriceSummary(pay.entries);
  assert.equal(view.total, 126000);
  assert.ok(!view.rows.some((row) => row.unitPrice === 99000 || row.unitPrice === 88000));
});
