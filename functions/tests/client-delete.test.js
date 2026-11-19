"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CLIENT_DELETE, HISTORY_KIND, createClientDeleteService, decideClientDelete,
} = require("../src/client-delete");

/** 보관된 빈 회원 삭제 (2026-11-19). 지울 수 있는 것은 보관된 빈 회원뿐이다. */

const empty = Object.freeze({});
const archived = { id: "csv_01049155730", archived: true };

test("판정: 대표 · 총괄매니저만, 보관된 회원만, 아무것도 붙지 않았을 때만", () => {
  assert.deepEqual(decideClientDelete({ role: "owner", client: archived, history: empty }), { ok: true });
  assert.deepEqual(decideClientDelete({ role: "area_manager", client: archived, history: empty }), { ok: true });
  for (const role of ["manager", "instructor", "staff", ""]) {
    assert.equal(decideClientDelete({ role, client: archived, history: empty }).code, CLIENT_DELETE.NOT_ALLOWED, role);
  }
  assert.equal(decideClientDelete({ role: "owner", client: null }).code, CLIENT_DELETE.NO_CLIENT);
  assert.equal(decideClientDelete({ role: "owner", client: { id: "a" } }).code, CLIENT_DELETE.NOT_ARCHIVED);
  assert.equal(decideClientDelete({ role: "owner", client: { id: "a", archived: "true" } }).code, CLIENT_DELETE.NOT_ARCHIVED);
});

test("판정: 회원권 · 수업 · 기록 중 하나라도 있으면 지우지 않고 무엇이 있는지 말한다", () => {
  for (const kind of Object.values(HISTORY_KIND)) {
    const decided = decideClientDelete({ role: "owner", client: archived, history: { [kind]: 1 } });
    assert.deepEqual(decided, { ok: false, code: CLIENT_DELETE.HAS_HISTORY, kinds: [kind] });
  }
  const both = decideClientDelete({ role: "owner", client: archived, history: { pass: 2, lesson_note: 1, summary: 0 } });
  assert.deepEqual(both.kinds, ["pass", "lesson_note"]);
});

const build = (overrides = {}) => {
  const calls = { membership: [], inspect: [], remove: [] };
  const service = createClientDeleteService({
    readMembership: async (id) => { calls.membership.push(id); return { status: "active", role: "owner" }; },
    inspectClient: async (org, id) => { calls.inspect.push([org, id]); return { client: archived, history: {} }; },
    deleteClient: async (input) => { calls.remove.push(input); return { unlinked: true }; },
    now: () => new Date(2026, 10, 19, 12, 0),
    ...overrides,
  });
  return { service, calls };
};
const request = (data = {}) => ({ auth: { uid: "u-owner" }, data: { organizationId: "center-a", clientId: "csv_01049155730", ...data } });

test("서비스: 역할은 앱이 보낸 값이 아니라 소속 문서에서 읽는다", async () => {
  const { service, calls } = build();
  const result = await service.remove(request({ role: "owner" }));
  assert.deepEqual(result, { ok: true, clientId: "csv_01049155730", unlinked: true });
  assert.deepEqual(calls.membership, ["center-a_u-owner"]);
  assert.equal(calls.remove[0].actorRole, "owner");
  assert.equal(calls.remove[0].actorId, "u-owner");
});

test("서비스: 강사 · 나간 사람은 지우지 못하고, 지우는 함수까지 가지 않는다", async () => {
  for (const membership of [{ status: "active", role: "instructor" }, { status: "ended", role: "owner" }, null]) {
    const { service, calls } = build({ readMembership: async () => membership });
    await assert.rejects(() => service.remove(request()), (error) => error.code === CLIENT_DELETE.NOT_ALLOWED);
    assert.equal(calls.remove.length, 0);
  }
});

test("서비스: 기록이 있으면 kinds 와 함께 거절하고 지우지 않는다", async () => {
  const { service, calls } = build({ inspectClient: async () => ({ client: archived, history: { pass: 1 } }) });
  await assert.rejects(() => service.remove(request()), (error) => {
    assert.equal(error.code, CLIENT_DELETE.HAS_HISTORY);
    assert.deepEqual(error.kinds, ["pass"]);
    return true;
  });
  assert.equal(calls.remove.length, 0);
});

test("서비스: 요청 모양 · 로그인 · 읽기 실패는 각자의 코드로", async () => {
  const { service } = build();
  await assert.rejects(() => service.remove({ data: { organizationId: "a", clientId: "b" } }), (error) => error.code === "unauthenticated");
  await assert.rejects(() => service.remove(request({ clientId: "" })), (error) => error.code === CLIENT_DELETE.INVALID_REQUEST);
  const broken = build({ inspectClient: async () => { throw Object.assign(new Error("deadline"), { code: 4 }); } });
  await assert.rejects(() => broken.service.remove(request()), (error) => error.code === CLIENT_DELETE.UNAVAILABLE && error.cause?.code === 4);
});
