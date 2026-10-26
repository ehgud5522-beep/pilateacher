import assert from "node:assert/strict";
import test from "node:test";

import {
  BRANCH_SCOPED_ROLES, canSeeLocation, holdsManyLocations, itemsVisibleTo, locationsVisibleTo,
  scopedLocationIds,
} from "../../src/data/repositories/location-repository.js";

/**
 * 지점 범위 — **대표 확정 (2026-10-26).**
 *
 * FC매니저만 지점을 여럿 갖는다. 그 사람은 맡은 지점만 보고, 강사·팀장·점장의
 * 동작은 바뀌지 않으며, 대표·총괄매니저는 전 지점을 그대로 본다.
 *
 * ── 왜 한 곳에서 보는가 ──
 * 범위를 정하는 자리가 화면마다 흩어지면 한 화면만 넓게 남는 날이 오고, 그날
 * FC매니저는 남의 지점 회원을 본다. 그래서 판단은 이 네 함수뿐이고, 화면은
 * 그것을 부르기만 한다.
 */

const LOCATIONS = [{ id: "yulha" }, { id: "bansong" }, { id: "centum" }];

const member = (id, locationId) => ({ id, locationId });

/* ── 어느 역할이 좁혀지는가 ─────────────────────────────────────────────── */

test("좁혀지는 역할은 셋뿐이고, 대표·총괄매니저는 들어 있지 않다", () => {
  /* 대표·총괄매니저를 좁히면 이관도 급여도 반쪽만 보인다 -- 센터 전체를
     보는 자리다. */
  assert.deepEqual([...BRANCH_SCOPED_ROLES].sort(), ["instructor", "manager", "staff"]);
  assert.equal(BRANCH_SCOPED_ROLES.includes("owner"), false);
  assert.equal(BRANCH_SCOPED_ROLES.includes("area_manager"), false);
});

test("지점을 여럿 갖는 것은 FC매니저뿐이다", () => {
  assert.equal(holdsManyLocations("manager"), true);
  for (const role of ["owner", "area_manager", "instructor", "staff", ""]) {
    assert.equal(holdsManyLocations(role), false, `${role} 는 한 지점이다`);
  }
});

/* ── 옛 필드와 새 필드를 함께 읽는다 ───────────────────────────────────── */

test("locationIds 가 없으면 locationId 로 대신 읽는다", () => {
  /* 옛 앱이 깔린 폰은 아직 한 칸짜리만 쓴다. 새 필드만 보면 그 사람의 지점이
     통째로 사라지고, 화면에는 "회원이 없다" 로 도착한다. */
  assert.deepEqual(scopedLocationIds({ locationId: "yulha" }), ["yulha"]);
  assert.deepEqual(scopedLocationIds({ locationIds: ["yulha", "bansong"] }), ["yulha", "bansong"]);
  // 둘 다 있으면 새 필드가 이긴다 -- 그쪽이 사람이 마지막으로 고른 것이다.
  assert.deepEqual(scopedLocationIds({ locationId: "centum", locationIds: ["yulha"] }), ["yulha"]);
  assert.deepEqual(scopedLocationIds({}), []);
  assert.deepEqual(scopedLocationIds(null), []);
});

test("빈 값과 중복은 걸러서 돌려준다", () => {
  assert.deepEqual(scopedLocationIds({ locationIds: ["yulha", "", "yulha", "  ", "bansong"] }),
    ["yulha", "bansong"]);
});

/* ── 보여 줄 지점 칩 ───────────────────────────────────────────────────── */

test("FC매니저에게는 맡은 지점 칩만 선다", () => {
  const found = locationsVisibleTo(LOCATIONS, { role: "manager", locationIds: ["yulha", "centum"] });
  assert.deepEqual(found.map((item) => item.id), ["yulha", "centum"]);
});

test("대표와 총괄매니저는 전 지점을 그대로 본다", () => {
  for (const role of ["owner", "area_manager"]) {
    const found = locationsVisibleTo(LOCATIONS, { role, locationIds: ["yulha"] });
    assert.equal(found.length, 3, `${role} 는 좁혀지지 않는다`);
  }
});

test("강사·팀장·점장의 동작은 바뀌지 않는다 — 한 지점 그대로", () => {
  /* 이 셋은 전부터 locationId 한 칸으로 좁혀져 있었다. 그 길이 그대로
     살아 있는지가 이 테스트의 일이다. */
  const found = locationsVisibleTo(LOCATIONS, { role: "instructor", locationId: "bansong" });
  assert.deepEqual(found.map((item) => item.id), ["bansong"]);
});

test("지점을 아직 안 넣은 사람은 거르지 않는다", () => {
  /* 모를 때는 다 보여주는 쪽이 틀려도 덜 틀린다 -- 빈 목록을 주면 그 사람은
     자기 회원까지 잃고, 고칠 칩조차 없다. */
  assert.equal(locationsVisibleTo(LOCATIONS, { role: "manager" }).length, 3);
  assert.equal(locationsVisibleTo(LOCATIONS, { role: "manager", locationIds: [] }).length, 3);
});

test("맡은 지점이 목록에서 사라졌으면 거르지 않는다", () => {
  /* 지워졌거나 못 읽은 것이다. 빈 목록으로 떨어뜨리면 화면이 통째로 빈다. */
  const found = locationsVisibleTo(LOCATIONS, { role: "manager", locationIds: ["gone"] });
  assert.equal(found.length, 3);
});

/* ── 보여 줄 명단 ──────────────────────────────────────────────────────── */

test("FC매니저의 명단은 맡은 지점만 남는다", () => {
  const found = itemsVisibleTo([
    member("a", "yulha"), member("b", "bansong"), member("c", "centum"),
  ], { role: "manager", locationIds: ["yulha", "centum"] });
  assert.deepEqual(found.map((item) => item.id), ["a", "c"]);
});

test("지점이 비어 있는 회원은 명단에 남는다", () => {
  /* 이관 전에 만들어진 회원이 실제로 있다. 빼면 그 회원은 어느 화면에서도
     안 보이고, 아무도 그 사실을 모른다. */
  const found = itemsVisibleTo([
    member("a", "yulha"), member("b", ""), member("c", "bansong"),
  ], { role: "manager", locationIds: ["yulha"] });
  assert.deepEqual(found.map((item) => item.id), ["a", "b"]);
});

test("대표의 명단은 좁혀지지 않는다", () => {
  const all = [member("a", "yulha"), member("b", "bansong")];
  assert.equal(itemsVisibleTo(all, { role: "owner", locationIds: ["yulha"] }).length, 2);
});

/* ── 한 지점을 볼 수 있는가 ────────────────────────────────────────────── */

test("canSeeLocation 은 네 갈래를 가른다", () => {
  const manager = { role: "manager", locationIds: ["yulha", "centum"] };
  assert.equal(canSeeLocation(manager, "yulha"), true);
  assert.equal(canSeeLocation(manager, "bansong"), false);
  // 대표는 늘 참이다.
  assert.equal(canSeeLocation({ role: "owner" }, "bansong"), true);
  // 지점을 안 넣은 사람은 막지 않는다.
  assert.equal(canSeeLocation({ role: "manager" }, "bansong"), true);
});

/* ── 목록 자리에 무엇이 와도 ───────────────────────────────────────────── */

test("못 읽어 null 이 와도 던지지 않는다", () => {
  /* 여기서 던지면 더보기 탭이 통째로 열리지 않는다. */
  assert.deepEqual(locationsVisibleTo(null, { role: "manager" }), []);
  assert.deepEqual(itemsVisibleTo(null, { role: "manager" }), []);
  assert.deepEqual(itemsVisibleTo(undefined, { role: "owner" }), []);
});

/* ── 만료 회원은 강사도 좁힌다 ───────────────────────────────────────────
   **명부와 다른 선이다** (2026-10-26 대표 결정 2항).

   명부에서 강사를 좁히지 않는 이유는 대타 차감이 그 길에 걸려 있기 때문이다.
   만료 회원은 그런 길이 없고, "누구를 챙겨야 하는가" 를 묻는 자리라 남의
   지점 회원이 섞이면 할 일이 아닌 것이 할 일로 보인다. */

test("만료 회원 화면은 강사·팀장·점장도 자기 지점만 본다", () => {
  const all = [member("a", "yulha"), member("b", "bansong")];
  const found = itemsVisibleTo(all, { role: "instructor", locationId: "yulha" },
    { roles: BRANCH_SCOPED_ROLES });
  assert.deepEqual(found.map((item) => item.id), ["a"]);
});

test("만료 회원 화면에서 FC매니저는 맡은 지점 전부를 본다", () => {
  const all = [member("a", "yulha"), member("b", "bansong"), member("c", "centum")];
  const found = itemsVisibleTo(all, { role: "manager", locationIds: ["yulha", "centum"] },
    { roles: BRANCH_SCOPED_ROLES });
  assert.deepEqual(found.map((item) => item.id), ["a", "c"]);
});

test("만료 회원 화면에서도 대표·총괄매니저는 전 지점이다", () => {
  const all = [member("a", "yulha"), member("b", "bansong")];
  for (const role of ["owner", "area_manager"]) {
    assert.equal(
      itemsVisibleTo(all, { role, locationId: "yulha" }, { roles: BRANCH_SCOPED_ROLES }).length, 2, role,
    );
  }
});

test("기본값은 FC매니저뿐이다 — 명부는 강사를 좁히지 않는다", () => {
  /* roles 를 주지 않으면 BRANCH_LIST_SCOPED_ROLES 다. 이 기본값이 흔들리면 강사의
     명부가 조용히 좁아지고, 대타 차감이 막힌다. */
  const all = [member("a", "yulha"), member("b", "bansong")];
  assert.equal(itemsVisibleTo(all, { role: "instructor", locationId: "yulha" }).length, 2);
});
