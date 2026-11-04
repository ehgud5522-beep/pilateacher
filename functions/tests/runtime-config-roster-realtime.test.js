"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readRuntimeConfig, writeRuntimeConfig } = require("../src/runtime-config-admin");

/* 명단 실시간 스위치 (2026-11-04, 2단계). 새 문서가 아니라 scheduleSync 문서의
   rosterRealtime 칸에 산다 -- 규칙에 읽기 문을 새로 내지 않으려고. 그래서 두 스위치가
   서로를 지우지 않는지가 이 파일의 전부다. */

function fakeFirestore() {
  const docs = new Map();
  return {
    docs,
    collection: (name) => ({
      doc: (id) => {
        const path = `${name}/${id}`;
        return {
          get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
          set: async (value, options) => {
            docs.set(path, options?.merge ? { ...(docs.get(path) || {}), ...value } : value);
          },
        };
      },
    }),
  };
}

const now = () => new Date(2026, 10, 4, 12, 0);

test("명단 실시간은 scheduleSync 문서의 칸에 쓰이고, 일정 동기화 값을 지우지 않는다", async () => {
  const firestore = fakeFirestore();
  await writeRuntimeConfig(firestore, { document: "scheduleSync", value: { mode: "all" }, actorId: "owner-uid-1", now });
  await writeRuntimeConfig(firestore, { document: "rosterRealtime", value: { mode: "listed", userIds: ["uidTeacher2"] }, actorId: "owner-uid-1", now });
  const stored = firestore.docs.get("runtimeConfig/scheduleSync");
  assert.equal(stored.mode, "all", "일정 동기화는 그대로");
  assert.deepEqual({ mode: stored.rosterRealtime.mode, userIds: stored.rosterRealtime.userIds }, { mode: "listed", userIds: ["uidTeacher2"] });
  assert.equal(firestore.docs.has("runtimeConfig/rosterRealtime"), false, "새 문서를 만들지 않는다");
});

test("일정 동기화를 다시 써도 명단 실시간 칸은 남는다", async () => {
  const firestore = fakeFirestore();
  await writeRuntimeConfig(firestore, { document: "rosterRealtime", value: { mode: "all" }, actorId: "owner-uid-1", now });
  await writeRuntimeConfig(firestore, { document: "scheduleSync", value: { mode: "off" }, actorId: "owner-uid-1", now });
  const stored = firestore.docs.get("runtimeConfig/scheduleSync");
  assert.equal(stored.mode, "off");
  assert.equal(stored.rosterRealtime.mode, "all");
});

test("읽을 때는 칸을 자기 이름으로 돌려준다 — 화면이 config.rosterRealtime 을 본다", async () => {
  const firestore = fakeFirestore();
  assert.equal((await readRuntimeConfig(firestore)).rosterRealtime, null, "없으면 null (= 꺼짐)");
  await writeRuntimeConfig(firestore, { document: "rosterRealtime", value: { mode: "all" }, actorId: "owner-uid-1", now });
  const config = await readRuntimeConfig(firestore);
  assert.equal(config.rosterRealtime.mode, "all");
  assert.equal(config.scheduleSync.rosterRealtime.mode, "all");
});

test("모양 검사는 일정 동기화와 같다", async () => {
  await assert.rejects(
    writeRuntimeConfig(fakeFirestore(), { document: "rosterRealtime", value: { mode: "on" }, actorId: "x", now }),
    /schedule_sync_mode_invalid/,
  );
});
