"use strict";

/* 강사 FC 복지 수업료 확정 (2026-11-21 · 횟수만 · 지점마다 한 명). 지정 · 8회 · 0회 · 자기 수업료 금지 · 대표 알림. */
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
const MONTH_PATH = `organizations/${ORG}/fcLessonMonths/t1_2026-11`;
const base = (extra = {}) => ({
  "memberships/o1_owner": member("owner", "owner", { displayName: "대표" }),
  "memberships/o1_fc": member("fc", "manager", { displayName: "박에프씨" }),
  "memberships/o1_t1": member("t1", "instructor", { displayName: "정예진" }),
  [`organizations/${ORG}/fcLessonDesignations/2026-11`]: { branches: { yul: "t1" }, instructorIds: ["t1"] },
  [MONTH_PATH]: { instructorId: "t1", month: "2026-11", status: "submitted", done: 3, cancel: 1 },
  ...extra,
});
const confirm = (store, callerUid) => createFcLessonConfirmService({
  firestore: store, membershipId: (org, uid) => `${org}_${uid}`, isOwnerLevel: (row) => ["owner", "area_manager"].includes(row?.role),
  now: () => new Date("2026-12-01T01:00:00Z"),
}).confirm({ callerUid, organizationId: ORG, instructorId: "t1", month: "2026-11" });

test("지정 강사의 횟수를 확정하고 금액을 남긴다 · FC 가 확정하면 대표 알림", async () => {
  const store = fake(base());
  const result = await confirm(store, "fc");
  assert.deepEqual(result.snapshot, { done: 3, cancel: 1, count: 4, amount: 90000 });
  assert.equal(store.docs.get(MONTH_PATH).status, "confirmed");
  const inbox = store.writes.filter((write) => write.path.includes("/inbox/"));
  assert.deepEqual(inbox.map((write) => write.path.split("/")[1]), ["owner"]);
  assert.equal(inbox[0].data.body, "박에프씨 님이 정예진 강사의 2026년 11월 FC 복지 수업료를 확정했어요 · 90,000원 (진행 3회 · 캔슬 1회)");
});

test("지정 안 됨 · 0회 · 8회 넘음 · 자기 수업료 · 강사 · 이미 확정은 거절", async () => {
  await assert.rejects(confirm(fake(base({ [`organizations/${ORG}/fcLessonDesignations/2026-11`]: { branches: { yul: "t9" } } })), "owner"), (error) => error.reason === "not_designated");
  await assert.rejects(confirm(fake(base({ [MONTH_PATH]: { status: "submitted", done: 0, cancel: 0 } })), "owner"), (error) => error.reason === "nothing_to_confirm");
  await assert.rejects(confirm(fake(base({ [MONTH_PATH]: { status: "submitted", done: 7, cancel: 2 } })), "owner"), (error) => error.reason === "fc_cap_exceeded");
  await assert.rejects(confirm(fake(base()), "t1"), (error) => error.reason === "own_lessons");
  await assert.rejects(confirm(fake(base({ "memberships/o1_t2": member("t2", "instructor") })), "t2"), (error) => error.reason === "not_confirmer");
  await assert.rejects(confirm(fake(base({ [MONTH_PATH]: { status: "confirmed", done: 3, cancel: 1 } })), "owner"), (error) => error.reason === "already_confirmed");
});
