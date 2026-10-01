"use strict";

/**
 * 이관 데이터 초기화를 에뮬레이터에서 실제로 돌린다.
 *
 * 가짜 Firestore 로는 못 보는 것들이 여기 있다 -- 하위 컬렉션(원장)이 정말로
 * 지워지는지, 배치 한계를 넘는 건수가 넘어가는지, 지우고 나서 **같은 방식으로
 * 다시 이관되는지**.
 *
 * 되돌릴 수 없는 쓰기라 여기서 확인하지 못한 것은 프로덕션에서 확인하게
 * 된다. 그때는 늦다.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { BLOCK_REASON, planMigrationReset, runMigrationReset } = require("../../src/migration-reset");

const ORG = "center-reset";
const app = initializeApp({ projectId: "pilateacher-dev" }, `migration-reset-${Date.now()}`);
const db = getFirestore(app);
const org = db.collection("organizations").doc(ORG);

test.after(async () => { await deleteApp(app); });

/** Storage 대신. 사본이 실제로 만들어지는지만 본다. */
function fakeBucket() {
  const saved = [];
  return {
    saved,
    file: (name) => ({
      save: async (body, options) => { saved.push({ name, body, options }); },
    }),
  };
}

const wipe = async () => {
  for (const name of ["clients", "passes", "memberViews", "instructorClientTotals"]) {
    const page = await org.collection(name).get();
    await Promise.all(page.docs.map(async (snapshot) => {
      const ledger = await snapshot.ref.collection("ledger").get();
      await Promise.all(ledger.docs.map((entry) => entry.ref.delete()));
      await snapshot.ref.delete();
    }));
  }
  const links = await db.collection("memberLinks").get();
  await Promise.all(links.docs
    .filter((snapshot) => (snapshot.data()?.links || []).some((link) => link?.organizationId === ORG))
    .map((snapshot) => snapshot.ref.delete()));
  const audits = await db.collection("auditLogs").where("organizationId", "==", ORG).get();
  await Promise.all(audits.docs.map((snapshot) => snapshot.ref.delete()));
};

/** 엑셀 이관이 만드는 모양 그대로 (migration-repository.js). */
const seedMigrated = async ({ clientId, round = 1, remainingCount = 10 }) => {
  const passId = `csv_${clientId}_${round}`;
  await org.collection("clients").doc(clientId).set({
    organizationId: ORG, name: `회원 ${clientId}`, phone: clientId.replace("csv_", ""),
    locationId: "bansong", status: "active",
  });
  await org.collection("passes").doc(passId).set({
    organizationId: ORG, clientId, locationId: "bansong", productId: "p1",
    category: "pt_1_1_new", totalSessions: 20, serviceSessions: 0, contractPrice: 1200000,
    paymentMethod: "card", purchaseRound: round, remainingCount, baseUnitPrice: 60000,
    instructorId: "instructor-1", status: "active", handedOver: false,
  });
  await org.collection("passes").doc(passId).collection("ledger").doc(`${passId}_issue`).set({
    organizationId: ORG, passId, clientId, locationId: "bansong",
    type: "issue", delta: remainingCount, category: "pt_1_1_new", unitPrice: 0,
    instructorId: "instructor-1",
  });
  /* 9월 차감 한 건. 지워도 되는 것이고, 지워지는지 본다. */
  await org.collection("passes").doc(passId).collection("ledger").doc(`${passId}_sep`).set({
    organizationId: ORG, passId, clientId, locationId: "bansong",
    type: "deduct", delta: -1, category: "pt_1_1_new", unitPrice: 60000,
    instructorId: "instructor-1", lessonId: "lesson-sep",
  });
  await org.collection("instructorClientTotals").doc(`instructor-1_${clientId}`).set({
    organizationId: ORG, instructorId: "instructor-1", clientId, sessions: 8,
  });
  await org.collection("memberViews").doc(clientId).set({
    organizationId: ORG, clientId, remainingTotal: remainingCount,
  });
  return passId;
};

test("미리보기는 지울 개수를 세고 아무것도 쓰지 않는다", async () => {
  await wipe();
  await seedMigrated({ clientId: "csv_01011112222" });
  await seedMigrated({ clientId: "csv_01033334444" });
  /* 앱에서 발급한 회원권. 건드리지 않는다. */
  await org.collection("passes").doc("app-pass-1").set({
    organizationId: ORG, clientId: "app-client-1", locationId: "bansong", remainingCount: 5,
  });

  const plan = await planMigrationReset(db, { organizationId: ORG });
  assert.equal(plan.counts.passes, 2, "이관 회원권만 센다");
  assert.equal(plan.counts.ledger, 4, "회원권마다 발급 + 9월 차감");
  assert.equal(plan.counts.clients, 2);
  assert.equal(plan.counts.instructorClientTotals, 2);
  assert.equal(plan.counts.memberViews, 2);
  assert.equal(plan.counts.keptPasses, 1, "앱 발급 한 장은 남는다");

  // 아무것도 안 지워졌다.
  assert.equal((await org.collection("passes").get()).size, 3);
});

test("회원 앱에 이어진 회원은 지우지 않고 목록에 올린다", async () => {
  await wipe();
  await seedMigrated({ clientId: "csv_01011112222" });
  await db.collection("memberLinks").doc("uid-member").set({
    userId: "uid-member", status: "linked",
    links: [{ organizationId: ORG, clientId: "csv_01011112222" }],
  });

  const plan = await planMigrationReset(db, { organizationId: ORG });
  assert.equal(plan.counts.clients, 0, "회원 문서는 남긴다");
  assert.equal(plan.counts.blockedClients, 1);
  assert.deepEqual(plan.blockedClients[0].reasons, [BLOCK_REASON.MEMBER_LINK]);
  /* 회원권은 그래도 지운다 -- 새 엑셀이 다시 넣는다. 지우지 않으면 회원권이
     두 벌이 된다. */
  assert.equal(plan.counts.passes, 1);
});

test("앱에서 발급한 회원권이 붙은 회원도 남긴다", async () => {
  /* 접두만 보고 지우면 그 사람의 신원은 사라지고 수업 기록은 남는다. */
  await wipe();
  await seedMigrated({ clientId: "csv_01011112222" });
  await org.collection("passes").doc("app-pass-2").set({
    organizationId: ORG, clientId: "csv_01011112222", locationId: "bansong", remainingCount: 3,
  });

  const plan = await planMigrationReset(db, { organizationId: ORG });
  assert.equal(plan.counts.clients, 0);
  assert.deepEqual(plan.blockedClients[0].reasons, [BLOCK_REASON.APP_ISSUED_PASS]);
});

test("앱에서 번호를 바꾼 회원도 남긴다", async () => {
  await wipe();
  await seedMigrated({ clientId: "csv_01011112222" });
  await org.collection("clients").doc("csv_01011112222")
    .set({ previousPhones: ["01099998888"] }, { merge: true });

  const plan = await planMigrationReset(db, { organizationId: ORG });
  assert.equal(plan.counts.clients, 0);
  assert.deepEqual(plan.blockedClients[0].reasons, [BLOCK_REASON.PHONE_CHANGED]);
});

test("실행하면 사본을 먼저 남기고 지운다", async () => {
  await wipe();
  await seedMigrated({ clientId: "csv_01011112222" });
  await seedMigrated({ clientId: "csv_01033334444", round: 2, remainingCount: 7 });
  await org.collection("passes").doc("app-pass-1").set({
    organizationId: ORG, clientId: "app-client-1", locationId: "bansong", remainingCount: 5,
  });

  const bucket = fakeBucket();
  const result = await runMigrationReset(db, bucket, { organizationId: ORG, actorId: "owner-1" });

  assert.equal(result.passes, 2);
  assert.equal(result.ledger, 4, "9월 차감까지 지운다");
  assert.equal(result.clients, 2);
  assert.equal(result.instructorClientTotals, 2);
  assert.equal(result.memberViews, 2);

  /* 사본이 먼저다. 되돌릴 자리 없이 원장을 지우는 것이 이 기능이 가장 하지
     말아야 하는 일이다. */
  assert.equal(bucket.saved.length, 1);
  assert.match(bucket.saved[0].name, /^migration-reset\/center-reset\//);
  const body = JSON.parse(bucket.saved[0].body);
  assert.equal(body.passes.length, 2);
  assert.equal(body.passes[0].ledger.length, 2, "원장도 사본에 들어간다");
  assert.equal(body.clients.length, 2);

  // 앱에서 발급한 것은 남았다.
  const left = await org.collection("passes").get();
  assert.deepEqual(left.docs.map((snapshot) => snapshot.id), ["app-pass-1"]);
  // 하위 컬렉션까지 사라졌다.
  assert.equal((await org.collection("passes").doc("csv_01011112222_1").collection("ledger").get()).size, 0);

  /* 감사 로그 한 줄. 원장을 지운 유일한 경우라 그 사실이 남아야 한다. */
  const audits = await db.collection("auditLogs").where("organizationId", "==", ORG).get();
  assert.equal(audits.size, 1);
  assert.equal(audits.docs[0].data().action, "migration_reset");
  assert.equal(audits.docs[0].data().targetId, bucket.saved[0].name, "사본 경로를 가리킨다");
});

test("초기화 뒤 같은 방식으로 다시 이관된다", async () => {
  /* **이것이 이 파일의 요점이다.** 지우기만 되고 다시 넣을 수 없으면
     10/1 에 아무것도 못 한다. */
  await wipe();
  await seedMigrated({ clientId: "csv_01011112222" });
  await runMigrationReset(db, fakeBucket(), { organizationId: ORG, actorId: "owner-1" });
  assert.equal((await org.collection("passes").get()).size, 0);

  // 새 엑셀. 번호가 바뀐 회원이라 clientId 도 다르다.
  const passId = await seedMigrated({ clientId: "csv_01055556666", remainingCount: 15 });
  /* 접두가 두 번 붙는다. passIdFor 가 `csv_${clientId}_${차수}` 인데 clientId
     자체가 이미 `csv_<번호>` 라서다 (migration-repository.js:102·106).
     이상해 보이지만 그대로 두는 것이 맞다 -- 이미 그 id 로 쌓인 원장이 있고,
     id 는 그 회원권의 주소다. 초기화의 접두 판정은 앞의 csv_ 하나만 본다. */
  assert.equal(passId, "csv_csv_01055556666_1");

  const passes = await org.collection("passes").get();
  assert.equal(passes.size, 1);
  assert.equal(passes.docs[0].data().remainingCount, 15);
  const ledger = await passes.docs[0].ref.collection("ledger").get();
  assert.equal(ledger.size, 2);

  /* 강사 누적이 새로 들어간다. 지우지 않았으면 옛 누적에 새 누적이 더해져
     20회째 단가가 앞당겨진다. */
  const totals = await org.collection("instructorClientTotals").get();
  assert.equal(totals.size, 1);
  assert.equal(totals.docs[0].data().sessions, 8);
});

test("지울 것이 없으면 조용히 끝난다", async () => {
  await wipe();
  const result = await runMigrationReset(db, fakeBucket(), { organizationId: ORG, actorId: "owner-1" });
  assert.equal(result.passes, 0);
  assert.equal(result.ledger, 0);
  assert.equal(result.clients, 0);
});
