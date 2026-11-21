/**
 * 강사 급여 명세 (2026-11-21 대표 승인): 조정 · 15일 지급 · 세전 → 3.3% → 실수령.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  TAX_TYPE, adjustmentErrors, adjustmentsOf, payMonthStatusView, payPeriodLabel, payStatementOf, paydayOf,
  statementFromSnapshot, statementSnapshot, taxTypeOf, withholdingOf,
} from "../../src/features/payroll/pay-statement.js";

test("3.3%: 소득세 3% 10원 미만 버림, 지방세는 소득세의 10% 10원 미만 버림 · 0 이하는 0 · 공제 없음", () => {
  assert.deepEqual(withholdingOf(1600000), { incomeTax: 48000, localTax: 4800, total: 52800 });
  assert.deepEqual(withholdingOf(1234567), { incomeTax: 37030, localTax: 3700, total: 40730 }, "37,037 → 37,030, 3,703 → 3,700");
  assert.deepEqual(withholdingOf(-50000), { incomeTax: 0, localTax: 0, total: 0 });
  assert.deepEqual(withholdingOf(1600000, TAX_TYPE.NONE), { incomeTax: 0, localTax: 0, total: 0 });
  assert.equal(taxTypeOf({ noTaxIds: ["u2"] }, "u2"), TAX_TYPE.NONE);
  assert.equal(taxTypeOf({ noTaxIds: ["u2"] }, "u1"), TAX_TYPE.FREELANCE);
  assert.equal(taxTypeOf(null, "u1"), TAX_TYPE.FREELANCE, "설정이 없으면 3.3%");
});

test("급여일은 다음 달 15일 · 12월분은 다음 해 1월", () => {
  assert.deepEqual(paydayOf("2026-11"), { date: "2026-12-15", label: "12월 15일" });
  assert.deepEqual(paydayOf("2026-12"), { date: "2027-01-15", label: "1월 15일" });
  assert.equal(payPeriodLabel("2026-11"), "11월분 · 12월 15일 지급");
});

test("명세: 수업료 + 수업료 외 + 조정 = 세전 → 세금 → 실수령, 남긴 숫자로 다시 그려도 같다", () => {
  const adjustments = [{ instructorId: "u1", amount: -30000, reason: "중복 지급", createdAt: new Date(2026, 10, 20) }];
  const statement = payStatementOf({ lessons: 1230000, extrasConfirmed: 400000, adjustments });
  assert.equal(statement.gross, 1600000);
  assert.equal(statement.tax.total, 52800);
  assert.equal(statement.net, 1547200);
  const snapshot = statementSnapshot(statement);
  assert.deepEqual(snapshot, { lessons: 1230000, extras: 400000, adjustTotal: -30000, gross: 1600000, incomeTax: 48000, localTax: 4800, net: 1547200, taxType: "3.3" });
  const again = statementFromSnapshot(snapshot, adjustments);
  assert.equal(again.net, statement.net);
  assert.equal(again.tax.total, statement.tax.total);
});

test("조정: 그 강사 것만 오래된 순 · 계정을 바꾼 강사는 한 사람 · 금액 0 · 사유 없음 · 너무 큼은 막는다", () => {
  const list = [
    { instructorId: "u2", amount: 10000, createdAt: new Date(2026, 10, 2) },
    { instructorId: "old", amount: 30000, createdAt: new Date(2026, 10, 3) },
    { instructorId: "u1", amount: -40000, createdAt: new Date(2026, 10, 1) },
  ];
  assert.deepEqual(adjustmentsOf(list, "u1", (id) => (id === "old" ? "u1" : id)).map((item) => item.amount), [-40000, 30000]);
  assert.deepEqual(adjustmentErrors({ amount: 0, reason: "" }).map((item) => item.code), ["adjust_amount_required", "adjust_reason_required"]);
  assert.deepEqual(adjustmentErrors({ amount: 20000000, reason: "x" }).map((item) => item.code), ["adjust_amount_too_large"]);
  assert.deepEqual(adjustmentErrors({ amount: -30000, reason: "대타 정산 누락" }), []);
});

test("급여 달 상태: 집계 중 · 확정(잠금) · 되돌림", () => {
  assert.equal(payMonthStatusView(null).code, "open");
  assert.equal(payMonthStatusView({ status: "closed" }).locked, true);
  assert.equal(payMonthStatusView({ status: "reopened", reopenReason: "조정 추가" }).label, "확정 되돌림 · 조정 추가");
});
