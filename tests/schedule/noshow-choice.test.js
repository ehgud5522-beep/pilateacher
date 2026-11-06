import assert from "node:assert/strict";
import test from "node:test";

import {
  NOSHOW_CHOICE_REQUIRED, SETTLEMENT_OUTCOME, canSettleLesson, deductsFor, isUndecidedNoshow,
  needsSettlement, planLessonSettlement, settleBlockReason, settlementOutcome,
} from "../../src/features/schedule/lesson-settlement.js";

/**
 * 노쇼 차감 / 노쇼 미차감 (2026-11-06 대표).
 *
 * 강사가 확정할 때 고르고, 확정은 고른 대로 한다:
 *   노쇼 차감   출석과 같게 1회 · 같은 단가
 *   노쇼 미차감 차감도 급여도 없다
 *   안 고름     확정할 수 없다
 * 듀엣은 한 회원권을 둘이 함께 쓴다 -- 한 명이라도 출석 · 노쇼 차감이면 1회,
 * 둘 다 미차감(또는 미차감 · 취소)이면 차감 없이 닫는다.
 */

const NOW = new Date(2026, 10, 6, 12, 0);
const members = [
  { id: "m1", name: "가", orgClientId: "c1" },
  { id: "m2", name: "나", orgClientId: "c2" },
];
const solo = (clientId) => ({
  id: `solo-${clientId}`, clientId, clientIds: [clientId], status: "active", remainingCount: 8,
  totalSessions: 20, serviceSessions: 0, serviceUsed: 0, contractPrice: 1200000, netContractPrice: 1200000,
  baseUnitPrice: 30000, category: "pt_1_1_repurchase_event", paymentMethod: "card",
  expiresAt: new Date(2027, 0, 1), instructorId: "u1",
});
const duetPass = {
  ...solo("c1"), id: "duet", clientIds: ["c1", "c2"], category: "pt_2_1_new", baseUnitPrice: 0,
};
const passes = [solo("c1"), solo("c2"), duetPass];
const lesson = (type, attendees) => ({
  id: "L", date: "2026-11-05", start: "10:00", end: "10:50", type, attendees,
});
const plan = (type, attendees) => planLessonSettlement({ lesson: lesson(type, attendees), members, passes, now: NOW });

test("1:1 노쇼 차감은 출석과 똑같이 1회 — 같은 회원권, 같은 모양", () => {
  const attended = plan("1:1", [{ memberId: "m1", status: "done" }]);
  const charged = plan("1:1", [{ memberId: "m1", status: "noshow", noshowFee: true }]);
  assert.equal(charged.deductions.length, 1);
  assert.equal(charged.deductions[0].pass.id, attended.deductions[0].pass.id, "단가를 정하는 회원권이 같다");
  assert.deepEqual(charged.deductions[0].attendanceByClientId, { c1: "noshow" });
  assert.deepEqual(charged.skips, []);
});

test("1:1 노쇼 미차감은 차감 없이 닫힌다 — 결과는 '차감할 회차 없음'", () => {
  const waived = plan("1:1", [{ memberId: "m1", status: "noshow", noshowFee: false }]);
  assert.deepEqual(waived.deductions, []);
  assert.deepEqual(waived.skips, []);
  assert.equal(settlementOutcome({ attempted: 0, written: 0, skipped: 0 }), SETTLEMENT_OUTCOME.NOTHING);
});

test("듀엣: 한 명 출석 · 한 명 노쇼 미차감 → 공유 회원권 1회, 노쇼는 기록에만", () => {
  const mixed = plan("듀엣", [
    { memberId: "m1", status: "done" },
    { memberId: "m2", status: "noshow", noshowFee: false },
  ]);
  assert.equal(mixed.deductions.length, 1);
  assert.equal(mixed.deductions[0].pass.id, "duet");
  assert.deepEqual(mixed.deductions[0].attendanceByClientId, { c1: "attended", c2: "noshow" });
});

test("듀엣: 둘 다 노쇼 차감이면 1회, 둘 다 미차감 · 미차감과 취소면 0회", () => {
  const bothCharged = plan("듀엣", [
    { memberId: "m1", status: "noshow", noshowFee: true },
    { memberId: "m2", status: "noshow", noshowFee: true },
  ]);
  assert.equal(bothCharged.deductions.length, 1, "한 장을 둘이 쓰므로 1회");

  for (const attendees of [
    [{ memberId: "m1", status: "noshow", noshowFee: false }, { memberId: "m2", status: "noshow", noshowFee: false }],
    [{ memberId: "m1", status: "noshow", noshowFee: false }, { memberId: "m2", status: "cancel" }],
  ]) {
    const none = plan("듀엣", attendees);
    assert.deepEqual(none.deductions, [], JSON.stringify(attendees));
    assert.deepEqual(none.skips, []);
  }
  // 한 명 노쇼 차감 · 한 명 미차감이면 1회.
  const oneCharged = plan("듀엣", [
    { memberId: "m1", status: "noshow", noshowFee: true },
    { memberId: "m2", status: "noshow", noshowFee: false },
  ]);
  assert.equal(oneCharged.deductions.length, 1);
});

test("안 고른 노쇼가 있으면 확정이 잠긴다 — 카드는 서되 이유를 말한다", () => {
  const undecided = lesson("1:1", [{ memberId: "m1", status: "noshow", noshowFee: null }]);
  assert.equal(canSettleLesson(undecided), true, "확정 블록은 선다");
  assert.equal(settleBlockReason(undecided), NOSHOW_CHOICE_REQUIRED);
  assert.equal(isUndecidedNoshow(undecided.attendees[0]), true);

  const halfDuet = lesson("듀엣", [
    { memberId: "m1", status: "noshow", noshowFee: true },
    { memberId: "m2", status: "noshow" },
  ]);
  assert.equal(settleBlockReason(halfDuet), NOSHOW_CHOICE_REQUIRED, "듀엣은 회원마다 골라야 한다");

  for (const fee of [true, false]) {
    assert.equal(settleBlockReason(lesson("1:1", [{ memberId: "m1", status: "noshow", noshowFee: fee }])), "");
  }
  assert.equal(settleBlockReason(lesson("1:1", [{ memberId: "m1", status: "done" }])), "", "출석은 고를 것이 없다");
});

test("노쇼 미차감만 있는 수업도 확정 대상으로 남는다 — 닫혀야 큐에서 빠진다", () => {
  const waived = { ...lesson("1:1", [{ memberId: "m1", status: "noshow", noshowFee: false }]), date: "2026-11-01" };
  assert.equal(needsSettlement(waived, { now: NOW }), true);
  assert.equal(needsSettlement({ ...waived, orgSettledAt: "2026-11-01T02:00:00Z" }, { now: NOW }), false);
});

test("deductsFor: 출석 · 노쇼 차감만 회차를 쓴다", () => {
  assert.equal(deductsFor({ status: "done" }), true);
  assert.equal(deductsFor({ status: "noshow", noshowFee: true }), true);
  assert.equal(deductsFor({ status: "noshow", noshowFee: false }), false);
  assert.equal(deductsFor({ status: "cancel" }), false);
  assert.equal(deductsFor({ status: "booked" }), false);
});

test("회귀: 출석만 있는 수업의 차감은 전과 같다", () => {
  const soloDone = plan("1:1", [{ memberId: "m1", status: "done" }]);
  assert.deepEqual(soloDone.deductions.map((item) => [item.pass.id, item.clientIds]), [["solo-c1", ["c1"]]]);
  const duetDone = plan("듀엣", [{ memberId: "m1", status: "done" }, { memberId: "m2", status: "done" }]);
  assert.deepEqual(duetDone.deductions.map((item) => [item.pass.id, item.clientIds, item.shared]), [["duet", ["c1", "c2"], true]]);
});
