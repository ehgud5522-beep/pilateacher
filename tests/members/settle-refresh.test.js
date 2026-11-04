/**
 * 수업 확정 · 되돌리기 뒤의 가벼운 다시 읽기 (2026-11-04).
 *
 * 확정한 회원권과 그 누적만 읽는가, 듀엣은 두 회원 몫인가, 실패하면 전체 읽기로
 * 돌아가는 신호를 내는가, 그리고 확정 뒤 화면의 잔여가 다시 읽은 회원권과 같은가.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  mergeById, refreshAfterSettlement, settleRefreshTargets,
} from "../../src/features/roster/settle-refresh.js";
import { readSettledRosterDocs } from "../../src/data/repositories/pass-repository.js";
import { mergeRoster } from "../../src/features/roster/roster-bridge.js";

const NOW = new Date(2026, 10, 4, 12, 0);
const SOLO = { id: "p-solo", clientId: "c1", instructorId: "u-me", status: "active", remainingCount: 8, expiresAt: new Date(2027, 0, 1) };
const DUET = { id: "p-duet", clientId: "c2", clientIds: ["c2", "c3"], instructorId: "u-me", status: "active", remainingCount: 5, expiresAt: new Date(2027, 0, 1) };
const OTHERS = Array.from({ length: 40 }, (_, index) => ({ id: `p-${index}`, clientId: `x${index}`, status: "active", remainingCount: 3 }));

/** 서버 하나. 문서 하나 읽을 때마다 센다. */
function server(docs) {
  const store = {
    reads: [],
    read: async (path) => { store.reads.push(path); return docs[path] ? { ...docs[path] } : null; },
  };
  return store;
}

test("확정한 회원권과 그 누적만 고른다 — 듀엣은 두 회원 몫", () => {
  const targets = settleRefreshTargets(
    [{ passId: "p-solo" }, { passId: "p-duet" }, { passId: "p-duet" }],
    [SOLO, DUET, ...OTHERS], "u-me",
  );
  assert.deepEqual(targets.passIds, ["p-solo", "p-duet"], "같은 회원권은 한 번");
  assert.deepEqual(targets.totals, [
    { instructorId: "u-me", clientId: "c1" },
    { instructorId: "u-me", clientId: "c2" },
    { instructorId: "u-me", clientId: "c3" },
  ]);
});

test("되돌리기는 그 차감을 한 강사의 누적을 고른다 — 누른 사람이 아니라", () => {
  const targets = settleRefreshTargets([{ passId: "p-solo", instructorId: "u-sub" }], [SOLO], "u-owner");
  assert.deepEqual(targets.totals, [{ instructorId: "u-sub", clientId: "c1" }]);
});

test("저장소: 회원권 id 와 누적 문서만 하나씩 읽는다", async () => {
  const store = server({
    "organizations/org-a/passes/p-solo": { id: "p-solo", clientId: "c1", remainingCount: 7 },
    "organizations/org-a/passes/p-duet": { id: "p-duet", clientId: "c2", clientIds: ["c2", "c3"], remainingCount: 4 },
    "organizations/org-a/instructorClientTotals/u-me_c1": { id: "u-me_c1", sessions: 21 },
  });
  const fresh = await readSettledRosterDocs("org-a", {
    passIds: ["p-solo", "p-duet"],
    totals: [{ instructorId: "u-me", clientId: "c1" }, { instructorId: "u-me", clientId: "c2" }],
  }, { store });
  assert.equal(store.reads.length, 4);
  assert.equal(fresh.read, 4);
  assert.deepEqual(fresh.passes.map((pass) => pass.remainingCount), [7, 4]);
  assert.deepEqual(fresh.totals, [{ id: "u-me_c1", sessions: 21 }], "없는 누적 문서는 0 이라 건너뛴다");
  assert.deepEqual(fresh.missingPassIds, []);
});

test("확정 뒤 화면의 잔여는 다시 읽은 회원권과 같다 — 나머지는 그대로", async () => {
  const store = server({
    "organizations/org-a/passes/p-solo": { ...SOLO, remainingCount: 7 },
    "organizations/org-a/instructorClientTotals/u-me_c1": { id: "u-me_c1", sessions: 21 },
  });
  const current = { passes: [SOLO, DUET, ...OTHERS], totals: [{ id: "u-me_c1", sessions: 20 }, { id: "u-x_c9", sessions: 3 }] };
  const outcome = await refreshAfterSettlement({
    targets: settleRefreshTargets([{ passId: "p-solo" }], current.passes, "u-me"),
    read: (targets) => readSettledRosterDocs("org-a", targets, { store }),
    current,
  });
  assert.equal(outcome.status, "refreshed");
  assert.equal(outcome.read, 2, "회원권 1 + 누적 1 -- 명단 전체가 아니다");
  assert.equal(outcome.passes.length, current.passes.length);
  assert.equal(outcome.passes.find((pass) => pass.id === "p-solo").remainingCount, 7);
  assert.deepEqual(outcome.totals, [{ id: "u-me_c1", sessions: 21 }, { id: "u-x_c9", sessions: 3 }]);

  const roster = mergeRoster({ clients: [{ id: "c1", name: "회원", phone: "01000001111" }], passes: outcome.passes, now: NOW }).roster;
  assert.equal(roster[0].orgRemaining, 7, "화면이 읽는 잔여가 다시 읽은 회원권의 잔여다");
});

test("읽기가 실패하거나 회원권이 없어졌으면 전체 읽기로 돌아가라는 신호", async () => {
  const current = { passes: [SOLO], totals: [] };
  const targets = settleRefreshTargets([{ passId: "p-solo" }], current.passes, "u-me");
  const failed = await refreshAfterSettlement({
    targets, current,
    read: async () => { throw Object.assign(new Error("offline"), { code: "unavailable" }); },
  });
  assert.equal(failed.status, "fallback");
  assert.equal(failed.errorCode, "unavailable");
  assert.deepEqual(failed.passes, current.passes, "들고 있던 명단은 그대로");

  const missing = await refreshAfterSettlement({
    targets, current,
    read: (wanted) => readSettledRosterDocs("org-a", wanted, { store: server({}) }),
  });
  assert.equal(missing.status, "fallback");
  assert.equal(missing.errorCode, "pass_missing");
});

test("차감이 없었으면 아무것도 읽지 않는다", async () => {
  let called = false;
  const outcome = await refreshAfterSettlement({
    targets: settleRefreshTargets([], [SOLO], "u-me"),
    read: async () => { called = true; return { passes: [], totals: [], missingPassIds: [], read: 0 }; },
    current: { passes: [SOLO], totals: [] },
  });
  assert.equal(outcome.status, "nothing");
  assert.equal(called, false);
});

test("mergeById — 다시 읽은 것이 이기고 새 것은 덧붙는다", () => {
  assert.deepEqual(mergeById([{ id: "a", v: 1 }, { id: "b", v: 1 }], [{ id: "b", v: 2 }, { id: "c", v: 1 }]),
    [{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "c", v: 1 }]);
});

test("배선 — 확정 · 되돌리기는 명단 전체가 아니라 그 회원권만 다시 읽는다", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const settle = source.slice(source.indexOf("  const settleLesson = async (lessonId) => {"), source.indexOf("  /* 확정 되돌리기. 대표만 한다"));
  const unsettle = source.slice(source.indexOf("  const unsettleLesson = async (lessonId, reason) => {"), source.indexOf("  const setGroupDone = "));
  assert.ok(settle.length > 0 && unsettle.length > 0);
  for (const [name, body] of [["확정", settle], ["되돌리기", unsettle]]) {
    assert.doesNotMatch(body, /setRosterRevision/, `${name}이 명단 전체를 다시 읽으면 안 된다`);
  }
  assert.match(settle, /refreshSettledRoster\("settle", results\.map\(\(item\) => \(\{ passId: item\.passId \}\)\)\)/);
  assert.match(unsettle, /refreshSettledRoster\("unsettle", touched\)/);
  assert.match(unsettle, /touched\.push\(\{ passId: item\.passId, instructorId: entry\.instructorId \|\| "" \}\)/);
  // 실패하면 전처럼 전체를 다시 읽는다 -- 그 한 곳에만 남는다.
  const helper = source.slice(source.indexOf("  const refreshSettledRoster = async"), source.indexOf("  const settleLesson = async"));
  assert.match(helper, /status === "fallback"[\s\S]*setRosterRevision\(\(value\) => value \+ 1\)/);
  assert.match(helper, /deviceLog\("roster_settle_refresh", \{ feature: "centre_roster", stage, count: outcome\.read \}\)/);
});
