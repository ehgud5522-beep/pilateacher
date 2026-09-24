import assert from "node:assert/strict";
import test from "node:test";

import {
  MEMBER_NOTE_MAX, memberNoteId, memberNoteSaveFailure, readMemberNote, saveMemberNote,
  trimMemberNote,
} from "../../src/data/repositories/member-note-repository.js";

/**
 * 강사가 회원에게 보낼 말.
 *
 * 규칙과 맞물리는 자리가 하나 있다: lessonNotes 의 update 는 affectedKeys 를
 * 본다. 두 번째 저장에 createdAt 을 다시 실으면 값이 달라져 고치기가 통째로
 * 거부된다 -- 이 파일이 지키는 것이 그것이다.
 */

const storeWith = (documents = {}) => {
  const writes = [];
  return {
    writes,
    documents,
    read: async (path) => documents[path] || null,
    commit: async (list) => { for (const write of list) writes.push(write); },
    serverTimestamp: async () => "SERVER_TIME",
  };
};

const NOTE_PATH = "organizations/center-a/lessonNotes/lesson-1_client-a";

test("문서 id 는 수업과 회원을 둘 다 담는다", () => {
  // 듀엣에서 짝의 말이 서로에게 가지 않게 하는 것이 이 id 다.
  assert.equal(memberNoteId("lesson-1", "client-a"), "lesson-1_client-a");
});

test("수업이나 회원이 없으면 id 를 만들지 않는다", () => {
  assert.throws(() => memberNoteId("", "client-a"), /lessonId/);
  assert.throws(() => memberNoteId("lesson-1", ""), /clientId/);
});

test("앞뒤 공백을 떼고 길이를 자른다", () => {
  assert.equal(trimMemberNote("  오늘 잘하셨어요  "), "오늘 잘하셨어요");
  assert.equal(trimMemberNote("가".repeat(MEMBER_NOTE_MAX + 40)).length, MEMBER_NOTE_MAX);
  assert.equal(trimMemberNote(null), "");
});

/* ── 저장 ────────────────────────────────────────────────────────────── */

test("처음 저장에는 createdAt 과 createdBy 가 들어간다", async () => {
  const store = storeWith();
  const result = await saveMemberNote("center-a", {
    lessonId: "lesson-1", clientId: "client-a", memberNote: "  오늘 정말 잘하셨어요  ",
    instructorId: "uid-instructor", userId: "uid-instructor", store,
  });
  assert.equal(result.created, true);
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].path, NOTE_PATH);
  assert.deepEqual(store.writes[0].data, {
    organizationId: "center-a",
    clientId: "client-a",
    lessonId: "lesson-1",
    memberNote: "오늘 정말 잘하셨어요",
    instructorId: "uid-instructor",
    createdBy: "uid-instructor",
    createdAt: "SERVER_TIME",
    updatedAt: "SERVER_TIME",
  });
});

test("고칠 때는 createdAt 을 다시 보내지 않는다", async () => {
  /* 규칙의 immutable 은 값이 아니라 건드린 필드를 본다(affectedKeys).
     serverTimestamp 를 다시 실으면 값이 달라지므로 고치기가 거부된다 --
     강사에게는 "권한이 없습니다" 로만 보인다. */
  const store = storeWith({ [NOTE_PATH]: { memberNote: "먼젓번 말", createdBy: "uid-instructor" } });
  const result = await saveMemberNote("center-a", {
    lessonId: "lesson-1", clientId: "client-a", memberNote: "고친 말",
    userId: "uid-instructor", store,
  });
  assert.equal(result.created, false);
  assert.deepEqual(Object.keys(store.writes[0].data).sort(), ["memberNote", "updatedAt"]);
  assert.equal(store.writes[0].data.memberNote, "고친 말");
});

test("빈 말은 지운 것이지 안 쓴 것이 아니다", async () => {
  /* 규칙이 삭제를 막는다. 빈 문자열로 남겨 두면 투영이 그 줄을 빼고, 회원
     화면에서 사라진다 -- 지운 것이 지워진다. */
  const store = storeWith({ [NOTE_PATH]: { memberNote: "먼젓번 말", createdBy: "uid-instructor" } });
  await saveMemberNote("center-a", {
    lessonId: "lesson-1", clientId: "client-a", memberNote: "   ",
    userId: "uid-instructor", store,
  });
  assert.equal(store.writes[0].data.memberNote, "");
});

test("긴 말은 저장 전에 잘린다", async () => {
  const store = storeWith();
  await saveMemberNote("center-a", {
    lessonId: "lesson-1", clientId: "client-a", memberNote: "가".repeat(MEMBER_NOTE_MAX + 40),
    userId: "uid-instructor", store,
  });
  assert.equal(store.writes[0].data.memberNote.length, MEMBER_NOTE_MAX);
});

test("누가 쓰는지 모르면 쓰지 않는다", async () => {
  const store = storeWith();
  await assert.rejects(() => saveMemberNote("center-a", {
    lessonId: "lesson-1", clientId: "client-a", memberNote: "말", userId: "", store,
  }), /userId/);
  assert.deepEqual(store.writes, []);
});

/* ── 읽기 ────────────────────────────────────────────────────────────── */

test("안 쓴 수업은 빈 문자열이다", async () => {
  const found = await readMemberNote("center-a", {
    lessonId: "lesson-1", clientId: "client-a", store: storeWith(),
  });
  assert.equal(found, "");
});

test("쓴 말을 그대로 돌려준다", async () => {
  const store = storeWith({ [NOTE_PATH]: { memberNote: "오늘 정말 잘하셨어요" } });
  const found = await readMemberNote("center-a", {
    lessonId: "lesson-1", clientId: "client-a", store,
  });
  assert.equal(found, "오늘 정말 잘하셨어요");
});

test("못 읽은 것은 빈 문자열이 아니라 오류로 나간다", async () => {
  /* 안 쓴 것과 못 읽은 것을 같은 모양으로 돌려주면, 강사는 지웠다고 읽고
     그 위에 덮어쓴다. */
  const store = storeWith();
  store.read = async () => { const error = new Error("nope"); error.code = "permission-denied"; throw error; };
  await assert.rejects(
    () => readMemberNote("center-a", { lessonId: "lesson-1", clientId: "client-a", store }),
    (error) => {
      assert.equal(error.name, "RepositoryReadError");
      // 원본 코드를 그대로 싣는다 -- permission-denied 와 unavailable 은 다른 일이다.
      assert.equal(error.code, "permission-denied");
      assert.equal(error.feature, "member_note");
      return true;
    },
  );
});

/* ── 실패 문구 ───────────────────────────────────────────────────────── */

test("실패는 종류별로 다른 말을 하고, 코드를 늘 함께 보여준다", () => {
  const rows = [
    ["permission-denied", "permission", false, /처음 쓴 강사만/],
    ["unavailable", "network", true, /연결이 불안정/],
    ["deadline-exceeded", "network", true, /연결이 불안정/],
    ["unauthenticated", "authentication", false, /다시 로그인/],
    ["invalid-argument", "invalid request", false, /거부되었어요/],
    ["something-new", "unknown", false, /저장하지 못했어요/],
  ];
  for (const [code, kind, retryable, pattern] of rows) {
    const failure = memberNoteSaveFailure({ code });
    assert.equal(failure.kind, kind, code);
    assert.equal(failure.retryable, retryable, code);
    assert.match(failure.message, pattern, code);
    // 코드 없는 "오류가 발생했습니다" 는 금지다.
    assert.match(failure.message, new RegExp(`코드 ${code}`), code);
  }
});

test("코드가 아예 없어도 추적할 것을 남긴다", () => {
  const failure = memberNoteSaveFailure(new Error("terse"));
  assert.equal(failure.kind, "unknown");
  assert.match(failure.message, /코드 unknown/);
});
