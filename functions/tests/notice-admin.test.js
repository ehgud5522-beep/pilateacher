"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { handleNoticeRequest } = require("../src/notice-admin");
const { membershipId } = require("../src/member-link");

/* manageNotice 의 본문을 역할마다 그대로 지난다 (2026-10-31). index.js 가 쓰는 membershipId 그대로다.
   규칙 에뮬레이터에서도 같은 함수를 지난다 (tests/rules/firestore.rules.test.js). */

const ORG = "bonita";
const NOW = () => new Date("2026-10-31T03:00:00Z");
const memberships = {
  [membershipId(ORG, "uid-owner")]: { status: "active", role: "owner", displayName: "대표" },
  [membershipId(ORG, "uid-area")]: { status: "active", role: "area_manager", displayName: "총괄" },
  [membershipId(ORG, "uid-area-2")]: { status: "active", role: "area_manager", displayName: "총괄2" },
  [membershipId(ORG, "uid-manager")]: { status: "active", role: "manager", displayName: "FC" },
  [membershipId(ORG, "uid-staff")]: { status: "active", role: "staff", displayName: "매니저" },
  [membershipId(ORG, "uid-teacher")]: { status: "active", role: "instructor", displayName: "강사" },
  [membershipId(ORG, "uid-left-owner")]: { status: "left", role: "owner", displayName: "옛 대표" },
};

function fakeFirestore() {
  const store = new Map(Object.entries(memberships).map(([id, value]) => [`memberships/${id}`, value]));
  const docRef = (path) => ({
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (value) => { store.set(path, value); },
    delete: async () => { store.delete(path); },
  });
  return { store, doc: docRef, collection: (name) => ({ doc: (id) => docRef(`${name}/${id}`) }) };
}

let counter = 0;
const call = (firestore, callerUid, action, extra = {}) => handleNoticeRequest(firestore, {
  callerUid, organizationId: ORG, action, now: NOW, ...extra,
}, { membershipId, newId: () => `n-${(counter += 1)}` });
const value = (overrides = {}) => ({ title: "휴무", body: "월요일은 쉽니다.", ...overrides });
const path = (id) => `organizations/${ORG}/notices/${id}`;

test("대표 · 총괄매니저는 쓴다 — 작성자 이름 · 올린 시각은 서버가 적고, 이미지 · 링크는 버린다", async () => {
  const firestore = fakeFirestore();
  const owner = await call(firestore, "uid-owner", "create", { value: value({ imageUrl: "https://x/a.png", linkUrl: "javascript:alert(1)", locationIds: ["bansong"] }) });
  const stored = firestore.store.get(path(owner.noticeId));
  assert.equal(stored.createdBy, "uid-owner");
  assert.equal(stored.createdByName, "대표", "보낸 값이 아니라 소속 문서의 이름");
  assert.deepEqual(stored.createdAt, NOW());
  assert.deepEqual(stored.locationIds, ["bansong"]);
  assert.equal("imageUrl" in stored, false);
  assert.equal("linkUrl" in stored, false);
  const area = await call(firestore, "uid-area", "create", { value: value({ createdByName: "사칭" }) });
  assert.equal(firestore.store.get(path(area.noticeId)).createdByName, "총괄");
});

test("FC매니저 · 매니저 · 강사 · 퇴사한 대표 · 소속 없음 · 비로그인은 쓰기 거절", async () => {
  const firestore = fakeFirestore();
  for (const uid of ["uid-manager", "uid-staff", "uid-teacher", "uid-left-owner", "uid-outsider"]) {
    await assert.rejects(call(firestore, uid, "create", { value: value() }), (error) => error.httpsCode === "permission-denied" && error.reason === "notice_not_owner_level", uid);
  }
  await assert.rejects(call(firestore, "", "create", { value: value() }), (error) => error.httpsCode === "unauthenticated");
  assert.equal([...firestore.store.keys()].some((key) => key.startsWith("organizations/")), false);
});

test("총괄매니저는 자기 공지만 고치고 지운다, 대표는 전부", async () => {
  const firestore = fakeFirestore();
  const mine = await call(firestore, "uid-area", "create", { value: value() });
  const owners = await call(firestore, "uid-owner", "create", { value: value() });
  await assert.rejects(call(firestore, "uid-area", "update", { noticeId: owners.noticeId, value: value({ title: "덮기" }) }),
    (error) => error.httpsCode === "permission-denied" && error.reason === "notice_not_author");
  await assert.rejects(call(firestore, "uid-area-2", "delete", { noticeId: mine.noticeId }), (error) => error.reason === "notice_not_author");
  await call(firestore, "uid-area", "update", { noticeId: mine.noticeId, value: value({ title: "고친 제목" }) });
  const updated = firestore.store.get(path(mine.noticeId));
  assert.equal(updated.title, "고친 제목");
  assert.equal(updated.createdBy, "uid-area", "쓴 사람은 그대로");
  assert.equal(updated.createdByName, "총괄");
  assert.equal(updated.updatedBy, "uid-area");
  await call(firestore, "uid-owner", "update", { noticeId: mine.noticeId, value: value({ title: "대표가 고침" }) });
  await call(firestore, "uid-owner", "delete", { noticeId: mine.noticeId });
  assert.equal(firestore.store.has(path(mine.noticeId)), false);
  await call(firestore, "uid-area", "delete", { noticeId: (await call(firestore, "uid-area", "create", { value: value() })).noticeId });
  await assert.rejects(call(firestore, "uid-owner", "delete", { noticeId: "없음" }), (error) => error.httpsCode === "not-found");
});

test("글 검사 — 중요 공지는 표시 종료일 필수, 지난 종료일 거절 (서버도 본다)", async () => {
  const firestore = fakeFirestore();
  await assert.rejects(call(firestore, "uid-owner", "create", { value: value({ important: true }) }),
    (error) => error.httpsCode === "invalid-argument" && error.reason === "notice_invalid" && /표시 종료일/.test(error.message));
  await assert.rejects(call(firestore, "uid-owner", "create", { value: value({ endsOn: "2026-10-30" }) }), (error) => error.reason === "notice_invalid");
  await call(firestore, "uid-owner", "create", { value: value({ important: true, endsOn: "2026-10-31" }) });
  await assert.rejects(call(firestore, "uid-owner", "rename", {}), (error) => error.reason === "notice_unknown_action");
});
