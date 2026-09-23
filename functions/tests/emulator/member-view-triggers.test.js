"use strict";

/**
 * 트리거의 읽기·쓰기를 에뮬레이터에서 실제로 돌린다.
 *
 * 가짜 Firestore 로는 못 보는 것들이 여기 있다 -- array-contains 질의가 옛
 * 회원권을 빠뜨리는지, orderBy·limit 가 원장을 제대로 자르는지, 트랜잭션의
 * high-water mark 가 늦게 온 쓰기를 실제로 막는지.
 *
 * Admin SDK 는 규칙을 지나지 않는다. 그것이 실제 트리거의 조건과 같다.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const {
  clientIdsFromPassChange, collectMemberViewInput, rebuildMemberView,
  rebuildMemberViews,
} = require("../../src/member-view-triggers");

const ORG = "center-a";
const app = initializeApp({ projectId: "pilateacher-dev" }, `member-view-${Date.now()}`);
const db = getFirestore(app);
const org = db.collection("organizations").doc(ORG);

test.after(async () => { await deleteApp(app); });

const wipe = async () => {
  for (const name of ["clients", "passes", "memberViews", "locations", "instructorClientTotals"]) {
    const page = await org.collection(name).get();
    await Promise.all(page.docs.map(async (snapshot) => {
      const ledger = await snapshot.ref.collection("ledger").get();
      await Promise.all(ledger.docs.map((entry) => entry.ref.delete()));
      await snapshot.ref.delete();
    }));
  }
  const memberships = await db.collection("memberships").get();
  await Promise.all(memberships.docs.map((snapshot) => snapshot.ref.delete()));
};

const seed = async (overrides = {}) => {
  await wipe();
  await org.collection("locations").doc("bansong").set({ organizationId: ORG, name: "반송점" });
  await db.collection("memberships").doc(`${ORG}_u1`).set({
    organizationId: ORG, userId: "u1", role: "instructor", status: "active", displayName: "정예진",
  });
  await org.collection("clients").doc("client-a").set({
    organizationId: ORG, name: "김하나", userId: "uid-1", phone: "01012345678",
    locationId: "bansong", status: "active",
  });
  await org.collection("clients").doc("client-b").set({
    organizationId: ORG, name: "박두리", userId: "uid-2", phone: "01099998888",
    locationId: "bansong", status: "active",
  });
  await org.collection("instructorClientTotals").doc("u1_client-a").set({
    organizationId: ORG, instructorId: "u1", clientId: "client-a", sessions: 40,
  });
  for (const pass of overrides.passes || [{
    id: "pass-1", clientId: "client-a", clientIds: ["client-a"], instructorId: "u1",
    locationId: "bansong", productId: "product-1", category: "pt_1_1_new", purchaseRound: 1,
    totalSessions: 20, serviceSessions: 0, remainingCount: 8, status: "active",
    expiresAt: new Date(2027, 0, 31), baseUnitPrice: 25000, contractPrice: 1300000,
  }]) {
    const { id, ledger = [], ...body } = pass;
    await org.collection("passes").doc(id).set({ organizationId: ORG, ...body });
    for (const entry of ledger) {
      await org.collection("passes").doc(id).collection("ledger").doc(entry.id).set({
        organizationId: ORG, passId: id, ...entry,
      });
    }
  }
};

const viewOf = async (clientId) => (await org.collection("memberViews").doc(clientId).get()).data();

/* ── 어느 회원을 다시 만들 것인가 ─────────────────────────────────────── */

test("a pass change names every member it touches, before and after", () => {
  /* before 도 본다. 담당이나 구성이 바뀌면 떨어져 나간 쪽의 투영도 다시
     만들어져야 한다 -- 안 그러면 그 회원 화면에 없어진 회원권이 남는다. */
  assert.deepEqual(
    clientIdsFromPassChange({ clientId: "a", clientIds: ["a", "b"] }, { clientId: "a", clientIds: ["a"] }).sort(),
    ["a", "b"],
  );
  assert.deepEqual(clientIdsFromPassChange(null, { clientId: "a" }), ["a"]);
  assert.deepEqual(clientIdsFromPassChange({ clientId: "a" }, null), ["a"]);
  assert.deepEqual(clientIdsFromPassChange(null, null), []);
});

/* ── 실제로 읽어 온다 ─────────────────────────────────────────────────── */

test("an old pass with no clientIds is still found", async () => {
  /* 이관분과 듀엣 이전 발급분에는 clientIds 가 없다. array-contains 만 걸면
     그 회원권이 통째로 빠지고, 회원은 잔여가 0 으로 보인다. */
  await seed({ passes: [{
    id: "legacy", clientId: "client-a", instructorId: "u1", locationId: "bansong",
    totalSessions: 20, serviceSessions: 0, remainingCount: 5, status: "active",
    expiresAt: new Date(2027, 0, 31), purchaseRound: 1,
  }] });
  const collected = await collectMemberViewInput(db, ORG, "client-a");
  assert.equal(collected.passes.length, 1);
  assert.equal(collected.passes[0].id, "legacy");
});

test("a pass is not read twice when both queries match it", async () => {
  // clientId 와 clientIds 둘 다에 걸리는 보통의 회원권이다.
  await seed();
  const collected = await collectMemberViewInput(db, ORG, "client-a");
  assert.equal(collected.passes.length, 1);
});

test("names come from the centre, not from ids", async () => {
  await seed();
  const collected = await collectMemberViewInput(db, ORG, "client-a");
  assert.equal(collected.locationName, "반송점");
  assert.equal(collected.instructorNames.u1, "정예진");
  assert.equal(collected.instructorSessions, 40);
});

test("a member the centre does not have collects nothing", async () => {
  await seed();
  assert.equal(await collectMemberViewInput(db, ORG, "nobody"), null);
});

/* ── 다시 만들어 쓴다 ─────────────────────────────────────────────────── */

test("the projection lands with the remaining count and no prices", async () => {
  await seed({ passes: [{
    id: "pass-1", clientId: "client-a", clientIds: ["client-a"], instructorId: "u1",
    locationId: "bansong", productId: "product-1", category: "pt_1_1_new", purchaseRound: 1,
    totalSessions: 20, serviceSessions: 2, remainingCount: 8, status: "active",
    expiresAt: new Date(2027, 0, 31), baseUnitPrice: 25000, contractPrice: 1300000,
    netContractPrice: 1181818, paymentMethod: "card",
    ledger: [
      { id: "e1", type: "deduct", delta: -1, occurredAt: new Date(2026, 8, 18), instructorId: "u1", unitPrice: 25000, rule: "base_category" },
      { id: "e2", type: "issue", delta: 22, occurredAt: new Date(2026, 7, 1), instructorId: "u1", unitPrice: 25000 },
    ],
  }] });

  const outcome = await rebuildMemberView(db, {
    organizationId: ORG, clientId: "client-a", eventAt: new Date(2026, 8, 20, 12, 0),
  });
  assert.equal(outcome, "written");

  const view = await viewOf("client-a");
  assert.equal(view.remainingTotal, 8);
  assert.equal(view.name, "김하나");
  assert.equal(view.userId, "uid-1");
  assert.equal(view.locationName, "반송점");
  // 발급은 이력에 안 들어간다. 차감 하나만.
  assert.equal(view.history.length, 1);
  assert.equal(view.history[0].instructorName, "정예진");
  // 관문이 트리거를 지나도 유지되는가.
  const json = JSON.stringify(view);
  for (const leak of ["25000", "1300000", "1181818", "base_category", "01012345678"]) {
    assert.doesNotMatch(json, new RegExp(leak), `${leak} 가 투영에 남았다`);
  }
});

test("a duet writes two projections, each naming the other", async () => {
  await seed({ passes: [{
    id: "duet", clientId: "client-a", clientIds: ["client-a", "client-b"], instructorId: "u1",
    locationId: "bansong", productId: "product-1", category: "pt_2_1_new", purchaseRound: 1,
    totalSessions: 30, serviceSessions: 0, remainingCount: 29, status: "active",
    expiresAt: new Date(2027, 0, 31), baseUnitPrice: 30000, contractPrice: 1800000,
  }] });

  const results = await rebuildMemberViews(db, {
    organizationId: ORG, clientIds: ["client-a", "client-b"], eventAt: new Date(2026, 8, 20),
  });
  assert.deepEqual(results.map((item) => item.outcome), ["written", "written"]);

  const a = await viewOf("client-a");
  const b = await viewOf("client-b");
  assert.equal(a.passes[0].partnerName, "박두리");
  assert.equal(b.passes[0].partnerName, "김하나");
  // 회원권 하나를 둘이 쓴다. 짝에게도 같은 잔여가 보인다.
  assert.equal(a.remainingTotal, 29);
  assert.equal(b.remainingTotal, 29);
});

test("a cancelled pass leaves the projection", async () => {
  await seed({ passes: [{
    id: "gone", clientId: "client-a", clientIds: ["client-a"], instructorId: "u1",
    locationId: "bansong", totalSessions: 20, serviceSessions: 0, remainingCount: 0,
    status: "cancelled", purchaseRound: 1, expiresAt: new Date(2027, 0, 31),
  }] });
  await rebuildMemberView(db, { organizationId: ORG, clientId: "client-a", eventAt: new Date(2026, 8, 20) });
  const view = await viewOf("client-a");
  assert.deepEqual(view.passes, []);
  assert.equal(view.remainingTotal, 0);
});

test("filling clients.userId makes the projection readable by that account", async () => {
  /* 연결(linkMemberAccount)이 하는 일이 이것뿐이다. 그 뒤에 트리거가 돌면
     투영의 userId 가 따라온다 -- 규칙이 그 값으로 판정한다. */
  await seed();
  await org.collection("clients").doc("client-a").update({ userId: "uid-changed" });
  await rebuildMemberView(db, { organizationId: ORG, clientId: "client-a", eventAt: new Date(2026, 8, 21) });
  assert.equal((await viewOf("client-a")).userId, "uid-changed");
});

/* ── 순서 ─────────────────────────────────────────────────────────────── */

test("a late call does not overwrite a newer projection", async () => {
  /* 같은 회원에 쓰기가 몰리면 호출 둘이 겹친다. 늦게 도착한 쪽이 옛 값으로
     덮으면 회원 화면이 과거로 돌아간다. */
  await seed();
  await rebuildMemberView(db, { organizationId: ORG, clientId: "client-a", eventAt: new Date(2026, 8, 20, 12, 0) });
  await org.collection("passes").doc("pass-1").update({ remainingCount: 3 });
  await rebuildMemberView(db, { organizationId: ORG, clientId: "client-a", eventAt: new Date(2026, 8, 20, 13, 0) });
  assert.equal((await viewOf("client-a")).remainingTotal, 3);

  // 11시에 일어난 쓰기가 뒤늦게 도착한다. 13시 값을 덮으면 안 된다.
  const outcome = await rebuildMemberView(db, {
    organizationId: ORG, clientId: "client-a", eventAt: new Date(2026, 8, 20, 11, 0),
  });
  assert.equal(outcome, "skipped");
  assert.equal((await viewOf("client-a")).remainingTotal, 3);
});

test("the same event time is allowed through, because both read after the commit", async () => {
  // 한 배치에서 온 호출들이다. 어느 쪽이 이겨도 값이 같다.
  await seed();
  const at = new Date(2026, 8, 20, 12, 0);
  assert.equal(await rebuildMemberView(db, { organizationId: ORG, clientId: "client-a", eventAt: at }), "written");
  assert.equal(await rebuildMemberView(db, { organizationId: ORG, clientId: "client-a", eventAt: at }), "skipped");
});

/* ── 실패해도 나머지는 계속한다 ───────────────────────────────────────── */

test("one member failing does not stop the other", async () => {
  /* 듀엣에서 한쪽이 막히면 다른 쪽까지 잃는다. 실패는 그 회원에서 끝나야 한다. */
  await seed();
  const errors = [];
  const results = await rebuildMemberViews(db, {
    organizationId: ORG,
    clientIds: ["client-a", "nobody", "client-b"],
    eventAt: new Date(2026, 8, 20),
    log: { error: (event, details) => errors.push({ event, details }) },
  });
  /* 가운데가 막혀도 뒤가 계속된다. 순서대로 written · no_client · written 이다 --
     세 번째가 written 인 것이 이 테스트의 전부다. */
  assert.deepEqual(results.map((item) => item.outcome), ["written", "no_client", "written"]);
  // 없는 회원은 오류가 아니라 "만들 것이 없음" 이다. 로그를 어지럽히지 않는다.
  assert.deepEqual(errors, []);
});

test("a read that throws is logged with its own code and does not spread", async () => {
  await seed();
  const errors = [];
  const results = await rebuildMemberViews(db, {
    organizationId: "", // organizationId 가 비면 경로를 만들 수 없다
    clientIds: ["client-a"],
    eventAt: new Date(2026, 8, 20),
    log: { error: (event, details) => errors.push({ event, details }) },
  });
  assert.equal(results[0].outcome, "no_client");
  assert.deepEqual(errors, []);
});

/* ── 트리거가 실제로 걸려 있는가 ──────────────────────────────────────── */

test("the triggers are registered on passes and clients, and not on the ledger", async () => {
  /* 원장에 쓰는 다섯 함수가 전부 같은 배치에서 passes 문서도 쓴다. ledger 에도
     달면 같은 일을 두 번 하고 비용이 두 배가 된다.

     이 판정은 선언이라 돌려 볼 수 없다 -- 소스로 확인한다. */
  /* import.meta 를 쓰면 이 파일이 ESM 으로 다시 파싱되고 위쪽 require 가 전부
     깨진다 -- functions/ 는 CommonJS 다. __dirname 으로 간다. */
  const { readFile } = require("node:fs/promises");
  const path = require("node:path");
  const source = await readFile(path.join(__dirname, "..", "..", "src", "index.js"), "utf8");
  assert.match(source, /document: "organizations\/\{organizationId\}\/passes\/\{passId\}"/);
  assert.match(source, /document: "organizations\/\{organizationId\}\/clients\/\{clientId\}"/);
  assert.doesNotMatch(source, /passes\/\{passId\}\/ledger\/\{entryId\}"/, "원장에도 트리거가 달려 있다");
  // 망가진 문서 하나가 무한히 재시도되면 비용만 쌓인다.
  assert.match(source, /retry: false/);
});
