/**
 * clients.instructorIds 를 채우는 트리거.
 *
 * Firestore 대신 최소한의 가짜를 세운다. 여기서 보려는 것은 질의가 정확한가,
 * 바뀌지 않았을 때 쓰지 않는가, 한 회원이 실패해도 나머지가 계속되는가다 --
 * 규칙이 막는지는 tests/rules 가 본다.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  clientIdsFromPassChange,
  rebuildInstructorIds,
  syncInstructorIds,
  verifyInstructorIds,
} = require("../../functions/src/instructor-scope-triggers.js");

const NOW = new Date(2026, 8, 26, 12, 0, 0);
const day = (offset) => new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);

const pass = (overrides = {}) => ({
  status: "active", remainingCount: 5, expiresAt: day(30),
  instructorId: "instructor_a", createdAt: day(-30), ...overrides,
});

/**
 * 가짜 Firestore. clients 와 passes 만 안다.
 *
 * passes 는 clientId 동등 질의와 clientIds array-contains 두 가지를 받는다 --
 * 트리거가 옛 회원권(clientIds 없음)을 놓치지 않는지 보기 위해서다.
 */
function fakeDb({ clients = {}, passes = {}, failOn = new Set() } = {}) {
  const writes = [];
  const docsOf = (map) => Object.entries(map).map(([id, data]) => ({ id, data: () => data }));
  const collection = (name) => {
    if (name === "clients") {
      return {
        doc: (id) => ({
          get: async () => {
            if (failOn.has(id)) throw Object.assign(new Error("boom"), { code: "unavailable" });
            return { exists: Object.hasOwn(clients, id), data: () => clients[id] };
          },
          set: async (patch) => { writes.push({ id, patch }); clients[id] = { ...clients[id], ...patch }; },
        }),
        orderBy: () => {
          const page = (startAfter, limit) => {
            let docs = docsOf(clients);
            if (startAfter) docs = docs.slice(docs.findIndex((item) => item.id === startAfter.id) + 1);
            const taken = docs.slice(0, limit);
            return { empty: taken.length === 0, size: taken.length, docs: taken };
          };
          const build = (startAfter, limit) => ({
            limit: (next) => build(startAfter, next),
            startAfter: (cursor) => build(cursor, limit),
            get: async () => page(startAfter, limit),
          });
          return build(null, 1000);
        },
      };
    }
    return {
      where: (field, op, value) => ({
        get: async () => ({
          docs: Object.entries(passes)
            .filter(([, data]) => (op === "=="
              ? data[field] === value
              : Array.isArray(data[field]) && data[field].includes(value)))
            .map(([id, data]) => ({ id, data: () => data })),
        }),
      }),
      doc: () => ({ collection }),
    };
  };
  return {
    writes,
    clients,
    collection: () => ({ doc: () => ({ collection }) }),
  };
}

test("회원권 변경은 전후의 회원을 모두 흔든다", () => {
  /* 듀엣에서 한 명이 빠지면 빠진 사람의 목록도 다시 세어야 한다. after 만
     보면 그 사람은 옛 담당을 그대로 달고 남는다. */
  const ids = clientIdsFromPassChange(
    { clientId: "c1", clientIds: ["c1", "c2"] },
    { clientId: "c1", clientIds: ["c1"] },
  );
  assert.deepEqual(ids.sort(), ["c1", "c2"]);
});

test("옛 회원권은 clientId 하나뿐이어도 잡힌다", () => {
  assert.deepEqual(clientIdsFromPassChange(null, { clientId: "c9" }), ["c9"]);
});

test("담당 강사를 세어 회원 문서에 쓴다", async () => {
  const db = fakeDb({
    clients: { c1: { name: "가" } },
    passes: { p1: pass({ clientId: "c1", clientIds: ["c1"], instructorId: "instructor_b" }) },
  });
  const results = await syncInstructorIds(db, { organizationId: "org", clientIds: ["c1"], now: NOW });
  assert.deepEqual(results, [{ clientId: "c1", outcome: "updated" }]);
  assert.deepEqual(db.writes, [{ id: "c1", patch: { instructorIds: ["instructor_b"] } }]);
});

test("듀엣은 두 회원 모두에게 담당이 붙는다", async () => {
  const db = fakeDb({
    clients: { c1: {}, c2: {} },
    passes: { p1: pass({ clientId: "c1", clientIds: ["c1", "c2"] }) },
  });
  await syncInstructorIds(db, { organizationId: "org", clientIds: ["c1", "c2"], now: NOW });
  assert.deepEqual(db.clients.c1.instructorIds, ["instructor_a"]);
  assert.deepEqual(db.clients.c2.instructorIds, ["instructor_a"]);
});

test("바뀌지 않았으면 쓰지 않는다", async () => {
  /* 회원 문서를 건드리면 memberViews 트리거가 함께 깨어난다. 아무것도 바뀌지
     않은 쓰기 하나가 그 뒤를 전부 불러온다. */
  const db = fakeDb({
    clients: { c1: { instructorIds: ["instructor_a"] } },
    passes: { p1: pass({ clientId: "c1", clientIds: ["c1"] }) },
  });
  const results = await syncInstructorIds(db, { organizationId: "org", clientIds: ["c1"], now: NOW });
  assert.deepEqual(results, [{ clientId: "c1", outcome: "unchanged" }]);
  assert.deepEqual(db.writes, []);
});

test("인수인계하면 이전 강사가 빠진다", async () => {
  const db = fakeDb({
    clients: { c1: { instructorIds: ["instructor_a"] } },
    passes: { p1: pass({ clientId: "c1", clientIds: ["c1"], instructorId: "instructor_b" }) },
  });
  await syncInstructorIds(db, { organizationId: "org", clientIds: ["c1"], now: NOW });
  assert.deepEqual(db.clients.c1.instructorIds, ["instructor_b"]);
});

test("만료해도 마지막 담당은 남는다", async () => {
  const db = fakeDb({
    clients: { c1: {} },
    passes: { p1: pass({ clientId: "c1", clientIds: ["c1"], remainingCount: 0, expiresAt: day(-100) }) },
  });
  await syncInstructorIds(db, { organizationId: "org", clientIds: ["c1"], now: NOW });
  assert.deepEqual(db.clients.c1.instructorIds, ["instructor_a"]);
});

test("없는 회원은 조용히 넘어간다", async () => {
  const db = fakeDb({ clients: {}, passes: {} });
  const results = await syncInstructorIds(db, { organizationId: "org", clientIds: ["gone"], now: NOW });
  assert.deepEqual(results, [{ clientId: "gone", outcome: "missing" }]);
});

test("한 회원이 실패해도 나머지는 계속한다", async () => {
  /* 회원권 하나가 두 사람을 가리키는데 앞사람에서 멈추면 뒷사람은 영영
     갱신되지 않는다. */
  const errors = [];
  const db = fakeDb({
    clients: { bad: {}, good: {} },
    passes: { p1: pass({ clientId: "good", clientIds: ["good"] }) },
    failOn: new Set(["bad"]),
  });
  const results = await syncInstructorIds(db, {
    organizationId: "org", clientIds: ["bad", "good"], now: NOW,
    log: { error: (...args) => errors.push(args) },
  });
  assert.deepEqual(results.map((item) => item.outcome), ["failed", "updated"]);
  assert.deepEqual(db.clients.good.instructorIds, ["instructor_a"]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1].errorCode, "unavailable", "원본 코드를 남긴다");
});

test("진단에 회원 id 를 남기지 않는다", async () => {
  const errors = [];
  const db = fakeDb({ clients: { secret: {} }, passes: {}, failOn: new Set(["secret"]) });
  await syncInstructorIds(db, {
    organizationId: "org", clientIds: ["secret"], now: NOW,
    log: { error: (...args) => errors.push(args) },
  });
  assert.equal(JSON.stringify(errors).includes("secret"), false);
});

test("채우기는 조직 전체를 훑고 결과를 센다", async () => {
  const db = fakeDb({
    clients: { c1: {}, c2: { instructorIds: ["instructor_a"] }, c3: {} },
    passes: {
      p1: pass({ clientId: "c1", clientIds: ["c1"] }),
      p2: pass({ clientId: "c2", clientIds: ["c2"] }),
    },
  });
  const tally = await rebuildInstructorIds(db, { organizationId: "org", now: NOW, pageSize: 2 });
  assert.equal(tally.scanned, 3);
  assert.equal(tally.updated, 1, "c1 만 바뀐다");
  assert.equal(tally.unchanged, 2, "c2 는 같고 c3 는 빈 채로 같다");
  assert.equal(tally.failed, 0);
});

test("검증은 고치지 않고 센다 — 운영중인데 빈 회원이 진짜 빠진 것이다", async () => {
  const db = fakeDb({
    clients: {
      c1: { status: "active", instructorIds: ["instructor_a"] },
      c2: { status: "active" },
      c3: { status: "ended" },
    },
    passes: {},
  });
  const tally = await verifyInstructorIds(db, { organizationId: "org" });
  assert.deepEqual(tally, {
    clients: 3, withInstructors: 1, empty: 2, emptyActive: 1,
    byInstructor: [{ instructorId: "instructor_a", clients: 1 }],
  });
  assert.deepEqual(db.writes, [], "검증은 쓰지 않는다");
});

test("검증은 강사별 담당 회원 수를 많은 순으로 센다", () => {
  /* 한 사람만 0 이면 그 사람의 회원이 빠진 것이고, 전부 0 이면 채우기가 안
     돈 것이다. 대표가 보는 순간 이상한 줄이 위에 오게 한다. */
  return (async () => {
    const db = fakeDb({
      clients: {
        c1: { status: "active", instructorIds: ["a"] },
        c2: { status: "active", instructorIds: ["a", "b"] },
        c3: { status: "active", instructorIds: ["a"] },
      },
      passes: {},
    });
    const tally = await verifyInstructorIds(db, { organizationId: "org" });
    assert.deepEqual(tally.byInstructor, [
      { instructorId: "a", clients: 3 },
      { instructorId: "b", clients: 1 },
    ]);
  })();
});

test("미리보기는 세기만 하고 쓰지 않는다", async () => {
  /* 재계산은 되돌리는 문이 없다. 대표가 숫자를 보고 누르기 전에는 아무것도
     바뀌지 않아야 한다. */
  const db = fakeDb({
    clients: { c1: {}, c2: { instructorIds: ["instructor_a"] } },
    passes: {
      p1: pass({ clientId: "c1", clientIds: ["c1"] }),
      p2: pass({ clientId: "c2", clientIds: ["c2"] }),
    },
  });
  const preview = await rebuildInstructorIds(db, { organizationId: "org", now: NOW, dryRun: true });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.scanned, 2);
  assert.equal(preview.wouldUpdate, 1);
  assert.equal(preview.updated, 0);
  assert.deepEqual(db.writes, [], "미리보기는 한 줄도 쓰지 않는다");

  const done = await rebuildInstructorIds(db, { organizationId: "org", now: NOW });
  assert.equal(done.updated, 1, "누르면 그때 바뀐다");
  assert.equal(db.writes.length, 1);
});
