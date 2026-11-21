/**
 * 강사별 집계를 지점으로 (2026-11-21 대표: "항상 지점별로 강사 하나씩").
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NO_BRANCH, branchIdsOf, groupRowsByBranch, pickBranch } from "../../src/features/records/branch-groups.js";
import { scopedLocationIds } from "../../src/data/repositories/location-repository.js";

test("지점 규칙은 소속 범위(scopedLocationIds)와 같다", () => {
  for (const member of [{}, { locationId: "a" }, { locationIds: ["b", "b", "c"], locationId: "a" }, { locationIds: [], locationId: " d " }]) {
    assert.deepEqual(branchIdsOf(member), scopedLocationIds(member));
  }
});

test("지점별로 나눔: 두 지점 강사는 둘 다 · 지점 없음 · 명부에 없는 강사는 맨 뒤 · 계정 바꾼 강사 합침", () => {
  const rows = [{ instructorId: "a" }, { instructorId: "b" }, { instructorId: "c" }, { instructorId: "ghost" }, { instructorId: "d" }];
  const groups = groupRowsByBranch(rows, {
    instructors: [
      { userId: "a", locationId: "yul" },
      { userId: "b", locationIds: ["yul", "jwa"] },
      { userId: "c" },
      { userId: "d-old", locationId: "jang" },
    ],
    locations: [{ id: "yul", name: "율하" }, { id: "jwa", name: "좌동" }, { id: "jang", name: "장유" }],
    canonicalInstructorId: (id) => (id === "d-old" ? "d" : String(id ?? "")),
  });
  assert.deepEqual(groups.map((group) => [group.name, group.rows.map((row) => row.instructorId)]), [
    ["율하", ["a", "b"]],
    ["장유", ["d"]],
    ["좌동", ["b"]],
    ["지점 없음", ["c", "ghost"]],
  ]);
  assert.equal(groups.at(-1).id, NO_BRANCH);
});

test("고른 지점이 없어지면 첫 지점으로", () => {
  const groups = [{ id: "x" }, { id: "y" }];
  assert.equal(pickBranch(groups, "y"), "y");
  assert.equal(pickBranch(groups, "gone"), "x");
  assert.equal(pickBranch([], "x"), "");
});

test("화면 배선: 세 집계 화면 모두 지점 칩 · 강사 카드 하나씩", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.equal(app.match(/<BranchTabs /g)?.length, 3, "레이더 · 기록 현황 · 비포애프터 현황");
  assert.ok(app.includes("function BranchTabs("));
});
