/**
 * 급여의 "수업료 외" 줄 (2026-11-21 대표: 급여 집계에 잘 포함돼서, 강사가 한눈에). 확정분만 합계 · 확정 전은 금액 없이 · 없으면 줄 없음.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EXTRA_STATE, extraPayOf, extrasByInstructor, extrasTotal } from "../../src/features/sales/extra-pay.js";

const confirmedSales = (instructorId, extra = {}) => ({
  instructorId, month: "2026-11", status: "confirmed",
  snapshot: { total: 5000000, bracketAmount: 250000, otBonus: 50000, groupBase: 2000000, groupBonus: 100000, clawbackTotal: 110000, payout: 290000, ...extra },
});

test("확정된 매출 인센은 개인 · 그룹 · 환수 줄로, 합계는 서버가 남긴 지급액과 같다", () => {
  const extra = extraPayOf({ salesMonth: confirmedSales("t1") });
  assert.deepEqual(extra.lines.map((line) => [line.code, line.amount]), [["sales_personal", 300000], ["sales_group", 100000], ["sales_clawback", -110000]]);
  assert.equal(extra.confirmedTotal, 290000, "snapshot.payout 과 같다");
  assert.equal(extra.lines[0].note, "매출 5,000,000원 · 구간 250,000원 · OT 10% 50,000원");
  assert.equal(extra.waiting, 0);
});

test("확정 전은 금액 없이 상태만 · 합계에 안 든다 · 문서가 없으면 줄도 없다", () => {
  const waiting = extraPayOf({ salesMonth: { status: "submitted" }, fcMonth: { status: "submitted", done: 3, cancel: 1 } });
  assert.deepEqual(waiting.lines.map((line) => [line.code, line.state, line.amount]), [["sales_waiting", EXTRA_STATE.WAITING, 0], ["fc_waiting", EXTRA_STATE.WAITING, 0]]);
  assert.equal(waiting.lines[0].note, "제출함 · FC · 대표 확정 전");
  assert.equal(waiting.confirmedTotal, 0);
  assert.equal(waiting.waiting, 2);
  assert.equal(extraPayOf({ salesMonth: { status: "reopened" } }).lines[0].note, "확정을 되돌림 · 다시 확정 전");
  assert.equal(extraPayOf({}).has, false);
  assert.equal(extraPayOf({ fcMonth: { status: "submitted", done: 0, cancel: 0 } }).has, false, "횟수 없는 FC 칸은 줄 없음");
});

test("확정된 FC 복지 수업료 · 그룹 없는 달은 그룹 줄 없음", () => {
  const extra = extraPayOf({
    salesMonth: confirmedSales("t1", { groupBase: 0, groupBonus: 0, clawbackTotal: 0, otBonus: 0 }),
    fcMonth: { status: "confirmed", done: 3, cancel: 1, snapshot: { done: 3, cancel: 1, count: 4, amount: 90000 } },
  });
  assert.deepEqual(extra.lines.map((line) => line.code), ["sales_personal", "fc_lessons"]);
  assert.equal(extra.lines[0].note, "매출 5,000,000원 · 구간 250,000원");
  assert.equal(extra.lines[1].note, "진행 3회 · 캔슬 1회");
  assert.equal(extra.confirmedTotal, 340000);
});

test("센터 한 달 → 강사별, 계정을 바꾼 강사는 한 사람으로", () => {
  const map = extrasByInstructor({
    salesMonths: [confirmedSales("old-uid"), { instructorId: "t2", status: "submitted" }],
    fcMonths: [{ instructorId: "new-uid", status: "confirmed", snapshot: { done: 2, cancel: 0, amount: 50000 } }],
    canonicalInstructorId: (id) => (id === "old-uid" ? "new-uid" : id),
  });
  assert.deepEqual([...map.keys()].sort(), ["new-uid", "t2"]);
  assert.equal(map.get("new-uid").confirmedTotal, 290000 + 50000);
  assert.deepEqual(extrasTotal(map), { confirmedTotal: 340000, waiting: 1 });
});
