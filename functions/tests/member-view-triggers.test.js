"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  clientIdsFromLessonNoteChange, collectMemberViewInput,
} = require("../src/member-view-triggers");

/**
 * 투영을 만들기 전에 무엇을 읽어 오는가.
 *
 * 여기서 틀리면 buildMemberView 가 아무리 맞아도 화면이 빈다 -- 읽지 않은
 * 것은 걸러진 것과 구별되지 않는다. 특히 회원용 문구는 질의가 아니라 문서 id
 * 로 집으므로, id 를 조립하는 규칙이 이 파일의 주인공이다.
 */

/** 경로를 문자열 하나로 다루는 아주 작은 Firestore 대역. */
function fakeFirestore(documents) {
  const read = (path) => ({
    exists: Object.prototype.hasOwnProperty.call(documents, path),
    id: path.slice(path.lastIndexOf("/") + 1),
    data: () => documents[path] || null,
  });
  const requested = [];
  const collection = (base) => (name) => {
    const at = `${base}/${name}`;
    const page = (field, op, value) => ({
      doc: (id) => makeDoc(`${at}/${id}`),
      orderBy: () => page(field, op, value),
      limit: () => page(field, op, value),
      where: (nextField, nextOp, nextValue) => page(nextField, nextOp, nextValue),
      get: async () => query(at, field, op, value),
    });
    // 조건 없는 orderBy/limit 은 그 컬렉션 전체다 -- 원장을 그렇게 읽는다.
    return page("", "all", null);
  };
  const query = async (at, field, op, value) => {
    const docs = Object.entries(documents)
      .filter(([path]) => path.startsWith(`${at}/`) && !path.slice(at.length + 1).includes("/"))
      .map(([path, data]) => ({ id: path.slice(path.lastIndexOf("/") + 1), data: () => data }))
      .filter(({ data }) => {
        if (op === "all") return true;
        const held = data()[field];
        if (op === "array-contains") return Array.isArray(held) && held.includes(value);
        return held === value;
      });
    return { docs };
  };
  const makeDoc = (path) => ({
    path,
    get: async () => read(path),
    collection: collection(path),
  });
  return {
    requested,
    collection: collection(""),
    getAll: async (...refs) => {
      for (const ref of refs) requested.push(ref.path);
      return refs.map((ref) => read(ref.path));
    },
  };
}

const ORG = "/organizations/center-a";

const baseDocuments = () => ({
  [`${ORG}/clients/client-a`]: {
    clientId: "client-a", organizationId: "center-a", name: "김하나",
    userId: "uid-1", status: "active", locationId: "bansong",
  },
  [`${ORG}/passes/pass-1`]: {
    clientId: "client-a", organizationId: "center-a", status: "active",
    remainingCount: 8, totalSessions: 20, productId: "product-1",
  },
  [`${ORG}/passes/pass-1/ledger/e-1`]: {
    passId: "pass-1", clientId: "client-a", type: "deduct",
    lessonId: "lesson-1", occurredAt: new Date(2026, 8, 18), instructorId: "u1",
  },
});

test("회원용 문구는 원장의 lessonId 로 문서를 바로 집는다", async () => {
  /* 질의하지 않는다. 질의에 정렬을 붙이는 순간 복합 색인이 필요해지고,
     정렬 없이 자르면 최근 것이 빠진다. */
  const documents = baseDocuments();
  documents[`${ORG}/lessonNotes/lesson-1_client-a`] = {
    clientId: "client-a", lessonId: "lesson-1", memberNote: "오늘 정말 잘하셨어요",
  };
  const db = fakeFirestore(documents);
  const collected = await collectMemberViewInput(db, "center-a", "client-a");
  assert.deepEqual(collected.memberNotes, { "lesson-1": "오늘 정말 잘하셨어요" });
  assert.deepEqual(db.requested, [`${ORG}/lessonNotes/lesson-1_client-a`]);
});

test("차감이 없으면 문구를 읽으러 가지 않는다", async () => {
  /* 회원 앱의 수업 탭은 차감으로 만들어진다. 붙일 줄이 없는데 읽으면 읽기만
     늘고 화면은 그대로다. */
  const documents = baseDocuments();
  delete documents[`${ORG}/passes/pass-1/ledger/e-1`];
  const db = fakeFirestore(documents);
  const collected = await collectMemberViewInput(db, "center-a", "client-a");
  assert.deepEqual(collected.memberNotes, {});
  assert.deepEqual(db.requested, []);
});

test("한 수업에 두 사람이면 각자의 문서를 집는다", async () => {
  /* 듀엣이다. 문서 id 에 clientId 가 들어 있지 않으면 짝의 말이 서로에게
     간다 -- 되돌릴 수 없는 종류의 실수다. */
  const documents = baseDocuments();
  documents[`${ORG}/lessonNotes/lesson-1_client-a`] = {
    clientId: "client-a", lessonId: "lesson-1", memberNote: "하나님께 드리는 말",
  };
  documents[`${ORG}/lessonNotes/lesson-1_client-b`] = {
    clientId: "client-b", lessonId: "lesson-1", memberNote: "두리님께 드리는 말",
  };
  const collected = await collectMemberViewInput(fakeFirestore(documents), "center-a", "client-a");
  assert.deepEqual(collected.memberNotes, { "lesson-1": "하나님께 드리는 말" });
});

test("남의 clientId 가 적힌 문서는 담지 않는다", async () => {
  /* id 규칙이 이미 막지만, 두 겹으로 둔다. 회원용 투영에서 남의 말이 보이는
     것은 사과로 끝나지 않는다. */
  const documents = baseDocuments();
  documents[`${ORG}/lessonNotes/lesson-1_client-a`] = {
    clientId: "client-b", lessonId: "lesson-1", memberNote: "남의 말",
  };
  const collected = await collectMemberViewInput(fakeFirestore(documents), "center-a", "client-a");
  assert.deepEqual(collected.memberNotes, {});
});

test("빈 문구는 지운 것으로 본다", async () => {
  /* 규칙이 삭제를 막으므로 지우기는 빈 문자열로 저장된다. 그 줄이 회원
     화면에서 사라져야 지운 것이 지워진 것이다. */
  const documents = baseDocuments();
  documents[`${ORG}/lessonNotes/lesson-1_client-a`] = {
    clientId: "client-a", lessonId: "lesson-1", memberNote: "   ",
  };
  const collected = await collectMemberViewInput(fakeFirestore(documents), "center-a", "client-a");
  assert.deepEqual(collected.memberNotes, {});
});

test("연결되지 않은 회원은 문구까지 갈 것도 없이 멈춘다", async () => {
  const documents = baseDocuments();
  documents[`${ORG}/clients/client-a`] = { ...documents[`${ORG}/clients/client-a`], userId: "" };
  const db = fakeFirestore(documents);
  const collected = await collectMemberViewInput(db, "center-a", "client-a");
  assert.deepEqual(collected, { unlinked: true });
  assert.deepEqual(db.requested, []);
});

test("문구가 바뀌면 그 회원의 투영을 다시 만든다", () => {
  assert.deepEqual(
    clientIdsFromLessonNoteChange(null, { clientId: "client-a" }),
    ["client-a"],
  );
});

test("before 도 본다 -- 규칙이 느슨해지는 날 조용히 틀리지 않게", () => {
  assert.deepEqual(
    clientIdsFromLessonNoteChange({ clientId: "client-a" }, { clientId: "client-b" }),
    ["client-a", "client-b"],
  );
});

test("회원을 모르는 변화는 아무 투영도 건드리지 않는다", () => {
  assert.deepEqual(clientIdsFromLessonNoteChange(null, {}), []);
  assert.deepEqual(clientIdsFromLessonNoteChange(null, null), []);
});
