"use strict";

/**
 * 투영 점검·재작성. 대표 전용이고, 쓰는 문은 기본이 건조 실행이다.
 *
 * 여기서 지키는 것 셋:
 *   1. 대표가 아니면 아무것도 보지 못한다 -- 센터 전체의 회원 목록이다
 *   2. 건조 실행은 한 글자도 쓰지 않는다
 *   3. 어긋난 것을 실제로 잡는다 -- 못 잡는 점검은 있으나 마나다
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MISMATCH, compareMemberView, createMemberViewAdminService, forbiddenFieldsIn,
  usableRemainingTotal,
} = require("../src/member-view-admin");

const ORG = "center-a";
const OWNER = "uid-owner";
const NOW = new Date(2026, 8, 24, 12, 0);

const pass = (overrides = {}) => ({
  id: "pass-1", status: "active", remainingCount: 8,
  expiresAt: new Date(2027, 0, 31), ...overrides,
});

const view = (overrides = {}) => ({
  organizationId: ORG, clientId: "client-a", userId: "uid-member",
  name: "김하나", locationName: "반송점", clientStatus: "active",
  remainingTotal: 8, passes: [{ passId: "pass-1" }], history: [], journey: null,
  ...overrides,
});

const inspected = (overrides = {}) => ({
  client: { id: "client-a", userId: "uid-member" },
  view: view(),
  rebuilt: view(),
  passes: [pass()],
  ...overrides,
});

function service({ clients = [], inspections = {}, memberships = {}, rebuildFails = "" } = {}) {
  const rebuilt = [];
  const built = createMemberViewAdminService({
    listClients: async () => clients,
    inspectClient: async (organizationId, clientId) => inspections[clientId] || inspected(),
    rebuildClient: async (organizationId, clientId) => {
      if (rebuildFails === clientId) throw Object.assign(new Error("nope"), { code: "aborted" });
      rebuilt.push(clientId);
      return "written";
    },
    readMembership: async (id) => memberships[id] || null,
    now: () => NOW,
  });
  return { ...built, rebuilt };
}

const ownerMembership = { [`${ORG}_${OWNER}`]: { role: "owner", status: "active" } };
const request = (data = {}) => ({
  auth: { uid: OWNER },
  data: { organizationId: ORG, locationId: "bansong", ...data },
});

/* ── 대표만 ─────────────────────────────────────────────────────────────── */

test("대표가 아니면 점검도 재작성도 못 한다", async () => {
  for (const role of ["manager", "instructor", "staff", "member"]) {
    const admin = service({ memberships: { [`${ORG}_${OWNER}`]: { role, status: "active" } } });
    await assert.rejects(() => admin.verify(request()), (error) => error.code === "not_owner", role);
    await assert.rejects(() => admin.rebuild(request()), (error) => error.code === "not_owner", role);
  }
});

test("퇴사한 대표는 통과하지 못한다", async () => {
  const admin = service({ memberships: { [`${ORG}_${OWNER}`]: { role: "owner", status: "revoked" } } });
  await assert.rejects(() => admin.verify(request()), (error) => error.code === "not_owner");
});

test("로그인하지 않았으면 unauthenticated", async () => {
  const admin = service({ memberships: ownerMembership });
  await assert.rejects(() => admin.verify({ data: { organizationId: ORG, locationId: "bansong" } }),
    (error) => error.code === "unauthenticated");
});

test("지점도 회원도 없으면 거부한다 — 센터 전체를 훑지 않는다", async () => {
  const admin = service({ memberships: ownerMembership });
  await assert.rejects(() => admin.verify({ auth: { uid: OWNER }, data: { organizationId: ORG } }),
    (error) => error.code === "invalid_request");
});

/* ── 건조 실행 ──────────────────────────────────────────────────────────── */

test("기본은 건조 실행이고 한 글자도 쓰지 않는다", async () => {
  const admin = service({
    memberships: ownerMembership,
    clients: [{ id: "client-a" }, { id: "client-b" }],
    inspections: {
      "client-a": inspected(),
      "client-b": inspected({ view: null }), // 투영이 없다 = 써야 할 건
    },
  });
  const result = await admin.rebuild(request());

  assert.equal(result.dryRun, true);
  assert.equal(result.checked, 2);
  assert.equal(result.wouldWrite, 1);
  assert.deepEqual(admin.rebuilt, [], "건조 실행이 썼다");
});

test("dryRun: false 를 명시해야 쓴다", async () => {
  const admin = service({
    memberships: ownerMembership,
    clients: [{ id: "client-a" }, { id: "client-b" }],
  });
  const result = await admin.rebuild(request({ dryRun: false }));

  assert.equal(result.dryRun, false);
  assert.deepEqual(admin.rebuilt, ["client-a", "client-b"]);
  assert.deepEqual(result.outcomes, { written: 2 });
});

test("쓰다 실패하면 그 회원에서 멈춘다", async () => {
  const admin = service({
    memberships: ownerMembership,
    clients: [{ id: "client-a" }, { id: "client-b" }, { id: "client-c" }],
    rebuildFails: "client-b",
  });
  const result = await admin.rebuild(request({ dryRun: false }));

  // 뒤를 계속 돌면 어느 회원부터 안 됐는지 잃는다.
  assert.equal(result.failedAt, "client-b");
  assert.equal(result.failedCode, "aborted");
  assert.deepEqual(admin.rebuilt, ["client-a"]);
  assert.equal(result.ok, false);
});

/* ── 어긋난 것을 잡는가 ─────────────────────────────────────────────────── */

test("연결됐는데 투영이 없으면 missing 으로 멈춘다", async () => {
  const admin = service({
    memberships: ownerMembership,
    clients: [{ id: "client-a" }, { id: "client-b" }],
    inspections: { "client-b": inspected({ view: null }) },
  });
  const result = await admin.verify(request());

  assert.equal(result.ok, false);
  assert.equal(result.stoppedAt, "client-b");
  assert.deepEqual(result.mismatches.map((item) => item.code), [MISMATCH.MISSING]);
  // 멈춘 자리까지만 셌다는 것이 보여야 한다.
  assert.equal(result.checked, 2);
});

test("연결이 없는데 투영이 남아 있으면 orphan", () => {
  /* 해제가 userId 만 지우고 투영을 남기면 그 사람이 계속 읽는다. */
  const found = compareMemberView({
    client: { id: "client-a", userId: "" }, view: view(), rebuilt: null, passes: [], now: NOW,
  });
  assert.deepEqual(found.map((item) => item.code), [MISMATCH.ORPHAN]);
});

test("연결도 투영도 없으면 어긋난 것이 아니다", () => {
  const found = compareMemberView({
    client: { id: "client-a", userId: "" }, view: null, rebuilt: null, passes: [], now: NOW,
  });
  assert.deepEqual(found, []);
});

test("잔여가 다르면 잡는다 — 다시 만든 것이 아니라 회원권에서 센다", () => {
  /* rebuilt 를 일부러 저장본과 같게 둔다. buildMemberView 가 틀렸을 때도
     잡히는지가 이 테스트의 전부다. */
  const stale = view({ remainingTotal: 8 });
  const found = compareMemberView({
    client: { id: "client-a", userId: "uid-member" },
    view: stale,
    rebuilt: stale,
    passes: [pass({ remainingCount: 3 })],
    now: NOW,
  });
  assert.deepEqual(found.map((item) => item.code), [MISMATCH.REMAINING_TOTAL]);
  assert.equal(found[0].detail, "8 != 3");
});

test("만료·취소된 회원권은 잔여에 들어가지 않는다", () => {
  assert.equal(usableRemainingTotal([
    pass({ remainingCount: 5 }),
    pass({ id: "gone", status: "cancelled", remainingCount: 9 }),
    pass({ id: "old", expiresAt: new Date(2026, 0, 1), remainingCount: 7 }),
    pass({ id: "no-expiry", expiresAt: null, remainingCount: 2 }),
  ], NOW), 7);
});

test("건수와 이름이 옛것이면 잡는다", () => {
  const found = compareMemberView({
    client: { id: "client-a", userId: "uid-member" },
    view: view({ name: "김하나", passes: [], history: [] }),
    rebuilt: view({ name: "김하늘", passes: [{ passId: "pass-1" }], history: [{ id: "e1" }] }),
    passes: [pass()],
    now: NOW,
  });
  assert.deepEqual(found.map((item) => item.code).sort(), [
    MISMATCH.HISTORY_COUNT, MISMATCH.PASS_COUNT, MISMATCH.STALE_FIELD,
  ].sort());
  assert.equal(found.find((item) => item.code === MISMATCH.STALE_FIELD).detail, "name");
});

/* ── 관문이 뚫렸는가 ────────────────────────────────────────────────────── */

test("금지 필드는 중첩 안에 있어도 찾는다", () => {
  assert.deepEqual(forbiddenFieldsIn({ passes: [{ passId: "p1", unitPrice: 30000 }] }), ["unitPrice"]);
  assert.deepEqual(forbiddenFieldsIn({ a: { b: { c: { phone: "010" } } } }), ["phone"]);
  assert.deepEqual(forbiddenFieldsIn(view()), []);
});

test("금지 필드가 있으면 잔여가 맞아도 어긋난 것이다", () => {
  const leaked = view();
  leaked.passes = [{ passId: "pass-1", rule: "base_category" }];
  const found = compareMemberView({
    client: { id: "client-a", userId: "uid-member" },
    view: leaked, rebuilt: view(), passes: [pass()], now: NOW,
  });
  assert.equal(found[0].code, MISMATCH.FORBIDDEN_FIELD);
  assert.equal(found[0].detail, "rule");
});

/* ── 한 번에 다 못 보면 ─────────────────────────────────────────────────── */

test("시간이 다 되면 커서를 돌려주고 멈춘다", async () => {
  let clock = 0;
  const admin = createMemberViewAdminService({
    listClients: async () => [{ id: "client-a" }, { id: "client-b" }, { id: "client-c" }],
    inspectClient: async () => inspected(),
    rebuildClient: async () => "written",
    readMembership: async () => ({ role: "owner", status: "active" }),
    // 볼 때마다 시계가 간다. 예산 초과를 실제로 만들어 본다.
    now: () => new Date(NOW.getTime() + (clock += 1000)),
    timeBudgetMs: 0, // 첫 회원을 보기도 전에 예산이 끝난다
  });
  const result = await admin.verify(request());

  assert.equal(result.partial, true);
  assert.equal(result.checked, 0);
});

test("한 명만 지정해 부를 수 있다", async () => {
  const admin = service({ memberships: ownerMembership, clients: [{ id: "client-a" }] });
  const result = await admin.verify(request({ locationId: "", clientId: "client-a" }));
  assert.equal(result.checked, 1);
  assert.equal(result.ok, true);
});
