import assert from "node:assert/strict";
import test from "node:test";
import { homeSummary } from "../../member/src/home-summary.js";

/* 홈 카드의 이름 · 날짜 · 링이 같은 회원권들에서 오는지 (2026-10-30 고침). */

const NOW = new Date(2026, 9, 30);
const usable = (pass) => pass.status === "active" && pass.remainingCount > 0;
const pass = (id, overrides) => ({
  passId: id, status: "active", totalSessions: 10, serviceSessions: 0, remainingCount: 5, ...overrides,
});

test("이름과 만료일은 같은 회원권 — 가장 먼저 끝나는 것", () => {
  const later = pass("later", { lessonType: "2:1", expiresAt: new Date(2027, 5, 1) });
  const sooner = pass("sooner", { lessonType: "1:1", expiresAt: new Date(2026, 11, 1) });
  // 서버 목록 순서가 어떻든 같은 답이어야 한다.
  for (const order of [[later, sooner], [sooner, later]]) {
    const summary = homeSummary({ passes: order }, usable, NOW);
    assert.equal(summary.front.passId, "sooner");
    assert.equal(summary.expiresAt, sooner.expiresAt);
    assert.equal(summary.others, 1);
  }
});

test("링의 분자와 분모는 같은 범위 — 쓸 수 있는 회원권 전부", () => {
  const summary = homeSummary({
    passes: [
      pass("a", { totalSessions: 10, serviceSessions: 2, remainingCount: 4 }),
      pass("b", { totalSessions: 20, serviceSessions: 0, remainingCount: 15 }),
      pass("done", { status: "active", remainingCount: 0, totalSessions: 30 }),
    ],
  }, usable, NOW);
  assert.equal(summary.remaining, 19);
  assert.equal(summary.ringTotal, 32);
  assert.ok(summary.remaining <= summary.ringTotal, "링 비율이 1 을 넘으면 잘린다");
});

test("만료일이 없는 회원권은 뒤로", () => {
  const summary = homeSummary({
    passes: [pass("open"), pass("dated", { expiresAt: new Date(2027, 0, 1) })],
  }, usable, NOW);
  assert.equal(summary.front.passId, "dated");
});

test("쓸 수 있는 것이 없으면 날짜를 말하지 않는다", () => {
  const summary = homeSummary({
    passes: [pass("used", { remainingCount: 0, expiresAt: new Date(2026, 11, 1) })],
  }, usable, NOW);
  assert.equal(summary.front.passId, "used");
  assert.equal(summary.expiresAt, null);
  assert.equal(summary.remaining, 0);
  assert.equal(summary.ringTotal, 0);
});
