/**
 * 현황판 강사 표의 줄 세우기 (2026-11-21 대표 승인 "현황판 웹 배치안" 1단계).
 *
 * 머리를 누르면 그 열로: 처음은 큰 것부터(숫자 열) · 가나다(이름 열), 한 번 더 누르면 반대.
 * 값이 없는 칸(보고 없음 · 결과 없음)은 어느 쪽으로 세워도 맨 뒤 -- "없음" 이 "0" 처럼 위로 오면 안 된다.
 * 같은 값이면 들어온 순서 그대로 (화면이 정한 기본 순서가 깨지지 않게). 순수 함수다.
 */

const isBlank = (value) => value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value)) || value === "";

/** 다음 정렬 상태. 처음 누르면 firstDir(숫자 열은 큰 것부터 "desc", 이름 열은 가나다 "asc"), 같은 열을 다시 누르면 뒤집는다. */
export function nextAggregateSort(current, key, firstDir = "desc") {
  if (current?.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: firstDir === "asc" ? "asc" : "desc" };
}

/**
 * @param {any[]} rows
 * @param {Array<{ key: string, sortValue?: (row: any) => any }>} columns
 * @param {null | { key: string, dir: "asc" | "desc" }} sort
 */
export function sortAggregateRows(rows, columns, sort) {
  const list = Array.isArray(rows) ? rows : [];
  const column = sort ? (columns || []).find((item) => item.key === sort.key) : null;
  if (!column?.sortValue) return list;
  const sign = sort.dir === "asc" ? 1 : -1;
  return list.map((row, index) => ({ row, index, value: column.sortValue(row) }))
    .sort((left, right) => {
      const leftBlank = isBlank(left.value);
      const rightBlank = isBlank(right.value);
      if (leftBlank || rightBlank) return leftBlank === rightBlank ? left.index - right.index : (leftBlank ? 1 : -1);
      const compared = typeof left.value === "string" || typeof right.value === "string"
        ? String(left.value).localeCompare(String(right.value), "ko")
        : left.value - right.value;
      return compared ? compared * sign : left.index - right.index;
    })
    .map((item) => item.row);
}
