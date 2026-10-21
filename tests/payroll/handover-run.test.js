import assert from "node:assert/strict";
import test from "node:test";

import { runHandover } from "../../src/data/repositories/handover-repository.js";
import { handoverPlan } from "../../src/features/members/instructor-handover.js";

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

/* ── 미리보기와 실행이 **같은 객체**를 쓴다 ──────────────────────────────
   화면이 보여 준 목록과 실제로 넘어가는 목록이 다르면, 대표는 자기가 승인한
   것과 다른 일이 일어난 것을 **나중에야** 안다 -- 원장은 append-only 라
   그때는 되돌릴 수 없다.

   그래서 실행은 계획을 다시 세우지 않는다. `handoverPlan` 이 낸 그 객체를
   그대로 받는다. 아래가 그 계약이다. */

const PASSES = [
  { id: "p1", clientId: "c1", instructorId: "u-old", status: "active", category: "pt_1_1_new", baseUnitPrice: 25000, remainingCount: 8, locationId: "bansong", expiresAt: new Date(2027, 0, 1) },
  { id: "p2", clientId: "c2", clientIds: ["c2", "c3"], instructorId: "u-old", status: "active", category: "pt_2_1_repurchase", baseUnitPrice: 35000, remainingCount: 5, locationId: "bansong", expiresAt: new Date(2027, 0, 1) },
  // 끝난 회원권. 계획에 들어가지 않으므로 실행에도 없어야 한다.
  { id: "spent", clientId: "c4", instructorId: "u-old", status: "active", remainingCount: 0, locationId: "bansong" },
];
const TARGETS = { "u-new": { userId: "u-new", displayName: "정예진", locationId: "bansong", status: "active" } };

const realPlan = (assignments, sessionsOf = () => 0) => handoverPlan({
  passes: PASSES, assignments, fromInstructorId: "u-old", now: new Date(2026, 9, 22),
  instructorOf: (id) => TARGETS[id] || null,
  clientNameOf: (id) => ({ c1: "김하나", c2: "이두리", c3: "박세인" })[id] || "",
  sessionsOf,
});

test("the rows the preview drew are exactly the rows that move", async () => {
  const planned = realPlan({ p1: "u-new", p2: "u-new" }, () => 30);
  assert.equal(planned.canRun, true);

  const { store, passStore, transfers } = fakeStores();
  const found = await runHandover(ORG, {
    fromInstructorId: "u-old", actorId: "owner-a", actorRole: "owner",
    rows: planned.rows, carries: planned.carries,
  }, { store, passStore });

  /* 화면이 보여 준 것과 넘어간 것이 같다. 끝난 회원권은 계획에 없었으므로
     실행에도 없다. */
  assert.deepEqual(
    found.moved.map((row) => row.passId).sort(),
    planned.rows.map((row) => row.passId).sort(),
  );
  assert.deepEqual(transfers.map((item) => item.passId).sort(), ["p1", "p2"]);
  assert.equal(transfers.some((item) => item.passId === "spent"), false);
});

test("a plan the preview refused is refused by the runner too", async () => {
  /* 화면이 막아도 실행이 한 번 더 본다 -- 목록이 낡았을 수 있고, 그 한 줄이
     원장에 박히면 되돌릴 수 없다. */
  const planned = realPlan({ p1: "u-new" });
  assert.equal(planned.canRun, false, "p2 가 아직 안 정해졌다");

  const { store, passStore, transfers } = fakeStores();
  const found = await runHandover(ORG, {
    fromInstructorId: "u-old", actorId: "owner-a", actorRole: "owner",
    rows: planned.rows, carries: planned.carries,
  }, { store, passStore });

  assert.deepEqual(transfers.map((item) => item.passId), ["p1"], "정해진 줄만 간다");
  assert.deepEqual(found.moved.map((row) => row.passId), ["p1"]);
});

test("a duet split in the preview moves nothing at all", async () => {
  /* 두 사람이 다른 강사로 가면 함께 수업을 받을 수 없다. 계획이 그 줄 전부를
     막고, 실행은 그 표시를 그대로 읽는다. */
  const split = { ...TARGETS, "u-two": { userId: "u-two", displayName: "최둘", locationId: "bansong", status: "active" } };
  const planned = handoverPlan({
    passes: [
      { id: "duet", clientId: "c1", clientIds: ["c1", "c2"], instructorId: "u-old", status: "active", remainingCount: 5, locationId: "bansong", expiresAt: new Date(2027, 0, 1) },
      { id: "solo", clientId: "c2", instructorId: "u-old", status: "active", remainingCount: 5, locationId: "bansong", expiresAt: new Date(2027, 0, 1) },
    ],
    assignments: { duet: "u-new", solo: "u-two" },
    fromInstructorId: "u-old", now: new Date(2026, 9, 22),
    instructorOf: (id) => split[id] || null,
  });
  assert.equal(planned.canRun, false);

  const { store, passStore, transfers } = fakeStores();
  await runHandover(ORG, {
    fromInstructorId: "u-old", actorId: "owner-a", actorRole: "owner",
    rows: planned.rows, carries: planned.carries,
  }, { store, passStore });
  assert.deepEqual(transfers, [], "한 장도 넘어가지 않는다");
});

test("the preview's carried counts are the ones the runner writes", async () => {
  /* 미리보기가 "누적 30 이 따라갑니다" 라고 말했으면 그 30 이 가야 한다.
     실행이 다시 세면 그 사이에 바뀐 값이 들어가고, 화면은 거짓이 된다. */
  const planned = realPlan({ p1: "u-new", p2: "u-new" }, (id) => ({ c1: 30, c2: 12, c3: 7 })[id] || 0);
  const { store, passStore, commits } = fakeStores();
  await runHandover(ORG, {
    fromInstructorId: "u-old", actorId: "owner-a", actorRole: "owner",
    rows: planned.rows, carries: planned.carries,
  }, { store, passStore });

  const written = carryWrites(commits).map((item) => [item.path.split("/").pop(), item.data.delta.sessions]);
  assert.deepEqual(written.sort(), [
    ["u-new_c1", 30], ["u-new_c2", 12], ["u-new_c3", 7],
  ].sort());
});

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
