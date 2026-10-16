import assert from "node:assert/strict";
import test from "node:test";

import { runHandover } from "../../src/data/repositories/handover-repository.js";

/**
 * 인계 실행.
 *
 * 계획은 instructor-handover.js 가 세우고, 여기는 그것을 쓰는 쪽이다.
 *
 * ── 이 파일이 지키는 것 ──
 * 하나. **누적은 회원당 한 번.** 회원권이 세 장이어도 누적은 하나이고, 세 번
 *       더하면 그 회원의 20회 경계가 세 배로 당겨진다.
 * 둘.  **한 장이 막혀도 나머지는 간다.** 통째로 되돌리면 대표는 처음부터
 *       다시 눌러야 하고 그 사이 차감이 섞인다.
 * 셋.  **넘어가지 않은 회원의 누적은 옮기지 않는다.** 그러면 두 사람 모두
 *       틀린 값을 든다.
 */

const ORG = "bonita";

const row = (overrides = {}) => ({
  passId: "p1", clientIds: ["c1"], toInstructorId: "u-new",
  locationId: "bansong", blocks: [], ...overrides,
});

function fakeStores({ failPassIds = [] } = {}) {
  const commits = [];
  const transfers = [];
  const passStore = {
    read: async () => null,
    commit: async (writes) => {
      /* transferPassInstructor 는 회원권 경로를 첫 줄 다음에 쓴다. 여기서는
         어느 회원권이 넘어갔는지만 본다. */
      const passWrite = writes.find((item) => /\/passes\/[^/]+$/.test(item.path));
      const passId = passWrite ? passWrite.path.split("/").pop() : "";
      if (failPassIds.includes(passId)) throw Object.assign(new Error("nope"), { code: "permission-denied" });
      transfers.push({ passId, writes });
    },
    serverTimestamp: async () => "SERVER_TIME",
  };
  const store = {
    commits,
    commit: async (writes) => { commits.push(writes); },
    serverTimestamp: async () => "SERVER_TIME",
  };
  return { store, passStore, transfers, commits };
}

const plan = (overrides = {}) => ({
  fromInstructorId: "u-old", actorId: "owner-a", actorRole: "owner",
  rows: [row()], carries: [{ toInstructorId: "u-new", clientId: "c1", sessions: 30 }],
  ...overrides,
});

const carryWrites = (commits) => commits
  .flat()
  .filter((item) => item.path.includes("instructorClientTotals"));

/* ── 누적은 회원당 한 번 ─────────────────────────────────────────────────── */

test("three passes for one member carry the count once, not three times", async () => {
  /* 세 번 더하면 그 회원의 20회 경계가 세 배로 당겨지고, 재등록 첫 차감부터
     기준 단가가 되어 센터가 더 낸다. */
  const { store, passStore, commits, transfers } = fakeStores();
  await runHandover(ORG, plan({
    rows: [row({ passId: "p1" }), row({ passId: "p2" }), row({ passId: "p3" })],
  }), { store, passStore });

  assert.equal(transfers.length, 3, "회원권 세 장은 각각 넘어간다");
  const carries = carryWrites(commits);
  assert.equal(carries.length, 1, "누적은 한 번만");
  assert.deepEqual(carries[0].data.delta, { sessions: 30 });
});

test("each half of a duet carries its own count", async () => {
  const { store, passStore, commits } = fakeStores();
  await runHandover(ORG, plan({
    rows: [row({ clientIds: ["c1", "c2"] })],
    carries: [
      { toInstructorId: "u-new", clientId: "c1", sessions: 30 },
      { toInstructorId: "u-new", clientId: "c2", sessions: 12 },
    ],
  }), { store, passStore });

  const carries = carryWrites(commits);
  assert.deepEqual(carries.map((item) => item.data.delta.sessions).sort((a, b) => a - b), [12, 30]);
});

/* ── 한 장이 막혀도 ──────────────────────────────────────────────────────── */

test("one refused pass does not stop the rest, and the code is kept", async () => {
  /* 통째로 되돌리면 대표는 처음부터 다시 눌러야 하고, 그 사이 차감이 섞인다.
     원본 코드를 버리면 왜 막혔는지 확정할 수 없다. */
  const { store, passStore } = fakeStores({ failPassIds: ["p2"] });
  const found = await runHandover(ORG, plan({
    rows: [row({ passId: "p1" }), row({ passId: "p2" }), row({ passId: "p3" })],
  }), { store, passStore });

  assert.deepEqual(found.moved.map((item) => item.passId), ["p1", "p3"]);
  assert.equal(found.failed.length, 1);
  assert.equal(found.failed[0].passId, "p2");
  assert.equal(found.failed[0].errorCode, "permission-denied");
});

test("a member whose only pass failed does not have their count moved", async () => {
  /* 그 회원은 아직 전 강사의 회원이다. 누적만 옮기면 두 사람 모두 틀린 값을
     들고, 다음 재등록의 단가가 거기서 갈린다. */
  const { store, passStore, commits } = fakeStores({ failPassIds: ["p1"] });
  const found = await runHandover(ORG, plan(), { store, passStore });

  assert.deepEqual(found.moved, []);
  assert.deepEqual(carryWrites(commits), []);
  assert.deepEqual(found.carried, []);
});

/* ── 무엇을 실행하는가 ───────────────────────────────────────────────────── */

test("a blocked row is never executed, however it got into the list", async () => {
  /* 화면이 막아도 여기서 한 번 더 본다 -- 목록이 낡았을 수 있고, 그 한 줄이
     원장에 박히면 되돌릴 수 없다. */
  const { store, passStore, transfers } = fakeStores();
  const found = await runHandover(ORG, plan({
    rows: [row({ passId: "p1", blocks: ["duet_split"] })],
  }), { store, passStore });
  assert.deepEqual(transfers, []);
  assert.deepEqual(found.moved, []);
});

test("a row with no target is never executed", async () => {
  const { store, passStore, transfers } = fakeStores();
  await runHandover(ORG, plan({ rows: [row({ toInstructorId: "" })] }), { store, passStore });
  assert.deepEqual(transfers, []);
});

/* ── 기록 ────────────────────────────────────────────────────────────────── */

test("the whole handover is one audit line, not one per pass", async () => {
  /* 장마다 남기면 퇴사 인계 하나가 감사 목록 수십 줄이 되고, 그러면 그
     목록은 안 읽힌다. 몇 장이 넘어갔는지가 그 줄의 내용이다. */
  const { store, passStore, commits } = fakeStores({ failPassIds: ["p2"] });
  await runHandover(ORG, plan({
    rows: [row({ passId: "p1" }), row({ passId: "p2" })],
  }), { store, passStore });

  const logs = commits.flat().filter((item) => item.path.startsWith("auditLogs/"));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].data.targetId, "u-old", "누구를 인계했는가");
  assert.equal(logs[0].data.stage, "handover");
  assert.equal(logs[0].data.succeeded, 1);
  assert.equal(logs[0].data.failed, 1);
});

test("nothing moved means nothing recorded", async () => {
  // 아무것도 안 바뀌었는데 기록만 남으면 그 줄은 거짓이다.
  const { store, passStore, commits } = fakeStores({ failPassIds: ["p1"] });
  await runHandover(ORG, plan(), { store, passStore });
  assert.deepEqual(commits.flat().filter((item) => item.path.startsWith("auditLogs/")), []);
});

test("the organisation and the leaving instructor are both required", async () => {
  const { store, passStore } = fakeStores();
  await assert.rejects(() => runHandover("", plan(), { store, passStore }), /organizationId/);
  await assert.rejects(
    () => runHandover(ORG, plan({ fromInstructorId: "" }), { store, passStore }),
    /fromInstructorId/,
  );
});
