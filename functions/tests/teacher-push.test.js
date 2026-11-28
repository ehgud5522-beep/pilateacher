"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { pushToTeacher } = require("../src/teacher-push");

/* 2026-11-28 대표: 회원 요청 · 몸 상태를 강사 폰 푸시로. 스위치 runtimeConfig/teacherPush, 토큰 teacherPush/{uid}. */

function world(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const ref = (path) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    create: async (value) => { if (docs.has(path)) throw Object.assign(new Error("exists"), { code: 6 }); docs.set(path, value); },
    update: async (value) => docs.set(path, { ...(docs.get(path) || {}), ...value }),
    set: async (value) => docs.set(path, { ...(docs.get(path) || {}), ...value }),
  });
  return { docs, collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }) };
}
const target = { instructorUid: "t1", inboxId: "member_request_feedback_c1_20261128", kind: "member_request_feedback", organizationId: "org", title: "[오늘 수업 내용 요청]", body: "회원이 오늘 수업 내용을 받고 싶어 해요" };
const device = { "teacherPush/t1": { tokens: { k1: { token: "tok-1", platform: "android" } } } };

test("스위치가 꺼져 있으면 보내지 않는다 (기본)", async () => {
  const sent = [];
  const result = await pushToTeacher(world(device), () => ({ sendEachForMulticast: async (m) => { sent.push(m); } }), target);
  assert.equal(result.push, "off");
  assert.equal(sent.length, 0);
});

test("켜져 있으면 한 번 -- 같은 알림함 글에 두 번 가지 않는다 · 문구 그대로 · 토큰은 기록에 없다", async () => {
  const db = world({ ...device, "runtimeConfig/teacherPush": { mode: "all" } });
  const sent = [];
  const messaging = () => ({ sendEachForMulticast: async (message) => { sent.push(message); return { successCount: 1, failureCount: 0, responses: [{ success: true }] }; } });
  assert.equal((await pushToTeacher(db, messaging, target)).push, "sent");
  assert.equal((await pushToTeacher(db, messaging, target)).push, "duplicate");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].notification.title, "[오늘 수업 내용 요청]");
  assert.equal(sent[0].data.open, "inbox");
  assert.equal(sent[0].android.notification.channelId, "teacher_alerts");
  assert.equal(JSON.stringify(db.docs.get(`notificationSends/teacher_${target.inboxId}_t1`)).includes("tok-1"), false);
});

test("기기가 없으면 no_device, 일부 강사만 켤 수도 있다", async () => {
  assert.equal((await pushToTeacher(world({ "runtimeConfig/teacherPush": { mode: "all" } }), () => ({}), target)).push, "no_device");
  const listed = world({ ...device, "runtimeConfig/teacherPush": { mode: "listed", userIds: ["someone"] } });
  assert.equal((await pushToTeacher(listed, () => ({}), target)).push, "off");
});

test("FCM 이 거절하면 실패로 남기고 던지지 않는다 · 죽은 토큰은 지운다", async () => {
  const db = world({ ...device, "runtimeConfig/teacherPush": { mode: "all" } });
  const messaging = () => ({ sendEachForMulticast: async () => ({ successCount: 0, failureCount: 1, responses: [{ success: false, error: { code: "messaging/registration-token-not-registered" } }] }) });
  const result = await pushToTeacher(db, messaging, target);
  assert.equal(result.push, "failed");
  assert.equal(result.errorCode, "messaging/registration-token-not-registered");
  const broken = await pushToTeacher(world({ ...device, "runtimeConfig/teacherPush": { mode: "all" } }), () => { throw Object.assign(new Error("init"), { code: "app/no-app" }); }, target);
  assert.equal(broken.push, "failed");
});
