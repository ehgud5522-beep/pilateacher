"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renewalRadarBranch } = require("../src/renewal-radar-branch");

/* 2026-11-24 대표: 재등록 레이더를 점장에게 -- 자기 지점만. 부원장은 모든 지점. */

function fakeFirestore(seed) {
  const docs = new Map(Object.entries(seed));
  const matches = (data, filters) => filters.every(([field, op, value]) => {
    const got = data?.[field];
    const at = (v) => (v instanceof Date ? v.getTime() : v);
    if (op === "==") return got === value;
    if (op === "in") return value.includes(got);
    if (op === ">=") return at(got) >= at(value);
    if (op === "<") return at(got) < at(value);
    throw new Error(`op ${op}`);
  });
  const query = (pick, filters = []) => ({
    where: (field, op, value) => query(pick, [...filters, [field, op, value]]),
    get: async () => ({
      docs: pick().filter(([, data]) => matches(data, filters))
        .map(([key, data]) => ({ id: key.split("/").at(-1), data: () => data })),
    }),
  });
  const children = (path) => () => [...docs.entries()].filter(([key]) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1);
  const collection = (path) => ({
    ...query(children(path)),
    doc: (id) => ({ collection: (name) => collection(`${path}/${id}/${name}`) }),
  });
  return {
    collection: (name) => ({
      ...collection(name),
      doc: (id) => ({
        get: async () => ({ exists: docs.has(`${name}/${id}`), data: () => docs.get(`${name}/${id}`) }),
        collection: (sub) => collection(`${name}/${id}/${sub}`),
      }),
    }),
    collectionGroup: (name) => query(() => [...docs.entries()].filter(([key]) => key.split("/").at(-2) === name)),
  };
}

const now = new Date("2026-11-24T06:00:00Z");
const daysAgo = (n) => new Date(now.getTime() - n * 86400000);
const seed = (manager) => ({
  "memberships/org_bm": manager,
  "memberships/org_t1": { organizationId: "org", userId: "t1", displayName: "가강사", role: "instructor", status: "active", locationIds: ["a"] },
  "memberships/org_t2": { organizationId: "org", userId: "t2", displayName: "나강사", role: "instructor", status: "active", locationIds: ["b"] },
  "organizations/org/locations/a": { name: "가지점" },
  "organizations/org/locations/b": { name: "나지점" },
  "organizations/org/clients/c1": { name: "가회원", locationId: "a", instructorIds: ["t1"], userId: "member-uid", phone: "01012345678" },
  "organizations/org/clients/c2": { name: "나회원", locationId: "b", instructorIds: ["t2"] },
  "organizations/org/passes/p1": { clientId: "c1", locationId: "a", instructorId: "t1", status: "active", remainingCount: 1, expiresAt: daysAgo(-5), contractPrice: 990000 },
  "organizations/org/passes/p2": { clientId: "c2", locationId: "b", instructorId: "t2", status: "active", remainingCount: 2, expiresAt: daysAgo(-5) },
  "organizations/org/passes/p1/ledger/d1": { organizationId: "org", type: "deduct", passId: "p1", clientId: "c1", occurredAt: daysAgo(3), unitPrice: 60000, category: "pt_1_1_new", instructorId: "t1" },
  "organizations/org/passes/p2/ledger/d2": { organizationId: "org", type: "deduct", passId: "p2", clientId: "c2", occurredAt: daysAgo(3), unitPrice: 50000 },
  "organizations/org/lessonNotes/n1": { clientId: "c1", createdAt: daysAgo(2), memberNote: "오늘 골반 정렬 잘 했어요" },
  "organizations/org/renewalCandidates/p1": { clientId: "c1", instructorId: "t1", locationId: "a", status: "pending" },
  "organizations/org/renewalCandidates/p2": { clientId: "c2", instructorId: "t2", locationId: "b", status: "renewed", decidedAt: daysAgo(10) },
});
const branchManager = { organizationId: "org", userId: "bm", role: "instructor", title: "branch_manager", status: "active", locationIds: ["a"] };

test("점장: 맡은 지점만, 단가 · 원문 · 연락처 · 계정 id 없이", async () => {
  const result = await renewalRadarBranch(fakeFirestore(seed(branchManager)), { callerUid: "bm", organizationId: "org", now });
  assert.equal(result.scope, "branch");
  assert.deepEqual(result.clients.map((client) => client.id), ["c1"]);
  assert.deepEqual(result.passes.map((pass) => pass.id), ["p1"]);
  assert.deepEqual(result.ledger.map((entry) => entry.id), ["d1"]);
  assert.deepEqual(result.candidates.map((row) => row.id), ["p1"]);
  assert.deepEqual(result.locations.map((row) => row.id), ["a"]);
  assert.ok(result.members.every((member) => member.userId !== "t2"), "다른 지점 강사는 없다");
  const flat = JSON.stringify(result);
  for (const secret of ["unitPrice", "60000", "category", "contractPrice", "골반", "01012345678", "member-uid"]) {
    assert.ok(!flat.includes(secret), `${secret} 가 나가면 안 된다`);
  }
  assert.equal(result.clients[0].userId, "linked", "회원 앱 연결은 예/아니오만");
  assert.equal(result.lessonNotes[0].memberNote, "1", "보낸 말은 있었다는 표시만");
});

test("부원장: 모든 지점", async () => {
  const deputy = { organizationId: "org", userId: "bm", role: "instructor", status: "active", isDeputyDirector: true, locationIds: ["a"] };
  const result = await renewalRadarBranch(fakeFirestore(seed(deputy)), { callerUid: "bm", organizationId: "org", now });
  assert.equal(result.scope, "all");
  assert.deepEqual(result.clients.map((client) => client.id).sort(), ["c1", "c2"]);
  assert.deepEqual(result.ledger.map((entry) => entry.id).sort(), ["d1", "d2"]);
  assert.deepEqual(result.locations.map((row) => row.id).sort(), ["a", "b"]);
});

test("거부: 평강사 · 지점 없는 점장 · 그만둔 점장 · 로그인 없음", async () => {
  const refuse = async (membership, reason, uid = "bm") => assert.rejects(
    () => renewalRadarBranch(fakeFirestore(seed(membership)), { callerUid: uid, organizationId: "org", now }),
    (error) => { assert.equal(error.reason, reason); return true; },
  );
  await refuse({ ...branchManager, title: "instructor" }, "not_branch_manager");
  await refuse({ ...branchManager, locationIds: [] }, "no_branch");
  await refuse({ ...branchManager, status: "ended" }, "not_branch_manager");
  await refuse({ ...branchManager, isDeputyDirector: true, status: "ended", title: "" }, "not_branch_manager");
  await refuse(branchManager, "unauthenticated", "");
});
