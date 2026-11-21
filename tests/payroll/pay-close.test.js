/**
 * 서버 급여 확정의 계산이 화면(급여 집계)과 같은가 (2026-11-22 외부 검토 2차).
 * 같은 원장 · 그룹 급여 · 심사용 회원 · 계정 바꾼 강사를 두 계산에 돌려 강사별 금액이 같아야 한다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { summarizeOrganizationPay } from "../../src/data/repositories/payroll-repository.js";
import { withoutReviewDemo } from "../../src/features/members/review-demo.js";
import { buildPayClose, kstMonthRange, lessonTotalsByInstructor } from "../../functions/shared/pay-close.mjs";

const ORG = "o1";
const entry = (id, instructorId, unitPrice, extra = {}) => ({
  id, organizationId: ORG, instructorId, type: "deduct", delta: -1, unitPrice, clientId: "c1", locationId: "bansong", category: "pt_1_1_new",
  occurredAt: new Date("2026-11-12T03:00:00Z"), ...extra,
});
const entries = [
  entry("a", "t1", 30000), entry("b", "t1", 45000), entry("c", "t1", 30000, { type: "correction", delta: 1 }),
  entry("d", "t2-old", 25000), entry("e", "t2", 25000), entry("demo", "t1", 99999, { clientId: "demo" }),
];
const groupRows = [{ instructorId: "t2", locationId: "bansong", fullCount: 3, fullRate: 20000, emptyCount: 2 }];
const canonicalInstructorId = (id) => (String(id) === "t2-old" ? "t2" : String(id || ""));
const excluded = new Set(["demo"]);

test("강사별 수업료: 화면(summarizeOrganizationPay)과 서버(lessonTotalsByInstructor)가 같다", () => {
  const screen = summarizeOrganizationPay(withoutReviewDemo(entries, excluded), { canonicalInstructorId, groupRows });
  const server = lessonTotalsByInstructor({ organizationId: ORG, month: "2026-11", entries, groupRows, excludedClientIds: excluded, canonicalInstructorId });
  for (const row of screen.byInstructor) assert.equal(server.get(row.instructorId), row.total, row.instructorId);
  assert.equal(server.size, screen.byInstructor.length);
  assert.equal(server.get("t2"), 25000 + 25000 + 3 * 20000 + 2 * 25000);
});

test("한국 시각 달 경계: 11월은 10/31 15:00Z ~ 11/30 15:00Z, 다른 센터 · 발급 항목은 뺀다", () => {
  const { start, end } = kstMonthRange("2026-11");
  assert.equal(start.toISOString(), "2026-10-31T15:00:00.000Z");
  assert.equal(end.toISOString(), "2026-11-30T15:00:00.000Z");
  const totals = lessonTotalsByInstructor({ organizationId: ORG, month: "2026-11", entries: [
    entry("edge-in", "t1", 1000, { occurredAt: new Date("2026-10-31T15:00:00Z") }),
    entry("edge-out", "t1", 2000, { occurredAt: new Date("2026-11-30T15:00:00Z") }),
    entry("other", "t1", 4000, { organizationId: "o2" }),
    entry("issue", "t1", 8000, { type: "issue" }),
  ] });
  assert.equal(totals.get("t1"), 1000);
});

test("확정 명세: 조정만 있는 강사도 줄이 서고, 취소한 조정은 빠진다", () => {
  const result = buildPayClose({
    lessons: new Map([["t1", 100000]]),
    adjustments: [{ instructorId: "t3", amount: 50000, reason: "대타" }, { instructorId: "t1", amount: -10000, reason: "x", canceledAt: new Date() }],
  });
  assert.deepEqual(result.statements.map((item) => [item.instructorId, item.snapshot.gross]), [["t1", 100000], ["t3", 50000]]);
});
