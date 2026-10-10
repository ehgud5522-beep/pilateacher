/**
 * 계정 삭제 — 화면이 하는 말이 사실인가.
 *
 * 이 화면은 되돌릴 수 없는 버튼 앞에서 "이것은 사라지고 이것은 남습니다" 를
 * 약속한다. 그 약속과 서버가 실제로 하는 일이 갈라지면, 갈라진 사실은
 * 회원이 센터에 전화할 때까지 아무도 모른다.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DELETED_ITEMS, DELETE_STEP, KEPT_ITEMS, deleteFailureMessage, deviceKeysToForget,
} from "../../member/src/delete-account.js";
import { DEVICE_KEYS, VERIFIED_AT_KEY, forgetDevice } from "../../member/src/session.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("사라진다고 말한 것과 남는다고 말한 것이 겹치지 않는다", () => {
  for (const item of DELETED_ITEMS) assert.ok(!KEPT_ITEMS.includes(item), item);
  assert.ok(DELETED_ITEMS.length && KEPT_ITEMS.length);
});

test("남는다고 약속한 것을 서버가 지우지 않는다", () => {
  /* **이것이 이 파일의 핵심이다.** 화면은 "센터에 등록된 회원 정보와 남은
     회원권은 그대로" 라고 말한다. 서버가 clients 문서나 passes 를 지우기
     시작하면 그 말은 거짓이 되고, 원장이 사라지면 강사 급여의 근거도 함께
     사라진다. */
  assert.ok(KEPT_ITEMS.some((item) => /센터에 등록된 회원 정보/.test(item)));
  assert.ok(KEPT_ITEMS.some((item) => /회원권/.test(item)));
});

test("지우는 배치는 명부와 원장을 건드리지 않는다", async () => {
  const store = await read("functions/src/member-link-store.js");
  const purge = store.slice(store.indexOf("async function purgeMemberAccount"));
  const body = purge.slice(0, purge.indexOf("\n  }\n"));

  /* clients 문서는 지우지 않는다 -- userId 칸 하나만 없앤다. */
  assert.match(body, /batch\.set\(clientRef\([^)]*\), \{ userId: FieldValue\.delete\(\) \}, \{ merge: true \}\)/);
  assert.doesNotMatch(body, /batch\.delete\(clientRef/);
  /* 투영은 지운다 -- userId 만 지우면 이미 깔린 사본을 계속 읽는다. */
  assert.match(body, /batch\.delete\(memberViewRef\(/);
  /* 원장·회원권은 이 배치가 아는 것이 아니다. */
  assert.doesNotMatch(body, /ledger|passes/);
});

test("서버는 되돌릴 수 있는 쪽으로 틀린다 — Firestore 가 먼저다", async () => {
  /* 거꾸로 하면 계정은 없는데 명부에 죽은 uid 가 남아, 다시 가입해도
     `taken` 에 막힌다. 순서가 곧 이 기능의 안전성이다. */
  const account = await read("functions/src/member-account.js");
  assert.ok(account.indexOf("purgeMemberAccount(") < account.indexOf("deleteAuthUser("),
    "purge 가 deleteAuthUser 보다 앞에 있어야 한다");
});

test("삭제 뒤 기기에 남는 칸이 없다", () => {
  /* 계정은 지웠는데 마지막 확인 시각이 남아 있으면, 다음에 이 폰을 여는
     사람이 지워진 사람의 흔적을 밟고 들어간다. */
  assert.ok(DEVICE_KEYS.includes(VERIFIED_AT_KEY));

  const box = new Map([[VERIFIED_AT_KEY, "2026-09-01T00:00:00.000Z"], ["남의 것", "그대로"]]);
  forgetDevice({
    removeItem: (key) => box.delete(key),
    getItem: (key) => box.get(key) ?? null,
  });
  assert.equal(box.has(VERIFIED_AT_KEY), false);
  assert.equal(box.get("남의 것"), "그대로", "우리 칸만 지운다");
});

test("한 칸이 막혀도 나머지는 지운다", () => {
  const removed = [];
  forgetDevice({
    removeItem: (key) => {
      removed.push(key);
      throw new Error("저장이 막혔습니다");
    },
  });
  assert.deepEqual(removed, [...DEVICE_KEYS], "막혀도 전부 시도한다");
});

test("저장소가 없어도 죽지 않는다", () => {
  assert.doesNotThrow(() => forgetDevice(null));
  assert.doesNotThrow(() => forgetDevice({}));
});

test("걷을 칸 목록은 중복과 빈 값을 걸러 낸다", () => {
  assert.deepEqual(deviceKeysToForget(["a", "a", "", null, " b "]), ["a", "b"]);
  assert.deepEqual(deviceKeysToForget(), []);
});

test("계정만 안 지워진 것은 다른 말을 한다", () => {
  /* 연결은 이미 끊겼다. "그대로입니다" 라고 말하면 화면과 사실이 어긋나고,
     그 사람이 다음에 열면 처음 가입한 것처럼 보인다. */
  const partial = deleteFailureMessage("account_not_removed");
  assert.match(partial, /연결은 끊었지만/);
  assert.match(partial, /코드 account_not_removed/);

  assert.match(deleteFailureMessage("unauthenticated"), /다시 로그인/);
  /* 분류하지 못한 것도 코드를 보여준다. */
  assert.match(deleteFailureMessage("internal"), /코드 internal/);
  assert.match(deleteFailureMessage(""), /코드 unknown/);
});

test("단계는 넷이다", () => {
  assert.deepEqual(Object.values(DELETE_STEP), ["idle", "confirm", "working", "failed"]);
});

test("계정 삭제 요청 URL 은 /delete-account 하나다", async () => {
  const { DELETE_ACCOUNT_PATH, wantsAccountDeletion } = await import("../../member/src/delete-account.js");
  assert.equal(DELETE_ACCOUNT_PATH, "/delete-account");
  for (const path of ["/delete-account", "/delete-account/", "/Delete-Account"]) {
    assert.equal(wantsAccountDeletion(path), true, path);
  }
  for (const path of ["/", "", null, "/delete", "/delete-account/x", "/more"]) {
    assert.equal(wantsAccountDeletion(path), false, String(path));
  }
});
