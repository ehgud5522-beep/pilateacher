/**
 * 센터 회원 명단 실시간 (2026-11-04, 2단계).
 *
 * 누가 무엇을 듣는가 · 스냅샷을 명단에 합치는 법 · 읽기 세기 · 그리고 담당을 바꾼
 * 직후 목록이 따라오는가 (가짜 Firestore 로 스냅샷을 흘려 본다).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ALL_LOCATIONS, NO_LOCATION } from "../../src/data/repositories/location-repository.js";
import { readPassesForClients, subscribeClients } from "../../src/data/repositories/client-realtime.js";
import {
  REALTIME_SCOPE, applyClientChanges, missingPassClientIds, readsOfSnapshot, removesOnLeave,
  rosterRealtimeEnabledFor, rosterRealtimeScope, shouldLogReads,
} from "../../src/features/roster/roster-realtime.js";
import { activeAssignments, instructorChips } from "../../src/features/members/instructor-groups.js";

const LOCATIONS = [{ id: "bansong" }, { id: "centum" }, { id: "yulha" }];

/* ── 누가 무엇을 듣는가 ─────────────────────────────────────────────── */

test("강사는 본인 담당 회원만 — 지점 칩과 상관없이", () => {
  for (const chip of [ALL_LOCATIONS, "bansong"]) {
    const scope = rosterRealtimeScope({ role: "instructor", userId: "u-me", locationFilter: chip, viewer: { locationId: "bansong" }, locations: LOCATIONS });
    assert.equal(scope.kind, REALTIME_SCOPE.INSTRUCTOR);
    assert.equal(scope.instructorId, "u-me");
  }
  assert.equal(rosterRealtimeScope({ role: "instructor", userId: "" }).kind, REALTIME_SCOPE.NONE, "uid 를 모르면 듣지 않는다");
});

test("FC매니저 · 매니저: 고른 지점, 전체 칩이면 맡은 지점 전부", () => {
  const fc = { role: "manager", viewer: { locationId: "bansong", locationIds: ["bansong", "yulha"] }, locations: LOCATIONS.slice(0, 1).concat(LOCATIONS[2]) };
  assert.deepEqual(rosterRealtimeScope({ ...fc, locationFilter: "yulha" }).locationIds, ["yulha"]);
  assert.deepEqual(rosterRealtimeScope({ ...fc, locationFilter: ALL_LOCATIONS }).locationIds, ["bansong", "yulha"]);
  const staff = rosterRealtimeScope({ role: "staff", viewer: { locationId: "centum" }, locations: LOCATIONS, locationFilter: ALL_LOCATIONS });
  assert.deepEqual(staff.locationIds, ["centum"]);
  assert.equal(rosterRealtimeScope({ role: "manager", viewer: {}, locations: LOCATIONS, locationFilter: ALL_LOCATIONS }).kind, REALTIME_SCOPE.NONE, "맡은 지점이 없으면 듣지 않는다");
});

test("대표 · 총괄매니저: 고른 지점만, 전체 칩이면 듣지 않는다", () => {
  for (const role of ["owner", "area_manager"]) {
    assert.deepEqual(rosterRealtimeScope({ role, locations: LOCATIONS, locationFilter: "centum" }).locationIds, ["centum"], role);
    const all = rosterRealtimeScope({ role, locations: LOCATIONS, locationFilter: ALL_LOCATIONS });
    assert.equal(all.kind, REALTIME_SCOPE.NONE, role);
    assert.equal(all.reason, "all_locations");
  }
  assert.equal(rosterRealtimeScope({ role: "owner", locations: LOCATIONS, locationFilter: NO_LOCATION }).kind, REALTIME_SCOPE.NONE);
  assert.equal(rosterRealtimeScope({ role: "owner", locations: LOCATIONS, locationFilter: "gone" }).kind, REALTIME_SCOPE.NONE, "목록에 없는 지점은 듣지 않는다");
  assert.equal(rosterRealtimeScope({ role: "member", locations: LOCATIONS, locationFilter: "centum" }).kind, REALTIME_SCOPE.NONE);
});

test("범위가 바뀌면 key 가 바뀐다 — 듣기를 끊고 다시 건다", () => {
  const a = rosterRealtimeScope({ role: "owner", locations: LOCATIONS, locationFilter: "centum" });
  const b = rosterRealtimeScope({ role: "owner", locations: LOCATIONS, locationFilter: "bansong" });
  assert.notEqual(a.key, b.key);
  assert.equal(a.key, rosterRealtimeScope({ role: "owner", locations: LOCATIONS, locationFilter: "centum" }).key);
});

test("스위치: scheduleSync 문서의 rosterRealtime 칸, 못 읽거나 없으면 꺼짐", () => {
  assert.equal(rosterRealtimeEnabledFor(null, "u1"), false);
  assert.equal(rosterRealtimeEnabledFor({ mode: "all" }, "u1"), false, "일정 동기화가 켜져도 명단 실시간은 따로");
  assert.equal(rosterRealtimeEnabledFor({ rosterRealtime: { mode: "all" } }, "u1"), true);
  assert.equal(rosterRealtimeEnabledFor({ rosterRealtime: { mode: "listed", userIds: ["u1"] } }, "u1"), true);
  assert.equal(rosterRealtimeEnabledFor({ rosterRealtime: { mode: "listed", userIds: ["u1"] } }, "u2"), false);
  assert.equal(rosterRealtimeEnabledFor({ rosterRealtime: { mode: "on" } }, "u1"), false);
});

/* ── 합치기 · 읽기 세기 ─────────────────────────────────────────────── */

test("합치기: 추가 · 수정은 넣고, 질의 밖으로 나간 회원은 강사 범위에서만 뺀다", () => {
  const current = [{ id: "c1", name: "A" }, { id: "c2", name: "B" }];
  const changes = [
    { type: "modified", doc: { id: "c1", name: "A2" } },
    { type: "added", doc: { id: "c3", name: "C" } },
    { type: "removed", doc: { id: "c2" } },
  ];
  assert.deepEqual(applyClientChanges(current, changes, { removeOnLeave: true }).map((c) => c.id), ["c1", "c3"]);
  assert.deepEqual(applyClientChanges(current, changes, { removeOnLeave: false }).map((c) => c.id), ["c1", "c2", "c3"]);
  assert.equal(applyClientChanges(current, changes, {})[0].name, "A2");
  assert.equal(removesOnLeave({ kind: REALTIME_SCOPE.INSTRUCTOR }), true);
  assert.equal(removesOnLeave({ kind: REALTIME_SCOPE.LOCATIONS }), false);
});

test("읽기 세기: 캐시는 0, 첫 스냅샷은 문서 수, 그 뒤는 바뀐 문서 수(나간 것은 빼고)", () => {
  assert.equal(readsOfSnapshot({ first: true, size: 112, changes: [] }), 112);
  assert.equal(readsOfSnapshot({ first: true, fromCache: true, size: 112 }), 0);
  assert.equal(readsOfSnapshot({ changes: [{ type: "modified" }, { type: "added" }, { type: "removed" }] }), 2);
  assert.equal(shouldLogReads(0, 15, true), true);
  assert.equal(shouldLogReads(15, 30), false);
  assert.equal(shouldLogReads(45, 52), true);
});

test("회원권을 모르는 회원만, 한 번만 묻는다 — 듀엣 짝은 이미 아는 것으로", () => {
  const passes = [{ id: "p1", clientId: "c1" }, { id: "p2", clientId: "c2", clientIds: ["c2", "c3"] }];
  const asked = new Set(["c5"]);
  assert.deepEqual(missingPassClientIds([{ id: "c1" }, { id: "c3" }, { id: "c4" }, { id: "c5" }], passes, asked), ["c4"]);
});

/* ── 가짜 Firestore 로 흘려 보기 ────────────────────────────────────── */

function fakeSdk() {
  const calls = { queries: [], listener: null, error: null, unsubscribed: 0 };
  const snapshotOf = (docs, changes, fromCache = false) => ({
    size: docs.length, metadata: { fromCache },
    docChanges: () => changes.map(([type, doc]) => ({ type, doc: { id: doc.id, data: () => { const { id, ...rest } = doc; return rest; } } })),
  });
  return {
    calls, snapshotOf,
    sdk: {
      getFirestore: () => ({}),
      collection: (_db, path) => ({ path }),
      where: (field, op, value) => ({ field, op, value }),
      query: (base, ...conditions) => { calls.queries.push({ path: base.path, conditions }); return { base, conditions }; },
      onSnapshot: (_query, next, error) => { calls.listener = next; calls.error = error; return () => { calls.unsubscribed += 1; }; },
      getDocs: async (q) => {
        const [condition] = q.conditions;
        const all = [
          { id: "p-new", clientId: "c-new" },
          { id: "p-duet", clientId: "c-x", clientIds: ["c-x", "c-new"] },
        ];
        const docs = all.filter((pass) => (condition.op === "in"
          ? condition.value.includes(pass.clientId)
          : (pass.clientIds || []).some((id) => condition.value.includes(id))));
        return { docs: docs.map((pass) => ({ id: pass.id, data: () => pass })) };
      },
    },
  };
}

test("강사: 담당이 넘어오면 나타나고, 넘어가면 사라진다 (담당 변경 직후)", async () => {
  const fake = fakeSdk();
  const scope = rosterRealtimeScope({ role: "instructor", userId: "u-me" });
  let roster = [];
  const seen = [];
  const stop = await subscribeClients("org-a", scope, {
    onChange: (snapshot) => {
      seen.push(readsOfSnapshot(snapshot));
      roster = applyClientChanges(roster, snapshot.changes, { removeOnLeave: removesOnLeave(scope) });
    },
    onError: () => {},
  }, { sdk: fake.sdk });
  assert.deepEqual(fake.calls.queries[0].conditions, [{ field: "instructorIds", op: "array-contains", value: "u-me" }]);
  assert.match(fake.calls.queries[0].path, /organizations\/org-a\/clients$/);

  // 앱을 열 때: 담당 둘.
  fake.calls.listener(fake.snapshotOf([{ id: "c1" }, { id: "c2" }], [["added", { id: "c1", name: "가" }], ["added", { id: "c2", name: "나" }]]));
  assert.deepEqual(roster.map((c) => c.id), ["c1", "c2"]);

  // 대표가 c2 의 담당을 다른 강사로 바꾸고, c3 를 나에게 넘겼다 -- 트리거가 instructorIds 를 고친다.
  fake.calls.listener(fake.snapshotOf([{ id: "c1" }, { id: "c3" }], [["removed", { id: "c2" }], ["added", { id: "c3", name: "다" }]]));
  assert.deepEqual(roster.map((c) => c.id), ["c1", "c3"]);
  assert.deepEqual(seen, [2, 1], "첫 스냅샷 2건, 그 뒤 새로 들어온 1건");

  stop();
  assert.equal(fake.calls.unsubscribed, 1);
});

test("지점: 담당 변경이 회원 문서에 닿으면 강사 묶음이 새 담당을 따른다", async () => {
  const fake = fakeSdk();
  const scope = rosterRealtimeScope({ role: "owner", locations: LOCATIONS, locationFilter: "bansong" });
  let roster = [{ id: "c-other-branch", locationId: "centum" }];
  await subscribeClients("org-a", scope, {
    onChange: (snapshot) => { roster = applyClientChanges(roster, snapshot.changes, { removeOnLeave: removesOnLeave(scope) }); },
    onError: () => {},
  }, { sdk: fake.sdk });
  assert.deepEqual(fake.calls.queries[0].conditions, [{ field: "locationId", op: "==", value: "bansong" }]);
  fake.calls.listener(fake.snapshotOf([{ id: "c1" }], [["added", { id: "c1", locationId: "bansong", instructorIds: ["u-a"] }]]));
  // 다른 지점 회원은 그대로 남는다 -- "전체" 칩에서 사라지지 않게.
  assert.deepEqual(roster.map((c) => c.id), ["c-other-branch", "c1"]);

  const now = new Date(2026, 10, 4);
  const passBefore = [{ id: "p1", clientId: "c1", instructorId: "u-a", status: "active", remainingCount: 5, expiresAt: new Date(2027, 0, 1) }];
  const passAfter = [{ ...passBefore[0], instructorId: "u-b", handedOver: true }];
  // 회원권은 담당 변경을 한 기기가 이미 고쳐 두고(1단계 갱신 · 확정 뒤 읽기), 회원 문서의 변화가 실시간으로 온다.
  fake.calls.listener(fake.snapshotOf([{ id: "c1" }], [["modified", { id: "c1", locationId: "bansong", instructorIds: ["u-b"] }]]));
  assert.deepEqual(roster.find((c) => c.id === "c1").instructorIds, ["u-b"]);
  const chips = (passes) => instructorChips(roster, activeAssignments(passes, now), []).chips.map((chip) => chip.id);
  assert.deepEqual(chips(passBefore), ["u-a"]);
  assert.deepEqual(chips(passAfter), ["u-b"]);
});

test("FC 의 '전체' 칩은 맡은 지점을 in 질의 하나로 듣는다", async () => {
  const fake = fakeSdk();
  const scope = rosterRealtimeScope({ role: "manager", viewer: { locationIds: ["yulha", "bansong"] }, locations: LOCATIONS, locationFilter: ALL_LOCATIONS });
  await subscribeClients("org-a", scope, { onChange: () => {}, onError: () => {} }, { sdk: fake.sdk });
  assert.deepEqual(fake.calls.queries[0].conditions, [{ field: "locationId", op: "in", value: ["bansong", "yulha"] }]);
});

test("꺼져 있거나 범위가 없으면 아무것도 듣지 않는다", async () => {
  const fake = fakeSdk();
  const stop = await subscribeClients("org-a", { kind: REALTIME_SCOPE.NONE }, { onChange: () => {}, onError: () => {} }, { sdk: fake.sdk });
  assert.equal(fake.calls.queries.length, 0);
  stop();
});

test("새 회원의 회원권만 골라 읽는다 — 짝 칸(듀엣)까지, 30개씩", async () => {
  const fake = fakeSdk();
  const found = await readPassesForClients("org-a", ["c-new", "c-new", ""], { sdk: fake.sdk });
  assert.deepEqual(found.map((pass) => pass.id).sort(), ["p-duet", "p-new"]);
  assert.deepEqual(fake.calls.queries.map((q) => q.conditions[0].op), ["in", "array-contains-any"]);
  assert.match(fake.calls.queries[0].path, /organizations\/org-a\/passes$/);

  const many = await (async () => {
    const f = fakeSdk();
    await readPassesForClients("org-a", Array.from({ length: 31 }, (_, i) => `c${i}`), { sdk: f.sdk });
    return f.calls.queries.length;
  })();
  assert.equal(many, 4, "31명이면 두 묶음 × 두 질의");
  assert.deepEqual(await readPassesForClients("org-a", [], { sdk: fakeSdk().sdk }), []);
});
