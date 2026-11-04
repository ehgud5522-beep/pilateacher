/**
 * 담당 강사 고르기 (2026-11-04): 지점 칩의 기본값 · 지점과 이름으로 거르기 ·
 * 맡은 지점 밖 판정을 역할별로 고정한다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ALL_LOCATIONS } from "../../src/data/repositories/location-repository.js";
import {
  defaultPickerLocation, instructorLocationLabel, instructorOutsideScope, pickerInstructors,
} from "../../src/features/membership/instructor-picker.js";

const LOCATIONS = [{ id: "bansong", name: "반송점" }, { id: "centum", name: "센텀점" }, { id: "yulha", name: "율하점" }];
const INSTRUCTORS = [
  { userId: "u-a", displayName: "김 하나", locationId: "bansong" },
  { userId: "u-b", displayName: "이두리", locationId: "centum" },
  { userId: "u-both", displayName: "박겸직", locationId: "bansong", locationIds: ["bansong", "yulha"] },
  { userId: "u-none", displayName: "최무소속", locationId: "" },
];
const VIEWERS = {
  owner: { role: "owner" },
  area_manager: { role: "area_manager", locationId: "centum" },
  fc: { role: "manager", locationId: "bansong", locationIds: ["bansong"] },
  fcMany: { role: "manager", locationId: "bansong", locationIds: ["bansong", "yulha"] },
  instructor: { role: "instructor", locationId: "centum" },
};
const ids = (list) => list.map((item) => item.userId);

test("기본 지점: 대표 · 총괄매니저는 전체, FC매니저 · 강사는 자기 지점", () => {
  assert.equal(defaultPickerLocation(VIEWERS.owner, LOCATIONS), ALL_LOCATIONS);
  assert.equal(defaultPickerLocation(VIEWERS.area_manager, LOCATIONS), ALL_LOCATIONS, "총괄은 소속 지점이 있어도 전체");
  assert.equal(defaultPickerLocation(VIEWERS.fc, LOCATIONS), "bansong");
  assert.equal(defaultPickerLocation(VIEWERS.instructor, LOCATIONS), "centum");
  assert.equal(defaultPickerLocation({ role: "staff", locationId: "yulha" }, LOCATIONS), "yulha", "직원(매니저)도 자기 지점");
});

test("지점을 여럿 맡은 FC매니저는 회원의 지점이 맡은 곳이면 그것, 아니면 첫 지점", () => {
  assert.equal(defaultPickerLocation(VIEWERS.fcMany, LOCATIONS, "yulha"), "yulha");
  assert.equal(defaultPickerLocation(VIEWERS.fcMany, LOCATIONS, "centum"), "bansong", "맡지 않은 지점은 따르지 않는다");
  assert.equal(defaultPickerLocation(VIEWERS.fcMany, LOCATIONS), "bansong");
  // 맡은 지점이 목록에 없으면(못 읽었으면) 전체로 -- 아무도 안 보이는 칩을 누르지 않는다.
  assert.equal(defaultPickerLocation(VIEWERS.fc, [{ id: "centum" }]), ALL_LOCATIONS);
});

test("지점 칩: 그 지점 강사만 · 겸직은 양쪽 · 지점 없는 강사는 어디서나", () => {
  assert.deepEqual(ids(pickerInstructors(INSTRUCTORS, { locationId: ALL_LOCATIONS })), ["u-a", "u-b", "u-both", "u-none"]);
  assert.deepEqual(ids(pickerInstructors(INSTRUCTORS, { locationId: "bansong" })), ["u-a", "u-both", "u-none"]);
  assert.deepEqual(ids(pickerInstructors(INSTRUCTORS, { locationId: "yulha" })), ["u-both", "u-none"]);
  assert.deepEqual(ids(pickerInstructors(INSTRUCTORS, { locationId: "centum" })), ["u-b", "u-none"]);
});

test("이름 검색은 띄어쓰기와 상관없이 맞고, 지점 칩과 함께 걸린다", () => {
  assert.deepEqual(ids(pickerInstructors(INSTRUCTORS, { query: "김하나" })), ["u-a"]);
  assert.deepEqual(ids(pickerInstructors(INSTRUCTORS, { query: " 겸직 " })), ["u-both"]);
  assert.deepEqual(ids(pickerInstructors(INSTRUCTORS, { locationId: "centum", query: "김" })), []);
});

test("칩의 소속 지점: 겸직은 둘 다, 없으면 '지점 없음'", () => {
  assert.equal(instructorLocationLabel(INSTRUCTORS[0], LOCATIONS), "반송점");
  assert.equal(instructorLocationLabel(INSTRUCTORS[2], LOCATIONS), "반송점 · 율하점");
  assert.equal(instructorLocationLabel(INSTRUCTORS[3], LOCATIONS), "지점 없음");
});

test("맡은 지점 밖: FC매니저만 막고, 대표 · 총괄매니저 · 강사는 막지 않는다", () => {
  const far = INSTRUCTORS[1];
  assert.equal(instructorOutsideScope(VIEWERS.fc, far), true, "FC 반송 → 센텀 강사");
  assert.equal(instructorOutsideScope(VIEWERS.fc, INSTRUCTORS[0]), false);
  assert.equal(instructorOutsideScope(VIEWERS.fc, INSTRUCTORS[2]), false, "겸직이 한 곳이라도 겹치면 된다");
  assert.equal(instructorOutsideScope(VIEWERS.fc, INSTRUCTORS[3]), false, "지점 모르는 강사는 막지 않는다");
  assert.equal(instructorOutsideScope(VIEWERS.fcMany, { userId: "x", locationId: "yulha" }), false);
  assert.equal(instructorOutsideScope({ role: "manager" }, far), false, "맡은 지점이 비면 막지 않는다");
  for (const viewer of [VIEWERS.owner, VIEWERS.area_manager, VIEWERS.instructor]) {
    assert.equal(instructorOutsideScope(viewer, far), false, viewer.role);
  }
});
