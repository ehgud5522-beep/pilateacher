"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClientPhoneService } = require("../src/client-phone-service");
const { PHONE_EDIT } = require("../src/client-phone");

/**
 * callable 의 몸통. 부르는 사람이 누구인지 서버가 직접 읽는지가 요점이다.
 *
 * 앱이 보낸 역할을 믿으면 잠긴 문이 아니다 -- 강사 계정이 role: "owner" 를
 * 실어 보내면 그대로 통과한다.
 */

const membership = (overrides = {}) => ({ status: "active", role: "owner", ...overrides });

const build = (overrides = {}) => {
  const calls = { change: [], malformed: [], membership: [] };
  const service = createClientPhoneService({
    changePhone: async (input) => { calls.change.push(input); return { unlinked: true }; },
    listMalformedPhones: async (organizationId) => { calls.malformed.push(organizationId); return []; },
    readMembership: async (id) => { calls.membership.push(id); return membership(); },
    now: () => new Date(2026, 8, 25, 12, 0),
    ...overrides,
  });
  return { service, calls };
};

const request = ({ data, ...rest } = {}) => ({
  auth: { uid: "u-owner" },
  data: { organizationId: "center-a", clientId: "csv_01012345678", phone: "01099998888", ...data },
  ...rest,
});

/* ── 역할은 서버가 읽는다 ───────────────────────────────────────────── */

test("앱이 보낸 역할을 믿지 않는다", async () => {
  const { service, calls } = build();
  await service.update(request({ data: { role: "owner" } }));
  // memberships 문서를 직접 읽는다.
  assert.deepEqual(calls.membership, ["center-a_u-owner"]);
  assert.equal(calls.change[0].actorRole, "owner");
  assert.equal(calls.change[0].actorId, "u-owner");
});

test("나간 사람은 바꾸지 못한다", async () => {
  /* 소속이 끝난 강사가 남의 번호를 계속 바꿀 수 있으면 안 된다. */
  const { service } = build({ readMembership: async () => membership({ status: "ended" }) });
  await assert.rejects(() => service.update(request()), (error) => {
    assert.equal(error.code, PHONE_EDIT.NOT_ALLOWED);
    return true;
  });
});

test("소속이 없으면 바꾸지 못한다", async () => {
  const { service } = build({ readMembership: async () => null });
  await assert.rejects(() => service.update(request()), (error) => {
    assert.equal(error.code, PHONE_EDIT.NOT_ALLOWED);
    return true;
  });
});

test("로그인하지 않았으면 읽지도 않는다", async () => {
  const { service, calls } = build();
  await assert.rejects(() => service.update({ auth: null, data: {} }), (error) => {
    assert.equal(error.code, "unauthenticated");
    return true;
  });
  assert.deepEqual(calls.membership, []);
});

test("센터나 회원이 빠지면 거부한다", async () => {
  const { service } = build();
  for (const data of [{ organizationId: "" }, { clientId: "" }]) {
    await assert.rejects(() => service.update(request({ data })), (error) => {
      assert.equal(error.code, "phone_invalid_request");
      return true;
    });
  }
});

/* ── 실패가 화면까지 그대로 간다 ────────────────────────────────────── */

test("중복이면 이름을 함께 올려 보낸다", async () => {
  /* 판정이 이미 역할로 걸러서 올려 보낸다 -- 여기서 다시 판단하지 않는다.
     두 곳에서 판단하면 언젠가 한쪽만 고쳐진다. */
  const { service } = build({
    changePhone: async () => {
      throw Object.assign(new Error(PHONE_EDIT.DUPLICATE), {
        code: PHONE_EDIT.DUPLICATE, clientName: "박두리",
      });
    },
  });
  await assert.rejects(() => service.update(request()), (error) => {
    assert.equal(error.code, PHONE_EDIT.DUPLICATE);
    assert.equal(error.clientName, "박두리");
    return true;
  });
});

test("한도에 걸리면 몇 건까지인지 함께 올려 보낸다", async () => {
  const { service } = build({
    changePhone: async () => {
      throw Object.assign(new Error(PHONE_EDIT.DAILY_LIMIT), {
        code: PHONE_EDIT.DAILY_LIMIT, limit: 10,
      });
    },
  });
  await assert.rejects(() => service.update(request()), (error) => {
    assert.equal(error.code, PHONE_EDIT.DAILY_LIMIT);
    assert.equal(error.limit, 10);
    return true;
  });
});

test("성공은 연결이 끊겼는지를 말한다", async () => {
  /* 화면이 "회원 앱은 새 번호로 다시 로그인해야 해요" 를 띄울지 정하는 값이다.
     바뀐 번호 자체는 돌려주지 않는다 -- 강사 화면은 전체 번호를 보지 않는다. */
  const { service } = build();
  const result = await service.update(request());
  assert.deepEqual(result, { ok: true, clientId: "csv_01012345678", unlinked: true });
  assert.equal("phone" in result, false);
});

test("연결이 없던 회원은 끊을 것도 없다", async () => {
  const { service } = build({ changePhone: async () => ({ unlinked: false }) });
  assert.equal((await service.update(request())).unlinked, false);
});

/* ── 철자 깨진 번호 목록 ────────────────────────────────────────────── */

test("깨진 번호 목록은 대표만 본다", async () => {
  const { service, calls } = build();
  assert.deepEqual(await service.listMalformed(request()), { ok: true, clients: [] });
  assert.deepEqual(calls.malformed, ["center-a"]);

  for (const role of ["manager", "instructor", "staff"]) {
    const other = build({ readMembership: async () => membership({ role }) });
    await assert.rejects(() => other.service.listMalformed(request()), (error) => {
      assert.equal(error.code, "not_owner");
      return true;
    });
  }
});

test("목록은 읽기만 한다", async () => {
  /* 한꺼번에 고치면 아예 틀린 번호가 "정상" 이 되어 더 찾기 어려워진다. */
  const { service, calls } = build();
  await service.listMalformed(request());
  assert.deepEqual(calls.change, [], "목록을 부르면서 무언가 고쳤다");
});
