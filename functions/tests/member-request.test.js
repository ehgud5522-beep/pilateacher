"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MEMBER_REQUEST_KIND, MEMBER_REQUEST_REASON, sendMemberRequest } = require("../src/member-request");

/* 2026-11-28 대표: 보니따 [비포애프터 요청] · [피드백 요청] → 담당 강사 알림함. */

function fakeFirestore(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const ref = (path) => ({
    path,
    collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    create: async (value) => {
      if (docs.has(path)) throw Object.assign(new Error("already exists"), { code: 6 });
      docs.set(path, value);
    },
  });
  return {
    docs,
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    batch: () => {
      const writes = [];
      return {
        create: (target, value) => writes.push([target.path, value, true]),
        set: (target, value) => writes.push([target.path, value, false]),
        commit: async () => {
          if (writes.some(([path, , create]) => create && docs.has(path))) throw Object.assign(new Error("already exists"), { code: 6 });
          writes.forEach(([path, value]) => docs.set(path, value));
        },
      };
    },
  };
}

const linked = (extra = {}) => ({
  "memberLinks/uid-1": { status: "linked", links: [{ organizationId: "org", clientId: "c1" }] },
  "organizations/org/clients/c1": { userId: "uid-1", instructorIds: ["t1", "t2"], name: "김하나" },
  ...extra,
});
const NOW = () => new Date("2026-11-28T03:00:00Z");
const input = (kind = MEMBER_REQUEST_KIND.FEEDBACK) => ({ callerUid: "uid-1", organizationId: "org", clientId: "c1", kind });

test("담당 강사마다 알림함에 한 건 -- 회원 이름은 싣지 않는다", async () => {
  const db = fakeFirestore(linked());
  const result = await sendMemberRequest(db, input(), { now: NOW });
  assert.deepEqual(result, { status: "sent", instructors: 2 });
  const id = "member_request_feedback_c1_20261128";
  for (const uid of ["t1", "t2"]) {
    const item = db.docs.get(`users/${uid}/inbox/${id}`);
    assert.equal(item.kind, MEMBER_REQUEST_KIND.FEEDBACK);
    assert.equal(item.clientId, "c1");
    assert.equal(item.title, "[오늘 수업 내용 요청]");
    assert.doesNotMatch(JSON.stringify(item), /김하나|uid-1/);
    assert.equal("lessonId" in item, false, "수업이 없는 알림 -- 강사 앱은 읽음만 한다");
  }
});

test("같은 종류는 서울 날짜로 하루 한 번", async () => {
  const db = fakeFirestore(linked());
  await sendMemberRequest(db, input(), { now: NOW });
  assert.equal((await sendMemberRequest(db, input(), { now: NOW })).status, "duplicate");
  assert.equal((await sendMemberRequest(db, input(MEMBER_REQUEST_KIND.BEFORE_AFTER), { now: NOW })).status, "sent", "다른 종류는 따로");
  const tomorrow = () => new Date("2026-11-28T15:30:00Z"); // 서울 11-29 00:30
  assert.equal((await sendMemberRequest(db, input(), { now: tomorrow })).status, "sent");
});

test("이어지지 않은 계정 · 남의 회원 · 끊긴 연결은 거절", async () => {
  const cases = [
    linked({ "memberLinks/uid-1": { status: "ended", links: [{ organizationId: "org", clientId: "c1" }] } }),
    linked({ "memberLinks/uid-1": { status: "linked", links: [{ organizationId: "org", clientId: "c9" }] } }),
    linked({ "organizations/org/clients/c1": { userId: "someone-else", instructorIds: ["t1"] } }),
    {},
  ];
  for (const seed of cases) {
    await assert.rejects(sendMemberRequest(fakeFirestore(seed), input(), { now: NOW }),
      (error) => error.reason === MEMBER_REQUEST_REASON.NOT_LINKED && error.httpsCode === "permission-denied");
  }
});

test("모르는 종류 · 로그인 없음 · 담당 강사 없음은 각자의 이유로", async () => {
  await assert.rejects(sendMemberRequest(fakeFirestore(linked()), { ...input(), kind: "hello" }),
    (error) => error.reason === MEMBER_REQUEST_REASON.BAD_KIND);
  await assert.rejects(sendMemberRequest(fakeFirestore(linked()), { ...input(), callerUid: "" }),
    (error) => error.reason === MEMBER_REQUEST_REASON.UNAUTHENTICATED);
  await assert.rejects(sendMemberRequest(fakeFirestore(linked({ "organizations/org/clients/c1": { userId: "uid-1", instructorIds: [] } })), input(), { now: NOW }),
    (error) => error.reason === MEMBER_REQUEST_REASON.NO_INSTRUCTOR && error.httpsCode === "failed-precondition");
});
