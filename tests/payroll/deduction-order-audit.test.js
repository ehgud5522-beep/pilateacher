import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateKind, misorderedDeductions, summarizeOrderAudit,
} from "../../tools/payroll/deduction-order-audit.js";

/**
 * 순서가 틀린 차감 찾기.
 *
 * 2026-10-09 ~ 10-22 사이에 차감이 **차수 순**으로 돌았다. 그 사이에 뒤
 * 차수의 만료가 더 이른 회원이 있으면 앞 차수가 먼저 빠지고, 뒤 차수는 손도
 * 못 대 보고 만료로 간다 -- 회원이 돈을 낸 회차다.
 *
 * **고치지 않는다.** 원장은 append-only 라 지난 항목을 옮길 수 없다. 이
 * 목록은 "어느 줄이 그런가" 까지만 답하고, 그 뒤는 사람이 회원과 이야기한 뒤
 * 정한다.
 */

const WINDOW_FROM = new Date(2026, 9, 9);
const WINDOW_TO = new Date(2026, 9, 22);

const pass = (overrides = {}) => ({
  id: "p1", clientId: "c1", category: "pt_1_1_new", purchaseRound: 1,
  remainingCount: 5, expiresAt: new Date(2027, 5, 1), ...overrides,
});

const deduct = (overrides = {}) => ({
  id: "e1", type: "deduct", passId: "p1", clientId: "c1", instructorId: "u1",
  unitPrice: 25000, occurredAt: new Date(2026, 9, 15), ...overrides,
});

const audit = (entries, passes) => misorderedDeductions({
  entries, passes, from: WINDOW_FROM, to: WINDOW_TO,
});

/* ── 찾아야 하는 것 ──────────────────────────────────────────────────────── */

test("the Yulha case: a later round expiring sooner was skipped", () => {
  /* 대표가 든 예시다. 2차가 11월에 만료되는데 1차(내년 6월)가 먼저 빠졌다 --
     차수 순이 그렇게 고른다. */
  const found = audit(
    [deduct({ passId: "first" })],
    [
      pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 5, 1) }),
      pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2026, 10, 30) }),
    ],
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].usedPassId, "first");
  assert.equal(found[0].shouldPassId, "second");
  assert.equal(found[0].shouldRound, 2);
});

test("the summary counts the passes that could still be lost", () => {
  /* 이 목록의 요점은 줄 수가 아니라 **회원이 돈을 낸 회차가 몇 장 위험한가**
     이다. */
  const found = audit(
    [deduct({ id: "a", passId: "first" }), deduct({ id: "b", passId: "first", occurredAt: new Date(2026, 9, 16) })],
    [
      pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 5, 1) }),
      pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2026, 10, 30) }),
    ],
  );
  const summary = summarizeOrderAudit(found);
  assert.equal(summary.entries, 2);
  assert.equal(summary.passesAtRisk, 1, "같은 회원권 한 장이 위험하다");
  assert.equal(summary.clients, 1);
});

/* ── 찾으면 안 되는 것 ───────────────────────────────────────────────────── */

test("a deduction in the right order is not listed", () => {
  const found = audit(
    [deduct({ passId: "second" })],
    [
      pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 5, 1) }),
      pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2026, 10, 30) }),
    ],
  );
  assert.deepEqual(found, []);
});

test("a deduction outside the window is left alone", () => {
  /* 그 밖의 차감은 그때의 규칙대로 간 것이다. 함께 세면 고칠 수 없는 과거가
     목록을 채우고, 그러면 아무도 그 목록을 읽지 않는다. */
  for (const day of [new Date(2026, 9, 8), new Date(2026, 9, 23)]) {
    const found = audit(
      [deduct({ passId: "first", occurredAt: day })],
      [
        pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 5, 1) }),
        pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2026, 10, 30) }),
      ],
    );
    assert.deepEqual(found, [], day.toISOString());
  }
});

test("a pass with nothing left was never a candidate", () => {
  const found = audit(
    [deduct({ passId: "first" })],
    [
      pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 5, 1) }),
      pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2026, 10, 30), remainingCount: 0 }),
    ],
  );
  assert.deepEqual(found, []);
});

test("a pass that had already expired was never a candidate", () => {
  /* 차감한 날에 이미 만료된 회원권은 쓸 수 없었다. 그것을 "먼저 썼어야 한다"
     고 적으면 고칠 수 없는 과거가 목록에 선다. */
  const found = audit(
    [deduct({ passId: "first" })],
    [
      pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 5, 1) }),
      pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2026, 8, 30) }),
    ],
  );
  assert.deepEqual(found, []);
});

test("1:1 and 2:1 are never compared", () => {
  /* 서로의 후보가 아니다. 견주면 아무 문제 없는 회원권이 매번 걸린다. */
  const found = audit(
    [deduct({ passId: "solo" })],
    [
      pass({ id: "solo", purchaseRound: 1, expiresAt: new Date(2027, 5, 1) }),
      pass({
        id: "duet", purchaseRound: 2, category: "pt_2_1_repurchase",
        clientIds: ["c1", "c2"], expiresAt: new Date(2026, 10, 30),
      }),
    ],
  );
  assert.deepEqual(found, []);
});

test("diosa A and B are their own kinds", () => {
  // 따로 파는 회원권이다. A 로 B 수업을 할 수 없다.
  assert.equal(candidateKind(pass({ category: "diosa_a" })), "diosa_a");
  assert.equal(candidateKind(pass({ category: "diosa_b" })), "diosa_b");
  assert.equal(candidateKind(pass({ category: "pt_2_1_new" })), "duet");
  assert.equal(candidateKind(pass({ clientIds: ["c1", "c2"] })), "duet");
  assert.equal(candidateKind(pass()), "solo");
});

test("another member's pass is never the one that should have been used", () => {
  const found = audit(
    [deduct({ passId: "mine" })],
    [
      pass({ id: "mine", clientId: "c1", expiresAt: new Date(2027, 5, 1) }),
      pass({ id: "theirs", clientId: "c9", purchaseRound: 2, expiresAt: new Date(2026, 10, 30) }),
    ],
  );
  assert.deepEqual(found, []);
});

test("a pass with no expiry date is never the one that should have been used", () => {
  /* "언제까지든 쓸 수 있다" 는 뜻이라 급하지 않다. 먼저 썼어야 할 이유가 없다. */
  const found = audit(
    [deduct({ passId: "first" })],
    [
      pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 5, 1) }),
      pass({ id: "forever", purchaseRound: 2, expiresAt: null }),
    ],
  );
  assert.deepEqual(found, []);
});

/* ── 그때의 잔여를 되짚는다 ──────────────────────────────────────────────── */

test("the count is rewound, so a pass spent later still counted back then", () => {
  /* 지금 잔여로 보면 그 뒤에 일어난 차감까지 섞여, 그때 쓸 수 있었던 회원권을
     "없었다" 로 읽는다 -- 그러면 목록이 비고 아무 문제 없어 보인다. */
  const found = audit(
    [
      deduct({ id: "a", passId: "first", occurredAt: new Date(2026, 9, 12) }),
      // 그 뒤에 second 를 다 썼다. 지금 잔여는 0 이지만 12일에는 1 이 있었다.
      deduct({ id: "b", passId: "second", occurredAt: new Date(2026, 9, 20) }),
    ],
    [
      pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 5, 1) }),
      pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2026, 10, 30), remainingCount: 0 }),
    ],
  );
  assert.deepEqual(found.map((row) => row.entryId), ["a"]);
});

test("a pass we could not read is skipped, not guessed", () => {
  const found = audit([deduct({ passId: "gone" })], []);
  assert.deepEqual(found, []);
});
