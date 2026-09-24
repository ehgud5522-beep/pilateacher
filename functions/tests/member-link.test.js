"use strict";

/**
 * 계정 ↔ 회원 연결. 설계 문서 4장의 경우별 표를 여기서 고정한다.
 *
 * 가장 중요한 줄은 "같은 지점에 둘이면 잇지 않는다"이다. 동명이인과 가족 공용
 * 번호가 실제로 있고, 한 번 잘못 이으면 남의 회원권을 보게 되며 **그 사실은
 * 아무도 모른다.** 자동 연결을 조금 더 친절하게 만들려는 다음 변경이 이 줄을
 * 밟고 지나가면 여기서 멈춘다.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LINK_STATUS,
  createMemberLinkService,
  decideLink,
} = require("../src/member-link");

/* 인증된 번호를 명부의 철자로 옮기는 함수. ESM 이라 동적 import 로 읽는다 --
   테스트가 흉내 낸 것이 아니라 함수가 실제로 쓰는 그 함수여야 한다. */
let phoneFromToken;
test.before(async () => {
  ({ phoneFromVerifiedToken: phoneFromToken } = await import("../shared/phone.mjs"));
});

const MEMBER = "uid-member";
const OWNER = "uid-owner";
const ORG = "center-a";
const OTHER_ORG = "center-b";
const PHONE = "01012345678";

const client = (overrides = {}) => ({
  organizationId: ORG,
  clientId: "client-1",
  locationId: "loc-1",
  status: "active",
  userId: "",
  phone: PHONE,
  ...overrides,
});

/**
 * 센터별 명부를 받아 서비스를 만든다. 쓰기는 실제로 하지 않고 무엇을 쓰려
 * 했는지만 모은다 -- 판정이 이 파일의 관심사다.
 */
function service({ roster = { [ORG]: [] }, memberships = {}, links = [] } = {}) {
  const writes = [];
  const removals = [];
  const built = createMemberLinkService({
    listOrganizationIds: async () => Object.keys(roster),
    findClientsByPhone: async (organizationId, phone) => (
      (roster[organizationId] || []).filter((row) => row.phone === phone)
    ),
    readClient: async (organizationId, clientId) => (
      (roster[organizationId] || []).find((row) => row.clientId === clientId) || null
    ),
    readMembership: async (id) => memberships[id] || null,
    writeLink: async (input) => { writes.push(input); },
    removeLink: async (input) => { removals.push(input); },
    listLinksByStatus: async () => links,
    // 진짜 모듈을 쓴다. 이 변환이 틀리면 연결은 아무도 찾지 못한다.
    phoneFromToken,
    now: () => new Date("2026-09-23T00:00:00.000Z"),
  });
  return { ...built, writes, removals };
}

const ownerMembership = { [`${ORG}_${OWNER}`]: { role: "owner", status: "active" } };

const callerRequest = (phone = "010-1234-5678") => ({
  auth: { uid: MEMBER, token: { phone_number: phone } },
});

/* ── 경우별 표 ──────────────────────────────────────────────────────────── */

test("0건 — 명부에 없는 번호는 잇지 않고 사유만 남는다", async () => {
  const link = service({ roster: { [ORG]: [] } });
  const result = await link.linkForCaller(callerRequest());

  assert.equal(result.status, LINK_STATUS.NOT_FOUND);
  assert.deepEqual(result.links, []);
  assert.equal(link.writes.length, 1);
  assert.equal(link.writes[0].candidateCount, 0);
});

test("1건 활성 — 이어지고, 그 회원 문서 하나만 대상이 된다", async () => {
  const link = service({ roster: { [ORG]: [client()] } });
  const result = await link.linkForCaller(callerRequest());

  assert.equal(result.status, LINK_STATUS.LINKED);
  assert.deepEqual(result.links, [{ organizationId: ORG, clientId: "client-1" }]);
  assert.equal(link.writes[0].links.length, 1);
});

test("1건 종료 — 연결은 하되 상태가 ended 로 남는다", async () => {
  const link = service({ roster: { [ORG]: [client({ status: "ended" })] } });
  const result = await link.linkForCaller(callerRequest());

  /* 잇는다. 지난 이력을 보는 것이 이 회원에게 남은 전부다. */
  assert.equal(result.status, LINK_STATUS.ENDED);
  assert.equal(link.writes[0].links.length, 1);
});

test("같은 지점에 둘 — 자동으로 잇지 않고 대기 목록에 올린다", async () => {
  const link = service({
    roster: {
      [ORG]: [
        client({ clientId: "client-1" }),
        client({ clientId: "client-2" }),
      ],
    },
  });
  const result = await link.linkForCaller(callerRequest());

  assert.equal(result.status, LINK_STATUS.AMBIGUOUS);
  assert.deepEqual(result.links, []);
  // 후보는 남긴다 -- 대표가 고를 목록이다.
  assert.deepEqual(
    link.writes[0].candidates.map((row) => row.clientId),
    ["client-1", "client-2"],
  );
});

test("여러 지점 — 전부 잇는다 (확정 7번)", async () => {
  const link = service({
    roster: {
      [ORG]: [client({ clientId: "client-1", locationId: "loc-1" })],
      [OTHER_ORG]: [client({
        organizationId: OTHER_ORG, clientId: "client-9", locationId: "loc-9",
      })],
    },
  });
  const result = await link.linkForCaller(callerRequest());

  assert.equal(result.status, LINK_STATUS.MULTI_LOCATION);
  assert.equal(result.links.length, 2);
});

/* ── 덮어쓰지 않는다 ────────────────────────────────────────────────────── */

test("이미 다른 계정의 것이면 덮지 않고 taken 으로 멈춘다", async () => {
  const link = service({ roster: { [ORG]: [client({ userId: "uid-someone-else" })] } });
  const result = await link.linkForCaller(callerRequest());

  assert.equal(result.status, LINK_STATUS.TAKEN);
  assert.deepEqual(result.links, []);
});

test("자기에게 이미 이어진 회원은 다시 불러도 같은 답이 나온다", async () => {
  const link = service({ roster: { [ORG]: [client({ userId: MEMBER })] } });
  const result = await link.linkForCaller(callerRequest());

  assert.equal(result.status, LINK_STATUS.LINKED);
});

test("같은 지점 후보 둘 중 하나가 남의 것이면 남은 하나로 이어진다", async () => {
  const link = service({
    roster: {
      [ORG]: [
        client({ clientId: "client-1", userId: "uid-someone-else" }),
        client({ clientId: "client-2" }),
      ],
    },
  });
  const result = await link.linkForCaller(callerRequest());

  assert.equal(result.status, LINK_STATUS.LINKED);
  assert.deepEqual(result.links, [{ organizationId: ORG, clientId: "client-2" }]);
});

/* ── 믿는 값 ────────────────────────────────────────────────────────────── */

test("클라이언트가 보낸 번호는 쓰지 않는다 — 토큰의 번호만 본다", async () => {
  const link = service({
    roster: { [ORG]: [client({ clientId: "victim", phone: "01099999999" })] },
  });
  const result = await link.linkForCaller({
    auth: { uid: MEMBER, token: { phone_number: "010-1234-5678" } },
    data: { phone: "01099999999" },
  });

  // 남의 번호를 실어 보내도 그 회원은 후보에 들지 않는다.
  assert.equal(result.status, LINK_STATUS.NOT_FOUND);
});

test("번호 인증이 없으면 아무것도 찾지 않는다", async () => {
  const link = service({ roster: { [ORG]: [client()] } });
  await assert.rejects(
    () => link.linkForCaller({ auth: { uid: MEMBER, token: {} } }),
    (error) => error.code === "phone_not_verified",
  );
  assert.equal(link.writes.length, 0);
});

test("로그인하지 않았으면 unauthenticated", async () => {
  const link = service();
  await assert.rejects(() => link.linkForCaller({}), (error) => error.code === "unauthenticated");
});

/* ── 대표의 문 ──────────────────────────────────────────────────────────── */

test("대표가 아니면 손으로 잇지 못한다", async () => {
  const link = service({
    roster: { [ORG]: [client()] },
    memberships: { [`${ORG}_${OWNER}`]: { role: "instructor", status: "active" } },
  });
  await assert.rejects(
    () => link.linkByOwner({ auth: { uid: OWNER }, data: { userId: MEMBER, organizationId: ORG, clientId: "client-1" } }),
    (error) => error.code === "not_owner",
  );
  assert.equal(link.writes.length, 0);
});

test("대표가 손으로 이으면 linkedBy 에 그 uid 가 남는다", async () => {
  const link = service({ roster: { [ORG]: [client()] }, memberships: ownerMembership });
  const result = await link.linkByOwner({
    auth: { uid: OWNER },
    data: { userId: MEMBER, organizationId: ORG, clientId: "client-1" },
  });

  assert.equal(result.status, LINK_STATUS.LINKED);
  assert.equal(link.writes[0].linkedBy, OWNER);
  // 감사에 남는다 -- 남의 개인정보를 여는 일이다.
  assert.equal(link.writes[0].audit.actorId, OWNER);
  assert.equal(link.writes[0].audit.targetId, MEMBER);
});

test("이미 남의 계정에 이어진 회원은 대표도 덮어쓰지 못한다", async () => {
  const link = service({
    roster: { [ORG]: [client({ userId: "uid-someone-else" })] },
    memberships: ownerMembership,
  });
  await assert.rejects(
    () => link.linkByOwner({ auth: { uid: OWNER }, data: { userId: MEMBER, organizationId: ORG, clientId: "client-1" } }),
    (error) => error.code === "already_linked",
  );
});

test("해제는 대표만 하고 감사에 남는다", async () => {
  const link = service({ roster: { [ORG]: [client({ userId: MEMBER })] }, memberships: ownerMembership });
  const result = await link.unlink({
    auth: { uid: OWNER },
    data: { userId: MEMBER, organizationId: ORG, clientId: "client-1" },
  });

  assert.equal(result.status, LINK_STATUS.REJECTED);
  assert.equal(link.removals.length, 1);
  assert.equal(link.removals[0].audit.actorId, OWNER);
});

/* ── 대기 목록 ──────────────────────────────────────────────────────────── */

test("대기 목록은 자기 센터의 후보가 있는 줄만 보여준다", async () => {
  const link = service({
    memberships: ownerMembership,
    links: [
      {
        userId: "uid-a", phone: PHONE,
        candidates: [{ organizationId: ORG, clientId: "client-1", locationId: "loc-1" }],
      },
      {
        userId: "uid-b", phone: "01055556666",
        candidates: [{ organizationId: OTHER_ORG, clientId: "client-9", locationId: "loc-9" }],
      },
    ],
  });
  const rows = await link.listPending({ auth: { uid: OWNER }, data: { organizationId: ORG } });

  // 다른 센터에 전화한 사람의 번호는 이 대표에게 보이지 않는다.
  assert.deepEqual(rows.map((row) => row.userId), ["uid-a"]);
});

/* ── 순수 판정 ──────────────────────────────────────────────────────────── */

test("decideLink 는 지점이 같은지로 갈린다 — 센터가 다르면 지점도 다르다", () => {
  const sameOrgSameLocation = decideLink([
    { organizationId: ORG, clientId: "a", locationId: "loc-1", status: "active" },
    { organizationId: ORG, clientId: "b", locationId: "loc-1", status: "active" },
  ], MEMBER);
  assert.equal(sameOrgSameLocation.status, LINK_STATUS.AMBIGUOUS);

  const sameOrgTwoLocations = decideLink([
    { organizationId: ORG, clientId: "a", locationId: "loc-1", status: "active" },
    { organizationId: ORG, clientId: "b", locationId: "loc-2", status: "active" },
  ], MEMBER);
  assert.equal(sameOrgTwoLocations.status, LINK_STATUS.MULTI_LOCATION);
});

/* ── 번호의 철자 ────────────────────────────────────────────────────────── */

test("인증 토큰의 E.164 번호가 명부의 철자로 옮겨진다", async () => {
  /* Firebase Auth 는 +8210… 으로 준다. 명부는 010… 으로 들고 있다. 숫자만
     남기면 이 둘은 영영 만나지 않고, **정상 등록된 회원 전원이** "등록된 번호를
     찾지 못했습니다"로 끝난다 -- 에뮬레이터에서 실제로 이렇게 실패했다. */
  const link = service({ roster: { [ORG]: [client()] } });
  const result = await link.linkForCaller({
    auth: { uid: MEMBER, token: { phone_number: "+821012345678" } },
  });
  assert.equal(result.status, LINK_STATUS.LINKED);
});

test("+ 로 시작하지 않으면 국가번호로 보지 않는다", async () => {
  const link = service({ roster: { [ORG]: [client({ phone: "8210001111" })] } });
  const result = await link.linkForCaller({
    auth: { uid: MEMBER, token: { phone_number: "8210001111" } },
  });
  assert.equal(result.status, LINK_STATUS.LINKED);
});

test("decideLink 는 hold 를 쓸 수 있는 상태로 본다", () => {
  const decision = decideLink([
    { organizationId: ORG, clientId: "a", locationId: "loc-1", status: "hold" },
  ], MEMBER);
  assert.equal(decision.status, LINK_STATUS.LINKED);
});
