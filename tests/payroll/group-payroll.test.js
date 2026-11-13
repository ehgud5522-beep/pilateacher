import assert from "node:assert/strict";
import test from "node:test";
import { payrollClientCsv, summarizeOrganizationPay } from "../../src/data/repositories/payroll-repository.js";

test("monthly group pay joins ordinary pay and remains visible for group-only instructors and in CSV", () => {
  const entries = [{ instructorId: "a", locationId: "east", delta: -1, unitPrice: 30000 }];
  const groupRows = [
    { instructorId: "a", locationId: "east", fullCount: 2, emptyCount: 1, fullRate: 45000 },
    { instructorId: "a", locationId: "west", fullCount: 0, emptyCount: 1, fullRate: 45000 },
    { instructorId: "b", locationId: "east", fullCount: 0, emptyCount: 2, fullRate: 0 },
  ];
  const summary = { month: "2026-11", ...summarizeOrganizationPay(entries, { groupRows }) };
  assert.equal(summary.total, 220000);
  assert.equal(summary.sessions, 7);
  assert.deepEqual(summary.byInstructor.map(({ instructorId, total }) => [instructorId, total]), [["a", 170000], ["b", 50000]]);
  assert.deepEqual(summary.byLocation.map(({ locationId, total }) => [locationId, total]), [["east", 195000], ["west", 25000]]);
  const csv = payrollClientCsv(summary, {}, { instructorId: "a", locationId: "east" });
  assert.match(csv, /east,a,,그룹 풀방,,2,45000,90000/);
  assert.match(csv, /east,a,,그룹 빈방,,1,25000,25000/);
  assert.doesNotMatch(csv, /west|east,b/);
});
