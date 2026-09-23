"use strict";

/**
 * 연결 함수가 Firestore 에 실제로 무엇을 쓰는지 에뮬레이터에서 확인한다.
 *
 * 판정은 member-link.test.js 가 순수 함수로 짚는다. 여기서 볼 것은 가짜
 * Firestore 가 못 보는 것들이다 -- 배치가 두 문서를 함께 쓰는지, 번호 질의가
 * 센터별로 걸리는지, `FieldValue.delete()` 가 칸을 정말 없애는지, 해제가
 * 투영까지 지우는지.
 *
 * Admin SDK 는 규칙을 지나지 않는다. 그것이 실제 함수의 조건과 같다.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { createMemberLinkService, LINK_STATUS } = require("../../src/member-link");
const { createFirestoreMemberLinkPorts } = require("../../src/member-link-store");

const ORG = "link-center-a";
const OTHER_ORG = "link-center-b";
const OWNER = "uid-owner";
const MEMBER = "uid-member";
const PHONE = "01070001111"; // 다른 테스트 파일의 번호와 겹치면 후보가 하나 더 붙는다

const app = initializeApp({ projectId: "pilateacher-dev" }, `member-link-${Date.now()}`);
const db = getFirestore(app);
const link = createMemberLinkService(createFirestoreMemberLinkPorts({ firestore: db, FieldValue }));

test.after(async () => { await deleteApp(app); });

const wipeCollection = async (reference) => {
  const page = await reference.get();
  await Promise.all(page.docs.map((snapshot) => snapshot.ref.delete()));
};

const seed = async () => {
  for (const organizationId of [ORG, OTHER_ORG]) {
    const org = db.collection("organizations").doc(organizationId);
    await wipeCollection(org.collection("clients"));
    await wipeCollection(org.collection("memberViews"));
    await org.set({ name: organizationId });
  }
  await wipeCollection(db.collection("memberLinks"));
  await wipeCollection(db.collection("auditLogs"));
  /* 소속은 이 파일의 센터 것만 지운다. 에뮬레이터 하나를 다른 테스트 파일과
     나눠 쓰기 때문에, 컬렉션을 통째로 비우면 그쪽이 조용히 깨진다. */
  for (const organizationId of [ORG, OTHER_ORG]) {
    await wipeCollection(db.collection("memberships").where("organizationId", "==", organizationId));
  }

  await db.collection("memberships").doc(`${ORG}_${OWNER}`).set({
    organizationId: ORG, userId: OWNER, role: "owner", status: "active", displayName: "대표",
  });
  await db.collection("organizations").doc(ORG).collection("clients").doc("client-a").set({
    organizationId: ORG, name: "김하나", phone: PHONE, locationId: "bansong", status: "active",
  });
};

const clientOf = async (organizationId, clientId) => (
  (await db.collection("organizations").doc(organizationId)
    .collection("clients").doc(clientId).get()).data()
);
const linkOf = async (userId) => (await db.collection("memberLinks").doc(userId).get()).data();
const audits = async () => (await db.collection("auditLogs").get()).docs.map((row) => row.data());

test("linking writes the roster and the link document together", async () => {
  await seed();
  const result = await link.linkForCaller({
    auth: { uid: MEMBER, token: { phone_number: "+82 10-7000-1111" } },
  });

  assert.equal(result.status, LINK_STATUS.LINKED);
  /* 국가번호가 붙어 와도 같은 철자로 찾는다 -- 이관이 만든 번호와 같은
     정규화를 쓰기 때문이다 (functions/shared/phone.mjs). */
  assert.equal((await clientOf(ORG, "client-a")).userId, MEMBER);

  const document = await linkOf(MEMBER);
  assert.equal(document.status, LINK_STATUS.LINKED);
  assert.equal(document.links.length, 1);
  assert.equal(document.links[0].clientId, "client-a");
  assert.equal(document.phone, PHONE);
});

test("an ambiguous result leaves the roster untouched", async () => {
  await seed();
  await db.collection("organizations").doc(ORG).collection("clients").doc("client-twin").set({
    organizationId: ORG, name: "김하나", phone: PHONE, locationId: "bansong", status: "active",
  });

  const result = await link.linkForCaller({
    auth: { uid: MEMBER, token: { phone_number: PHONE } },
  });

  assert.equal(result.status, LINK_STATUS.AMBIGUOUS);
  // 명부는 한 칸도 바뀌지 않는다. 대표가 고를 때까지 아무것도 이어지지 않는다.
  assert.equal((await clientOf(ORG, "client-a")).userId, undefined);
  assert.equal((await clientOf(ORG, "client-twin")).userId, undefined);
  assert.equal((await linkOf(MEMBER)).candidates.length, 2);
});

test("the owner's manual link leaves an audit entry", async () => {
  await seed();
  await link.linkByOwner({
    auth: { uid: OWNER },
    data: { userId: MEMBER, organizationId: ORG, clientId: "client-a" },
  });

  assert.equal((await linkOf(MEMBER)).linkedBy, OWNER);
  const entries = await audits();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "member_link_created");
  assert.equal(entries[0].actorRole, "owner");
  // 자유 문장 칸이 없다 -- 있으면 언젠가 거기에 회원 이름이 들어간다.
  assert.deepEqual(Object.keys(entries[0]).sort(), [
    "action", "actorId", "actorRole", "clientId", "createdAt", "organizationId", "targetId",
  ]);
});

test("unlinking clears the field, deletes the projection, and records it", async () => {
  await seed();
  await link.linkForCaller({ auth: { uid: MEMBER, token: { phone_number: PHONE } } });
  await db.collection("organizations").doc(ORG).collection("memberViews").doc("client-a")
    .set({ organizationId: ORG, clientId: "client-a", userId: MEMBER, remainingTotal: 8 });

  await link.unlink({
    auth: { uid: OWNER },
    data: { userId: MEMBER, organizationId: ORG, clientId: "client-a" },
  });

  /* 칸을 비우는 것이 아니라 없앤다. 아직 아무에게도 연결되지 않은 회원과 같은
     모양이어야 한다. */
  assert.equal("userId" in (await clientOf(ORG, "client-a")), false);
  // userId 만 지우면 이미 깔린 투영을 그 사람이 계속 읽는다.
  const view = await db.collection("organizations").doc(ORG)
    .collection("memberViews").doc("client-a").get();
  assert.equal(view.exists, false);
  assert.equal((await linkOf(MEMBER)).status, LINK_STATUS.REJECTED);
  assert.deepEqual((await audits()).map((row) => row.action), ["member_link_removed"]);
});

test("unlinking one centre keeps the other", async () => {
  await seed();
  await db.collection("organizations").doc(OTHER_ORG).collection("clients").doc("client-z").set({
    organizationId: OTHER_ORG, name: "김하나", phone: PHONE, locationId: "songjeong", status: "active",
  });

  const result = await link.linkForCaller({ auth: { uid: MEMBER, token: { phone_number: PHONE } } });
  assert.equal(result.status, LINK_STATUS.MULTI_LOCATION);

  await link.unlink({
    auth: { uid: OWNER },
    data: { userId: MEMBER, organizationId: ORG, clientId: "client-a" },
  });

  /* 한 지점을 잘못 이었다고 다른 지점까지 끊으면 그 회원은 이유를 모른 채
     전부를 잃는다. */
  const document = await linkOf(MEMBER);
  assert.equal(document.links.length, 1);
  assert.equal(document.links[0].organizationId, OTHER_ORG);
  assert.equal((await clientOf(OTHER_ORG, "client-z")).userId, MEMBER);
});

test("the pending list only shows callers with a candidate in this centre", async () => {
  await seed();
  await db.collection("organizations").doc(ORG).collection("clients").doc("client-twin").set({
    organizationId: ORG, name: "김하나", phone: PHONE, locationId: "bansong", status: "active",
  });
  await link.linkForCaller({ auth: { uid: MEMBER, token: { phone_number: PHONE } } });

  const rows = await link.listPending({ auth: { uid: OWNER }, data: { organizationId: ORG } });
  assert.deepEqual(rows.map((row) => row.userId), [MEMBER]);
  assert.equal(rows[0].candidates.length, 2);
});
