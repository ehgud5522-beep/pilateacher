import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

import {
  FULL_EDIT_ROLES, PHONE_EDIT_CODE, canEditPhone, maskPhone, phoneEditMessage,
} from "../../src/features/members/phone-edit.js";

/**
 * 화면 쪽 판정과 문구.
 *
 * 판정의 원본은 서버다. 여기는 버튼을 보여 줄지만 정하고, 그것은 보안이
 * 아니라 친절이다 -- 눌러도 거부될 버튼을 두지 않으려는 것이다.
 */

const pass = (overrides = {}) => ({
  id: "pass-1", clientId: "csv_01012345678", instructorId: "u-mine", ...overrides,
});

/* ── 코드가 서버와 같은가 ────────────────────────────────────────────── */

test("화면이 아는 코드와 서버가 보내는 코드가 같다", () => {
  /* 갈라지면 화면이 "바꾸지 못했어요 (코드 phone_duplicate)" 로 떨어진다 --
     서버는 제대로 말했는데 화면이 못 알아듣는 것이다. */
  const require = createRequire(import.meta.url);
  const { PHONE_EDIT } = require("../../functions/src/client-phone.js");
  assert.deepEqual(
    Object.values(PHONE_EDIT_CODE).sort(),
    Object.values(PHONE_EDIT).sort(),
  );
});

/* ── 누구에게 버튼을 보여 주나 ──────────────────────────────────────── */

test("대표와 FC매니저는 모든 회원을 고친다", () => {
  for (const role of ["owner", "manager"]) {
    assert.equal(canEditPhone({ role, clientId: "csv_01012345678", passes: [] }), true, role);
  }
});

test("강사는 자기 회원만", () => {
  const mine = { role: "instructor", clientId: "csv_01012345678", instructorId: "u-mine", passes: [pass()] };
  assert.equal(canEditPhone(mine), true);
  assert.equal(canEditPhone({ ...mine, instructorId: "u-other" }), false);
  assert.equal(canEditPhone({ ...mine, passes: [] }), false);
});

test("나머지 역할에게는 버튼이 없다", () => {
  for (const role of ["staff", "member", "", "guest"]) {
    assert.equal(canEditPhone({ role, clientId: "csv_01012345678", passes: [pass()] }), false, role);
  }
});

/* ── 실패 문구 ───────────────────────────────────────────────────────── */

test("중복일 때 이름이 있으면 합치기를 말한다", () => {
  assert.match(
    phoneEditMessage({ code: PHONE_EDIT_CODE.DUPLICATE, clientName: "박두리" }),
    /박두리 회원 번호예요.*회원 합치기/,
  );
});

test("이름이 없으면 이름 없이 말한다", () => {
  /* 강사에게는 서버가 이름을 실어 보내지 않는다. 빈 이름으로
     "이미  회원 번호예요" 가 나가면 그게 더 나쁘다. */
  const said = phoneEditMessage({ code: PHONE_EDIT_CODE.DUPLICATE });
  assert.equal(said, "이미 등록된 번호예요. 대표님께 문의해 주세요.");
  assert.doesNotMatch(said, /회원 번호예요/);
});

test("한도 문구는 정해진 그대로다", () => {
  assert.equal(
    phoneEditMessage({ code: PHONE_EDIT_CODE.DAILY_LIMIT }),
    "오늘은 더 바꿀 수 없어요. 대표님께 문의해 주세요.",
  );
});

test("코드마다 다른 말을 한다", () => {
  const said = Object.values(PHONE_EDIT_CODE).map((code) => phoneEditMessage({ code }));
  assert.equal(new Set(said).size, said.length, "두 코드가 같은 문구를 쓴다");
});

test("모르는 코드도 숨기지 않는다", () => {
  assert.match(phoneEditMessage({ code: "something_new" }), /코드 something_new/);
  assert.match(phoneEditMessage({}), /코드 unknown/);
});

/* ── 마스킹 ──────────────────────────────────────────────────────────── */

test("감사 목록의 번호는 가운데를 가린다", () => {
  assert.equal(maskPhone("01012345678"), "010····5678");
  assert.equal(maskPhone("010-1234-5678"), "010····5678");
  // 가릴 것이 없으면 번호가 있다는 사실만 말한다.
  assert.equal(maskPhone("0101"), "···");
  assert.equal(maskPhone(""), "");
  assert.equal(maskPhone(null), "");
});

test("고칠 수 있는 역할 목록이 서버와 같다", () => {
  /* staff 는 번호를 볼 수는 있어도 고치지는 못한다. 보는 쪽 목록을 그대로
     쓰면 눌러도 서버가 거부하는 버튼이 생긴다. */
  const require = createRequire(import.meta.url);
  const { FULL_EDIT_ROLES: server } = require("../../functions/src/client-phone.js");
  assert.deepEqual([...FULL_EDIT_ROLES].sort(), [...server].sort());
});
