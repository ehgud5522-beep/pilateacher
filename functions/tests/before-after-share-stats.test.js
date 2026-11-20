"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_SHARES, SHARE_STATS, createShareStatsService, shareRow } = require("../src/before-after-share-stats");

/** 비포애프터 공유 현황 (2026-11-21). 대표 · 총괄만, 사진 · 코멘트 · 회원 계정은 나가지 않는다. */

const share = (extra = {}) => ({
  id: "s1", organizationId: "center-a", clientId: "c1", teacherId: "t1", memberUserId: "member-uid",
  teacherName: "김보현", photoIds: ["p1", "p2"], feedback: "허리가 펴졌어요", card: { path: "beforeAfterShares/s1/card.jpg" },
  status: "active", createdAt: new Date("2026-11-03T01:00:00Z"), sharedAt: { toDate: () => new Date("2026-11-03T02:00:00Z") },
  readAt: new Date("2026-11-04T00:00:00Z"), ...extra,
});

const build = (overrides = {}) => createShareStatsService({
  readMembership: async () => ({ status: "active", role: "owner" }),
  listShares: async () => [share(), share({ id: "s2", organizationId: "center-b" }), share({ id: "s3", status: "draft", sharedAt: null, readAt: null })],
  ...overrides,
});
const request = (data = {}) => ({ auth: { uid: "u-owner" }, data: { organizationId: "center-a", ...data } });

test("한 줄에는 누가 · 누구에게 · 언제 · 상태 · 열람만 -- 사진 · 코멘트 · 회원 계정 · 이름은 없다", () => {
  const row = shareRow(share());
  assert.deepEqual(Object.keys(row).sort(), ["clientId", "createdAt", "read", "revokedAt", "sharedAt", "status", "teacherId"]);
  assert.equal(row.sharedAt, "2026-11-03T02:00:00.000Z");
  assert.equal(row.read, true);
  assert.ok(!JSON.stringify(row).includes("허리") && !JSON.stringify(row).includes("member-uid") && !JSON.stringify(row).includes("김보현"));
});

test("대표 · 총괄은 자기 센터 것만 받는다", async () => {
  for (const role of ["owner", "area_manager"]) {
    const result = await build({ readMembership: async () => ({ status: "active", role }) }).list(request());
    assert.equal(result.rows.length, 2, role);
    assert.equal(result.truncated, false);
  }
});

test("강사 · FC매니저 · 나간 대표는 거절, 읽기 전에 멈춘다", async () => {
  for (const membership of [{ status: "active", role: "instructor" }, { status: "active", role: "manager" }, { status: "ended", role: "owner" }, null]) {
    let listed = false;
    const service = build({ readMembership: async () => membership, listShares: async () => { listed = true; return []; } });
    await assert.rejects(() => service.list(request()), (error) => error.code === SHARE_STATS.NOT_ALLOWED);
    assert.equal(listed, false);
  }
});

test("로그인 · 요청 모양 · 읽기 실패는 각자의 코드로, 원본 오류는 cause 에", async () => {
  await assert.rejects(() => build().list({ data: { organizationId: "a" } }), (error) => error.code === "unauthenticated");
  await assert.rejects(() => build().list(request({ organizationId: "" })), (error) => error.code === SHARE_STATS.INVALID_REQUEST);
  const broken = build({ listShares: async () => { throw Object.assign(new Error("index"), { code: 9 }); } });
  await assert.rejects(() => broken.list(request()), (error) => error.code === SHARE_STATS.UNAVAILABLE && error.cause?.code === 9 && error.stage === "list_shares");
});

test("넘치면 잘렸다고 말한다", async () => {
  const many = Array.from({ length: MAX_SHARES + 1 }, (_, index) => share({ id: `s${index}` }));
  const result = await build({ listShares: async () => many }).list(request());
  assert.equal(result.rows.length, MAX_SHARES);
  assert.equal(result.truncated, true);
});
