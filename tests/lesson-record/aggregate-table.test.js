/**
 * 현황판 강사 표 줄 세우기 (2026-11-21 "현황판 웹 배치안" 1단계).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nextAggregateSort, sortAggregateRows } from "../../src/features/records/aggregate-table.js";

const rows = [
  { id: "a", name: "나강사", rate: 0.5 },
  { id: "b", name: "가강사", rate: null },
  { id: "c", name: "다강사", rate: 0.9 },
  { id: "d", name: "라강사", rate: 0.5 },
];
const columns = [{ key: "name", sortValue: (row) => row.name }, { key: "rate", sortValue: (row) => row.rate }, { key: "plain" }];
const ids = (list) => list.map((row) => row.id).join("");

test("처음은 큰 것부터 · 다시 누르면 반대 · 이름 열은 가나다부터", () => {
  assert.deepEqual(nextAggregateSort(null, "rate"), { key: "rate", dir: "desc" });
  assert.deepEqual(nextAggregateSort({ key: "rate", dir: "desc" }, "rate"), { key: "rate", dir: "asc" });
  assert.deepEqual(nextAggregateSort({ key: "rate", dir: "asc" }, "name", "asc"), { key: "name", dir: "asc" });
});

test("값 없는 칸은 어느 쪽이든 맨 뒤 · 같은 값은 들어온 순서", () => {
  assert.equal(ids(sortAggregateRows(rows, columns, { key: "rate", dir: "desc" })), "cadb");
  assert.equal(ids(sortAggregateRows(rows, columns, { key: "rate", dir: "asc" })), "adcb");
  assert.equal(ids(sortAggregateRows(rows, columns, { key: "name", dir: "asc" })), "bacd");
  assert.equal(ids(sortAggregateRows(rows, columns, null)), "abcd", "정렬 전에는 화면이 정한 순서");
  assert.equal(ids(sortAggregateRows(rows, columns, { key: "plain", dir: "asc" })), "abcd", "세울 수 없는 열");
});

test("화면 배선: 세 현황판이 PC 표 · 오른쪽 상세 · 요약 줄을 쓴다", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.equal(app.match(/<AggregateSplit /g)?.length, 6, "현황판 셋 + 돈 화면 둘 + 매출 인센");
  assert.equal(app.match(/<InstructorTable /g)?.length, 6, "현황판 셋 + 돈 화면 둘 + 매출 인센");
  assert.equal(app.match(/<SummaryTiles /g)?.length, 7, "현황판 셋 + 돈 화면 둘 + 매출 인센(강사 · FC 대표 화면 둘)");
  for (const key of ['key: "renewal-radar"', 'key: "record-board"', 'key: "before-after-board"']) assert.ok(app.includes(key), key);
  assert.ok(app.indexOf('{ label: "현황판"') < app.indexOf('{ label: "돈"') && app.indexOf('{ label: "돈"') < app.indexOf('{ label: "관리"'), "현황판 → 돈 → 관리");
});
