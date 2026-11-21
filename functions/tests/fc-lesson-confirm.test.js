"use strict";

/* 강사 FC 복지 수업료 확정 (2026-11-21). 지정 강사 · FC 별 8회 · 받은 FC 본인 확정 금지 · 대표 알림. */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createFcLessonConfirmService } = require("../src/fc-lesson-confirm");

function fake(seed) {
  const docs = new Map(Object.entries(seed));
  const writes = [];
  const snap = (path) => ({ id: path.split("/").pop(), exists: docs.has(path), data: () => docs.get(path) });
  const query = (path, filters) => ({
    where: (field, _op, value) => query(path, [...filters, [field, value]]),
    get: async () => ({ docs: [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
      .map(snap).filter((row) => filters.every(([field, value]) => row.data()[field] === value)) }),
  });
  const collectionRef = (path) => ({ doc: (id) => docRef(`${path}/${id}`), where: (field, op, value) => query(path, []).where(field, op, value) });
  const docRef = (path) => ({
    get: async () => snap(path),
    set: async (data, options) => { writes.push({ path, data }); docs.set(path, options?.merge ? { ...(docs.get(path) || {}), ...data } : data); },
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  return { writes, docs, doc: docRef, collection: collectionRef };
}
const ORG = "o1";
const member = (userId, role, extra = {}) => ({ organizationId: ORG, userId, role, status: "active", ...extra });
const lesson = (id, extra = {}) => [`organizations/${ORG}/fcLessons/${id}`, { organizationId: ORG, instructorId: "t1", fcUserId: "fc2", month: "2026-11", lessonDate: "2026-11-05", outcome: "done", ...extra }];
const base = (extra = {}) => ({
  "memberships/o1_owner": member("owner", "owner", { displayName: "대표" }),
  "memberships/o1_fc": member("fc", "manager", { displayName: "박에프씨" }),
  "memberships/o1_fc2": member("fc2", "manager", { displayName: "이에프씨" }),
  "memberships/o1_t1": member("t1", "instructor", { displayName: "정예진" }),
  [`organizations/${ORG}/fcLessonDesignations/2026-11`]: { instructorIds: ["t1"] },
  ...extra,
});
const confirm = (store, callerUid, extra = {}) => createFcLessonConfirmService({
  firestore: store, membershipId: (org, uid) => `${org}_${uid}`, isOwnerLevel: (row) => ["owner", "area_manager"].includes(row?.role),
  now: () => new Date("2026-12-01T01:00:00Z"),
}).confirm({ callerUid, organizationId: ORG, instructorId: "t1", month: "2026-11", ...extra });

test("지정 강사 · 한도 안이면 확정, 진행 25,000 · 캔슬 15,000 합, 대표 알림", async () => {
  const store = fake(base(Object.fromEntries([lesson("a"), lesson("b", { outcome: "cancel" }), lesson("c")])));
  const result = await confirm(store, "fc");
  assert.deepEqual(result.snapshot, { done: 2, cancel: 1, count: 3, amount: 65000 });
  assert.equal(store.docs.get(`organizations/${ORG}/fcLessonMonths/t1_2026-11`).status, "confirmed");
  const inbox = store.writes.filter((write) => write.path.includes("/inbox/"));
  assert.deepEqual(inbox.map((write) => write.path.split("/")[1]), ["owner"]);
  assert.equal(inbox[0].data.body, "박에프씨 님이 정예진 강사의 2026년 11월 FC 복지 수업료를 확정했어요 · 65,000원 (진행 2회 · 캔슬 1회)");
});

test("지정 안 된 강사 · 받은 FC 본인 · 자기 수업료 · 강사는 확정 못 함", async () => {
  await assert.rejects(confirm(fake(base({ [`organizations/${ORG}/fcLessonDesignations/2026-11`]: { instructorIds: ["t9"] } })), "owner"), (error) => error.reason === "not_designated");
  await assert.rejects(confirm(fake(base(Object.fromEntries([lesson("a")]))), "fc2"), (error) => error.reason === "received_by_confirmer");
  await assert.rejects(confirm(fake(base()), "t1"), (error) => error.reason === "own_lessons");
  await assert.rejects(confirm(fake(base({ "memberships/o1_t2": member("t2", "instructor") })), "t2"), (error) => error.reason === "not_confirmer");
});

test("FC 별 8회를 넘친 줄이 이 강사에게 있으면 거절하고 넘친 줄을 남긴다 (다른 강사 줄과 합쳐 셈)", async () => {
  const others = Array.from({ length: 7 }, (_, index) => lesson(`t2-${index}`, { instructorId: "t2", lessonDate: `2026-11-0${index + 1}` }));
  const store = fake(base(Object.fromEntries([...others, lesson("mine1", { lessonDate: "2026-11-20" }), lesson("mine2", { lessonDate: "2026-11-21" })])));
  await assert.rejects(confirm(store, "owner"), (error) => error.reason === "fc_cap_exceeded" && error.details.overCap === 1);
  assert.deepEqual(store.docs.get(`organizations/${ORG}/fcLessonMonths/t1_2026-11`).lastCheck.overCapEntryIds, ["mine2"]);
});

test("이미 확정된 달은 다시 못 함", async () => {
  const store = fake(base({ [`organizations/${ORG}/fcLessonMonths/t1_2026-11`]: { status: "confirmed" } }));
  await assert.rejects(confirm(store, "owner"), (error) => error.reason === "already_confirmed");
});
