"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createMemberLookupService, normalizeEmail } = require("../src/member-lookup");

const OWNER = "uid-owner";
const ORG = "center-a";

function service({ users = {}, memberships = {}, readFails = false } = {}) {
  const calls = { findUserByEmail: [], readMembership: [] };
  const built = createMemberLookupService({
    findUserByEmail: async (email) => {
      calls.findUserByEmail.push(email);
      const found = users[email];
      if (!found) {
        throw Object.assign(new Error("no user"), { code: "auth/user-not-found" });
      }
      return found;
    },
    readMembership: async (id) => {
      calls.readMembership.push(id);
      if (readFails) throw new Error("firestore down");
      return memberships[id] || null;
    },
  });
  return { ...built, calls };
}

const ownerMembership = { [`${ORG}_${OWNER}`]: { role: "owner", status: "active" } };

const request = (overrides = {}) => ({
  auth: { uid: OWNER },
  data: { organizationId: ORG, email: "teacher@studio.com", ...(overrides.data || {}) },
  ...(overrides.auth === undefined ? {} : { auth: overrides.auth }),
});

test("an owner gets the uid behind an e-mail they already know", async () => {
  const lookup = service({
    memberships: ownerMembership,
    users: { "teacher@studio.com": { uid: "uid-teacher", displayName: "박서연" } },
  });
  const found = await lookup.lookupByEmail(request());
  assert.deepEqual(found, {
    userId: "uid-teacher",
    displayName: "박서연",
    membership: null,
  });
});

test("the address is matched however it was typed", async () => {
  /* 대표가 대문자로 적어도 같은 계정을 찾아야 한다. 못 찾으면 대표는 그 강사가
     가입을 안 한 줄 알고 기다린다. */
  const lookup = service({
    memberships: ownerMembership,
    users: { "teacher@studio.com": { uid: "uid-teacher" } },
  });
  const found = await lookup.lookupByEmail(request({ data: { email: "  Teacher@Studio.COM " } }));
  assert.equal(found.userId, "uid-teacher");
  assert.deepEqual(lookup.calls.findUserByEmail, ["teacher@studio.com"]);
});

test("a name the sign-in never carried comes back empty, not missing", async () => {
  // 이메일 가입 계정에는 이름이 없을 수 있다. 그때는 대표가 직접 적는다.
  const lookup = service({
    memberships: ownerMembership,
    users: { "teacher@studio.com": { uid: "uid-teacher" } },
  });
  assert.equal((await lookup.lookupByEmail(request())).displayName, "");
});

test("someone already in the centre is reported, not hidden", async () => {
  /* 없이 두면 대표가 추가를 눌렀다가 거부되는 이유를 알 수 없다. 퇴사한 사람도
     여기서 잡혀, 새로 만드는 대신 되살리는 길로 간다. */
  const lookup = service({
    memberships: {
      ...ownerMembership,
      [`${ORG}_uid-teacher`]: {
        role: "instructor", status: "revoked", title: "팀장", displayName: "박서연",
      },
    },
    users: { "teacher@studio.com": { uid: "uid-teacher" } },
  });
  const found = await lookup.lookupByEmail(request());
  assert.deepEqual(found.membership, {
    role: "instructor", status: "revoked", title: "팀장", displayName: "박서연",
  });
});

test("only the owner of that centre may ask", async () => {
  /* 이메일 하나로 uid 를 돌려주는 통로는 계정 존재 여부를 캐는 데 쓰일 수 있다.
     대표가 아니면 없는 계정과 있는 계정을 구별할 수 없어야 한다. */
  const users = { "teacher@studio.com": { uid: "uid-teacher" } };
  for (const membership of [
    undefined,
    { role: "manager", status: "active" },
    { role: "instructor", status: "active" },
    { role: "owner", status: "revoked" },
  ]) {
    const lookup = service({
      users,
      memberships: membership ? { [`${ORG}_${OWNER}`]: membership } : {},
    });
    await assert.rejects(
      () => lookup.lookupByEmail(request()),
      (error) => error.code === "not_owner",
      JSON.stringify(membership),
    );
    assert.equal(lookup.calls.findUserByEmail.length, 0, "권한을 확인하기 전에 조회하지 않는다");
  }
});

test("an owner of another centre cannot ask about this one", async () => {
  const lookup = service({
    memberships: { [`other-center_${OWNER}`]: { role: "owner", status: "active" } },
    users: { "teacher@studio.com": { uid: "uid-teacher" } },
  });
  await assert.rejects(() => lookup.lookupByEmail(request()), (error) => error.code === "not_owner");
});

test("a signed-out caller is refused before anything is read", async () => {
  const lookup = service({ memberships: ownerMembership });
  await assert.rejects(
    () => lookup.lookupByEmail({ auth: {}, data: { organizationId: ORG, email: "teacher@studio.com" } }),
    (error) => error.code === "unauthenticated",
  );
  assert.equal(lookup.calls.readMembership.length, 0);
});

test("a missing account is its own answer, separate from a typo", async () => {
  /* 대표에게는 "아직 가입을 안 했다"와 "내가 잘못 적었다"가 서로 다른 할 일이다.
     한 문구로 뭉개면 둘 중 무엇을 해야 하는지 알 수 없다. */
  const lookup = service({ memberships: ownerMembership, users: {} });
  await assert.rejects(() => lookup.lookupByEmail(request()), (error) => error.code === "user_not_found");
  await assert.rejects(
    () => lookup.lookupByEmail(request({ data: { email: "not-an-address" } })),
    (error) => error.code === "invalid_email",
  );
});

test("a malformed request never reaches the directory", async () => {
  const lookup = service({ memberships: ownerMembership });
  for (const data of [{ organizationId: "" }, { organizationId: "   " }]) {
    await assert.rejects(
      () => lookup.lookupByEmail({ auth: { uid: OWNER }, data: { email: "teacher@studio.com", ...data } }),
      (error) => error.code === "invalid_request",
    );
  }
  assert.equal(lookup.calls.findUserByEmail.length, 0);
});

test("a directory that will not answer is not read as an empty centre", async () => {
  /* 못 읽은 것과 "그런 사람이 없다"는 다르다. 조용히 통과시키면 대표가 아닌
     사람에게 조회가 열린다. */
  const lookup = service({ memberships: ownerMembership, readFails: true });
  await assert.rejects(() => lookup.lookupByEmail(request()), (error) => error.code === "lookup_unavailable");
});

test("the address is normalised without judging the whole grammar", () => {
  /* 여기서 주소 문법을 다 따지면 Auth 가 받아 주는 주소를 이쪽이 먼저 거절하고,
     그 강사는 영영 못 붙는다. */
  assert.equal(normalizeEmail(" A.B+tag@Sub.Example.co.kr "), "a.b+tag@sub.example.co.kr");
  for (const bad of ["", "   ", "no-at-sign", "a@b", "a b@c.com", undefined, null]) {
    assert.throws(() => normalizeEmail(bad), /invalid_email/, JSON.stringify(bad));
  }
});
