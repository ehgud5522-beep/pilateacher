/**
 * 잔여 점검.
 *
 * 이 파일이 지키는 것은 **부호**다. 한 종류의 부호가 틀리면 멀쩡한 회원권이
 * 안 맞는 것으로 보고되고, 대표는 있지도 않은 장부 오류를 찾아 나선다.
 * 반대로 진짜 어긋난 것이 맞는 것으로 세어지면 아무도 모른다.
 *
 * 그래서 규칙 테스트가 고정한 일곱 경로와 **같은 모양**으로 견준다
 * (tests/rules/firestore.rules.test.js 의 "every way the owner writes a pass
 * today"). 저쪽이 규칙을 통과하는 것을 보고, 이쪽이 그 결과를 셀 수 있는지
 * 본다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  RECONCILE_STATE,
  RECONCILE_UNKNOWN,
  differenceLabel,
  ledgerTotal,
  reconcileMessage,
  reconcilePass,
  reconcileReport,
  unknownLabel,
} from "../../src/features/members/pass-reconcile.js";

const pass = (remainingCount, overrides = {}) => ({
  id: "pass-a", clientId: "client-a", remainingCount, ...overrides,
});

/* 일곱 경로가 원장에 남기는 것. 부호는 delta 에 이미 실려 있다. */
const ISSUE = { type: "issue", delta: 20 };
const DEDUCT = { type: "deduct", delta: -1 };
const CORRECTION = { type: "correction", delta: 1 };
const HANDOVER_OUT = { type: "handover", delta: -5 };
const CANCEL = (remaining) => ({ type: "cancel", delta: -remaining });
const INSTRUCTOR_TRANSFER = { type: "transfer", delta: 0 };
const ADJUST = (delta) => ({ type: "adjust", delta });
const EXPIRY = { type: "expiry", delta: 0 };

test("일곱 경로를 그대로 따라가면 잔여와 원장이 맞는다", () => {
  /* 발급 20 → 차감 3 → 되돌리기 1 → 담당 교체 → 양도 5 → 조정 +2 → 만료일.
     남는 것은 20 - 3 + 1 - 5 + 2 = 15. */
  const entries = [
    ISSUE,
    DEDUCT, DEDUCT, DEDUCT,
    CORRECTION,
    INSTRUCTOR_TRANSFER,
    HANDOVER_OUT,
    ADJUST(2),
    EXPIRY,
  ];
  assert.equal(ledgerTotal(entries), 15);
  const result = reconcilePass(pass(15), entries);
  assert.equal(result.state, RECONCILE_STATE.MATCHED);
  assert.equal(result.difference, 0);
});

test("종류마다 부호가 하나씩 맞다", () => {
  /* 한 줄씩 떼어 본다. 표를 따로 두지 않고 delta 를 그대로 더하는 것이
     맞는지 여기서 확인한다 -- 종류가 늘 때 표를 안 고쳐 새 종류가 조용히
     0 으로 세어지는 일을 막는 것이 이 설계의 요점이다. */
  assert.equal(ledgerTotal([ISSUE]), 20, "발급은 더한다");
  assert.equal(ledgerTotal([DEDUCT]), -1, "차감은 뺀다");
  assert.equal(ledgerTotal([CORRECTION]), 1, "되돌리기는 더한다");
  assert.equal(ledgerTotal([HANDOVER_OUT]), -5, "양도로 나간 것은 뺀다");
  assert.equal(ledgerTotal([CANCEL(8)]), -8, "취소는 남은 만큼 뺀다");
  assert.equal(ledgerTotal([INSTRUCTOR_TRANSFER]), 0, "담당 교체는 회차를 안 움직인다");
  assert.equal(ledgerTotal([EXPIRY]), 0, "만료일 변경도 회차를 안 움직인다");
  assert.equal(ledgerTotal([ADJUST(3)]), 3, "조정은 부호대로 더한다");
  assert.equal(ledgerTotal([ADJUST(-3)]), -3);
});

test("취소한 회원권은 0 으로 맞는다", () => {
  const entries = [ISSUE, DEDUCT, DEDUCT, CANCEL(18)];
  assert.equal(ledgerTotal(entries), 0);
  assert.equal(reconcilePass(pass(0), entries).state, RECONCILE_STATE.MATCHED);
});

test("양도로 받은 회원권도 맞는다", () => {
  /* 받는 쪽은 issue 한 줄로 시작한다. 보내는 쪽의 handover 는 저쪽 회원권의
     원장에 있고 이쪽과 상관없다. */
  const entries = [{ type: "issue", delta: 5 }];
  assert.equal(reconcilePass(pass(5, { id: "pass-new" }), entries).state, RECONCILE_STATE.MATCHED);
});

test("안 맞으면 어느 쪽이 얼마나 많은지 말한다", () => {
  const short = reconcilePass(pass(12), [ISSUE, DEDUCT, DEDUCT, DEDUCT]);
  assert.equal(short.state, RECONCILE_STATE.MISMATCHED);
  assert.equal(short.ledgerTotal, 17);
  assert.equal(short.difference, -5);
  assert.match(differenceLabel(short.difference), /잔여가 원장보다 5회 적음/);

  const over = reconcilePass(pass(20), [ISSUE, DEDUCT]);
  assert.equal(over.difference, 1);
  assert.match(differenceLabel(over.difference), /잔여가 원장보다 1회 많음/);
  assert.equal(differenceLabel(0), "");
});

test("셀 수 없는 것과 안 맞는 것을 가른다", () => {
  /* **여기가 이 파일의 두 번째 요점이다.** 못 읽은 것을 "안 맞는다" 로
     보고하면 대표는 있지도 않은 장부 오류를 찾아 나선다. */
  const noLedger = reconcilePass(pass(10), []);
  assert.equal(noLedger.state, RECONCILE_STATE.UNKNOWN);
  assert.equal(noLedger.unknownReason, RECONCILE_UNKNOWN.NO_LEDGER);
  assert.equal(noLedger.difference, null);

  const badDelta = reconcilePass(pass(10), [ISSUE, { type: "deduct", delta: "한 번" }]);
  assert.equal(badDelta.state, RECONCILE_STATE.UNKNOWN);
  assert.equal(badDelta.unknownReason, RECONCILE_UNKNOWN.UNREADABLE_DELTA);

  const badRemaining = reconcilePass(pass(null), [ISSUE]);
  assert.equal(badRemaining.state, RECONCILE_STATE.UNKNOWN);
  assert.equal(badRemaining.unknownReason, RECONCILE_UNKNOWN.UNREADABLE_REMAINING);

  for (const reason of Object.values(RECONCILE_UNKNOWN)) {
    assert.ok(unknownLabel(reason).length > 0, reason);
  }
  assert.equal(unknownLabel("무엇인가"), "확인하지 못함");
});

test("읽을 수 없는 줄 하나가 합을 조용히 틀리게 하지 않는다", () => {
  /* 0 으로 치고 넘어가면 합이 20 이 되고, 잔여 19 인 회원권이 "안 맞는다"
     로 보고된다 -- 실제로는 우리가 못 읽은 것뿐이다. */
  assert.equal(ledgerTotal([ISSUE, { type: "deduct" }]), null);
  assert.equal(ledgerTotal([ISSUE, { type: "deduct", delta: 1.5 }]), null);
  assert.equal(ledgerTotal([]), null);
  assert.equal(ledgerTotal(null), null);
});

test("안 맞는 것이 위로 오고, 차이가 큰 것이 먼저다", () => {
  /* 대표가 보는 순간 할 일이 먼저 보여야 한다. */
  const report = reconcileReport([
    { pass: pass(20, { id: "ok" }), entries: [ISSUE] },
    { pass: pass(10, { id: "off-1", clientId: "c1" }), entries: [ISSUE, DEDUCT] },
    { pass: pass(5, { id: "unknown-1" }), entries: [] },
    { pass: pass(1, { id: "off-big", clientId: "c2" }), entries: [ISSUE] },
  ], { nameOf: (id) => ({ c1: "김하나", c2: "이두리" }[id] || "") });

  assert.deepEqual(report.rows.map((row) => row.passId), ["off-big", "off-1", "unknown-1", "ok"]);
  assert.equal(report.total, 4);
  assert.equal(report.mismatched, 2);
  assert.equal(report.unknown, 1);
  assert.equal(report.matched, 1);
  assert.equal(report.rows[0].clientName, "이두리", "회원 이름을 함께 보여준다");
});

test("점검 결과를 한 줄로 말한다", () => {
  assert.equal(reconcileMessage({ total: 0 }), "점검할 회원권이 없습니다.");
  assert.match(reconcileMessage({ total: 12, mismatched: 0, unknown: 0 }), /12건 모두 원장과 맞습니다/);
  assert.match(reconcileMessage({ total: 12, mismatched: 2, unknown: 3 }), /안 맞음 2건 · 확인 불가 3건/);
  /* 확인 불가만 있을 때 "안 맞음 0건" 을 적지 않는다 -- 없는 문제를 만든다. */
  const onlyUnknown = reconcileMessage({ total: 12, mismatched: 0, unknown: 3 });
  assert.match(onlyUnknown, /확인 불가 3건/);
  assert.doesNotMatch(onlyUnknown, /안 맞음/);
});

test("id 가 없는 줄은 세지 않는다", () => {
  const report = reconcileReport([{ pass: { remainingCount: 5 }, entries: [ISSUE] }, null, undefined]);
  assert.equal(report.total, 0);
});
