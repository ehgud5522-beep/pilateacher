/**
 * 회원권 이력의 달 묶음 (2026-11-04): 머리줄의 숫자 · 회원권 칩 · 보정과 조정 줄.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_PASSES, UNKNOWN_MONTH, entryCountsByPass, historyMonths, monthHeading,
} from "../../src/features/membership/pass-history-months.js";

const NOW = new Date(2026, 10, 4, 12, 0);
const ENTRIES = [
  { id: "d1", passId: "p1", type: "deduct", delta: -1, unitPrice: 30000, occurredAt: new Date(2026, 10, 3, 10) },
  { id: "d2", passId: "p2", type: "deduct", delta: -1, unitPrice: 25000, occurredAt: new Date(2026, 10, 1, 10) },
  { id: "a1", passId: "p1", type: "adjust", delta: -3, reason: "이관 누락분 보정", occurredAt: new Date(2026, 10, 2, 9) },
  { id: "d3", passId: "p1", type: "deduct", delta: -1, unitPrice: 30000, occurredAt: new Date(2026, 9, 20, 10) },
  { id: "c1", passId: "p1", type: "correction", delta: 1, unitPrice: 30000, correctsEntryId: "d3", reason: "잘못 누름", occurredAt: new Date(2026, 9, 21, 9) },
  { id: "i1", passId: "p1", type: "issue", delta: 20, occurredAt: new Date(2025, 11, 1, 9) },
  { id: "x", passId: "p2", type: "deduct", delta: -1, unitPrice: 25000, occurredAt: null },
];

test("최근 달이 앞, 날짜 없는 줄은 맨 뒤 · 달 안의 순서는 그대로", () => {
  const months = historyMonths(ENTRIES);
  assert.deepEqual(months.map((month) => month.key), ["2026-11", "2026-10", "2025-12", UNKNOWN_MONTH]);
  assert.deepEqual(months[0].entries.map((entry) => entry.id), ["d1", "d2", "a1"]);
});

test("머리줄: 차감 회차 · 보정 건수 — 보정된 차감도 그 달의 차감이다", () => {
  const [nov, oct, dec] = historyMonths(ENTRIES);
  assert.equal(monthHeading(nov, { now: NOW }), "11월 · 차감 2회 · 보정 0건");
  assert.equal(monthHeading(oct, { now: NOW }), "10월 · 차감 1회 · 보정 1건");
  assert.equal(monthHeading(dec, { now: NOW }), "2025년 12월 · 차감 0회 · 보정 0건", "다른 해는 연도를 붙인다");
});

test("급여 합계는 부를 때만 붙고, 차감 + 보정만 센다 (조정 · 발급은 급여가 아니다)", () => {
  const [nov, oct] = historyMonths(ENTRIES);
  assert.equal(monthHeading(nov, { now: NOW, showPay: true }), "11월 · 차감 2회 · 보정 0건 · 급여 ₩55,000");
  assert.equal(monthHeading(oct, { now: NOW, showPay: true }), "10월 · 차감 1회 · 보정 1건 · 급여 ₩0");
  assert.doesNotMatch(monthHeading(nov, { now: NOW }), /급여/);
});

test("회원권 칩으로 거르면 그 회원권 줄만 — 보정과 조정 줄은 그대로 남는다", () => {
  const months = historyMonths(ENTRIES, { passId: "p1" });
  const ids = months.flatMap((month) => month.entries.map((entry) => entry.id));
  assert.deepEqual(ids, ["d1", "a1", "d3", "c1", "i1"]);
  assert.equal(historyMonths(ENTRIES, { passId: ALL_PASSES }).flatMap((month) => month.entries).length, ENTRIES.length);
  assert.deepEqual(historyMonths(ENTRIES, { passId: "none" }), []);
});

test("칩의 숫자는 회원권별 줄 수", () => {
  assert.deepEqual(entryCountsByPass(ENTRIES), { p1: 5, p2: 2 });
});
