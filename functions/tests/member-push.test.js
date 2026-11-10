"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_CATCH_UP, PUSH_COPY, PUSH_KIND, dueKinds, handleMemberPushSettings, messageFor,
  pushAllowedFor, runMemberPush, sendKey, sweepWindow, tokenKey,
} = require("../src/member-push");

/* 회원 수업 알림 (2026-11-07, 지시서 2차 기본). 칸 계산 · 한 번만 · 직전 재확인 ·
   듀엣은 회원마다 · 설정 끔 · 스위치 끔 · 문구에 이름 없음. */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 10, 7, 3, 0, 0); // 11/7 12:00 KST

/* ── 가짜 Firestore: 이 모듈이 쓰는 모양만 ─────────────────────────────── */
function fakeFirestore(seed = {}) {
  const store = new Map(Object.entries(seed));
  const deleteMarker = Symbol.for("delete");
  const mergeInto = (base, value) => {
    const out = { ...(base || {}) };
    for (const [k, v] of Object.entries(value)) {
      if (v && v.constructor && v.constructor.name === "DeleteTransform") { delete out[k]; continue; }
      if (v === deleteMarker) { delete out[k]; continue; }
      if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && out[k] && typeof out[k] === "object") out[k] = mergeInto(out[k], v);
      else out[k] = v;
    }
    return out;
  };
  const docRef = (path) => ({
    id: path.split("/").pop(),
    path,
    get: async () => ({ id: path.split("/").pop(), exists: store.has(path), data: () => store.get(path) }),
    set: async (value, options) => { store.set(path, options?.merge ? mergeInto(store.get(path), value) : { ...value }); },
    update: async (value) => { if (!store.has(path)) throw new Error("no doc"); store.set(path, { ...store.get(path), ...value }); },
    create: async (value) => { if (store.has(path)) throw Object.assign(new Error("exists"), { code: 6 }); store.set(path, { ...value }); },
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  const collectionRef = (path) => {
    const filters = [];
    const api = {
      doc: (id) => docRef(`${path}/${id}`),
      where: (field, op, value) => { filters.push([field, op, value]); return api; },
      select: () => api,
      get: async () => {
        const depth = path.split("/").length + 1;
        const docs = [...store.keys()]
          .filter((key) => key.startsWith(`${path}/`) && key.split("/").length === depth)
          .map((key) => ({ id: key.split("/").pop(), ref: docRef(key), data: () => store.get(key) }))
          .filter((doc) => filters.every(([field, op, value]) => {
            const got = doc.data()[field];
            const a = got instanceof Date ? got.getTime() : got;
            const b = value instanceof Date ? value.getTime() : value;
            return op === ">" ? a > b : op === "<=" ? a <= b : op === "==" ? a === b : true;
          }));
        filters.length = 0;
        return { docs, size: docs.length };
      },
    };
    return api;
  };
  // 문서가 없는 상위 경로(organizations/{id})도 select().get() 에 잡히게 표시 문서를 둔다.
  return { store, collection: (name) => collectionRef(name) };
}

function fakeMessaging({ fail = {} } = {}) {
  const sent = [];
  return {
    sent,
    sendEachForMulticast: async (message) => {
      sent.push(message);
      const responses = message.tokens.map((token) => (fail[token]
        ? { success: false, error: { code: fail[token] } }
        : { success: true }));
      return {
        responses,
        successCount: responses.filter((item) => item.success).length,
        failureCount: responses.filter((item) => !item.success).length,
      };
    },
  };
}

const lesson = (overrides = {}) => ({
  status: "scheduled", clientIds: ["c1"], startsAt: new Date(NOW + 30 * MIN - 2 * MIN), ...overrides,
});

function world({ lessons = {}, mode = "all", userIds = [], prefs = null, tokens = { t1: "tok-1" }, sweptUntil = NOW - 5 * MIN } = {}) {
  const seed = {
    "organizations/org": { name: "센터" },
    "runtimeConfig/memberPush": { mode, userIds },
    "notificationState/memberPush": { sweptUntil: new Date(sweptUntil) },
    "organizations/org/clients/c1": { userId: "member-1" },
    "organizations/org/clients/c2": { userId: "member-2" },
    "organizations/org/clients/c3": {},
  };
  const tokenMap = Object.fromEntries(Object.entries(tokens).map(([key, token]) => [key, { token, platform: "ios" }]));
  seed["memberPush/member-1"] = { tokens: tokenMap, ...(prefs ? { prefs } : {}) };
  seed["memberPush/member-2"] = { tokens: { t2: { token: "tok-2", platform: "android" } } };
  for (const [id, value] of Object.entries(lessons)) seed[`organizations/org/lessons/${id}`] = value;
  return fakeFirestore(seed);
}

const run = (firestore, messaging, now = NOW) => runMemberPush(firestore, messaging, { now: () => now });

/* ── 칸 ──────────────────────────────────────────────────────────────── */

test("칸은 지난번 끝에서 지금까지 — 이어 붙어 겹침도 빈틈도 없다", () => {
  const first = sweepWindow({ now: NOW, sweptUntil: NOW - 5 * MIN });
  const second = sweepWindow({ now: NOW + 5 * MIN, sweptUntil: first.to });
  assert.equal(second.from, first.to);
  // 경계의 수업은 정확히 한 칸에만 든다.
  const edge = first.to + 30 * MIN;
  assert.deepEqual(dueKinds(edge, first), [PUSH_KIND.LESSON_30M]);
  assert.deepEqual(dueKinds(edge, second), []);
});

test("오래 멈췄다 깨어나면 15분까지만 거슬러 간다 · 처음이면 15분", () => {
  assert.equal(sweepWindow({ now: NOW, sweptUntil: NOW - 3 * HOUR }).from, NOW - MAX_CATCH_UP);
  assert.equal(sweepWindow({ now: NOW, sweptUntil: null }).from, NOW - MAX_CATCH_UP);
});

test("30시간 · 30분 칸 — 이미 시작한 수업은 아무것도 받지 않는다", () => {
  const window = { from: NOW - 5 * MIN, to: NOW };
  assert.deepEqual(dueKinds(NOW + 30 * HOUR - MIN, window), []);
  assert.deepEqual(dueKinds(NOW + 30 * MIN - MIN, window), [PUSH_KIND.LESSON_30M]);
  assert.deepEqual(dueKinds(NOW + 2 * HOUR, window), []);
  assert.deepEqual(dueKinds(NOW - MIN, window), []);
});

/* ── 보내기 ──────────────────────────────────────────────────────────── */

test("30분 전 한 통 · 문구는 대표 확정 그대로 · 이름 없음 · 기록이 남는다", async () => {
  const firestore = world({ lessons: { L1: lesson() } });
  const messaging = fakeMessaging();
  const tally = await run(firestore, messaging);
  assert.equal(tally.sent, 1);
  const [message] = messaging.sent;
  assert.equal(message.notification.title, "수업 30분 전");
  assert.equal(message.notification.body, "잠시 후 수업이 시작됩니다. 수업 준비를 부탁드립니다.");
  assert.deepEqual(message.tokens, ["tok-1"]);
  assert.deepEqual(Object.keys(message.data).sort(), ["kind", "lessonId", "open", "organizationId"]);
  const record = firestore.store.get(`notificationSends/${sendKey("L1", "c1", PUSH_KIND.LESSON_30M)}`);
  assert.equal(record.status, "sent");
  assert.equal(record.successCount, 1);
  assert.equal(JSON.stringify(record).includes("tok-1"), false, "기록에 토큰 값이 없다");
});

test("30시간 전 문구", async () => {
  const firestore = world({ lessons: { L1: lesson({ startsAt: new Date(NOW + 30 * HOUR - MIN) }) } });
  const messaging = fakeMessaging();
  await run(firestore, messaging);
  assert.equal(messaging.sent.length, 0, "취소 마감 알림은 보내지 않는다");
});

test("한 번만 — 같은 칸을 다시 돌아도, 기록이 이미 있어도 두 번 보내지 않는다", async () => {
  const firestore = world({ lessons: { L1: lesson() } });
  const messaging = fakeMessaging();
  await run(firestore, messaging);
  firestore.store.set("notificationState/memberPush", { sweptUntil: new Date(NOW - 5 * MIN) });
  const again = await run(firestore, messaging);
  assert.equal(messaging.sent.length, 1);
  assert.equal(again.duplicate, 1);
});

test("듀엣은 회원마다 따로 · 계정이 없는 회원은 건너뛴다", async () => {
  const firestore = world({ lessons: { L1: lesson({ clientIds: ["c1", "c2", "c3"] }) } });
  const messaging = fakeMessaging();
  const tally = await run(firestore, messaging);
  assert.equal(messaging.sent.length, 2);
  assert.deepEqual(messaging.sent.map((item) => item.tokens[0]).sort(), ["tok-1", "tok-2"]);
  assert.equal(tally.noAccount, 1);
});

test("취소 · 삭제 · 확정된 수업은 보내지 않는다", async () => {
  for (const changed of [{ status: "cancelled" }, { deletedAt: new Date(NOW) }, { status: "completed" }]) {
    const firestore = world({ lessons: { L1: lesson(changed) } });
    const messaging = fakeMessaging();
    await run(firestore, messaging);
    assert.equal(messaging.sent.length, 0, JSON.stringify(changed));
  }
});

test("보내기 직전에 다시 본다 — 그사이 취소됐거나 시각이 옮겨졌으면 이번에는 안 보낸다", async () => {
  const firestore = world({ lessons: { L1: lesson() } });
  const messaging = fakeMessaging();
  // 회원 문서를 읽는 순간(목록을 읽은 뒤) 강사가 시각을 3시간 뒤로 옮겼다.
  const original = firestore.collection;
  firestore.collection = (name) => {
    const ref = original(name);
    if (name !== "memberPush") return ref;
    return { ...ref, doc: (id) => { const doc = ref.doc(id); return { ...doc, get: async () => {
      firestore.store.set("organizations/org/lessons/L1", lesson({ startsAt: new Date(NOW + 3 * HOUR) }));
      return doc.get();
    } }; } };
  };
  const tally = await run(firestore, messaging);
  assert.equal(messaging.sent.length, 0);
  assert.equal(tally.skipped, 1);
  assert.equal(firestore.store.has(`notificationSends/${sendKey("L1", "c1", PUSH_KIND.LESSON_30M)}`), false,
    "기록을 남기지 않는다 -- 새 시각이 칸에 들어오면 그때 보낸다");
});

test("회원이 끈 알림은 보내지 않는다 (종류별)", async () => {
  const firestore = world({ lessons: { L1: lesson() }, prefs: { lesson30m: false } });
  const messaging = fakeMessaging();
  await run(firestore, messaging);
  assert.equal(messaging.sent.length, 0);
  const on30h = world({ lessons: { L1: lesson({ startsAt: new Date(NOW + 30 * HOUR - MIN) }) }, prefs: { lesson30m: false } });
  const messaging2 = fakeMessaging();
  await run(on30h, messaging2);
  assert.equal(messaging2.sent.length, 0, "30시간 알림은 폐지됐다");
});

test("스위치가 꺼져 있으면 아무에게도 보내지 않고, 칸만 앞으로 민다", async () => {
  const firestore = world({ lessons: { L1: lesson() }, mode: "off" });
  const messaging = fakeMessaging();
  const tally = await run(firestore, messaging);
  assert.equal(tally.switch, "off");
  assert.equal(messaging.sent.length, 0);
  assert.equal(firestore.store.get("notificationState/memberPush").sweptUntil.getTime(), NOW);
  assert.equal(pushAllowedFor(null, "member-1"), false, "문서가 없으면 꺼짐");
});

test("listed 는 그 회원 계정에만", async () => {
  const firestore = world({ lessons: { L1: lesson({ clientIds: ["c1", "c2"] }) }, mode: "listed", userIds: ["member-2"] });
  const messaging = fakeMessaging();
  await run(firestore, messaging);
  assert.deepEqual(messaging.sent.map((item) => item.tokens[0]), ["tok-2"]);
});

test("실패는 원본 코드로 남기고, 죽은 토큰은 지운다", async () => {
  const firestore = world({ lessons: { L1: lesson() }, tokens: { t1: "tok-1", t9: "tok-dead" } });
  const messaging = fakeMessaging({ fail: { "tok-dead": "messaging/registration-token-not-registered" } });
  await run(firestore, messaging);
  const record = firestore.store.get(`notificationSends/${sendKey("L1", "c1", PUSH_KIND.LESSON_30M)}`);
  assert.equal(record.status, "sent");
  assert.deepEqual(record.errorCodes, ["messaging/registration-token-not-registered"]);
  assert.equal(record.removedTokens, 1);
  assert.deepEqual(Object.keys(firestore.store.get("memberPush/member-1").tokens), ["t1"], "죽은 토큰만 지운다");
});

test("문구 · 메시지에 회원 이름이 들어갈 자리가 없다", () => {
  for (const copy of Object.values(PUSH_COPY)) assert.doesNotMatch(`${copy.title}${copy.body}`, /님|\{|\$/);
  const message = messageFor({ kind: PUSH_KIND.LESSON_30M, organizationId: "org", lessonId: "L1", tokens: ["x"] });
  assert.deepEqual(Object.keys(message.data).sort(), ["kind", "lessonId", "open", "organizationId"]);
});

/* ── 회원 앱 통로 ────────────────────────────────────────────────────── */

test("설정 통로 — 회원 계정만, 토큰 등록 · 해제, 설정 저장, 기본은 둘 다 켜짐", async () => {
  const firestore = fakeFirestore({ "memberLinks/member-1": { status: "linked" } });
  await assert.rejects(handleMemberPushSettings(firestore, { callerUid: "", action: "get" }), /unauthenticated/);
  await assert.rejects(handleMemberPushSettings(firestore, { callerUid: "staff-1", action: "get" }), /member_link_missing/);

  const first = await handleMemberPushSettings(firestore, { callerUid: "member-1", action: "get" });
  assert.deepEqual(first.prefs, { lessonRating: true, lesson30m: true });

  const registered = await handleMemberPushSettings(firestore, { callerUid: "member-1", action: "register", token: "tok-a", platform: "android" });
  assert.equal(registered.devices, 1);
  const stored = firestore.store.get("memberPush/member-1");
  assert.ok(stored.tokens[tokenKey("tok-a")], "칸 이름은 토큰 해시");
  assert.equal(Object.keys(stored.tokens).some((key) => key.includes("tok-a")), false);

  const saved = await handleMemberPushSettings(firestore, { callerUid: "member-1", action: "save", prefs: { lessonRating: false } });
  assert.deepEqual(saved.prefs, { lessonRating: false, lesson30m: true });

  await assert.rejects(handleMemberPushSettings(firestore, { callerUid: "member-1", action: "save", prefs: { lesson30h: "no" } }), /push_prefs_invalid/);
  await assert.rejects(handleMemberPushSettings(firestore, { callerUid: "member-1", action: "register", token: "x", platform: "web" }), /push_platform_invalid/);
  await assert.rejects(handleMemberPushSettings(firestore, { callerUid: "member-1", action: "nope" }), /push_action_invalid/);
});

test("평가 알림: 종료 10분 뒤 출석 회원에게만, 정확한 수업으로, 중복 없음", async () => {
  const db = world({ lessons: { L1: lesson({ status: "completed", startsAt: new Date(NOW - 62 * MIN), endsAt: new Date(NOW - 12 * MIN), clientIds: ["c1", "c2"], instructorId: "t1" }) } });
  db.store.set("runtimeConfig/scheduleSync", { memberRating: { mode: "all" } });
  db.store.set("organizations/org/lessons/L1/participants/c1", { attendanceStatus: "attended" });
  db.store.set("organizations/org/lessons/L1/participants/c2", { attendanceStatus: "noshow" });
  const messaging = fakeMessaging();
  assert.equal((await run(db, messaging)).sent, 1);
  assert.deepEqual(messaging.sent[0].tokens, ["tok-1"]);
  assert.deepEqual(messaging.sent[0].data, { kind: "lessonRating", open: "rating", organizationId: "org", clientId: "c1", lessonId: "L1" });
  db.store.set("notificationState/memberPush", { sweptUntil: new Date(NOW - 5 * MIN) });
  assert.equal((await run(db, messaging)).duplicate, 1);
  assert.equal(messaging.sent.length, 1);
});

test("평가 알림: 너무 이른 수업·설정 끔·이미 평가·취소·출석 미확인은 제외", async () => {
  for (const mode of ["early", "pref", "rated", "cancelled", "booked", "off", "moved", "memberCancelled"]) {
    const db = world({ lessons: { L1: lesson({ status: mode === "cancelled" ? "cancelled" : "completed", startsAt: new Date(NOW - 62 * MIN), endsAt: new Date(NOW - (mode === "early" ? 9 : 12) * MIN), instructorId: "t1", ...(mode === "memberCancelled" ? { memberCancellations: { c1: { at: new Date(NOW) } } } : {}) }) }, prefs: mode === "pref" ? { lessonRating: false } : null });
    db.store.set("runtimeConfig/scheduleSync", { memberRating: { mode: mode === "off" ? "off" : "all" } });
    db.store.set("organizations/org/lessons/L1/participants/c1", { attendanceStatus: mode === "booked" ? "booked" : "attended" });
    if (mode === "rated") db.store.set("organizations/org/lessonRatings/L1_c1", { scores: {} });
    if (mode === "moved") {
      const collection = db.collection.bind(db);
      db.collection = (name) => {
        if (name === "memberPush") db.store.get("organizations/org/lessons/L1").endsAt = new Date(NOW + 20 * MIN);
        return collection(name);
      };
    }
    const messaging = fakeMessaging();
    await run(db, messaging);
    assert.equal(messaging.sent.length, 0, mode);
  }
});

test("옛 앱의 30시간 설정 요청은 받아도 다시 켜지지 않는다", async () => {
  const db = world(); db.store.set("memberLinks/member-1", {});
  const result = await handleMemberPushSettings(db, { callerUid: "member-1", action: "save", prefs: { lesson30h: true } });
  assert.equal(result.prefs.lesson30h, undefined);
  assert.equal(result.prefs.lessonRating, true);
});

test("옛 앱에서 두 알림을 모두 꺼도 새 평가 알림이 켜지지 않는다", async () => {
  const db = world(); db.store.set("memberLinks/member-1", {});
  const result = await handleMemberPushSettings(db, { callerUid: "member-1", action: "save", prefs: { lesson30h: false, lesson30m: false } });
  assert.deepEqual(result.prefs, { lessonRating: false, lesson30m: false });
  assert.equal(PUSH_COPY.lesson30h, undefined);
});
