import assert from "node:assert/strict";
import test from "node:test";
import { currentPassUsage } from "../../src/features/membership/pass-usage.js";

/* 회원 카드 "지금 회원권" (2026-11-08). 여정 전체가 아니라 지금 것만, 미리 끊은 다음 회원권은 따로. */

const seg = (round, total, used, active = true) => ({ kind: "pass", round, total, used, active });
const prior = { kind: "prior", round: 0, total: 36, used: 36, active: false };

test("지금 회원권만: 앱 이전 · 끝난 회원권은 세지 않는다", () => {
  const usage = currentPassUsage({ segments: [prior, seg(1, 20, 20, false), seg(5, 20, 12)], currentRound: 5 });
  assert.equal(usage.title, "이번 회원권 · 5번째 등록");
  assert.equal(usage.usage, "20회 중 12회 사용");
  assert.equal(usage.remaining, 8);
  assert.equal(usage.waiting, null);
});

test("미리 끊은 다음 회원권은 합치지 않고 대기로", () => {
  const usage = currentPassUsage({ segments: [seg(4, 20, 18), seg(5, 20, 0)], currentRound: 5 });
  assert.equal(usage.title, "이번 회원권 · 4번째 등록", "지금 쓰는 것은 4번째");
  assert.equal(usage.usage, "20회 중 18회 사용");
  assert.deepEqual(usage.waiting, { passes: 1, total: 20, label: "다음 회원권 · 20회 대기" });
  const two = currentPassUsage({ segments: [seg(3, 10, 4), seg(4, 10, 0), seg(5, 20, 0)] });
  assert.equal(two.waiting.label, "다음 회원권 2개 · 30회 대기");
});

test("둘 다 쓰는 중(예: 1:1 과 2:1)이면 함께 '사용 중', 아무것도 안 썼으면 맨 앞이 지금", () => {
  const both = currentPassUsage({ segments: [seg(1, 20, 5), seg(1, 10, 2)] });
  assert.equal(both.title, "사용 중인 회원권 2개");
  assert.equal(both.usage, "30회 중 7회 사용");
  assert.equal(both.waiting, null);
  const fresh = currentPassUsage({ segments: [seg(1, 20, 0), seg(2, 20, 0)] });
  assert.equal(fresh.usage, "20회 중 0회 사용");
  assert.equal(fresh.title, "이번 회원권");
  assert.equal(fresh.waiting.label, "다음 회원권 · 20회 대기");
});

test("진행 중 회원권이 없으면 줄이 없다", () => {
  assert.equal(currentPassUsage({ segments: [seg(1, 10, 10, false)] }), null);
  assert.equal(currentPassUsage(null), null);
});
