import test from "node:test";
import assert from "node:assert/strict";
import { buildBranchOverview, overviewPhone } from "../../src/features/members/branch-overview.js";

const now = new Date("2026-11-10T00:00:00Z");
const clients = [
  { id: "a", name: "김하나", phone: "01012345678", locationId: "one" },
  { id: "b", name: "이두리", phone: "01022223333", locationId: "one" },
  { id: "c", name: "다른지점회원", phone: "01099998888", locationId: "two" },
  { id: "d", name: "지점미지정회원", locationId: "" },
  { id: "zero", name: "종료회원", locationId: "one" },
  { id: "empty", name: "신규회원", locationId: "one" },
  { id: "archived", name: "보관회원", locationId: "one", archived: true },
  { id: "demo", name: "심사용", locationId: "one", reviewDemo: true },
];
const pass = (extra = {}) => ({ id: "p", clientId: "a", locationId: "one", instructorId: "t1", status: "active", remainingCount: 5, expiresAt: new Date("2027-01-01"), createdAt: now, ...extra });
const base = {
  viewer: { role: "manager", locationIds: ["one"] }, clients, now,
  locations: [{ id: "one", name: "반송점" }, { id: "two", name: "센텀점" }],
  instructors: [{ userId: "t1", displayName: "강사가", locationId: "one", status: "active" }, { userId: "t2", displayName: "강사나", locationId: "one", status: "active" }, { userId: "outside", displayName: "타지점강사", locationId: "two", status: "active" }],
  passes: [pass(), pass({ id: "shared", clientIds: ["a", "b"], instructorId: "t2", remainingCount: 8 }), pass({ id: "other", clientId: "c", locationId: "two", instructorId: "outside", remainingCount: 99 })],
};
test("FC overview excludes other branches and unassigned branches, even when a filter is forged", () => {
  const result = buildBranchOverview(base);
  assert.equal(result.count, 4);
  assert.deepEqual(result.locations.map((item) => item.id), ["one"]);
  assert.equal(JSON.stringify(result).includes("다른지점회원"), false);
  assert.equal(JSON.stringify(result).includes("타지점강사"), false);
  assert.equal(JSON.stringify(result).includes("지점미지정회원"), false);
  assert.equal(buildBranchOverview({ ...base, locationId: "two" }).count, 0);
  assert.equal(buildBranchOverview({ ...base, viewer: { role: "manager" } }).missingScope, true);
  assert.equal(buildBranchOverview({ ...base, viewer: { role: "manager" } }).count, 0);
  assert.equal(buildBranchOverview({ ...base, viewer: { role: "instructor", locationId: "one" } }).allowed, false);
});
test("multiple branches and owner scope work without changing existing branch helpers", () => {
  assert.equal(buildBranchOverview({ ...base, viewer: { role: "manager", locationIds: ["one", "two"] } }).count, 5);
  assert.equal(buildBranchOverview({ ...base, viewer: { role: "owner" } }).count, 6);
});
test("each instructor sees only their passes; shared rows do not inflate unique member count", () => {
  const result = buildBranchOverview(base);
  assert.equal(result.groups.find((g) => g.id === "t1").rows.find((r) => r.client.id === "a").remaining, 5);
  const shared = result.groups.find((g) => g.id === "t2").rows;
  assert.deepEqual(shared.map((r) => [r.client.id, r.remaining, r.shared]), [["a", 8, true], ["b", 8, true]]);
  assert.equal(result.count, 4);
});
test("holds preserve balance; expired/cancelled balances are excluded; zero members remain visible", () => {
  const result = buildBranchOverview({ ...base, passes: [
    pass({ holdFrom: new Date(now.getTime() - 1), holdUntil: new Date(now.getTime() + 86400000) }),
    pass({ id: "expired", remainingCount: 99, expiresAt: new Date("2026-01-01") }),
    pass({ id: "cancelled", remainingCount: 99, status: "cancelled" }),
    pass({ id: "finished", clientId: "zero", remainingCount: 0 }),
    pass({ id: "wrong-branch", locationId: "two", remainingCount: 99 }),
  ] });
  const rows = result.groups.find((g) => g.id === "t1").rows;
  assert.equal(rows.find((r) => r.client.id === "a").remaining, 5);
  assert.equal(rows.find((r) => r.client.id === "a").held, 5);
  assert.equal(rows.find((r) => r.client.id === "zero").remaining, 0);
  assert.equal(result.groups.find((g) => g.id === "t2").rows.length, 0, "empty instructors still have a section");
});
test("name, full/partial phone and instructor search; low balance sort; no archived/demo members", () => {
  assert.equal(buildBranchOverview({ ...base, search: "010-1234" }).count, 1);
  assert.equal(buildBranchOverview({ ...base, search: "강사나" }).count, 2);
  assert.equal(buildBranchOverview({ ...base, search: "보관회원" }).count, 0);
  assert.equal(buildBranchOverview({ ...base, search: "심사용" }).count, 0);
  const result = buildBranchOverview({ ...base, sort: "remaining", passes: [pass(), pass({ id: "q", clientId: "b", remainingCount: 2 })] });
  assert.deepEqual(result.groups.find((g) => g.id === "t1").rows.map((r) => r.remaining), [2, 5]);
  assert.equal(overviewPhone("01012345678"), "010-1234-5678");
});
