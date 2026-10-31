"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { handleRuntimeConfigRequest } = require("../src/runtime-config-admin");
const { isActiveOwner, membershipId } = require("../src/member-link");

/* updateRuntimeConfig 의 본문을 역할마다 그대로 지난다 (2026-10-31).
   기존 appUpdate · settlement 쓰기가 그대로 되는지, scheduleSync 를 포함한 모든
   쓰기가 대표에게만 열리는지. index.js 가 쓰는 isActiveOwner · membershipId 그대로다. */

const ORG = "bonita";
const memberships = {
  [membershipId(ORG, "uid-owner")]: { status: "active", role: "owner" },
  [membershipId(ORG, "uid-area")]: { status: "active", role: "area_manager" },
  [membershipId(ORG, "uid-manager")]: { status: "active", role: "manager" },
  [membershipId(ORG, "uid-teacher")]: { status: "active", role: "instructor" },
  [membershipId(ORG, "uid-left-owner")]: { status: "left", role: "owner" },
};

function fakeFirestore(seed = {}) {
  const store = new Map(Object.entries(seed));
  const docRef = (path) => ({
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (value) => { store.set(path, value); },
  });
  return {
    store,
    collection: (name) => ({ doc: (id) => docRef(`${name}/${id}`) }),
  };
}

const seeded = () => fakeFirestore(Object.fromEntries(Object.entries(memberships).map(([id, value]) => [`memberships/${id}`, value])));
const call = (firestore, callerUid, document, value) => handleRuntimeConfigRequest(firestore, {
  callerUid, organizationId: ORG, document, value, now: () => new Date("2026-10-31T00:00:00Z"),
}, { isActiveOwner, membershipId });

/* 지금 웹(App.jsx AppUpdateAdmin.save)이 보내는 모양 그대로. */
const appUpdateValue = {
  android: { latestBuild: "73", minimumBuild: "", message: "세션업기능추가" },
  ios: { latestBuild: "226", minimumBuild: "", message: "세션업기능추가" },
};
const settlementValue = { minBuilds: { web: "", android: "70", ios: "" } };

test("대표: 기존 appUpdate · settlement 쓰기가 그대로 된다 — 지금 웹의 요청 모양", async () => {
  const firestore = seeded();
  const app = await call(firestore, "uid-owner", "appUpdate", appUpdateValue);
  assert.equal(app.document, "appUpdate");
  assert.deepEqual(app.value, appUpdateValue);
  assert.deepEqual(firestore.store.get("runtimeConfig/appUpdate").android, appUpdateValue.android);
  assert.equal(firestore.store.get("runtimeConfig/appUpdate").updatedBy, "uid-owner");

  const settlement = await call(firestore, "uid-owner", "settlement", settlementValue);
  assert.deepEqual(settlement.value, settlementValue);
  assert.deepEqual(firestore.store.get("runtimeConfig/settlement").minBuilds, settlementValue.minBuilds);

  // 응답에는 지금 값 전부가 실린다 -- 화면이 그것으로 다시 그린다.
  assert.deepEqual(Object.keys(settlement.config).sort(), ["appUpdate", "scheduleSync", "settlement"]);
  assert.equal(settlement.config.scheduleSync, null, "아직 쓰지 않은 스위치는 null -- 앱은 꺼짐으로 본다");
});

test("대표: 읽기만 (문서 없이) — 지금 웹이 화면을 열 때 보내는 요청", async () => {
  const result = await call(seeded(), "uid-owner", "", undefined);
  assert.deepEqual(Object.keys(result), ["config"]);
});

test("대표: scheduleSync 를 쓴다", async () => {
  const firestore = seeded();
  const result = await call(firestore, "uid-owner", "scheduleSync", { mode: "listed", userIds: ["uid-owner"] });
  assert.deepEqual(result.value, { mode: "listed", userIds: ["uid-owner"] });
  assert.deepEqual(result.config.scheduleSync.userIds, ["uid-owner"]);
});

test("총괄매니저 · 매니저 · 강사 · 떠난 대표 · 다른 센터 사람은 어떤 문서도 쓰지 못한다", async () => {
  for (const callerUid of ["uid-area", "uid-manager", "uid-teacher", "uid-left-owner", "uid-stranger"]) {
    for (const [document, value] of [["scheduleSync", { mode: "all" }], ["appUpdate", appUpdateValue], ["settlement", settlementValue], ["", undefined]]) {
      const firestore = seeded();
      await assert.rejects(call(firestore, callerUid, document, value), (error) => error.httpsCode === "permission-denied", `${callerUid} ${document}`);
      assert.equal(firestore.store.has(`runtimeConfig/${document || "appUpdate"}`), false, "아무것도 쓰지 않았다");
    }
  }
});

test("비로그인은 unauthenticated, 소속 없이는 invalid-argument", async () => {
  await assert.rejects(call(seeded(), "", "scheduleSync", { mode: "all" }), (error) => error.httpsCode === "unauthenticated");
  await assert.rejects(handleRuntimeConfigRequest(seeded(), { callerUid: "uid-owner", organizationId: "", document: "scheduleSync" }, { isActiveOwner, membershipId }),
    (error) => error.httpsCode === "invalid-argument");
});

test("값이 틀리면 쓰지 않고 쓰기 실패로 표시한다 — index.js 가 failed-precondition 으로", async () => {
  const firestore = seeded();
  await assert.rejects(call(firestore, "uid-owner", "scheduleSync", { mode: "on" }),
    (error) => error.writeFailed === true && /schedule_sync_mode_invalid/.test(error.message));
  await assert.rejects(call(firestore, "uid-owner", "appUpdate", { android: { latestBuild: "70", minimumBuild: "80" } }),
    (error) => error.writeFailed === true && /minimum_above_latest/.test(error.message));
  await assert.rejects(call(firestore, "uid-owner", "unknownDoc", {}), (error) => error.writeFailed === true && /unknown_document/.test(error.message));
  assert.equal(firestore.store.has("runtimeConfig/scheduleSync"), false);
});
