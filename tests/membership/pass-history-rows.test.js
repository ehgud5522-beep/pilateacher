/**
 * 회원 상세의 등록 이력 (2026-11-16 대표: "남은 횟수 그래프가 이해하기 힘듦").
 * 회원권마다 한 줄, 최근 것이 위. 미리 끊은 회원권은 "대기", 끝난 것에 남은 회차는 "못 씀".
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildPassJourney } from "../../functions/shared/pass-journey.mjs";
import { passHistoryRows } from "../../src/features/membership/pass-usage.js";

const pass = (id, round, total, remaining, status, extra = {}) => ({
  id, purchaseRound: round, totalSessions: total, serviceSessions: 0, remainingCount: remaining, status,
  createdAt: new Date(2026, round, 1), ...extra,
});

test("회원권마다 한 줄 · 최근 것이 위 · 상태별 말", () => {
  const journey = buildPassJourney({
    passes: [
      pass("a", 1, 20, 0, "completed"),
      pass("b", 2, 30, 3, "expired"),
      pass("c", 3, 30, 18, "active", { serviceSessions: 2 }),
      pass("d", 4, 50, 50, "active"),
    ],
    instructorSessions: 74,
  });
  const { rows, usedTotal, passCount } = passHistoryRows(journey);
  assert.deepEqual(rows.map((row) => [row.label, row.detail, row.state]), [
    ["4차 · 50회", "대기 · 50회", "waiting"],
    ["3차 · 32회 (서비스 2)", "18회 남음", "using"],
    ["2차 · 30회", "끝남 · 3회 못 씀", "lapsed"],
    ["1차 · 20회", "다 씀", "done"],
    ["앱 이전 기록", "13회 수업", "prior"],
  ]);
  assert.equal(usedTotal, 74);
  assert.equal(passCount, 4);
});

test("하나도 안 쓴 회원권 하나뿐이면 대기가 아니라 사용 중", () => {
  const { rows } = passHistoryRows(buildPassJourney({ passes: [pass("a", 1, 20, 20, "active")] }));
  assert.deepEqual(rows.map((row) => [row.detail, row.state]), [["20회 남음", "using"]]);
});

test("둘 다 쓰는 중이면 둘 다 사용 중", () => {
  const { rows } = passHistoryRows(buildPassJourney({ passes: [pass("a", 1, 20, 5, "active"), pass("b", 2, 10, 9, "active")] }));
  assert.deepEqual(rows.map((row) => row.state), ["using", "using"]);
});

test("빈 여정은 빈 목록", () => {
  assert.deepEqual(passHistoryRows(null), { rows: [], usedTotal: 0, passCount: 0 });
});
