/**
 * 강사별 집계를 지점으로 나눈다 (2026-11-21 대표: "항상 취합하는 거 나올 땐 지점별로 강사 하나씩 볼 수 있게").
 *
 * 재등록 레이더 · 강사 기록 현황 · 비포애프터 공유 현황이 같이 쓴다. 앞으로 만드는 강사별 집계도 여기를 쓴다.
 *  - 지점 = 소속의 locationIds, 없으면 locationId (location-repository.js 의 scopedLocationIds 와 같은 규칙)
 *  - 두 지점 소속 강사는 두 지점에 다 선다
 *  - 명부에 없거나 지점이 없는 강사는 "지점 없음" -- 빠뜨리지 않는다
 * 순수 함수다.
 */

const text = (value) => String(value ?? "").trim();

export const NO_BRANCH = "__no_branch__";
export const NO_BRANCH_LABEL = "지점 없음";

/** 소속 하나의 지점들. */
export function branchIdsOf(membership) {
  const many = (Array.isArray(membership?.locationIds) ? membership.locationIds : []).map(text).filter(Boolean);
  if (many.length) return [...new Set(many)];
  const one = text(membership?.locationId);
  return one ? [one] : [];
}

/**
 * @param {any[]} rows  instructorId 가 있는 강사 줄
 * @param {{ instructors?: any[], locations?: any[], canonicalInstructorId?: (id: unknown) => string }} options
 * @returns {Array<{ id: string, name: string, rows: any[] }>}  지점 이름 순, "지점 없음" 은 맨 뒤. 줄 순서는 들어온 그대로
 */
export function groupRowsByBranch(rows, { instructors = [], locations = [], canonicalInstructorId } = {}) {
  const canonical = typeof canonicalInstructorId === "function" ? canonicalInstructorId : (id) => text(id);
  const branchesBy = new Map();
  for (const member of instructors || []) {
    const key = canonical(member?.userId) || text(member?.userId);
    if (!key) continue;
    const merged = new Set([...(branchesBy.get(key) || []), ...branchIdsOf(member)]);
    branchesBy.set(key, [...merged]);
  }
  const nameOf = new Map((locations || []).map((location) => [text(location?.id), text(location?.name)]));
  const groups = new Map();
  for (const row of rows || []) {
    const ids = branchesBy.get(text(row?.instructorId)) || [];
    for (const id of ids.length ? ids : [NO_BRANCH]) {
      if (!groups.has(id)) groups.set(id, { id, name: id === NO_BRANCH ? NO_BRANCH_LABEL : nameOf.get(id) || id, rows: [] });
      groups.get(id).rows.push(row);
    }
  }
  return [...groups.values()].sort((left, right) => (left.id === NO_BRANCH) - (right.id === NO_BRANCH) || left.name.localeCompare(right.name, "ko"));
}

/** 고른 지점이 사라졌으면(새로고침 뒤 빈 지점) 첫 지점으로. */
export function pickBranch(groups, selected) {
  const list = Array.isArray(groups) ? groups : [];
  return list.some((group) => group.id === selected) ? selected : (list[0]?.id || "");
}
