"use strict";

/* 보니따 앱 설치 현황 (2026-11-15 대표). 대표만 · 토큰 값 · 이름은 나가지 않음 · 앱이 켜진 흔적은 12시간에 한 번. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { appUsageOf, createMemberAppStatusService } = require("../src/member-app-status");
const { handleMemberPushSettings } = require("../src/member-push");

function fakeFirestore(seed = {}) {
  const store = new Map(Object.entries(seed));
  const writes = [];
  const merge = (base, value) => {
    const out = { ...(base || {}) };
    for (const [k, v] of Object.entries(value)) out[k] = v && typeof v === "object" && !(v instanceof Date) && out[k] && typeof out[k] === "object" ? merge(out[k], v) : v;
    return out;
  };
  const doc = (path) => ({
    id: path.split("/").pop(), path,
    get: async () => ({ id: path.split("/").pop(), exists: store.has(path), data: () => store.get(path), get: (field) => store.get(path)?.[field] }),
    set: async (value, options) => { writes.push(path); store.set(path, options?.merge ? merge(store.get(path), value) : { ...value }); },
  });
  const collection = (path) => {
    const filters = [];
    const api = {
      doc: (id) => doc(`${path}/${id}`),
      where: (field, op, value) => { filters.push([field, op, value]); return api; },
      select: () => api,
      get: async () => {
        const depth = path.split("/").length + 1;
        const docs = [...store.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === depth)
          .map((key) => ({ id: key.split("/").pop(), get: (field) => store.get(key)?.[field], data: () => store.get(key) }))
          .filter((d) => filters.every(([field, op, value]) => op === ">" ? String(d.get(field) ?? "") > value : true));
        return { docs };
      },
    };
    return api;
  };
  return { store, writes, doc, collection, getAll: async (...refs) => Promise.all(refs.map((ref) => ref.get())) };
}

const ORG = "bonita";
const owner = { status: "active", role: "owner" };
const seed = (extra = {}) => ({
  [`memberships/${ORG}_boss`]: owner,
  [`memberships/${ORG}_teacher`]: { status: "active", role: "instructor" },
  [`organizations/${ORG}/clients/c1`]: { name: "SECRET_NAME", userId: "u1" },
  [`organizations/${ORG}/clients/c2`]: { name: "B", userId: "u2" },
  [`organizations/${ORG}/clients/c3`]: { name: "C" },
  "memberPush/u1": { tokens: { a: { token: "SECRET_TOKEN", platform: "android" } }, seen: { android: new Date("2026-11-14T03:00:00Z") } },
  "memberPush/u2": { seen: { web: new Date("2026-11-10T03:00:00Z") } },
  ...extra,
});
const call = (db, uid, organizationId = ORG) => createMemberAppStatusService({ firestore: db }).list({ auth: { uid }, data: { organizationId } });

test("app use comes from a registered phone or a phone that opened the app; web alone is not the app", () => {
  assert.deepEqual(appUsageOf({ tokens: { a: { token: "t", platform: "ios" } } }), { app: true, platforms: ["ios"], notifications: true, lastSeenAt: "", lastPlatform: "" });
  const webOnly = appUsageOf({ seen: { web: new Date("2026-11-10T00:00:00Z") } });
  assert.equal(webOnly.app, false); assert.equal(webOnly.lastPlatform, "web");
  // 알림을 끈 채 앱만 켠 회원도 "앱 사용" 이다.
  const quiet = appUsageOf({ seen: { android: new Date("2026-11-12T00:00:00Z"), web: new Date("2026-11-01T00:00:00Z") } });
  assert.deepEqual([quiet.app, quiet.notifications, quiet.lastPlatform], [true, false, "android"]);
  assert.deepEqual(appUsageOf(null), { app: false, platforms: [], notifications: false, lastSeenAt: "", lastPlatform: "" });
});

test("owner sees each linked member's app use -- no names, no tokens; unlinked members are not listed", async () => {
  const result = await call(fakeFirestore(seed()), "boss");
  const byId = Object.fromEntries(result.members.map((m) => [m.clientId, m]));
  assert.deepEqual(Object.keys(byId).sort(), ["c1", "c2"]);
  assert.equal(byId.c1.app, true); assert.deepEqual(byId.c1.platforms, ["android"]);
  assert.equal(byId.c2.app, false); assert.equal(byId.c2.lastPlatform, "web");
  const json = JSON.stringify(result);
  assert.ok(!json.includes("SECRET_TOKEN") && !json.includes("SECRET_NAME") && !json.includes("u1"), "only client ids and app use go out");
});

test("only owner-level accounts may ask", async () => {
  await assert.rejects(call(fakeFirestore(seed()), "teacher"), { httpsCode: "permission-denied", code: "not_owner" });
  await assert.rejects(call(fakeFirestore(seed()), "stranger"), { httpsCode: "permission-denied" });
  await assert.rejects(call(fakeFirestore(seed()), ""), { httpsCode: "unauthenticated" });
  await assert.rejects(call(fakeFirestore(seed()), "boss", ""), { httpsCode: "invalid-argument" });
});

test("opening the member app leaves a mark at most every 12 hours, and only on read", async () => {
  const db = fakeFirestore({ "memberLinks/u9": { status: "linked" } });
  const at = (iso) => () => new Date(iso);
  await handleMemberPushSettings(db, { callerUid: "u9", action: "get", seenPlatform: "ios", appVersion: "1.1.4", now: at("2026-11-15T00:00:00Z") });
  assert.equal(db.store.get("memberPush/u9").seen.ios.toISOString(), "2026-11-15T00:00:00.000Z");
  assert.deepEqual(db.store.get("memberPush/u9").appVersion, { ios: "1.1.4" });
  await handleMemberPushSettings(db, { callerUid: "u9", action: "get", seenPlatform: "ios", now: at("2026-11-15T06:00:00Z") });
  assert.equal(db.writes.filter((p) => p === "memberPush/u9").length, 1, "not again within 12 hours");
  await handleMemberPushSettings(db, { callerUid: "u9", action: "get", seenPlatform: "ios", now: at("2026-11-15T12:00:00Z") });
  assert.equal(db.store.get("memberPush/u9").seen.ios.toISOString(), "2026-11-15T12:00:00.000Z");
  // 모르는 플랫폼 · 옛 앱(플랫폼 없음)은 아무것도 적지 않는다.
  const before = db.writes.length;
  await handleMemberPushSettings(db, { callerUid: "u9", action: "get", seenPlatform: "desktop", now: at("2026-11-16T12:00:00Z") });
  await handleMemberPushSettings(db, { callerUid: "u9", action: "get", now: at("2026-11-16T12:00:00Z") });
  assert.equal(db.writes.length, before);
});
