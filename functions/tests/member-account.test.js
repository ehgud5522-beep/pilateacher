"use strict";

/**
 * 계정 삭제.
 *
 * 여기서 고정하는 것은 **틀리는 방향**이다. 이 통로는 되돌릴 수 없는 것을
 * 하나 들고 있어서 (Auth 사용자 삭제) 순서를 잘못 잡으면 회원이 영영 자기
 * 회원권을 못 보게 된다.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMemberAccountService } = require("../src/member-account");

const AT = new Date(2026, 8, 27, 12, 0, 0);

function harness(overrides = {}) {
  const calls = [];
  const service = createMemberAccountService({
    now: () => AT,
    readLink: async (userId) => {
      calls.push(["readLink", userId]);
      return { userId, links: [{ organizationId: "org", clientId: "c1" }] };
    },
    purgeMemberAccount: async (input) => { calls.push(["purge", input]); return { removed: input.links.length }; },
    deleteAuthUser: async (userId) => { calls.push(["deleteAuthUser", userId]); },
    ...overrides,
  });
  return { service, calls };
}

const request = (uid) => ({ auth: uid ? { uid } : null });

test("로그인하지 않았으면 아무것도 하지 않는다", async () => {
  const { service, calls } = harness();
  await assert.rejects(service.deleteForCaller(request("")), (error) => {
    assert.equal(error.code, "unauthenticated");
    assert.equal(error.stage, "authorize");
    return true;
  });
  assert.deepEqual(calls, [], "읽지도 지우지도 않았다");
});

test("지울 대상은 토큰의 uid 다 — 요청에서 받지 않는다", async () => {
  /* 대상을 요청에서 받으면 남의 계정을 지울 수 있다. */
  const { service, calls } = harness();
  await service.deleteForCaller({ auth: { uid: "me" }, data: { userId: "someone-else" } });
  assert.deepEqual(calls.map((call) => call[0]), ["readLink", "purge", "deleteAuthUser"]);
  assert.equal(calls[0][1], "me");
  assert.equal(calls[1][1].userId, "me");
  assert.equal(calls[2][1], "me");
});

test("Firestore 를 먼저, Auth 를 나중에", async () => {
  /* **이 순서가 이 파일의 전부다.** 거꾸로 하면 Firestore 실패가 되돌릴 수
     없는 잠금이 된다 -- 계정은 없는데 명부에 죽은 uid 가 남아, 다시 가입해도
     `taken` 에 막힌다. */
  const { service, calls } = harness();
  await service.deleteForCaller(request("uid-1"));
  assert.deepEqual(calls.map((call) => call[0]), ["readLink", "purge", "deleteAuthUser"]);
});

test("연결을 못 읽으면 계정을 지우지 않는다", async () => {
  /* 무엇을 끊어야 하는지 모르는 채로 Auth 를 지우면 그 회원은 다시 시도할
     계정조차 없다. */
  const { service, calls } = harness({ readLink: async () => { throw new Error("firestore down"); } });
  await assert.rejects(service.deleteForCaller(request("uid-1")), (error) => {
    assert.equal(error.code, "delete_unavailable");
    assert.equal(error.stage, "read_link");
    return true;
  });
  assert.ok(!calls.some((call) => call[0] === "deleteAuthUser"));
});

test("연결을 못 끊으면 계정을 지우지 않는다", async () => {
  const { service, calls } = harness({ purgeMemberAccount: async () => { throw new Error("batch failed"); } });
  await assert.rejects(service.deleteForCaller(request("uid-1")), (error) => {
    assert.equal(error.stage, "purge");
    return true;
  });
  assert.ok(!calls.some((call) => call[0] === "deleteAuthUser"));
});

test("계정만 안 지워진 것은 다른 코드다", async () => {
  /* 연결은 이미 끊겼다. 그 사람은 다시 로그인해 번호로 다시 이어질 수
     있다 -- 되돌릴 수 있는 실패이므로 앞의 것과 같은 말을 하면 안 된다. */
  const { service } = harness({ deleteAuthUser: async () => { throw new Error("auth down"); } });
  await assert.rejects(service.deleteForCaller(request("uid-1")), (error) => {
    assert.equal(error.code, "account_not_removed");
    assert.equal(error.stage, "delete_user");
    return true;
  });
});

test("연결이 없어도 계정은 지운다", async () => {
  /* 앞선 시도가 중간에 끊긴 계정이 영영 안 지워지는 것을 막는다. */
  const { service, calls } = harness({ readLink: async () => null });
  const result = await service.deleteForCaller(request("uid-1"));
  assert.deepEqual(result, { status: "deleted", unlinked: 0 });
  assert.ok(calls.some((call) => call[0] === "deleteAuthUser"));
});

test("성한 연결만 넘긴다", async () => {
  /* 빈 조각을 그대로 넘기면 배치가 루트 문서를 가리키고 통째로 터진다. */
  const { service, calls } = harness({
    readLink: async () => ({
      links: [
        { organizationId: "org", clientId: "c1" },
        { organizationId: "", clientId: "c2" },
        { organizationId: "org2", clientId: "" },
        { organizationId: "org2", clientId: "c3", locationId: "loc" },
      ],
    }),
  });
  const result = await service.deleteForCaller(request("uid-1"));
  const purge = calls.find((call) => call[0] === "purge")[1];
  assert.deepEqual(purge.links, [
    { organizationId: "org", clientId: "c1" },
    { organizationId: "org2", clientId: "c3" },
  ]);
  assert.equal(result.unlinked, 2);
  assert.equal(purge.at.getTime(), AT.getTime());
});

test("links 가 배열이 아니어도 죽지 않는다", async () => {
  const { service } = harness({ readLink: async () => ({ links: "전부" }) });
  assert.deepEqual(await service.deleteForCaller(request("uid-1")), { status: "deleted", unlinked: 0 });
});
