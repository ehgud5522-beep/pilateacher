import assert from "node:assert/strict";
import test from "node:test";
import {
  createFirestorePassStore, issuePass, listPasses, transferPassInstructor,
} from "../../src/data/repositories/pass-repository.js";
import { RepositoryReadError, connectRepositoryLog, disconnectRepositoryLog } from "../../src/data/repositories/repository-read.js";

const ORG = "center-a";

/**
 * 배치를 흉내 낸다. commit 이 실패하면 어떤 문서도 남지 않는다 — 실제
 * writeBatch 와 같은 성질이고, 이 테스트가 확인하려는 바로 그 성질이다.
 */
function fakeStore({ documents = [], failCommit = null } = {}) {
  const written = new Map();
  const calls = { list: [], commit: [] };
  return {
    written,
    calls,
    list: async (path) => { calls.list.push(path); return documents; },
    commit: async (writes) => {
      calls.commit.push(writes);
      if (failCommit) throw failCommit;
      for (const write of writes) written.set(write.path, write);
    },
    serverTimestamp: async () => "SERVER_TIME",
  };
}

const issueInput = (overrides = {}) => ({
  clientId: "client-a",
  locationId: "bansong",
  productId: "product-a",
  payCategory: "pt_1_1_new",
  totalSessions: 20,
  contractPrice: 1300000,
  instructorId: "instructor-a",
  createdBy: "owner-a",
  ...overrides,
});

const passDoc = (overrides = {}) => ({
  id: "pass-a",
  organizationId: ORG,
  clientId: "client-a",
  purchaseRound: 1,
  status: "active",
  ...overrides,
});

/* ── 조회 ─────────────────────────────────────────────────────────────── */

test("passes are read from the organization's own collection", async () => {
  const store = fakeStore({ documents: [passDoc()] });
  await listPasses(ORG, { store });
  assert.deepEqual(store.calls.list, ["organizations/center-a/passes"]);
});

test("an organizationId is required before anything is read", async () => {
  const store = fakeStore();
  await assert.rejects(() => listPasses("", { store }), /Missing organizationId/);
  assert.equal(store.calls.list.length, 0);
});

test("a client filter keeps only that client's passes", async () => {
  const store = fakeStore({ documents: [
    passDoc({ id: "p1", clientId: "client-a" }),
    passDoc({ id: "p2", clientId: "client-b" }),
  ] });
  const found = await listPasses(ORG, { clientId: "client-a", store });
  assert.deepEqual(found.map((item) => item.id), ["p1"]);
});

test("the most recent purchase round comes first", async () => {
  const store = fakeStore({ documents: [
    passDoc({ id: "p1", purchaseRound: 1 }),
    passDoc({ id: "p3", purchaseRound: 3 }),
    passDoc({ id: "p2", purchaseRound: 2 }),
  ] });
  assert.deepEqual((await listPasses(ORG, { store })).map((item) => item.id), ["p3", "p2", "p1"]);
});

test("expired passes can be excluded when the screen asks", async () => {
  const store = fakeStore({ documents: [
    passDoc({ id: "p1", status: "active" }),
    passDoc({ id: "p2", status: "expired" }),
  ] });
  assert.deepEqual((await listPasses(ORG, { includeExpired: false, store })).map((item) => item.id), ["p1"]);
});

test("a refused read throws instead of becoming an empty list", async () => {
  const entries = [];
  connectRepositoryLog((code, detail) => entries.push({ code, detail }));
  const store = fakeStore();
  store.list = async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); };
  await assert.rejects(() => listPasses(ORG, { store }), RepositoryReadError);
  assert.equal(entries[0].code, "pass_directory_read_failed");
  assert.equal(entries[0].detail.errorCode, "permission-denied");
  disconnectRepositoryLog();
});

/* ── 발급: 두 문서는 함께 쓰인다 ───────────────────────────────────────── */

test("issuing writes the pass and its ledger entry in one commit", async () => {
  const store = fakeStore();
  await issuePass(ORG, issueInput(), { store, newId: () => "pass-new" });
  assert.equal(store.calls.commit.length, 1, "두 번 나눠 쓰면 하나만 저장되는 순간이 생긴다");
  assert.equal(store.calls.commit[0].length, 2);
  assert.deepEqual(store.calls.commit[0].map((write) => write.path), [
    "organizations/center-a/passes/pass-new",
    "organizations/center-a/passes/pass-new/ledger/pass-new_issue",
  ]);
});

test("nothing is written when the commit fails", async () => {
  /* 회원권만 남고 원장이 없으면 잔여 횟수의 근거가 없다. 원장은 append-only 라
     사후에 채워 넣을 수도 없다. */
  const failure = Object.assign(new Error("denied"), { code: "permission-denied" });
  const store = fakeStore({ failCommit: failure });
  await assert.rejects(() => issuePass(ORG, issueInput(), { store }), /denied/);
  assert.equal(store.written.size, 0, "한쪽만 남으면 안 된다");
});

test("the ledger entry counts the service sessions too", async () => {
  const store = fakeStore();
  const { pass, entry } = await issuePass(ORG, issueInput({ totalSessions: 20, serviceSessions: 2 }), { store });
  // 서비스 회차도 차감되는 수업이다. 빠지면 마지막 두 번이 근거 없이 사라진다.
  assert.equal(entry.delta, 22);
  assert.equal(pass.remainingCount, 22);
  assert.equal(pass.totalSessions, 20);
  assert.equal(pass.serviceSessions, 2);
});

test("the issue entry is stamped by the server and happens at issue time", async () => {
  const store = fakeStore();
  const { entry } = await issuePass(ORG, issueInput(), { store });
  assert.equal(entry.type, "issue");
  assert.equal(entry.createdAt, "SERVER_TIME", "규칙이 createdAt == request.time 을 요구한다");
  assert.equal(entry.occurredAt, "SERVER_TIME", "발급은 그 자리에서 일어난다");
  assert.equal(entry.lessonId, undefined, "발급은 수업을 가리키지 않는다");
});

test("the unit price comes from the table and is frozen into the entry", async () => {
  const store = fakeStore();
  const { entry } = await issuePass(ORG, issueInput({ payCategory: "pt_1_1_new" }), { store });
  assert.equal(entry.unitPrice, 25000);
  assert.equal(entry.category, "pt_1_1_new");
});

test("a category the table cannot price must be given one", async () => {
  // 물어보지 않고 0원으로 발급되면 그 달 급여가 조용히 비어 버린다.
  for (const payCategory of ["pt_1_1_repurchase_normal", "etc"]) {
    const store = fakeStore();
    await assert.rejects(() => issuePass(ORG, issueInput({ payCategory }), { store }), /Missing unitPrice/);
    assert.equal(store.calls.commit.length, 0);
    const entered = await issuePass(ORG, issueInput({ payCategory, unitPrice: 31000 }), { store });
    assert.equal(entered.entry.unitPrice, 31000);
  }
});

test("the pass and the entry agree on organization, location and instructor", async () => {
  const store = fakeStore();
  const { pass, entry } = await issuePass(ORG, issueInput(), { store });
  for (const field of ["organizationId", "locationId", "instructorId"]) {
    assert.equal(pass[field], entry[field], field);
  }
  assert.equal(entry.passId, "pass-a".replace("pass-a", entry.passId));
});

test("issuing refuses what the rules would refuse, before the round trip", async () => {
  const cases = [
    { payload: issueInput({ clientId: "" }), expected: /Missing clientId/ },
    { payload: issueInput({ locationId: "" }), expected: /Missing locationId/ },
    { payload: issueInput({ productId: "" }), expected: /Missing productId/ },
    { payload: issueInput({ instructorId: "" }), expected: /Missing instructorId/ },
    { payload: issueInput({ createdBy: "" }), expected: /Missing createdBy/ },
    { payload: issueInput({ payCategory: "" }), expected: /Missing payCategory/ },
    { payload: issueInput({ totalSessions: 0 }), expected: /Invalid totalSessions/ },
    { payload: issueInput({ serviceSessions: -1 }), expected: /Invalid serviceSessions/ },
    { payload: issueInput({ contractPrice: -1 }), expected: /Invalid contractPrice/ },
    { payload: issueInput({ purchaseRound: 0 }), expected: /Invalid purchaseRound/ },
    { payload: issueInput({ paymentMethod: "bitcoin" }), expected: /Invalid paymentMethod/ },
  ];
  for (const { payload, expected } of cases) {
    const store = fakeStore();
    await assert.rejects(() => issuePass(ORG, payload, { store }), expected);
    assert.equal(store.calls.commit.length, 0, "거부된 입력은 쓰지 않는다");
  }
});

test("a pass starts active on round one paid by card", async () => {
  const store = fakeStore();
  const { pass } = await issuePass(ORG, issueInput(), { store });
  assert.equal(pass.status, "active");
  assert.equal(pass.purchaseRound, 1);
  assert.equal(pass.paymentMethod, "card");
});

/* ── 담당 강사 교체 ───────────────────────────────────────────────────── */

test("a transfer records the move and points the pass at the new instructor", async () => {
  const store = fakeStore();
  const { entry } = await transferPassInstructor(ORG, "pass-a", {
    fromInstructorId: "instructor-a",
    toInstructorId: "instructor-b",
    locationId: "bansong",
    createdBy: "owner-a",
  }, { store, newId: () => "1" });
  assert.equal(store.calls.commit.length, 1, "이력만 남고 주인이 그대로면 둘 다 틀린 상태다");
  const [ledgerWrite, passWrite] = store.calls.commit[0];
  assert.match(ledgerWrite.path, /\/ledger\//);
  assert.equal(passWrite.path, "organizations/center-a/passes/pass-a");
  // set 이면 계약 금액도 잔여 횟수도 통째로 날아간다.
  assert.equal(passWrite.operation, "update");
  assert.deepEqual(passWrite.data, { instructorId: "instructor-b" });
  assert.equal(entry.type, "transfer");
  assert.equal(entry.delta, 0, "잔여 횟수는 그대로이고 주인만 바뀐다");
  assert.equal(entry.fromInstructorId, "instructor-a");
  assert.equal(entry.toInstructorId, "instructor-b");
});

test("a transfer entry carries no category and no unit price", async () => {
  const store = fakeStore();
  const { entry } = await transferPassInstructor(ORG, "pass-a", {
    fromInstructorId: "instructor-a",
    toInstructorId: "instructor-b",
    locationId: "bansong",
    createdBy: "owner-a",
  }, { store });
  // 자리를 채우려고 아무 값이나 넣으면 급여를 카테고리별로 묶는 계산에 섞여 든다.
  assert.equal(entry.category, undefined);
  assert.equal(entry.unitPrice, undefined);
  assert.equal(entry.lessonId, undefined);
});

test("nothing moves when the transfer commit fails", async () => {
  const store = fakeStore({ failCommit: Object.assign(new Error("denied"), { code: "permission-denied" }) });
  await assert.rejects(() => transferPassInstructor(ORG, "pass-a", {
    fromInstructorId: "instructor-a",
    toInstructorId: "instructor-b",
    locationId: "bansong",
    createdBy: "owner-a",
  }, { store }), /denied/);
  assert.equal(store.written.size, 0);
});

test("a transfer to the same instructor is refused", async () => {
  const store = fakeStore();
  await assert.rejects(() => transferPassInstructor(ORG, "pass-a", {
    fromInstructorId: "instructor-a",
    toInstructorId: "instructor-a",
    locationId: "bansong",
    createdBy: "owner-a",
  }, { store }), /Invalid toInstructorId/);
  assert.equal(store.calls.commit.length, 0);
});

test("a transfer needs both ends, a location and an author", async () => {
  const base = {
    fromInstructorId: "instructor-a",
    toInstructorId: "instructor-b",
    locationId: "bansong",
    createdBy: "owner-a",
  };
  const cases = [
    { field: "fromInstructorId", expected: /Missing fromInstructorId/ },
    { field: "toInstructorId", expected: /Missing toInstructorId/ },
    { field: "locationId", expected: /Missing locationId/ },
    { field: "createdBy", expected: /Missing createdBy/ },
  ];
  for (const { field, expected } of cases) {
    const store = fakeStore();
    await assert.rejects(
      () => transferPassInstructor(ORG, "pass-a", { ...base, [field]: "" }, { store }),
      expected,
    );
    assert.equal(store.calls.commit.length, 0);
  }
  const store = fakeStore();
  await assert.rejects(() => transferPassInstructor(ORG, "", base, { store }), /Missing passId/);
});

/* ── 주입 없이 부르면 Firestore 로 나간다 ─────────────────────────────── */

test("the Firestore store is what a caller gets when none is injected", async () => {
  const calls = [
    () => listPasses(ORG),
    () => issuePass(ORG, issueInput()),
    () => transferPassInstructor(ORG, "pass-a", {
      fromInstructorId: "a", toInstructorId: "b", locationId: "bansong", createdBy: "owner-a",
    }),
  ];
  for (const call of calls) {
    const error = await call().then(() => null, (thrown) => thrown);
    assert.ok(error, "주입 없이 부르면 Firestore 로 나가야 한다");
    assert.notEqual(error.name, "TypeError", `기본 store 가 사라졌다: ${error.message}`);
    assert.equal(error.code, "app/no-app", error.message);
  }
});

test("the Firestore store answers the whole PassStore shape", () => {
  const store = createFirestorePassStore();
  for (const method of ["list", "commit", "serverTimestamp"]) {
    assert.equal(typeof store[method], "function", `${method} 가 없으면 호출부가 죽는다`);
  }
  // 문서를 한 건씩 쓰는 입구는 두지 않는다. 있으면 언젠가 그리로 새 나간다.
  assert.equal(store.create, undefined);
  assert.equal(store.update, undefined);
});
