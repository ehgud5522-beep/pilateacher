"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { memberCancelLesson } = require("../src/member-cancel");
const { membershipId } = require("../src/member-link");
const {
  TEACHER_NOTICE, TITLE, cancelThenNotifyTeacher, handleTeacherPushSettings, lessonWhenLabel, teacherCancelBody,
} = require("../src/teacher-cancel-push");

/* 회원 취소 → 담당 강사 푸시 (2026-11-07). 취소 본문(memberCancelLesson)을 그대로 지나고
   알림만 가짜 FCM 으로 받는다. index.js 는 cancelThenNotifyTeacher 를 감쌀 뿐이다. */

const ORG = "bonita";
const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-06T03:00:00Z"); // 한국 11월 6일(금) 12:00
const STARTS = new Date("2026-11-08T01:00:00Z"); // 한국 11월 8일(일) 10:00

const clone = (value) => (value instanceof Date ? new Date(value) : Array.isArray(value) ? value.map(clone)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value);

/** 경로로 문서를 두는 Firestore. create 는 있으면 code 6 으로 실패한다 (Admin SDK 와 같다). */
function memoryFirestore(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  let counter = 0;
  let chain = Promise.resolve();
  const snapshot = (path) => ({
    id: path.split("/").pop(), exists: docs.has(path), data: () => (docs.has(path) ? clone(docs.get(path)) : undefined),
  });
  const write = (path, value, options) => {
    docs.set(path, options?.merge ? { ...(docs.get(path) || {}), ...clone(value) } : clone(value));
  };
  const docRef = (path) => ({
    id: path.split("/").pop(),
    path,
    get: async () => snapshot(path),
    set: async (value, options) => write(path, value, options),
    create: async (value) => {
      if (docs.has(path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      write(path, value);
    },
    update: async (value) => {
      if (!docs.has(path)) throw Object.assign(new Error("NOT_FOUND"), { code: 5 });
      write(path, value, { merge: true });
    },
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  const collectionRef = (path) => {
    const query = (filters) => ({
      where: (field, op, value) => query([...filters, [field, op, value]]),
      get: async () => ({
        docs: [...docs.keys()]
          .filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
          .filter((key) => filters.every(([field, op, value]) => {
            const actual = docs.get(key)?.[field];
            if (op === "==") return actual === value;
            if (op === "array-contains") return Array.isArray(actual) && actual.includes(value);
            throw new Error(`unsupported ${op}`);
          }))
          .map(snapshot),
      }),
    });
    return { doc: (id) => docRef(`${path}/${id || `auto-${(counter += 1)}`}`), ...query([]) };
  };
  return {
    docs,
    collection: collectionRef,
    read: (path) => docs.get(path),
    runTransaction(callback) {
      const run = chain.then(async () => {
        const writes = [];
        const result = await callback({
          get: async (ref) => snapshot(ref.path),
          set: (ref, value, options) => writes.push([ref.path, value, options]),
        });
        for (const [path, value, options] of writes) write(path, value, options);
        return result;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}

function fakeMessaging({ throwCode = "", failCode = "" } = {}) {
  const sent = [];
  return {
    sent,
    async sendEachForMulticast(message) {
      sent.push(message);
      if (throwCode) throw Object.assign(new Error(`fcm said ${throwCode}`), { code: throwCode });
      if (failCode) {
        return {
          successCount: 0, failureCount: message.tokens.length,
          responses: message.tokens.map(() => ({ success: false, error: { code: failCode } })),
        };
      }
      return { successCount: message.tokens.length, failureCount: 0, responses: message.tokens.map(() => ({ success: true })) };
    },
  };
}

function fakeLog() {
  const lines = [];
  const at = (level) => (event, fields) => lines.push({ level, event, ...fields });
  return { lines, info: at("info"), warn: at("warn"), error: at("error") };
}

const lessonPath = (id) => `organizations/${ORG}/lessons/${id}`;
const sendsOf = (db) => [...db.docs.entries()].filter(([key]) => key.startsWith("notificationSends/"));

function seed({ teacherPush = { mode: "all" }, devices = { k1: { token: "tok-teacher", platform: "ios" } }, lesson = {} } = {}) {
  const base = {
    "runtimeConfig/scheduleSync": {
      mode: "listed", userIds: ["uid-teacher"],
      memberCancel: { mode: "listed", userIds: ["uid-teacher"], limit: 3, period: "month" },
    },
    [`memberships/${membershipId(ORG, "uid-teacher")}`]: { status: "active", role: "instructor", displayName: "정예진" },
    [`organizations/${ORG}/clients/client-a`]: { organizationId: ORG, userId: "uid-member-a", name: "김하나", instructorIds: ["uid-teacher"] },
    [`organizations/${ORG}/clients/client-b`]: { organizationId: ORG, userId: "uid-member-b", name: "박둘", instructorIds: ["uid-teacher"] },
    [lessonPath("L1")]: {
      organizationId: ORG, lessonId: "L1", status: "scheduled", clientIds: ["client-a"], clientId: "client-a",
      instructorId: "uid-teacher", startsAt: STARTS, revision: 1, ...lesson,
    },
  };
  if (teacherPush) base["runtimeConfig/teacherPush"] = teacherPush;
  if (devices) base["teacherPush/uid-teacher"] = { tokens: devices };
  return memoryFirestore(base);
}

let ids = 0;
function cancel(db, messaging, { log = fakeLog(), getMessaging = () => messaging, clientId = "client-a", uid = "uid-member-a" } = {}) {
  return cancelThenNotifyTeacher(
    db, getMessaging,
    { callerUid: uid, organizationId: ORG, clientId, lessonId: "L1" },
    { membershipId, now: () => NOW, newId: () => `rec-${(ids += 1)}` },
    { cancel: memberCancelLesson },
    { log, stamp: () => NOW },
  );
}

test("취소가 되면 담당 강사에게 한 번 — 제목 · 본문(한국 시각) · 강사 토큰, 회원 이름 없음", async () => {
  const db = seed();
  const messaging = fakeMessaging();
  const result = await cancel(db, messaging);
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.teacherNotice, TEACHER_NOTICE.SENT);
  assert.equal(messaging.sent.length, 1);
  const [message] = messaging.sent;
  assert.deepEqual(message.tokens, ["tok-teacher"]);
  assert.equal(message.notification.title, "[회원 수업 취소]");
  assert.equal(message.notification.body, "11/8(일) 10:00 수업이 회원 요청으로 취소되었어요");
  assert.doesNotMatch(JSON.stringify(message), /김하나|client-a|uid-member/, "잠금 화면에 회원이 드러나지 않는다");
  const sends = sendsOf(db);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][0], `notificationSends/L1_client-a_member_cancel_${result.recordId}`);
  assert.equal(sends[0][1].status, "sent");
});

test("두 번 눌러도 알림은 한 번 — 동시에 · 다시 눌러도, 다시 누른 쪽도 '보냈음' 을 그대로 받는다", async () => {
  const db = seed();
  const messaging = fakeMessaging();
  const [first, second] = await Promise.all([cancel(db, messaging), cancel(db, messaging)]);
  assert.deepEqual([first.outcome, second.outcome].sort(), ["already_cancelled", "cancelled"]);
  assert.equal(messaging.sent.length, 1);
  const again = await cancel(db, messaging);
  assert.equal(again.outcome, "already_cancelled");
  assert.equal(again.teacherNotice, TEACHER_NOTICE.SENT, "이미 보낸 취소는 보냈다고 답한다");
  assert.equal(messaging.sent.length, 1);
  assert.equal(sendsOf(db).length, 1);
});

test("푸시가 실패해도 취소는 그대로 성공 — 원본 코드를 기록 · 로그에 남기고 '전달 안 됨' 으로 답한다", async () => {
  const db = seed();
  const messaging = fakeMessaging({ throwCode: "messaging/internal-error" });
  const log = fakeLog();
  const result = await cancel(db, messaging, { log });
  assert.equal(result.outcome, "cancelled");
  assert.equal(db.read(lessonPath("L1")).status, "cancelled", "수업은 취소된 채로 남는다");
  assert.equal(result.teacherNotice, TEACHER_NOTICE.FAILED);
  assert.equal(result.teacherNoticeCode, "messaging/internal-error");
  const [, send] = sendsOf(db)[0];
  assert.equal(send.status, "failed");
  assert.deepEqual(send.errorCodes, ["messaging/internal-error"]);
  const line = log.lines.find((item) => item.event === "member_cancel_push_failed");
  assert.ok(line, "실패 로그가 있다");
  assert.equal(line.feature, "member_cancel_push");
  assert.equal(line.stage, "send");
  assert.equal(line.errorDomain, "fcm");
  assert.equal(line.errorCode, "messaging/internal-error");
  assert.equal(line.correlationId, result.recordId);
  assert.doesNotMatch(JSON.stringify(log.lines), /김하나|tok-teacher|client-a|uid-member|uid-teacher/, "이름 · 토큰 · 회원 id · uid 없음");

  /* 다시 눌러도 다시 보내지 않는다 -- 실패는 실패로 답한다. */
  const again = await cancel(db, fakeMessaging());
  assert.equal(again.teacherNotice, TEACHER_NOTICE.FAILED);
});

test("FCM 이 모든 토큰을 거절하면 failed — 그 원본 코드", async () => {
  const db = seed();
  const result = await cancel(db, fakeMessaging({ failCode: "messaging/third-party-auth-error" }));
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.teacherNotice, TEACHER_NOTICE.FAILED);
  assert.equal(result.teacherNoticeCode, "messaging/third-party-auth-error");
});

test("FCM 을 열지도 못하면(초기화 실패) 취소는 성공, 알림은 failed + 로그", async () => {
  const db = seed();
  const log = fakeLog();
  const result = await cancel(db, null, { log, getMessaging: () => { throw Object.assign(new Error("no app"), { code: "app/no-app" }); } });
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.teacherNotice, TEACHER_NOTICE.FAILED);
  assert.equal(result.teacherNoticeCode, "app/no-app");
  assert.ok(log.lines.some((item) => item.event === "member_cancel_push_failed" && item.stage === "messaging_init"));
});

test("스위치가 없으면(기본) 보내지 않는다 — off, 보낸 기록도 없음", async () => {
  const db = seed({ teacherPush: null });
  const messaging = fakeMessaging();
  const result = await cancel(db, messaging);
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.teacherNotice, TEACHER_NOTICE.OFF);
  assert.equal(messaging.sent.length, 0);
  assert.equal(sendsOf(db).length, 0);
  const listedOther = await cancel(seed({ teacherPush: { mode: "listed", userIds: ["uid-other"] } }), messaging);
  assert.equal(listedOther.teacherNotice, TEACHER_NOTICE.OFF, "시범 목록 밖의 강사");
  assert.equal(messaging.sent.length, 0);
});

test("강사 기기 토큰이 없으면 no_device — 진단에 남기고 보내지 않는다", async () => {
  const db = seed({ devices: null });
  const messaging = fakeMessaging();
  const log = fakeLog();
  const result = await cancel(db, messaging, { log });
  assert.equal(result.teacherNotice, TEACHER_NOTICE.NO_DEVICE);
  assert.equal(messaging.sent.length, 0);
  assert.ok(log.lines.some((item) => item.errorCode === "no_device"));
});

test("막힌 취소는 알림도 없다 — 오류를 그대로 던진다", async () => {
  const db = seed({ lesson: { startsAt: new Date(NOW.getTime() + 2 * HOUR) } });
  const messaging = fakeMessaging();
  await assert.rejects(cancel(db, messaging), (error) => error.reason === "deadline_passed");
  assert.equal(messaging.sent.length, 0);
  assert.equal(sendsOf(db).length, 0);
});

test("듀엣에서 한 사람만 빠지면 '듀엣 수업에서 회원 1명이 취소했어요'", async () => {
  const db = seed({ lesson: { clientIds: ["client-a", "client-b"] } });
  const messaging = fakeMessaging();
  const result = await cancel(db, messaging);
  assert.equal(result.partnerKept, true);
  assert.equal(messaging.sent[0].notification.body, "11/8(일) 10:00 듀엣 수업에서 회원 1명이 취소했어요");
});

test("시각 표시는 한국 시각 · 서버 시간대와 무관", () => {
  assert.equal(lessonWhenLabel(new Date("2026-11-08T15:30:00Z")), "11/9(월) 00:30");
  assert.equal(lessonWhenLabel(null), "");
  assert.equal(teacherCancelBody({ lessonStartsAt: null }), "수업이 회원 요청으로 취소되었어요");
  assert.equal(TITLE, "[회원 수업 취소]");
});

test("강사 토큰 등록 통로: 센터 직원만 · 서버가 teacherPush/{uid} 에 쓴다", async () => {
  const db = seed({ devices: null });
  const result = await handleTeacherPushSettings(db, {
    callerUid: "uid-teacher", organizationId: ORG, action: "register", token: "tok-new", platform: "android",
  }, { membershipId });
  assert.equal(result.devices, 1);
  const stored = Object.values(db.read("teacherPush/uid-teacher").tokens);
  assert.equal(stored[0].token, "tok-new");
  await assert.rejects(handleTeacherPushSettings(db, {
    callerUid: "uid-member-a", organizationId: ORG, action: "register", token: "x", platform: "ios",
  }, { membershipId }), (error) => error.code === "not_staff");
  await assert.rejects(handleTeacherPushSettings(db, {
    callerUid: "uid-teacher", organizationId: ORG, action: "register", token: "x", platform: "web",
  }, { membershipId }), (error) => error.code === "push_platform_invalid");
});


/* ── 강사 알림함 (2026-11-07) ── */
const inboxOf = (db, uid = "uid-teacher") => [...db.docs.entries()].filter(([key]) => key.startsWith(`users/${uid}/inbox/`));

test("알림함: 취소마다 강사 알림함에 한 건 — 푸시 스위치가 꺼져 있어도, 이름 없이", async () => {
  const db = seed({ teacherPush: null, devices: null });
  const result = await cancel(db, fakeMessaging());
  assert.equal(result.teacherNotice, TEACHER_NOTICE.OFF);
  assert.equal(result.teacherInbox, "written");
  const items = inboxOf(db);
  assert.equal(items.length, 1);
  const [path, item] = items[0];
  assert.equal(path, `users/uid-teacher/inbox/${result.recordId}`);
  assert.equal(item.kind, "member_cancel");
  assert.equal(item.lessonId, "L1");
  assert.equal(item.clientId, "client-a");
  assert.equal(item.body, "11/8(일) 10:00 수업이 회원 요청으로 취소되었어요");
  assert.equal(item.readAt, undefined, "서버는 읽음을 적지 않는다");
  assert.doesNotMatch(JSON.stringify(item), /김하나/);
});

test("알림함: 두 번 눌러도 한 건 — 두 번째는 duplicate", async () => {
  const db = seed();
  const messaging = fakeMessaging();
  await cancel(db, messaging);
  const again = await cancel(db, messaging);
  assert.equal(again.teacherInbox, "duplicate");
  assert.equal(inboxOf(db).length, 1);
});

test("알림함 쓰기가 실패해도 취소 · 푸시는 그대로 — failed + 원본 코드 + 로그", async () => {
  const db = seed();
  const original = db.collection;
  db.collection = (name) => {
    const ref = original(name);
    if (name !== "users") return ref;
    return { doc: () => ({ collection: () => ({ doc: () => ({ create: async () => { throw Object.assign(new Error("quota"), { code: "resource-exhausted" }); } }) }) }) };
  };
  const log = fakeLog();
  const messaging = fakeMessaging();
  const result = await cancel(db, messaging, { log });
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.teacherInbox, "failed");
  assert.equal(result.teacherInboxCode, "resource-exhausted");
  assert.equal(result.teacherNotice, TEACHER_NOTICE.SENT, "푸시는 따로 간다");
  assert.ok(log.lines.some((line) => line.event === "member_cancel_inbox_failed" && line.errorCode === "resource-exhausted" && line.stage === "create"));
});
