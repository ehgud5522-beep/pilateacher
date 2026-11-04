/**
 * 담당 강사 고르기 — 지점 칩 · 이름 검색 · 맡은 지점 밖 판정.
 *
 * 회원권 발급과 담당 변경이 같은 판정을 쓴다. 강사가 60명을 넘으면서 칩을
 * 한 줄로 늘어놓는 것으로는 찾을 수 없게 됐다 (2026-11-04 대표).
 *
 * ── 기본 지점 ──
 * FC매니저 · 직원 · 강사는 **자기 지점**이 기본, 대표 · 총괄매니저는 **전체**.
 * 지점을 여럿 맡은 FC매니저는 회원의 지점이 그중 하나면 그것, 아니면 첫 지점.
 *
 * ── 겸직 ──
 * 소속 문서의 지점은 scopedLocationIds 로 읽는다 (locationIds 가 먼저, 없으면
 * locationId). 지점이 둘인 강사는 두 지점 칩 어디서나 보인다.
 *
 * ── 지점이 비어 있는 강사 ──
 * 어느 지점 칩에서나 보인다. 빼면 그 강사는 어느 화면에서도 고를 수 없고,
 * 아무도 그 사실을 모른다 -- itemsVisibleTo 와 같은 판단이다.
 */

import {
  ALL_LOCATIONS, BRANCH_LIST_SCOPED_ROLES, BRANCH_SCOPED_ROLES, scopedLocationIds,
} from "../../data/repositories/location-repository.js";

/** 맡은 지점 밖의 강사를 담당으로 지정하려 한 것. 화면과 진단이 같은 코드를 쓴다. */
export const INSTRUCTOR_OUT_OF_SCOPE = "instructor_out_of_scope";

export const INSTRUCTOR_OUT_OF_SCOPE_MESSAGE =
  `맡은 지점 밖의 강사는 담당으로 지정할 수 없어요. (코드 ${INSTRUCTOR_OUT_OF_SCOPE})`;

const text = (value) => String(value ?? "").trim();
const folded = (value) => text(value).replace(/\s+/g, "").toLowerCase();

/** @param {any} instructor */
export const instructorLocationIds = (instructor) => scopedLocationIds(instructor);

/**
 * 처음 눌려 있을 지점 칩.
 *
 * @param {{ role?: string, locationId?: string, locationIds?: Array<string> }} viewer
 * @param {Array<{ id: string }>} locations 칩으로 그릴 지점 (이미 범위로 좁힌 것)
 * @param {string} [preferredLocationId] 회원의 지점. 맡은 지점 중 하나면 그것
 */
export function defaultPickerLocation(viewer, locations = [], preferredLocationId = "") {
  const role = text(viewer?.role);
  if (!BRANCH_SCOPED_ROLES.includes(role)) return ALL_LOCATIONS;
  const known = new Set((Array.isArray(locations) ? locations : []).map((item) => text(item?.id)));
  const mine = scopedLocationIds(viewer).filter((id) => known.has(id));
  const preferred = text(preferredLocationId);
  if (preferred && mine.includes(preferred)) return preferred;
  return mine[0] || ALL_LOCATIONS;
}

/**
 * 칩과 검색으로 거른 강사. 순서는 받은 그대로다 (부르는 쪽이 이름순으로 준다).
 *
 * @param {Array<any>} instructors
 * @param {{ locationId?: string, query?: string }} [filter]
 */
export function pickerInstructors(instructors, filter = {}) {
  const locationId = text(filter.locationId) || ALL_LOCATIONS;
  const query = folded(filter.query);
  return (Array.isArray(instructors) ? instructors : [])
    .filter(Boolean)
    .filter((item) => {
      if (locationId === ALL_LOCATIONS) return true;
      const theirs = instructorLocationIds(item);
      return theirs.length === 0 || theirs.includes(locationId);
    })
    .filter((item) => !query || folded(item.displayName).includes(query));
}

/**
 * 칩에 붙일 소속 지점. 겸직이면 둘 다, 없으면 "지점 없음".
 *
 * @param {any} instructor @param {Array<{ id: string, name?: string }>} locations
 */
export function instructorLocationLabel(instructor, locations = []) {
  const names = instructorLocationIds(instructor).map((id) => {
    const found = (Array.isArray(locations) ? locations : []).find((item) => text(item?.id) === id);
    return text(found?.name) || "다른 지점";
  });
  return names.length ? names.join(" · ") : "지점 없음";
}

/**
 * 이 사람이 이 강사를 담당으로 지정하면 **맡은 지점 밖**인가.
 *
 * FC매니저만 좁힌다 (BRANCH_LIST_SCOPED_ROLES -- 명단과 같은 선). 대표 ·
 * 총괄매니저는 센터 전체를 맡는다. 맡은 지점이 비어 있거나 강사의 지점이
 * 비어 있으면 막지 않는다 -- 모를 때는 막지 않는 쪽이 itemsVisibleTo 와 같다.
 *
 * 규칙은 이 판정을 하지 않는다 (2026-11-04 기준). 화면과 저장 직전이 막는다.
 *
 * @param {{ role?: string, locationId?: string, locationIds?: Array<string> }} viewer
 * @param {any} instructor
 */
export function instructorOutsideScope(viewer, instructor) {
  const role = text(viewer?.role);
  if (!BRANCH_LIST_SCOPED_ROLES.includes(role)) return false;
  const mine = scopedLocationIds(viewer);
  if (mine.length === 0) return false;
  const theirs = instructorLocationIds(instructor);
  if (theirs.length === 0) return false;
  return !theirs.some((id) => mine.includes(id));
}
