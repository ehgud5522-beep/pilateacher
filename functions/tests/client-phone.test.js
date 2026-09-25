"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  INSTRUCTOR_DAILY_LIMIT, PHONE_EDIT, decidePhoneEdit, duplicateAnswer,
  isMobilePhone, kstDayKey, teachesClient,
} = require("../src/client-phone");

/**
 * 연락처 변경의 판정.
 *
 * 번호는 회원의 정체다 -- 회원 앱이 인증된 번호로 명부를 찾고, 엑셀 이관이
 * 번호로 문서 id 를 만든다. 그래서 이 판정이 틀리면 남의 잔여가 남에게
 * 보이거나, 한 사람이 회원 둘이 된다.
 */

const client = (overrides = {}) => ({
  clientId: "csv_01012345678", organizationId: "center-a", name: "김하나",
  phone: "01012345678", status: "active", ...overrides,
});

const pass = (overrides = {}) => ({
  id: "pass-1", clientId: "csv_01012345678", status: "active",
  instructorId: "u-mine", ...overrides,
});

const decide = (overrides = {}) => decidePhoneEdit({
  role: "owner", actorId: "u-owner", client: client(), passes: [pass()],
  newPhone: "01099998888", usedToday: 0, ...overrides,
});

/* ── 번호의 모양 ─────────────────────────────────────────────────────── */

test("010 열한 자리만 받는다", () => {
  assert.equal(isMobilePhone("01012345678"), true);
  assert.equal(isMobilePhone("010-1234-5678"), true, "하이픈은 떼고 본다");
  /* 011·016 은 2021년에 사라졌고, 지역번호로는 회원 앱에 로그인할 수 없다 --
     문자 인증이 휴대폰에만 간다. 받아 두고 로그인이 안 되는 것이 거절보다
     나쁘다. */
  assert.equal(isMobilePhone("01112345678"), false);
  assert.equal(isMobilePhone("0212345678"), false);
  assert.equal(isMobilePhone("0101234567"), false, "열 자리");
  assert.equal(isMobilePhone("010123456789"), false, "열두 자리");
  assert.equal(isMobilePhone(""), false);
  assert.equal(isMobilePhone(null), false);
});

test("형식이 아니면 그 이유로 막는다", () => {
  assert.equal(decide({ newPhone: "0212345678" }).code, PHONE_EDIT.INVALID);
  assert.equal(decide({ newPhone: "" }).code, PHONE_EDIT.INVALID);
});

test("같은 번호로는 바꾸지 않는다", () => {
  // 바꿀 것이 없는데 연결을 끊고 이전 번호를 남기면 그것이 곧 사고다.
  assert.equal(decide({ newPhone: "01012345678" }).code, PHONE_EDIT.SAME);
  assert.equal(decide({ newPhone: "010-1234-5678" }).code, PHONE_EDIT.SAME);
});

test("회원이 없으면 판정할 것이 없다", () => {
  assert.equal(decide({ client: null }).code, PHONE_EDIT.NO_CLIENT);
});

/* ── 누가 바꿀 수 있나 ───────────────────────────────────────────────── */

test("대표와 FC매니저는 모든 회원을 바꾼다", () => {
  for (const role of ["owner", "manager"]) {
    const allowed = decide({ role, passes: [] });
    assert.equal(allowed.ok, true, role);
    assert.equal(allowed.phone, "01099998888");
  }
});

test("강사는 자기 회원만 바꾼다", () => {
  const mine = decide({ role: "instructor", actorId: "u-mine" });
  assert.equal(mine.ok, true);

  const others = decide({ role: "instructor", actorId: "u-other" });
  assert.equal(others.ok, false);
  assert.equal(others.code, PHONE_EDIT.NOT_MY_CLIENT);
});

test("끝난 회원권으로는 자기 회원이 아니다", () => {
  /* 담당이었던 사실만으로 지금 번호를 바꿀 수 있으면, 퇴사한 강사도 계속
     바꿀 수 있다. */
  const ended = decide({
    role: "instructor", actorId: "u-mine", passes: [pass({ status: "expired" })],
  });
  assert.equal(ended.code, PHONE_EDIT.NOT_MY_CLIENT);
});

test("듀엣의 짝도 자기 회원이다", () => {
  /* 못 고치면 그 회원은 아무 강사에게도 속하지 않은 것이 된다. */
  const partner = decidePhoneEdit({
    role: "instructor", actorId: "u-mine",
    client: client({ clientId: "csv_01055556666" }),
    passes: [pass({ clientId: "csv_01012345678", clientIds: ["csv_01012345678", "csv_01055556666"] })],
    newPhone: "01099998888",
  });
  assert.equal(partner.ok, true);
});

test("나머지 역할은 바꾸지 못한다", () => {
  for (const role of ["staff", "member", "", "guest"]) {
    assert.equal(decide({ role }).code, PHONE_EDIT.NOT_ALLOWED, role);
  }
});

test("teachesClient 는 담당과 상태를 함께 본다", () => {
  assert.equal(teachesClient([pass()], "csv_01012345678", "u-mine"), true);
  assert.equal(teachesClient([pass()], "csv_01012345678", "u-other"), false);
  assert.equal(teachesClient([pass({ status: "cancelled" })], "csv_01012345678", "u-mine"), false);
  assert.equal(teachesClient([], "csv_01012345678", "u-mine"), false);
  assert.equal(teachesClient([pass()], "", "u-mine"), false);
  assert.equal(teachesClient([pass()], "csv_01012345678", ""), false);
});

/* ── 강사 하루 한도 ──────────────────────────────────────────────────── */

test("강사는 하루 열 건까지", () => {
  assert.equal(INSTRUCTOR_DAILY_LIMIT, 10);
  const ninth = decide({ role: "instructor", actorId: "u-mine", usedToday: 9 });
  assert.equal(ninth.ok, true, "아홉 건 썼으면 한 건 남는다");

  const over = decide({ role: "instructor", actorId: "u-mine", usedToday: 10 });
  assert.equal(over.ok, false);
  assert.equal(over.code, PHONE_EDIT.DAILY_LIMIT);
  assert.equal(over.limit, 10);
});

test("대표에게는 한도가 없다", () => {
  assert.equal(decide({ role: "owner", usedToday: 99 }).ok, true);
  assert.equal(decide({ role: "manager", usedToday: 99 }).ok, true);
});

test("하루는 한국 시간 자정에 바뀐다", () => {
  /* UTC 로 세면 한국의 오전 9시에 날짜가 바뀐다 -- 강사에게는 하루 중간에
     한도가 초기화되는 것으로 보이고, 그 시각을 아는 사람은 아무도 없다. */
  assert.equal(kstDayKey(new Date("2026-09-24T14:59:00.000Z")), "2026-09-24", "KST 23:59");
  assert.equal(kstDayKey(new Date("2026-09-24T15:00:00.000Z")), "2026-09-25", "KST 익일 00:00");
  assert.equal(kstDayKey(new Date("2026-09-25T00:30:00.000Z")), "2026-09-25", "KST 09:30");
});

/* ── 중복일 때의 답 ──────────────────────────────────────────────────── */

test("대표에게는 누구의 번호인지 말한다", () => {
  assert.deepEqual(
    duplicateAnswer({ role: "owner", owner: { name: "박두리" } }),
    { code: PHONE_EDIT.DUPLICATE, clientName: "박두리" },
  );
});

test("강사에게는 이름을 주지 않는다", () => {
  /* 번호 하나로 "이 번호는 박두리 회원의 것" 을 알아낼 수 있으면, 그것은 남의
     명부를 한 명씩 조회하는 길이다 -- 강사 명부를 좁혀 둔 것과 같은 선이다. */
  assert.deepEqual(
    duplicateAnswer({ role: "instructor", owner: { name: "박두리" } }),
    { code: PHONE_EDIT.DUPLICATE },
  );
});

test("이름을 모르면 대표에게도 이름 없이 답한다", () => {
  // 지어내지 않는다.
  assert.deepEqual(
    duplicateAnswer({ role: "owner", owner: {} }),
    { code: PHONE_EDIT.DUPLICATE },
  );
});
