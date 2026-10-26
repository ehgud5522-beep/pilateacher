import assert from "node:assert/strict";
import test from "node:test";

import { AUDIT_ACTION, auditEntry } from "../../src/data/repositories/audit-repository.js";
import { recordPasswordResetSent } from "../../src/data/repositories/instructor-repository.js";

/**
 * 비밀번호 재설정 — **가입 여부를 밖으로 흘리지 않는다.**
 *
 * 없는 계정에 다른 답을 주면 그 화면이 **가입 여부 확인기**가 된다. 아무
 * 주소나 넣어 보며 "이 사람이 우리 센터를 쓰는가" 를 셀 수 있고, 그것은
 * 회원 명부를 한 줄씩 긁는 것과 같다.
 *
 * 발송 자체(fbSendPasswordReset)는 Firebase Auth 를 부르므로 여기서 돌리지
 * 않는다. 이 파일이 지키는 것은 **기록**이다 -- 무엇이 남고 무엇이 남지
 * 않는가.
 */

const ORG = "bonita";

const fakeStore = () => {
  const calls = { commit: [] };
  return {
    calls,
    serverTimestamp: async () => "STAMP",
    commit: async (writes) => { calls.commit.push(writes); },
  };
};

test("기록에는 uid 만 남고 이메일 주소는 남지 않는다", async () => {
  /* auditLogs 에 이메일 칸이 없고 열 생각도 없다 (CLAUDE.md §7). 누구에게
     보냈는지는 targetId 가 말한다.

     주소를 남기면 그 컬렉션을 읽는 사람이 센터 강사 전원의 로그인 주소를
     한 화면에서 보게 된다 -- 감사 기록이 명부가 된다. */
  const store = fakeStore();
  await recordPasswordResetSent(ORG, {
    targetId: "u-1", changedBy: "owner-a", actorRole: "owner",
  }, { store });

  const [write] = store.calls.commit[0];
  assert.equal(write.data.action, AUDIT_ACTION.PASSWORD_RESET_SENT);
  assert.equal(write.data.targetId, "u-1");
  assert.equal(write.data.actorId, "owner-a");

  const fields = Object.keys(write.data).join(" ");
  assert.doesNotMatch(fields, /email/i, "이메일 칸이 있으면 안 된다");
  const values = JSON.stringify(write.data);
  assert.doesNotMatch(values, /@/, "값 어디에도 주소가 들어가면 안 된다");
});

test("행위자와 대상이 없으면 기록하지 않는다", async () => {
  /* 누가 했는지 모르는 기록은 없는 것보다 해롭다 -- 있었다는 사실만 남고
     물어볼 사람이 없다. */
  const store = fakeStore();
  for (const bad of [
    { targetId: "", changedBy: "owner-a", actorRole: "owner" },
    { targetId: "u-1", changedBy: "", actorRole: "owner" },
    { targetId: "u-1", changedBy: "owner-a", actorRole: "" },
  ]) {
    await assert.rejects(() => recordPasswordResetSent(ORG, bad, { store }));
  }
  assert.equal(store.calls.commit.length, 0, "하나도 쓰이지 않는다");
});

test("감사 동작 목록에 들어 있다 — 규칙과 같은 이름이다", () => {
  /* 이름이 어긋나면 규칙이 거부하고, 화면에는 "저장하지 못했다" 만 남는다.
     firestore.foundation.rules 의 auditActions() 와 함께 고친다. */
  assert.equal(AUDIT_ACTION.PASSWORD_RESET_SENT, "password_reset_sent");
  const entry = auditEntry(ORG, {
    action: AUDIT_ACTION.PASSWORD_RESET_SENT,
    actorId: "owner-a", actorRole: "owner", targetId: "u-1", stampedAt: "STAMP",
  });
  assert.equal(entry.action, "password_reset_sent");
});

test("기록은 한 번에 한 줄이다", async () => {
  /* 한 번 누른 일이 두 줄로 남으면 대표는 두 번 보낸 줄 안다. */
  const store = fakeStore();
  await recordPasswordResetSent(ORG, {
    targetId: "u-1", changedBy: "owner-a", actorRole: "area_manager",
  }, { store });
  assert.equal(store.calls.commit.length, 1);
  assert.equal(store.calls.commit[0].length, 1);
});
