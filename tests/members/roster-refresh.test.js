/**
 * 센터 회원 명단의 가벼운 갱신 (2026-11-04, 1단계).
 *
 * 다른 기기(FC)가 회원을 등록하고 회원권을 발급한 뒤, 강사 폰이 새로고침 · 회원
 * 선택 시트 열기로 그 회원을 보게 되는가. 그리고 연속 갱신은 10초에 한 번인가.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ROSTER_REFRESH_MIN_MS, ROSTER_RESUME_AFTER_MS, ROSTER_SINCE_MARGIN_MS,
  lastUpdatedLabel, mergeRosterRefresh, passesSince, refreshRosterOnce,
  shouldRefreshOnResume, shouldRefreshRoster,
} from "../../src/features/roster/roster-refresh.js";
import { listPassesIssuedSince } from "../../src/data/repositories/pass-repository.js";
import { mergeRoster } from "../../src/features/roster/roster-bridge.js";

const T0 = new Date(2026, 10, 4, 9, 0, 0).getTime();

/** 센터 서버 하나. 두 기기가 같은 것을 본다. 읽은 문서 수를 센다. */
function centreServer() {
  const server = {
    clients: [{ id: "c-old", name: "기존회원", phone: "01011112222", locationId: "bansong", status: "active", instructorIds: ["u-me"] }],
    passes: [{ id: "p-old", clientId: "c-old", instructorId: "u-me", status: "active", remainingCount: 5, expiresAt: new Date(2027, 0, 1), createdAt: new Date(T0 - 86400000) }],
    reads: 0,
  };
  server.readClients = async () => {
    const mine = server.clients.filter((client) => (client.instructorIds || []).includes("u-me"));
    server.reads += mine.length;
    return mine.map((client) => ({ ...client }));
  };
  server.readPassesSince = async (since) => {
    const found = server.passes.filter((pass) => !since || pass.createdAt.getTime() >= since.getTime());
    server.reads += found.length;
    return found.map((pass) => ({ ...pass }));
  };
  return server;
}

/** FC 기기에서 등록 + 발급. 회원권 트리거가 instructorIds 를 채운 뒤의 모습이다. */
function registerOnAnotherDevice(server, at) {
  server.clients.push({ id: "c-new", name: "새회원", phone: "01033334444", locationId: "bansong", status: "active", instructorIds: ["u-me"] });
  server.passes.push({ id: "p-new", clientId: "c-new", instructorId: "u-me", status: "active", remainingCount: 10, expiresAt: new Date(2027, 2, 1), createdAt: new Date(at) });
}

const pickerNames = (current, now) => mergeRoster({ clients: current.clients, passes: current.passes, now: new Date(now) })
  .roster.filter((member) => member.orgRemaining > 0).map((member) => member.name);

test("다른 기기에서 등록한 회원이 새로고침으로 명단 · 회원 선택에 나타난다", async () => {
  const server = centreServer();
  // 앱을 연 시각의 명단.
  let current = { clients: await server.readClients(), passes: await server.readPassesSince(null) };
  let state = { lastAt: T0, loadedAt: T0 };
  assert.deepEqual(pickerNames(current, T0), ["기존회원"]);

  registerOnAnotherDevice(server, T0 + 60 * 1000);

  const result = await refreshRosterOnce({
    readClients: server.readClients, readPassesSince: server.readPassesSince,
    current, ...state, now: () => T0 + 2 * 60 * 1000,
  });
  assert.equal(result.status, "refreshed");
  current = { clients: result.clients, passes: result.passes };
  assert.deepEqual(pickerNames(current, T0 + 2 * 60 * 1000).sort(), ["기존회원", "새회원"]);
  assert.equal(current.passes.length, 2, "새 회원권이 합쳐지고 기존 것은 그대로");
  state = { lastAt: result.startedAt, loadedAt: result.startedAt };
});

test("가벼운 갱신은 회원 + 새로 발급된 회원권만 읽는다", async () => {
  const server = centreServer();
  for (let i = 0; i < 50; i += 1) {
    server.passes.push({ id: `p-${i}`, clientId: "c-other", instructorId: "u-x", status: "active", remainingCount: 1, createdAt: new Date(T0 - 7 * 86400000) });
  }
  registerOnAnotherDevice(server, T0 + 30 * 1000);
  server.reads = 0;
  const result = await refreshRosterOnce({
    readClients: server.readClients, readPassesSince: server.readPassesSince,
    current: { clients: [], passes: [] }, lastAt: T0, loadedAt: T0, now: () => T0 + 60 * 1000,
  });
  assert.equal(result.status, "refreshed");
  assert.equal(server.reads, 3, "담당 회원 2 + 새 회원권 1 -- 지난주 회원권 51장은 읽지 않는다");
  assert.equal(result.read, 3);
});

test("시트를 연속으로 열면 10초에 한 번만 읽는다", async () => {
  const server = centreServer();
  const open = (at, lastAt) => refreshRosterOnce({
    readClients: server.readClients, readPassesSince: server.readPassesSince,
    current: { clients: [], passes: [] }, lastAt, loadedAt: T0, now: () => at,
  });
  const first = await open(T0 + 20 * 1000, T0);
  assert.equal(first.status, "refreshed");
  const readsAfterFirst = server.reads;
  const second = await open(T0 + 25 * 1000, first.startedAt);
  assert.equal(second.status, "throttled");
  assert.equal(server.reads, readsAfterFirst, "간격 안에서는 읽지 않는다");
  const third = await open(first.startedAt + ROSTER_REFRESH_MIN_MS, first.startedAt);
  assert.equal(third.status, "refreshed", "10초가 지나면 다시 읽는다");
});

test("같은 순간에 두 번 불리면 둘째는 읽지 않는다 (읽는 중)", async () => {
  const server = centreServer();
  const state = { lastAt: null, inFlight: false };
  const call = () => refreshRosterOnce({
    readClients: server.readClients, readPassesSince: server.readPassesSince,
    current: { clients: [], passes: [] }, ...state, loadedAt: T0, now: () => T0 + 60 * 1000,
    onStart: (at) => { state.inFlight = true; state.lastAt = at; },
  });
  const first = call();
  const second = await call();
  assert.equal(second.status, "in_flight");
  assert.equal((await first).status, "refreshed");
});

test("읽기가 실패하면 들고 있던 명단을 그대로 돌려준다", async () => {
  const current = { clients: [{ id: "c1" }], passes: [{ id: "p1" }] };
  const result = await refreshRosterOnce({
    readClients: async () => { throw Object.assign(new Error("offline"), { code: "unavailable" }); },
    readPassesSince: async () => [],
    current, lastAt: null, loadedAt: T0, now: () => T0,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "unavailable");
  assert.deepEqual(result.clients, current.clients);
  assert.deepEqual(result.passes, current.passes);
});

test("간격 · 복귀 · 여유 시간", () => {
  assert.equal(shouldRefreshRoster({ lastAt: null, now: T0 }), true);
  assert.equal(shouldRefreshRoster({ lastAt: T0, now: T0 + 9999 }), false);
  assert.equal(shouldRefreshRoster({ lastAt: T0, now: T0 + 10000 }), true);
  assert.equal(shouldRefreshRoster({ lastAt: T0, now: T0 + 9999, force: true }), true);
  assert.equal(shouldRefreshRoster({ lastAt: null, now: T0, inFlight: true, force: true }), false);
  assert.equal(shouldRefreshOnResume({ hiddenAt: T0, now: T0 + ROSTER_RESUME_AFTER_MS - 1 }), false);
  assert.equal(shouldRefreshOnResume({ hiddenAt: T0, now: T0 + ROSTER_RESUME_AFTER_MS }), true);
  assert.equal(shouldRefreshOnResume({ hiddenAt: null, now: T0 }), false);
  assert.equal(passesSince(T0).getTime(), T0 - ROSTER_SINCE_MARGIN_MS);
  assert.equal(passesSince(null), null);
});

test("합치기: 회원은 새것으로 바꾸고(담당이 넘어간 회원은 빠진다), 회원권은 id 로 합친다", () => {
  const merged = mergeRosterRefresh(
    { passes: [{ id: "p1", remainingCount: 5 }, { id: "p2", remainingCount: 1 }] },
    { clients: [{ id: "c2" }], passes: [{ id: "p2", remainingCount: 1, instructorId: "u-new" }, { id: "p3" }] },
  );
  assert.deepEqual(merged.clients, [{ id: "c2" }]);
  assert.deepEqual(merged.passes.map((pass) => pass.id), ["p1", "p2", "p3"]);
  assert.equal(merged.passes[1].instructorId, "u-new");
});

test("마지막 갱신 문구", () => {
  assert.equal(lastUpdatedLabel(T0, T0 + 30 * 1000), "방금 갱신");
  assert.equal(lastUpdatedLabel(T0, T0 + 3 * 60 * 1000), "마지막 갱신 3분 전");
  assert.equal(lastUpdatedLabel(T0, T0 + 2 * 3600 * 1000), "마지막 갱신 2시간 전");
  assert.equal(lastUpdatedLabel(null, T0), "");
});

test("저장소: 그 시각 이후 발급분만 — 범위 조회가 없으면 전체를 읽어 거른다", async () => {
  const passes = [
    { id: "old", createdAt: new Date(T0 - 1000) },
    { id: "new", createdAt: new Date(T0 + 1000) },
  ];
  let ranged = null;
  const withRange = {
    list: async () => { throw new Error("전체 읽기를 하면 안 된다"); },
    listCreatedSince: async (path, since) => { ranged = { path, since }; return passes.filter((pass) => pass.createdAt >= since); },
  };
  assert.deepEqual((await listPassesIssuedSince("org-a", new Date(T0), { store: withRange })).map((pass) => pass.id), ["new"]);
  assert.match(ranged.path, /organizations\/org-a\/passes$/);
  const plain = { list: async () => passes };
  assert.deepEqual((await listPassesIssuedSince("org-a", new Date(T0), { store: plain })).map((pass) => pass.id), ["new"]);
  await assert.rejects(listPassesIssuedSince("org-a", null, { store: plain }), /Invalid since/);
});
