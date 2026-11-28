"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { handleTeacherPushSettings, teacherPushMuted } = require("../src/teacher-cancel-push");
const { pushToTeacher } = require("../src/teacher-push");

/* 2026-11-28 대표: "강사가 더보기에서 알림 설정 켜기 끄기, 기본은 켜짐". */

function world(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const ref = (path) => ({
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (value) => docs.set(path, { ...(docs.get(path) || {}), ...value }),
    create: async (value) => { if (docs.has(path)) throw Object.assign(new Error("exists"), { code: 6 }); docs.set(path, value); },
    update: async (value) => docs.set(path, { ...(docs.get(path) || {}), ...value }),
  });
  return { docs, collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }) };
}
const staff = { "memberships/org_t1": { status: "active", role: "instructor" } };
const deps = { membershipId: (org, uid) => `${org}_${uid}` };
const call = (db, extra) => handleTeacherPushSettings(db, { callerUid: "t1", organizationId: "org", ...extra }, deps);

test("기본은 켜짐 -- 칸이 없으면 켜진 것으로 본다", async () => {
  assert.equal(teacherPushMuted(null), false);
  assert.equal(teacherPushMuted({}), false);
  const result = await call(world(staff), { action: "get" });
  assert.deepEqual(result, { devices: 0, enabled: true });
});

test("끄고 켜기는 본인 문서에 남고, 토큰은 그대로", async () => {
  const db = world({ ...staff, "teacherPush/t1": { tokens: { k: { token: "tok", platform: "android" } } } });
  assert.deepEqual(await call(db, { action: "set", enabled: false }), { devices: 1, enabled: false });
  assert.equal(db.docs.get("teacherPush/t1").tokens.k.token, "tok");
  assert.deepEqual(await call(db, { action: "set", enabled: true }), { devices: 1, enabled: true });
  await assert.rejects(call(db, { action: "set", enabled: "off" }), (error) => error.code === "push_enabled_invalid");
});

test("끈 강사에게는 회원 요청 · 몸 상태 푸시를 보내지 않는다 (알림함은 그대로 -- 이 함수 밖)", async () => {
  const db = world({ "runtimeConfig/teacherPush": { mode: "all" }, "teacherPush/t1": { enabled: false, tokens: { k: { token: "tok" } } } });
  let sent = 0;
  const result = await pushToTeacher(db, () => ({ sendEachForMulticast: async () => { sent += 1; } }),
    { instructorUid: "t1", inboxId: "x", kind: "member_condition", organizationId: "org", title: "t", body: "b" });
  assert.equal(result.push, "muted");
  assert.equal(sent, 0);
});
