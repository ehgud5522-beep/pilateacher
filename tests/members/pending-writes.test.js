import assert from "node:assert/strict";
import test from "node:test";

import {
  WRITE_LABEL, pendingWriteRows, pendingWriteSummary, refusedWriteMessage,
} from "../../src/features/members/pending-writes.js";
import { isPermanentWriteError } from "../../src/data/dual-write/coordinator.js";
import { PendingWriteLog, pendingClientWrites } from "../../src/data/dual-write/retry-store.js";

/**
 * 센터에 못 간 쓰기.
 *
 * 이중 쓰기는 기기에 먼저 저장하고 그다음 센터로 보낸다. 센터 쪽 실패를
 * 코디네이터가 잡아 성공으로 돌려주므로 강사에게는 저장된 것으로 보였다 --
 * 그 침묵이 이 코드가 생긴 이유다.
 */

const storage = () => {
  const box = new Map();
  return {
    getItem: (key) => (box.has(key) ? box.get(key) : null),
    setItem: (key, value) => box.set(key, value),
  };
};

/* ── 영구와 일시를 가른다 ────────────────────────────────────────────── */

test("서버가 거부한 것과 연결이 끊긴 것을 가른다", () => {
  /* 앞의 것은 백 번 보내도 같은 답이라 그 자리에서 말해야 하고, 뒤의 것은
     다음에 저장하면 들어간다. */
  for (const code of ["permission-denied", "invalid-argument", "failed-precondition", "not-found", "unauthenticated"]) {
    assert.equal(isPermanentWriteError(code), true, code);
  }
  for (const code of ["unavailable", "deadline-exceeded", "aborted", "internal", "resource-exhausted", "unknown", ""]) {
    assert.equal(isPermanentWriteError(code), false, code);
  }
});

/* ── 영구 오류는 그 자리에서 말한다 ─────────────────────────────────── */

test("누구의 무엇이 안 갔는지 말한다", () => {
  /* "저장되지 않았어요" 만으로는 무엇을 다시 봐야 하는지 알 수 없다 --
     강사는 그날 열 명을 만진다. */
  const said = refusedWriteMessage(
    { entityType: "client", entityId: "csv_01012345678", errorCode: "permission-denied" },
    (id) => (id === "csv_01012345678" ? "김하나" : ""),
  );
  assert.match(said, /김하나 회원의 회원 정보/);
  assert.match(said, /센터에 저장되지 않았어요/);
  assert.match(said, /대표님께 알려주세요/);
  // 코드 없는 "오류가 발생했습니다" 는 금지다.
  assert.match(said, /코드 permission-denied/);
});

test("이름을 모르면 이름 없이 말한다", () => {
  const said = refusedWriteMessage({ entityType: "lesson", entityId: "lesson-1", errorCode: "invalid-argument" });
  assert.match(said, /수업 일정가 센터에 저장되지 않았어요/);
  assert.match(said, /코드 invalid-argument/);
});

test("모르는 종류도 숨기지 않는다", () => {
  const said = refusedWriteMessage({ entityType: "something", entityId: "x" });
  assert.match(said, /변경/);
  assert.match(said, /코드 unknown/);
});

/* ── 일시 오류는 위에 숫자만 ────────────────────────────────────────── */

test("아직 안 간 것이 없으면 아무 말도 하지 않는다", () => {
  assert.equal(pendingWriteSummary([]), "");
  assert.equal(pendingWriteSummary(null), "");
});

test("숫자만 말한다. 실패라고 쓰지 않는다", () => {
  /* 실제로 실패가 아니다 -- 기기에는 저장됐고, 다음에 그 회원을 저장하면
     들어간다. */
  const said = pendingWriteSummary([{ idempotencyKey: "a" }, { idempotencyKey: "b" }]);
  assert.equal(said, "센터에 아직 안 간 변경 2건");
  assert.doesNotMatch(said, /실패|오류/);
});

test("목록은 회원 이름과 무엇이었는지를 준다", () => {
  const rows = pendingWriteRows([
    { idempotencyKey: "k1", entityType: "client", entityId: "c-1", lastErrorCode: "unavailable" },
    { idempotencyKey: "k2", entityType: "lesson", entityId: "l-1" },
  ], (id) => (id === "c-1" ? "김하나" : ""));
  assert.deepEqual(rows, [
    { key: "k1", name: "김하나", what: WRITE_LABEL.client, code: "unavailable" },
    { key: "k2", name: "l-1", what: WRITE_LABEL.lesson, code: "unknown" },
  ]);
});

/* ── 기록이 실제로 늘고 준다 ────────────────────────────────────────── */

test("성공하면 그 줄이 빠진다", () => {
  /* 다시 보내는 코드는 없다. 사람이 그 회원을 다시 저장하면 같은 열쇠가
     지워지고 숫자가 준다 -- 그것이 유일한 복구 수단이다. */
  const log = new PendingWriteLog(storage());
  log.record({ idempotencyKey: "org:client:c-1:update:1", entityType: "client", entityId: "c-1", operation: "update", lastErrorCode: "unavailable", createdAt: "t", nextRetryAt: "t" });
  log.record({ idempotencyKey: "org:client:c-2:update:1", entityType: "client", entityId: "c-2", operation: "update", lastErrorCode: "unavailable", createdAt: "t", nextRetryAt: "t" });
  assert.equal(pendingWriteSummary(log.read()), "센터에 아직 안 간 변경 2건");

  log.remove("org:client:c-1:update:1");
  assert.equal(pendingWriteSummary(log.read()), "센터에 아직 안 간 변경 1건");
});

test("같은 회원을 두 번 실패해도 줄은 하나다", () => {
  // 숫자가 사람 수가 아니라 시도 횟수가 되면 읽는 사람이 겁만 먹는다.
  const log = new PendingWriteLog(storage());
  const entry = { idempotencyKey: "k", entityType: "client", entityId: "c-1", operation: "update", lastErrorCode: "unavailable", createdAt: "t", nextRetryAt: "t" };
  log.record(entry);
  const second = log.record(entry);
  assert.equal(log.read().length, 1);
  assert.equal(second.retryCount, 2, "몇 번 걸렸는지는 줄 안에 남는다");
});

test("회원 쪽 쓰기만 센다", () => {
  /* 화면이 "어느 회원" 을 말해야 하는데, 일정은 회원이 아니다. */
  const rows = [
    { idempotencyKey: "a", entityType: "client" },
    { idempotencyKey: "b", entityType: "lesson" },
  ];
  assert.deepEqual(pendingClientWrites(rows).map((row) => row.idempotencyKey), ["a"]);
  assert.deepEqual(pendingClientWrites(null), []);
});

test("옛 이름으로도 같은 것이 나온다", async () => {
  /* 이름을 바꿨지만 부르는 곳이 남아 있을 수 있다. 같은 클래스를 가리킨다. */
  const module = await import("../../src/data/dual-write/retry-store.js");
  assert.equal(module.RetryMetadataStore, PendingWriteLog);
});
