/**
 * 설계 문서 1단계-2: 수업기록 "보낼 줄". 서버가 받기 전에는 지우지 않는다 · 같은 줄은 한 번 · 결정적 오류는 남기고 멈춘다.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createServerOutbox, isTransientOutboxError, lessonRecordPath, outboxKeyFor } from "../../src/features/lesson-record/server-outbox.js";

const memoryStorage = () => { const map = new Map(); return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), map }; };
const fakeStore = () => {
  const docs = new Map(); const calls = []; let failNext = null;
  return {
    docs, calls, failWith: (error) => { failNext = error; },
    read: async (path) => { calls.push(["read", path]); return docs.get(path) || null; },
    create: async (path, data) => {
      calls.push(["create", path]);
      if (failNext) { const error = failNext; failNext = null; throw error; }
      if (docs.has(path)) throw Object.assign(new Error("exists"), { code: "permission-denied" });
      docs.set(path, data);
    },
  };
};
const record = (id = "t1_n1_abcd") => ({ recordId: id, organizationId: "org", data: { body: "브릿지", clientId: "c1" } });

test("넣고 보내면 서버에 한 줄, 보낼 줄은 빈다", async () => {
  const storage = memoryStorage(); const store = fakeStore(); let clock = 1000;
  const outbox = createServerOutbox({ storage, key: outboxKeyFor("t1"), store, now: () => clock });
  assert.equal(outbox.enqueue(record()), true);
  assert.equal(outbox.enqueue(record()), true, "같은 기록ID 는 한 번만");
  assert.equal(outbox.pending().length, 1);
  const summary = await outbox.flush();
  assert.equal(summary.sent, 1);
  assert.deepEqual([...store.docs.keys()], [lessonRecordPath("org", "t1_n1_abcd")]);
  assert.equal(outbox.pending().length, 0);
});

test("이미 서버에 있으면 쓰지 않고 보낸 것으로 친다 (두 기기 · 다시 보내기)", async () => {
  const storage = memoryStorage(); const store = fakeStore();
  store.docs.set(lessonRecordPath("org", "t1_n1_abcd"), { body: "브릿지" });
  const outbox = createServerOutbox({ storage, key: "k", store });
  outbox.enqueue(record());
  const summary = await outbox.flush();
  assert.equal(summary.alreadyThere, 1);
  assert.equal(store.calls.filter(([kind]) => kind === "create").length, 0);
  assert.equal(outbox.pending().length, 0);
});

test("일시 오류: 지우지 않고 기다렸다가 다시 -- 기다리는 동안은 건너뛴다", async () => {
  const storage = memoryStorage(); const store = fakeStore(); let clock = 0;
  const outbox = createServerOutbox({ storage, key: "k", store, now: () => clock });
  outbox.enqueue(record());
  store.failWith(Object.assign(new Error("offline"), { code: "unavailable" }));
  assert.equal((await outbox.flush()).retryLater, 1);
  assert.equal(outbox.pending().length, 1, "원문은 남는다");
  assert.equal(outbox.pending()[0].lastError.transient, true);
  assert.equal((await outbox.flush()).retryLater, 1, "30초가 안 지났다");
  clock = 31e3;
  assert.equal((await outbox.flush()).sent, 1);
  assert.equal(outbox.pending().length, 0);
});

test("결정적 오류: 남기고 멈춘다 -- 자동으로 되풀이하지 않고, 앱을 다시 열 때(includeBlocked) 한 번 더", async () => {
  const storage = memoryStorage(); const store = fakeStore(); const logs = [];
  const outbox = createServerOutbox({ storage, key: "k", store, log: (event, details) => logs.push([event, details]) });
  outbox.enqueue(record());
  store.failWith(Object.assign(new Error("denied"), { code: "permission-denied" }));
  assert.equal((await outbox.flush()).blocked, 1);
  assert.equal(outbox.pending().length, 1, "결정적 오류여도 지우지 않는다");
  assert.equal(outbox.pending()[0].lastError.code, "permission-denied");
  assert.equal(store.calls.filter(([kind]) => kind === "create").length, 1);
  assert.equal((await outbox.flush()).blocked, 1, "그냥 비우기로는 다시 안 보낸다");
  assert.equal(store.calls.filter(([kind]) => kind === "create").length, 1);
  assert.equal((await outbox.flush({ includeBlocked: true })).sent, 1);
  assert.equal(logs[0][0], "lesson_record_server_write_failed");
  assert.equal(logs[0][1].errorCode, "permission-denied");
  assert.equal(logs[0][1].stage, "write");
  assert.doesNotMatch(JSON.stringify(logs), /브릿지/, "진단에 기록 내용이 없다");
});

test("계정마다 따로 · 읽은 값이 깨져 있어도 넘어진다 대신 비어 있다", () => {
  assert.notEqual(outboxKeyFor("a"), outboxKeyFor("b"));
  const storage = memoryStorage(); storage.setItem("k", "{broken");
  assert.deepEqual(createServerOutbox({ storage, key: "k", store: fakeStore() }).pending(), []);
  assert.equal(isTransientOutboxError({ code: "deadline-exceeded" }), true);
  assert.equal(isTransientOutboxError({ code: "invalid-argument" }), false);
});

test("앱: 스위치(scheduleSync.lessonRecordServer)가 켜졌을 때만 보내고, 운영 스위치 화면에 카드가 있다", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /scheduleSyncEnabledFor\(scheduleSyncConfig\?\.lessonRecordServer, account\?\.id\)/);
  assert.match(source, /isEnabled: \(\) => lessonRecordServerOnRef\.current && Boolean\(lessonRecordOutbox\)/);
  assert.match(source, /document="lessonRecordServer" title="수업기록 서버 저장"/);
});

test("넘치면 새로 넣기를 거절할 뿐, 이미 있는 줄은 버리지 않는다", () => {
  const storage = memoryStorage(); const logs = [];
  const outbox = createServerOutbox({ storage, key: "k", store: fakeStore(), log: (event, details) => logs.push([event, details]) });
  for (let i = 0; i < 500; i += 1) assert.equal(outbox.enqueue(record(`t1_n${i}_x`)), true);
  assert.equal(outbox.room(), 0);
  assert.equal(outbox.enqueue(record("t1_late_x")), false);
  assert.equal(outbox.pending().length, 500);
  assert.equal(outbox.pending()[0].recordId, "t1_n0_x", "가장 오래된 줄이 그대로 있다");
  assert.equal(logs.at(-1)[1].errorCode, "outbox_full");
});
