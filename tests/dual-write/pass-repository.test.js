import assert from "node:assert/strict";
import test from "node:test";
import {
  activeRemainingTotal, cancelPass, correctDeduction, correctionEntryId, createFirestorePassStore,
  deductPass, isCancellablePass, isCorrectableEntry, isCorrectedEntry, isDeductablePass,
  isExpiredPass, issuePass, listPassLedger, listPasses, loadClientPassHistory,
  readInstructorClientSessions, remainingCountOf, transferPassInstructor,
} from "../../src/data/repositories/pass-repository.js";
import { RepositoryReadError, connectRepositoryLog, disconnectRepositoryLog } from "../../src/data/repositories/repository-read.js";

const ORG = "center-a";

/**
 * 배치를 흉내 낸다. commit 이 실패하면 어떤 문서도 남지 않는다 — 실제
 * writeBatch 와 같은 성질이고, 이 테스트가 확인하려는 바로 그 성질이다.
 */
function fakeStore({ documents = [], failCommit = null, totals = {} } = {}) {
  const written = new Map();
  const calls = { list: [], commit: [], read: [] };
  return {
    written,
    calls,
    list: async (path) => { calls.list.push(path); return documents; },
    read: async (path) => { calls.read.push(path); return totals[path] || null; },
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
  expiresAt: new Date(2027, 2, 31),
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

test("the manual category must be given a price", async () => {
  /* 물어보지 않고 0원으로 발급되면 그 수업들이 무보수로 기록된다. 풀방금액이
     필요한 카테고리는 아래에 따로 있다 -- 막히는 이유가 다르기 때문이다. */
  const store = fakeStore();
  await assert.rejects(() => issuePass(ORG, issueInput({ payCategory: "etc" }), { store }), /Missing unitPrice/);
  assert.equal(store.calls.commit.length, 0);
  const entered = await issuePass(ORG, issueInput({ payCategory: "etc", unitPrice: 31000 }), { store });
  assert.equal(entered.entry.unitPrice, 31000);
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
    clientId: "client-a",
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
  /* 담당만 바뀌고 handedOver 가 안 서면 새 강사가 인수인계 단가(25,000)가
     아니라 기준 단가를 받는다. 규칙도 둘을 함께 요구한다. */
  assert.deepEqual(passWrite.data, { instructorId: "instructor-b", handedOver: true });
  assert.equal(entry.type, "transfer");
  assert.equal(entry.delta, 0, "잔여 횟수는 그대로이고 주인만 바뀐다");
  assert.equal(entry.fromInstructorId, "instructor-a");
  assert.equal(entry.toInstructorId, "instructor-b");
});

test("a transfer entry carries no category and no unit price", async () => {
  const store = fakeStore();
  const { entry } = await transferPassInstructor(ORG, "pass-a", {
    clientId: "client-a",
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
    clientId: "client-a",
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
    clientId: "client-a",
    fromInstructorId: "instructor-a",
    toInstructorId: "instructor-a",
    locationId: "bansong",
    createdBy: "owner-a",
  }, { store }), /Invalid toInstructorId/);
  assert.equal(store.calls.commit.length, 0);
});

test("a transfer needs both ends, a location and an author", async () => {
  const base = {
    clientId: "client-a",
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
      clientId: "client-a", fromInstructorId: "a", toInstructorId: "b", locationId: "bansong", createdBy: "owner-a",
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

/* ── 풀방금액이 필요한 카테고리 ───────────────────────────────────────── */

test("a repurchase-normal pass takes the instructor's full-room rate", async () => {
  const store = fakeStore();
  const { entry } = await issuePass(ORG, issueInput({
    payCategory: "pt_1_1_repurchase_normal", fullRoomRate: 45000,
  }), { store });
  assert.equal(entry.unitPrice, 45000);
});

test("issuing is blocked when the instructor has no full-room rate", async () => {
  /* 0 을 받아들이면 그 강사의 재등록 수업이 통째로 무보수로 기록되고, 원장은
     append-only 라 고칠 수 없다. 화면은 이 실패를 "담당 강사의 풀방금액이
     설정되지 않았습니다" 로 보여준다. */
  for (const missing of [undefined, null, "", 0, "0"]) {
    const store = fakeStore();
    await assert.rejects(() => issuePass(ORG, issueInput({
      payCategory: "pt_1_1_repurchase_normal", fullRoomRate: missing,
    }), { store }), /Missing fullRoomRate/, JSON.stringify(missing));
    assert.equal(store.calls.commit.length, 0, "막힌 발급은 아무것도 쓰지 않는다");
  }
});

test("a full-room rate cannot stand in for a typed unit price", async () => {
  const store = fakeStore();
  await assert.rejects(() => issuePass(ORG, issueInput({
    payCategory: "etc", fullRoomRate: 45000,
  }), { store }), /Missing unitPrice/);
});

test("a full-room rate never moves a fixed category at issue time", async () => {
  // pay-rates 에서 고정한 규칙이 발급 경로에서도 그대로인지.
  const store = fakeStore();
  const { entry } = await issuePass(ORG, issueInput({
    payCategory: "pt_1_1_repurchase_event", fullRoomRate: 45000,
  }), { store });
  assert.equal(entry.unitPrice, 30000, "이벤트페이는 풀방금액이 있어도 정해진 금액이다");
});

/* ── 출석 체크(차감) ──────────────────────────────────────────────────── */

const activePass = (overrides = {}) => ({
  id: "pass-a",
  passId: "pass-a",
  organizationId: ORG,
  clientId: "client-a",
  locationId: "bansong",
  category: "pt_1_1_new",
  baseUnitPrice: 25000,
  contractPrice: 1300000,
  /* 현금 계약이라 공급가액이 계약 금액과 같다. 부원장 판정만 이 값을 보고,
     카드였다면 1.1 로 나뉜 금액을 반으로 접는다. */
  paymentMethod: "cash",
  netContractPrice: 1300000,
  totalSessions: 20,
  serviceSessions: 0,
  serviceUsed: 0,
  handedOver: false,
  remainingCount: 20,
  status: "active",
  ...overrides,
});

const deductInput = (overrides = {}) => ({
  instructorId: "instructor-a",
  createdBy: "instructor-a",
  occurredAt: new Date("2026-09-17T10:00:00.000Z"),
  isDeputyDirector: false,
  ...overrides,
});

/* 판정 3 을 넘긴 상태. 누적이 20회 미만이면 카테고리가 무엇이든 신규 단가라,
   기준 단가를 확인하려면 이 강사가 이 회원을 충분히 봤어야 한다. */
const TOTALS_PATH = "organizations/center-a/instructorClientTotals/instructor-a_client-a";
const settledPair = (sessions = 40) => ({ [TOTALS_PATH]: { sessions } });

const deductOptions = (store) => ({
  store,
  newId: () => "lesson-new",
  now: () => new Date("2026-09-17T12:00:00.000Z"),
});

test("a deduction writes the lesson, the participant, the entry, the count and the total at once", async () => {
  /* 다섯 중 하나만 쓰이면 잔여가 어긋나거나, 급여가 어느 수업에서 나왔는지
     모르거나, 누적이 실제와 달라진다. 원장은 append-only 라 사후 보정도
     불가능하다. */
  const store = fakeStore();
  await deductPass(ORG, activePass(), deductInput(), deductOptions(store));
  assert.equal(store.calls.commit.length, 1);
  assert.deepEqual(store.calls.commit[0].map((write) => write.path), [
    "organizations/center-a/lessons/lesson-new",
    "organizations/center-a/lessons/lesson-new/participants/client-a",
    "organizations/center-a/passes/pass-a/ledger/lesson-new_deduct",
    "organizations/center-a/passes/pass-a",
    "organizations/center-a/instructorClientTotals/instructor-a_client-a",
  ]);
});

test("the entry points at the lesson it was taught in", async () => {
  const store = fakeStore();
  const { entry, lesson } = await deductPass(ORG, activePass(), deductInput(), deductOptions(store));
  assert.equal(entry.type, "deduct");
  assert.equal(entry.delta, -1);
  assert.equal(entry.lessonId, "lesson-new");
  assert.equal(entry.lessonId, lesson.lessonId, "원장이 없는 수업을 가리키면 안 된다");
  assert.equal(entry.instructorId, "instructor-a", "차감을 누른 강사가 그 회차의 급여를 받는다");
});

test("the base price comes from the pass, not from the table", async () => {
  /* 상품이 나중에 바뀌어도, 담당 강사의 풀방금액이 나중에 올라도, 이 회원권의
     기준값은 발급 시점에 확정된 값이다. 앞의 판정에 걸리지 않을 때 그 값이
     그대로 그 회차의 단가가 된다. */
  const store = fakeStore({ totals: settledPair() });
  const { entry } = await deductPass(
    ORG,
    activePass({ category: "pt_1_1_repurchase_normal", baseUnitPrice: 45000 }),
    deductInput(),
    deductOptions(store),
  );
  assert.equal(entry.category, "pt_1_1_repurchase_normal");
  assert.equal(entry.unitPrice, 45000);
  assert.equal(entry.rule, "base_category");
});

test("a pass without a frozen base price is refused rather than re-priced", async () => {
  for (const missing of [undefined, null, "25000", -1]) {
    const store = fakeStore({ totals: settledPair() });
    await assert.rejects(
      () => deductPass(ORG, activePass({ baseUnitPrice: missing }), deductInput(), deductOptions(store)),
      /Missing baseUnitPrice/,
      JSON.stringify(missing),
    );
    assert.equal(store.calls.commit.length, 0);
  }
});

/* ── 차감 단가 판정 (2026-09-15 확정본) ────────────────────────────────── */

test("a deduction is priced by the engine, and the entry says which rule won", async () => {
  /* 반년 뒤 "왜 이 금액이냐"에 답할 수 있어야 한다. 그때의 누적 횟수는 계속
     올라가 사라지고, 부원장 지정도 서비스 사용 수도 그 뒤로 움직인다 -- 다시
     계산할 수 없으므로 그 자리에서 적는다. */
  const cases = [
    {
      label: "누적 20회 미만이면 카테고리와 무관하게 신규 단가",
      pass: { category: "pt_2_1_repurchase", baseUnitPrice: 35000 },
      totals: { [TOTALS_PATH]: { sessions: 19 } },
      unitPrice: 25000,
      rule: "new_to_instructor",
    },
    {
      label: "인수인계받은 회원권은 횟수와 무관하게 신규 단가",
      pass: { handedOver: true, baseUnitPrice: 45000 },
      totals: settledPair(),
      unitPrice: 25000,
      rule: "handed_over",
    },
    {
      label: "부원장은 계약 금액의 5:5",
      pass: { contractPrice: 1300000, totalSessions: 20 },
      input: { isDeputyDirector: true },
      totals: settledPair(),
      unitPrice: 32500,
      rule: "deputy_director",
    },
    {
      label: "첫 서비스 회차는 센터가 낸다",
      pass: { category: "service", serviceUsed: 0, baseUnitPrice: 10000 },
      totals: settledPair(),
      unitPrice: 10000,
      rule: "base_category",
    },
    {
      label: "두 번째 서비스 회차부터는 0원이다",
      pass: { category: "service", serviceUsed: 1, baseUnitPrice: 10000 },
      totals: settledPair(),
      unitPrice: 0,
      rule: "service_already_used",
    },
  ];
  for (const item of cases) {
    const store = fakeStore({ totals: item.totals });
    const { entry } = await deductPass(
      ORG, activePass(item.pass), deductInput(item.input || {}), deductOptions(store),
    );
    assert.equal(entry.unitPrice, item.unitPrice, item.label);
    assert.equal(entry.rule, item.rule, item.label);
  }
});

test("the accumulated count is read at the moment of the deduction, not before", async () => {
  /* 화면이 열릴 때 읽어 두면 20회째에서 한 칸 뒤처지고, 그 한 회차만 신규
     단가로 굳는다. 원장은 고칠 수 없다. */
  const store = fakeStore({ totals: settledPair() });
  await deductPass(ORG, activePass(), deductInput(), deductOptions(store));
  assert.deepEqual(store.calls.read, [TOTALS_PATH]);
});

test("a deduction without an explicit deputy answer is refused", async () => {
  /* 빠뜨리면 부원장의 수업이 통째로 신규 단가로 기록된다. 조용히 false 로
     가느니 멈춘다. */
  for (const missing of [undefined, null, "false", 0]) {
    const store = fakeStore({ totals: settledPair() });
    await assert.rejects(
      () => deductPass(ORG, activePass(), deductInput({ isDeputyDirector: missing }), deductOptions(store)),
      /Missing isDeputyDirector/,
      JSON.stringify(missing),
    );
    assert.equal(store.calls.commit.length, 0);
  }
});

test("a service session moves its counter in the very same write", async () => {
  /* 차감과 카운터가 갈라져 저장되면 다음 서비스 회차가 한 번 더 급여를 받는다. */
  const store = fakeStore({ totals: settledPair() });
  await deductPass(ORG, activePass({ category: "service", baseUnitPrice: 10000 }), deductInput(), deductOptions(store));
  const passWrite = store.calls.commit[0][3];
  assert.equal(passWrite.operation, "decrement");
  assert.deepEqual(passWrite.data, { remainingCount: -1, serviceUsed: 1 });
});

test("the remaining count is spent by the server, not by a read", async () => {
  // 두 강사가 같은 순간에 눌러도 하나가 다른 하나를 덮어쓰지 않는다.
  const store = fakeStore();
  await deductPass(ORG, activePass(), deductInput(), deductOptions(store));
  const passWrite = store.calls.commit[0][3];
  assert.equal(passWrite.path, "organizations/center-a/passes/pass-a");
  assert.equal(passWrite.operation, "decrement");
  assert.deepEqual(passWrite.data, { remainingCount: -1 }, "서비스가 아닌 회차는 카운터를 건드리지 않는다");
});

test("nothing is written when the deduction commit fails", async () => {
  const store = fakeStore({ failCommit: Object.assign(new Error("denied"), { code: "permission-denied" }) });
  await assert.rejects(() => deductPass(ORG, activePass(), deductInput(), deductOptions(store)), /denied/);
  assert.equal(store.written.size, 0);
});

test("a pass with nothing left cannot be spent", async () => {
  /* 음수 잔여가 한 번 생기면 그 회원권의 기록은 영영 앞뒤가 안 맞는다 --
     원장을 고칠 수 없기 때문이다. */
  const spentCases = [
    { remainingCount: 0 },
    { remainingCount: -1 },
    { status: "expired" },
    { status: "cancelled" },
  ];
  for (const spent of spentCases) {
    const store = fakeStore();
    await assert.rejects(
      () => deductPass(ORG, activePass(spent), deductInput(), deductOptions(store)),
      /Missing remainingCount/,
      JSON.stringify(spent),
    );
    assert.equal(store.calls.commit.length, 0);
  }
});

test("a lesson time in the future or long past is refused", async () => {
  // 강사가 그날 밤에 몰아 누르는 것은 허용하고, 지난달 소급은 막는다.
  const refused = [
    { at: new Date("2026-09-17T13:00:00.000Z"), label: "미래" },
    { at: new Date("2026-09-09T12:00:00.000Z"), label: "8일 전" },
    { at: "그저께", label: "날짜가 아님" },
  ];
  for (const item of refused) {
    const store = fakeStore();
    await assert.rejects(
      () => deductPass(ORG, activePass(), deductInput({ occurredAt: item.at }), deductOptions(store)),
      /Invalid occurredAt/,
      item.label,
    );
    assert.equal(store.calls.commit.length, 0);
  }
});

test("a lesson inside the window is accepted", async () => {
  const store = fakeStore();
  await deductPass(
    ORG,
    activePass(),
    deductInput({ occurredAt: new Date("2026-09-11T12:00:00.000Z") }),
    deductOptions(store),
  );
  assert.equal(store.calls.commit.length, 1, "6일 전 수업은 아직 입력할 수 있다");
});

test("a deduction needs a pass, a client, a location, an instructor and an author", async () => {
  const brokenPasses = [
    { pass: activePass({ id: "", passId: "" }), expected: /Missing passId/ },
    { pass: activePass({ clientId: "" }), expected: /Missing clientId/ },
    { pass: activePass({ locationId: "" }), expected: /Missing locationId/ },
  ];
  for (const { pass, expected } of brokenPasses) {
    const store = fakeStore();
    await assert.rejects(() => deductPass(ORG, pass, deductInput(), deductOptions(store)), expected);
    assert.equal(store.calls.commit.length, 0);
  }
  for (const field of ["instructorId", "createdBy"]) {
    const store = fakeStore();
    await assert.rejects(
      () => deductPass(ORG, activePass(), deductInput({ [field]: "" }), deductOptions(store)),
      new RegExp(`Missing ${field}`),
    );
    assert.equal(store.calls.commit.length, 0);
  }
});

test("a screen can tell which passes are spendable", () => {
  assert.equal(isDeductablePass(activePass()), true);
  assert.equal(isDeductablePass(activePass({ remainingCount: 0 })), false);
  assert.equal(isDeductablePass(activePass({ status: "expired" })), false);
  assert.equal(isDeductablePass(undefined), false);
  assert.equal(remainingCountOf(activePass({ remainingCount: 7 })), 7);
  assert.equal(remainingCountOf(activePass({ remainingCount: "7" })), 0, "문자열은 횟수가 아니다");
  assert.equal(remainingCountOf(undefined), 0);
});

test("an issued pass carries the base a later deduction will read", async () => {
  const store = fakeStore();
  const { pass } = await issuePass(ORG, issueInput(), { store });
  assert.equal(pass.baseUnitPrice, 25000);
  assert.equal(pass.serviceUsed, 0, "서비스 카운터는 0 에서 시작한다");
  // 발급이 만든 회원권을 그대로 차감할 수 있어야 한다.
  const deductStore = fakeStore({ totals: settledPair() });
  await deductPass(ORG, { ...pass, id: "pass-a" }, deductInput(), deductOptions(deductStore));
  assert.equal(deductStore.calls.commit[0][2].data.unitPrice, 25000);
});

/* ── 회원 한 명의 회원권과 이력 ────────────────────────────────────────── */

const historyStore = ({ passes = [], ledgers = {}, failPassIds = [] } = {}) => {
  const calls = [];
  return {
    calls,
    list: async (path) => {
      calls.push(path);
      if (path.endsWith("/passes")) return passes;
      const passId = /\/passes\/([^/]+)\/ledger$/.exec(path)?.[1] || "";
      if (failPassIds.includes(passId)) {
        throw Object.assign(new Error("denied"), { code: "permission-denied" });
      }
      return ledgers[passId] || [];
    },
    read: async () => null,
    commit: async () => {},
    serverTimestamp: async () => "SERVER_TIME",
  };
};

const ledgerEntry = (overrides = {}) => ({
  id: "entry-1",
  organizationId: ORG,
  passId: "pass-a",
  type: "deduct",
  delta: -1,
  category: "pt_1_1_new",
  unitPrice: 25000,
  instructorId: "instructor-a",
  occurredAt: new Date(2026, 8, 10, 10, 0, 0),
  ...overrides,
});

test("a ledger is read from its own pass, not across the centre", async () => {
  /* 원장 항목은 clientId 를 들고 있지 않다. 회원 기준 그룹 쿼리는 인덱스를
     더해서 되는 일이 아니라 append-only 기록에 필드를 더해야 하는 일이다. */
  const store = historyStore({ passes: [activePass({ id: "pass-a" })] });
  await loadClientPassHistory(ORG, "client-a", { store });
  assert.deepEqual(store.calls, [
    "organizations/center-a/passes",
    "organizations/center-a/passes/pass-a/ledger",
  ]);
});

test("only this client's passes are read", async () => {
  const store = historyStore({
    passes: [activePass({ id: "pass-a" }), activePass({ id: "pass-b", clientId: "client-b" })],
  });
  const history = await loadClientPassHistory(ORG, "client-a", { store });
  assert.deepEqual(history.passes.map((item) => item.id), ["pass-a"]);
  assert.equal(store.calls.filter((path) => path.endsWith("/ledger")).length, 1);
});

test("the remaining total counts only passes that can still be used", async () => {
  /* 종료된 회원권에 숫자가 남아 있어도 그것으로 수업할 수 없다. 더하면 화면이
     실제보다 많이 남았다고 말하게 되고, 분쟁 중에 그 숫자가 근거가 된다. */
  const store = historyStore({
    passes: [
      activePass({ id: "p1", remainingCount: 8 }),
      activePass({ id: "p2", remainingCount: 3 }),
      activePass({ id: "p3", remainingCount: 5, status: "expired" }),
      activePass({ id: "p4", remainingCount: 9, status: "cancelled" }),
    ],
  });
  const history = await loadClientPassHistory(ORG, "client-a", { store });
  assert.equal(history.remainingTotal, 11);
  // 종료된 회원권도 목록에는 남는다 -- 흐리게 보여줄 뿐이다.
  assert.equal(history.passes.length, 4);
});

test("a remaining total of a broken count is zero, not NaN", () => {
  assert.equal(activeRemainingTotal([activePass({ remainingCount: "8" })]), 0);
  assert.equal(activeRemainingTotal([]), 0);
  assert.equal(activeRemainingTotal(undefined), 0);
});

test("the history is newest first", async () => {
  const store = historyStore({
    passes: [activePass({ id: "pass-a" })],
    ledgers: {
      "pass-a": [
        ledgerEntry({ id: "mid", occurredAt: new Date(2026, 8, 10, 10, 0, 0) }),
        ledgerEntry({ id: "newest", occurredAt: new Date(2026, 8, 17, 19, 0, 0) }),
        ledgerEntry({ id: "oldest", occurredAt: new Date(2026, 8, 1, 9, 0, 0) }),
      ],
    },
  });
  const history = await loadClientPassHistory(ORG, "client-a", { store });
  assert.deepEqual(history.entries.map((item) => item.id), ["newest", "mid", "oldest"]);
});

test("issue, deduct and transfer all appear together", async () => {
  const store = historyStore({
    passes: [activePass({ id: "pass-a" })],
    ledgers: {
      "pass-a": [
        ledgerEntry({ id: "issued", type: "issue", delta: 20, occurredAt: new Date(2026, 8, 1, 9, 0, 0) }),
        ledgerEntry({ id: "spent", type: "deduct", delta: -1, occurredAt: new Date(2026, 8, 5, 9, 0, 0) }),
        ledgerEntry({
          id: "moved", type: "transfer", delta: 0,
          clientId: "client-a",
    fromInstructorId: "instructor-a", toInstructorId: "instructor-b",
          occurredAt: new Date(2026, 8, 9, 9, 0, 0),
        }),
      ],
    },
  });
  const history = await loadClientPassHistory(ORG, "client-a", { store });
  assert.deepEqual(history.entries.map((item) => item.type), ["transfer", "deduct", "issue"]);
  const moved = history.entries.find((item) => item.type === "transfer");
  assert.equal(moved.fromInstructorId, "instructor-a");
  assert.equal(moved.toInstructorId, "instructor-b");
});

test("entries from several passes are merged into one timeline", async () => {
  const store = historyStore({
    passes: [activePass({ id: "p2", purchaseRound: 2 }), activePass({ id: "p1", purchaseRound: 1 })],
    ledgers: {
      p1: [ledgerEntry({ id: "round1", passId: "p1", occurredAt: new Date(2026, 7, 20, 9, 0, 0) })],
      p2: [ledgerEntry({ id: "round2", passId: "p2", occurredAt: new Date(2026, 8, 12, 9, 0, 0) })],
    },
  });
  const history = await loadClientPassHistory(ORG, "client-a", { store });
  assert.deepEqual(history.entries.map((item) => item.id), ["round2", "round1"]);
});

test("an entry carries the pass it belongs to even when the field is missing", async () => {
  // 화면이 어느 회원권의 이력인지 말할 수 있어야 한다.
  const store = historyStore({
    passes: [activePass({ id: "pass-a" })],
    ledgers: { "pass-a": [{ id: "bare", type: "deduct", delta: -1, occurredAt: new Date(2026, 8, 5) }] },
  });
  const history = await loadClientPassHistory(ORG, "client-a", { store });
  assert.equal(history.entries[0].passId, "pass-a");
});

test("one unreadable ledger does not empty the whole screen", async () => {
  /* 분쟁 중에 화면이 통째로 비는 것보다 "이 회원권의 이력을 못 읽었다"가 낫다. */
  const store = historyStore({
    passes: [activePass({ id: "p1" }), activePass({ id: "p2" })],
    ledgers: { p1: [ledgerEntry({ id: "readable", passId: "p1" })] },
    failPassIds: ["p2"],
  });
  const history = await loadClientPassHistory(ORG, "client-a", { store });
  assert.deepEqual(history.entries.map((item) => item.id), ["readable"]);
  assert.deepEqual(history.failedPassIds, ["p2"]);
  assert.equal(history.remainingTotal, 40, "회원권 자체는 읽혔으므로 잔여는 맞다");
});

test("a failed pass list is a failure, not an empty client", async () => {
  // 회원권 목록을 못 읽으면 "회원권이 없다"로 보이면 안 된다.
  const store = historyStore();
  store.list = async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); };
  await assert.rejects(() => loadClientPassHistory(ORG, "client-a", { store }), RepositoryReadError);
});

test("a client with nothing yet is empty, not broken", async () => {
  const store = historyStore({ passes: [] });
  const history = await loadClientPassHistory(ORG, "client-a", { store });
  assert.deepEqual(history.passes, []);
  assert.deepEqual(history.entries, []);
  assert.deepEqual(history.failedPassIds, []);
  assert.equal(history.remainingTotal, 0);
});

test("an organization and a client are required before anything is read", async () => {
  const store = historyStore();
  await assert.rejects(() => loadClientPassHistory("", "client-a", { store }), /Missing organizationId/);
  await assert.rejects(() => loadClientPassHistory(ORG, "", { store }), /Missing clientId/);
  assert.equal(store.calls.length, 0);
});

test("reading one pass ledger needs both ids", async () => {
  const store = historyStore();
  await assert.rejects(() => listPassLedger("", "pass-a", { store }), /Missing organizationId/);
  await assert.rejects(() => listPassLedger(ORG, "", { store }), /Missing passId/);
  assert.equal(store.calls.length, 0);
});

test("a refused ledger read is recorded with its own feature name", async () => {
  const entries = [];
  connectRepositoryLog((code, detail) => entries.push({ code, detail }));
  const store = historyStore({ failPassIds: ["pass-a"] });
  await assert.rejects(() => listPassLedger(ORG, "pass-a", { store }), RepositoryReadError);
  assert.equal(entries[0].code, "pass_ledger_read_failed");
  assert.equal(entries[0].detail.errorCode, "permission-denied");
  assert.equal(entries[0].detail.path, "organizations/center-a/passes/pass-a/ledger");
  disconnectRepositoryLog();
});

/* ── 만료일 ────────────────────────────────────────────────────────────── */

const MARCH = new Date(2027, 2, 1);
const APRIL = new Date(2027, 3, 1);

test("an issued pass carries the expiry from the contract", async () => {
  const store = fakeStore();
  const { pass } = await issuePass(ORG, issueInput(), { store });
  assert.equal(pass.expiresAt.getTime(), new Date(2027, 2, 31).getTime());
});

test("an unreadable or missing expiry is refused at issue", async () => {
  // 회원이 가장 자주 묻는 값이라 지어내지 않는다.
  for (const bad of [undefined, null, "", "언젠가"]) {
    const store = fakeStore();
    await assert.rejects(
      () => issuePass(ORG, issueInput({ expiresAt: bad }), { store }),
      /Invalid expiresAt/,
      JSON.stringify(bad),
    );
    assert.equal(store.calls.commit.length, 0);
  }
});

test("an expiry in the past makes a pass unusable even while it says active", () => {
  /* status 는 사람이나 배치가 바꿔 주기 전까지 active 로 남는다. 날짜만 지나고
     status 가 그대로인 회원권이 반드시 생긴다. */
  const pass = activePass({ expiresAt: new Date(2027, 2, 31), remainingCount: 8 });
  assert.equal(isExpiredPass(pass, MARCH), false);
  assert.equal(isExpiredPass(pass, APRIL), true);
  assert.equal(isDeductablePass(pass, MARCH), true);
  assert.equal(isDeductablePass(pass, APRIL), false);
});

test("a pass without an expiry never expires", () => {
  // 이 필드가 생기기 전에 발급된 건을 하루아침에 못 쓰게 만들 수는 없다.
  for (const missing of [undefined, null, ""]) {
    const pass = activePass({ expiresAt: missing });
    assert.equal(isExpiredPass(pass, APRIL), false, JSON.stringify(missing));
    assert.equal(isDeductablePass(pass, APRIL), true, JSON.stringify(missing));
  }
  assert.equal(isExpiredPass(activePass({ expiresAt: "망가진 값" }), APRIL), false);
});

test("expired sessions are not counted as remaining", async () => {
  /* 더하면 화면이 쓸 수 없는 회차를 "남았다"고 말한다 -- 분쟁 때 여는 화면이라
     그 숫자가 곧 근거가 된다. */
  const passes = [
    activePass({ id: "p1", remainingCount: 8, expiresAt: new Date(2027, 2, 31) }),
    activePass({ id: "p2", remainingCount: 5, expiresAt: new Date(2027, 2, 15) }),
    activePass({ id: "p3", remainingCount: 3 }),
  ];
  assert.equal(activeRemainingTotal(passes, MARCH), 16, "3월에는 셋 다 살아 있다");
  assert.equal(activeRemainingTotal(passes, APRIL), 3, "4월에는 만료되지 않은 것만");
});

test("an expired pass still appears in the history, only unusable", async () => {
  // 목록에서 사라지면 회원이 "내가 산 게 어디 갔냐"고 묻게 된다.
  const store = historyStore({
    passes: [activePass({ id: "p1", remainingCount: 5, expiresAt: new Date(2027, 1, 28) })],
  });
  const history = await loadClientPassHistory(ORG, "client-a", { store, now: () => APRIL });
  assert.equal(history.passes.length, 1);
  assert.equal(history.remainingTotal, 0);
});

/* ── 원장 항목이 누구의 것인지 말한다 ─────────────────────────────────── */

test("every ledger entry names the client it belongs to", async () => {
  /* 원장은 append-only 다. 지금 넣지 않으면 이미 쌓인 항목에는 영영 없고,
     회원 단위 집계가 필요해지는 날 그 구멍을 메울 방법이 없다. */
  const issueStore = fakeStore();
  const issued = await issuePass(ORG, issueInput(), { store: issueStore });
  assert.equal(issued.entry.clientId, "client-a");

  const deductStore = fakeStore();
  const deducted = await deductPass(ORG, activePass(), deductInput(), deductOptions(deductStore));
  assert.equal(deducted.entry.clientId, "client-a");

  const transferStore = fakeStore();
  const moved = await transferPassInstructor(ORG, "pass-a", {
    clientId: "client-a",
    fromInstructorId: "instructor-a",
    toInstructorId: "instructor-b",
    locationId: "bansong",
    createdBy: "owner-a",
  }, { store: transferStore });
  assert.equal(moved.entry.clientId, "client-a");
});

test("a transfer needs the client it is about", async () => {
  const store = fakeStore();
  await assert.rejects(() => transferPassInstructor(ORG, "pass-a", {
    clientId: "",
    fromInstructorId: "instructor-a",
    toInstructorId: "instructor-b",
    locationId: "bansong",
    createdBy: "owner-a",
  }, { store }), /Missing clientId/);
  assert.equal(store.calls.commit.length, 0);
});

/* ── 강사-회원 누적 ───────────────────────────────────────────────────── */

const totalPath = "organizations/center-a/instructorClientTotals/instructor-a_client-a";

test("a deduction bumps the pair that taught it", async () => {
  /* 급여 판정이 이 숫자를 보고 신규 단가인지 기준 단가인지 가른다. 차감과
     같은 배치라 둘이 어긋날 수 없다. */
  const store = fakeStore();
  await deductPass(ORG, activePass(), deductInput(), deductOptions(store));
  const bump = store.calls.commit[0][4];
  assert.equal(bump.path, totalPath);
  assert.equal(bump.operation, "bump", "없으면 만들고 있으면 더한다");
  assert.deepEqual(bump.data, {
    organizationId: ORG,
    instructorId: "instructor-a",
    clientId: "client-a",
    delta: { sessions: 1 },
  });
});

test("the pair is the instructor who taught, not the one the pass belongs to", async () => {
  // 대타로 들어간 수업은 그날 가르친 사람의 누적으로 쌓인다.
  const store = fakeStore();
  await deductPass(
    ORG,
    activePass({ instructorId: "instructor-b" }),
    deductInput({ instructorId: "instructor-a" }),
    deductOptions(store),
  );
  assert.equal(store.calls.commit[0][4].path, totalPath);
});

test("nothing is bumped when the deduction fails", async () => {
  const store = fakeStore({ failCommit: Object.assign(new Error("denied"), { code: "permission-denied" }) });
  await assert.rejects(() => deductPass(ORG, activePass(), deductInput(), deductOptions(store)), /denied/);
  assert.equal(store.written.size, 0);
});

test("a pair that has never met reads as zero", async () => {
  const store = fakeStore();
  assert.equal(await readInstructorClientSessions(ORG, "instructor-a", "client-a", { store }), 0);
  assert.deepEqual(store.calls.read, [totalPath]);
});

test("an existing pair reads its count", async () => {
  const store = fakeStore({ totals: { [totalPath]: { sessions: 19 } } });
  assert.equal(await readInstructorClientSessions(ORG, "instructor-a", "client-a", { store }), 19);
});

test("a broken count reads as zero rather than as a number it is not", async () => {
  for (const broken of [{ sessions: "19" }, { sessions: -1 }, { sessions: 1.5 }, {}]) {
    const store = fakeStore({ totals: { [totalPath]: broken } });
    assert.equal(
      await readInstructorClientSessions(ORG, "instructor-a", "client-a", { store }),
      0,
      JSON.stringify(broken),
    );
  }
});

test("a refused read throws instead of reading as a fresh pair", async () => {
  /* 조용히 0 으로 떨어지면 20회를 넘긴 강사가 신규 단가를 받고, 그 값이
     원장에 박혀 고칠 수 없게 된다. */
  const store = fakeStore();
  store.read = async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); };
  const error = await readInstructorClientSessions(ORG, "instructor-a", "client-a", { store })
    .then(() => null, (thrown) => thrown);
  assert.ok(error instanceof RepositoryReadError);
  assert.equal(error.code, "permission-denied");
  assert.equal(error.feature, "instructor_client_totals");
});

test("reading a pair needs all three ids", async () => {
  const store = fakeStore();
  await assert.rejects(() => readInstructorClientSessions("", "i", "c", { store }), /Missing organizationId/);
  await assert.rejects(() => readInstructorClientSessions(ORG, "", "c", { store }), /Missing instructorId/);
  await assert.rejects(() => readInstructorClientSessions(ORG, "i", "", { store }), /Missing clientId/);
  assert.equal(store.calls.read.length, 0);
});

test("an issued pass has not been handed over yet", async () => {
  const store = fakeStore();
  const { pass } = await issuePass(ORG, issueInput(), { store });
  assert.equal(pass.handedOver, false, "발급 시점에는 아직 아무도 넘겨받지 않았다");
});

/* ── 되돌리기 ───────────────────────────────────────────────────────────

   원장은 append-only 다. 지우는 대신 반대 항목을 더하고, 원래 항목은 그대로
   남는다 -- "고쳤다"가 아니라 "고친 기록이 있다"가 되어야 한다. */

const deductEntry = (overrides = {}) => ({
  id: "lesson-old_deduct",
  organizationId: ORG,
  passId: "pass-a",
  clientId: "client-a",
  locationId: "bansong",
  type: "deduct",
  delta: -1,
  category: "pt_1_1_new",
  unitPrice: 25000,
  lessonId: "lesson-old",
  instructorId: "instructor-a",
  occurredAt: new Date("2026-09-16T10:00:00.000Z"),
  ...overrides,
});

const correctInput = (overrides = {}) => ({
  reason: "강사가 다른 회원을 눌렀습니다",
  createdBy: "owner-a",
  ...overrides,
});

test("a correction is added, and the original stays where it is", async () => {
  const store = fakeStore();
  const { entry, entryId } = await correctDeduction(ORG, activePass(), deductEntry(), correctInput(), { store });
  assert.equal(entryId, "lesson-old_deduct_correction");
  assert.equal(entry.type, "correction");
  assert.equal(entry.delta, 1);
  assert.equal(entry.correctsEntryId, "lesson-old_deduct");
  // 되돌리는 항목만 쓴다. 원래 항목을 건드리는 쓰기는 하나도 없다.
  const written = store.calls.commit[0].map((write) => write.path);
  assert.ok(!written.includes("organizations/center-a/passes/pass-a/ledger/lesson-old_deduct"));
});

test("the correction carries the price the deduction was recorded at", async () => {
  /* 표를 다시 읽으면 그 사이 바뀐 단가로 빼게 되고 차액이 남는다. 급여는 원장을
     더해서 나오므로 같은 값이어야 그 회차가 정확히 상쇄된다. */
  const store = fakeStore();
  const { entry } = await correctDeduction(
    ORG, activePass(), deductEntry({ unitPrice: 45000, category: "pt_1_1_repurchase_normal" }),
    correctInput(), { store },
  );
  assert.equal(entry.unitPrice, 45000);
  assert.equal(entry.category, "pt_1_1_repurchase_normal");
  // 급여에서 빠지는 쪽은 되돌린 사람이 아니라 그 수업을 한 강사다.
  assert.equal(entry.instructorId, "instructor-a");
  assert.equal(entry.createdBy, "owner-a");
});

test("a correction gives the session back and takes the count back down", async () => {
  const store = fakeStore();
  await correctDeduction(ORG, activePass(), deductEntry(), correctInput(), { store });
  const [, passWrite, totalWrite] = store.calls.commit[0];
  assert.equal(passWrite.operation, "decrement");
  assert.deepEqual(passWrite.data, { remainingCount: 1 });
  /* 누적을 되돌리지 않으면 있지도 않은 수업이 남아 20회째가 앞당겨지고, 그
     회원의 다음 회차부터 단가가 조용히 달라진다. */
  assert.equal(totalWrite.operation, "bump");
  assert.deepEqual(totalWrite.data.delta, { sessions: -1 });
  assert.equal(totalWrite.path, "organizations/center-a/instructorClientTotals/instructor-a_client-a");
});

test("correcting a service session gives the centre's one paid session back", async () => {
  /* 되돌리지 않으면 센터가 내주기로 한 1회분이 실수 하나로 사라지고, 회원의
     다음 서비스 수업이 강사 봉사가 된다. */
  const store = fakeStore();
  await correctDeduction(
    ORG, activePass({ category: "service", serviceUsed: 1 }),
    deductEntry({ category: "service", unitPrice: 10000 }), correctInput(), { store },
  );
  assert.deepEqual(store.calls.commit[0][1].data, { remainingCount: 1, serviceUsed: -1 });
});

test("the service counter never goes below zero", async () => {
  // 이 필드가 없던 옛 회원권이 있다. 되돌릴 것이 없으면 건드리지 않는다.
  const store = fakeStore();
  await correctDeduction(
    ORG, activePass({ category: "service", serviceUsed: 0 }),
    deductEntry({ category: "service", unitPrice: 10000 }), correctInput(), { store },
  );
  assert.deepEqual(store.calls.commit[0][1].data, { remainingCount: 1 });
});

test("the same deduction cannot be corrected twice", () => {
  /* 문서 id 가 <원래항목>_correction 이라 두 번째 보정은 같은 자리로 가고, 원장의
     update 금지가 막는다. 세지 않고 구조로 막는 것이라 놓칠 수가 없다. */
  assert.equal(correctionEntryId("lesson-old_deduct"), "lesson-old_deduct_correction");
  const entries = [deductEntry(), { id: "x", type: "correction", correctsEntryId: "lesson-old_deduct" }];
  assert.equal(isCorrectedEntry(deductEntry(), entries), true);
  assert.equal(isCorrectableEntry(deductEntry(), entries), false, "화면도 버튼을 잠근다");
  assert.equal(isCorrectableEntry(deductEntry(), [deductEntry()]), true);
});

test("only a deduction can be corrected", async () => {
  const store = fakeStore();
  for (const type of ["issue", "transfer", "correction", "cancel"]) {
    await assert.rejects(
      () => correctDeduction(ORG, activePass(), deductEntry({ type }), correctInput(), { store }),
      /Invalid entry/,
      type,
    );
  }
  assert.equal(store.calls.commit.length, 0);
});

test("a correction without a reason is refused", async () => {
  /* 반년 뒤 이 줄을 보는 사람에게 "왜 되돌렸나"가 없으면, 되돌린 것 자체가
     실수인지 아닌지 알 수 없다. */
  const store = fakeStore();
  for (const blank of ["", "   ", null, undefined]) {
    await assert.rejects(
      () => correctDeduction(ORG, activePass(), deductEntry(), correctInput({ reason: blank }), { store }),
      /Missing reason/,
      JSON.stringify(blank),
    );
  }
  await assert.rejects(
    () => correctDeduction(ORG, activePass(), deductEntry(), correctInput({ reason: "가".repeat(201) }), { store }),
    /Invalid reason/,
  );
  assert.equal(store.calls.commit.length, 0);
});

/* ── 발급 취소 ─────────────────────────────────────────────────────────── */

test("a pass with no deductions is cancelled and its remaining sessions collected", async () => {
  const store = fakeStore();
  const { entry } = await cancelPass(ORG, activePass({ remainingCount: 20 }), {
    reason: "회원이 당일 취소를 요청했습니다", createdBy: "owner-a", entries: [],
  }, { store });
  assert.equal(entry.type, "cancel");
  assert.equal(entry.delta, -20, "원장의 합과 잔여 횟수가 어긋나면 안 된다");
  assert.ok(!("category" in entry), "취소는 돈이 오가지 않는다");
  assert.ok(!("unitPrice" in entry));
  const passWrite = store.calls.commit[0][1];
  assert.equal(passWrite.operation, "update");
  assert.deepEqual(passWrite.data, { status: "cancelled", remainingCount: 0 });
});

test("a pass that has already been taught cannot be cancelled", async () => {
  /* 그 수업은 실제로 일어났다. 없던 일로 만들면 그 회차의 급여도 함께 사라진다. */
  const store = fakeStore();
  await assert.rejects(() => cancelPass(ORG, activePass(), {
    reason: "잘못 발급", createdBy: "owner-a", entries: [deductEntry()],
  }, { store }), /Invalid entries/);
  assert.equal(store.calls.commit.length, 0);
});

test("once every deduction is corrected, the pass can be cancelled", async () => {
  const entries = [
    deductEntry(),
    { id: "c", type: "correction", passId: "pass-a", correctsEntryId: "lesson-old_deduct" },
  ];
  assert.equal(isCancellablePass(activePass(), [deductEntry()]), false);
  assert.equal(isCancellablePass(activePass(), entries), true);
  // 이미 취소되거나 끝난 회원권은 다시 취소하지 않는다.
  assert.equal(isCancellablePass(activePass({ status: "cancelled" }), []), false);

  const store = fakeStore();
  await cancelPass(ORG, activePass(), { reason: "잘못 발급", createdBy: "owner-a", entries }, { store });
  assert.equal(store.calls.commit.length, 1);
});

test("a cancellation without a reason is refused", async () => {
  const store = fakeStore();
  await assert.rejects(() => cancelPass(ORG, activePass(), {
    reason: "  ", createdBy: "owner-a", entries: [],
  }, { store }), /Missing reason/);
  assert.equal(store.calls.commit.length, 0);
});

/* ── 서비스 회차를 먼저 쓴다 ────────────────────────────────────────────────

   회원권 하나가 결제 회차와 서비스 회차를 함께 들고 있고 잔여는 둘을 합친 숫자
   하나다. 어느 쪽을 먼저 쓸지는 순서로만 정해지고, 서비스가 먼저다 -- 강사가
   중도 퇴사하면 남은 서비스는 쓰이지 못하고 사라지기 때문이다. */

const withService = (overrides = {}) => activePass({
  category: "pt_1_1_repurchase_event",
  baseUnitPrice: 30000,
  serviceSessions: 1,
  serviceUsed: 0,
  ...overrides,
});

test("a pass with a service session spends that one first", async () => {
  const store = fakeStore({ totals: settledPair() });
  const { entry } = await deductPass(ORG, withService(), deductInput(), deductOptions(store));
  /* 회원권은 pt_1_1_repurchase_event 인데 이 회차는 서비스다. 급여가 카테고리별로
     묶이므로, 결제 카테고리로 적으면 10,000 이 1:1 매출로 세어진다. */
  assert.equal(entry.category, "service");
  assert.equal(entry.unitPrice, 10000, "회원권의 30,000 이 아니라 서비스 금액이다");
  const passWrite = store.calls.commit[0][3];
  assert.deepEqual(passWrite.data, { remainingCount: -1, serviceUsed: 1 });
});

test("once the service session is gone the pass is priced as what it was sold as", async () => {
  const store = fakeStore({ totals: settledPair() });
  const { entry } = await deductPass(
    ORG, withService({ serviceUsed: 1 }), deductInput(), deductOptions(store),
  );
  assert.equal(entry.category, "pt_1_1_repurchase_event");
  assert.equal(entry.unitPrice, 30000);
  assert.equal(entry.rule, "base_category");
  const passWrite = store.calls.commit[0][3];
  assert.deepEqual(passWrite.data, { remainingCount: -1 }, "서비스 카운터는 움직이지 않는다");
});

test("the second service session of a pass is the instructor's own", async () => {
  /* 센터가 내는 것은 회원권당 1회분뿐이다. 두 번째부터는 잔여만 줄고 급여는 0 이다. */
  const store = fakeStore({ totals: settledPair() });
  const { entry } = await deductPass(
    ORG, withService({ serviceSessions: 2, serviceUsed: 1 }), deductInput(), deductOptions(store),
  );
  assert.equal(entry.category, "service");
  assert.equal(entry.unitPrice, 0);
  assert.equal(entry.rule, "service_already_used");
});

test("a service session does not escape the judgements that come before the table", async () => {
  /* 확정본의 판정 순서는 그대로다. 이 강사에게 이 회원이 아직 20회 미만이면
     서비스 회차라도 25,000 이다 -- 판정 3 이 카테고리를 가리지 않는다. */
  const store = fakeStore({ totals: settledPair(3) });
  const { entry } = await deductPass(ORG, withService(), deductInput(), deductOptions(store));
  assert.equal(entry.category, "service");
  assert.equal(entry.unitPrice, 25000);
  assert.equal(entry.rule, "new_to_instructor");
});

test("a pass with no service sessions is untouched by any of this", async () => {
  const store = fakeStore({ totals: settledPair() });
  const { entry } = await deductPass(ORG, activePass(), deductInput(), deductOptions(store));
  assert.equal(entry.category, "pt_1_1_new");
  assert.deepEqual(store.calls.commit[0][3].data, { remainingCount: -1 });
});

test("correcting a service deduction gives the session back to the centre", async () => {
  /* 원장에 service 로 적혀 있으므로 되돌리기가 그것을 보고 카운터를 되돌린다.
     되돌리지 않으면 센터가 내주기로 한 1회분이 실수 하나로 사라진다. */
  const store = fakeStore();
  await correctDeduction(
    ORG,
    withService({ serviceUsed: 1 }),
    {
      id: "lesson-1_deduct", type: "deduct", passId: "pass-a",
      category: "service", unitPrice: 10000, instructorId: "instructor-a",
    },
    { reason: "잘못 눌렀습니다", createdBy: "owner-a" },
    { store },
  );
  assert.deepEqual(store.calls.commit[0][1].data, { remainingCount: 1, serviceUsed: -1 });
});

/* ── 부원장 5:5 는 현금가 기준이다 ──────────────────────────────────────────

   카드로 받은 금액 안에는 부가세가 들어 있다. 그것은 센터의 매출이 아니라
   나라에 낼 돈이므로, 그것까지 반으로 접으면 센터가 받지도 않은 돈의 절반을
   지급하게 된다. */

test("the net price is frozen at issue, for every pass", async () => {
  const store = fakeStore();
  await issuePass(ORG, issueInput({ contractPrice: 1100000, paymentMethod: "card" }), {
    store, newId: () => "pass-new",
  });
  const passWrite = store.calls.commit[0][0];
  assert.equal(passWrite.data.contractPrice, 1100000);
  assert.equal(passWrite.data.netContractPrice, 1000000);
});

test("cash and transfer are issued at the contract itself", async () => {
  for (const paymentMethod of ["cash", "transfer"]) {
    const store = fakeStore();
    await issuePass(ORG, issueInput({ contractPrice: 1100000, paymentMethod }), {
      store, newId: () => "pass-new",
    });
    assert.equal(store.calls.commit[0][0].data.netContractPrice, 1100000, paymentMethod);
  }
});

test("the same contract pays a deputy less on a card than in cash", async () => {
  /* 이것이 이 변경의 요점이다. 110만 20회를 카드로 받으면 회당 25,000,
     현금으로 받으면 27,500 이다. */
  const deputy = deductInput({ isDeputyDirector: true });
  const rates = [];
  for (const paymentMethod of ["card", "cash"]) {
    const store = fakeStore({ totals: settledPair() });
    const { entry } = await deductPass(
      ORG,
      activePass({
        contractPrice: 1100000,
        paymentMethod,
        totalSessions: 20,
        netContractPrice: paymentMethod === "card" ? 1000000 : 1100000,
      }),
      deputy,
      deductOptions(store),
    );
    assert.equal(entry.rule, "deputy_director");
    rates.push(entry.unitPrice);
  }
  assert.deepEqual(rates, [25000, 27500]);
});

test("a pass issued before the field falls back to its payment method", async () => {
  /* 옛 회원권에는 공급가액이 없다. 세율은 법이 정한 값이라 그 회원권이 팔린
     조건이 아니므로, 결제 수단으로 다시 계산해도 같은 답이 나온다. */
  const legacy = activePass({ contractPrice: 1100000, paymentMethod: "card", totalSessions: 20 });
  delete legacy.netContractPrice;
  const store = fakeStore({ totals: settledPair() });
  const { entry } = await deductPass(
    ORG, legacy, deductInput({ isDeputyDirector: true }), deductOptions(store),
  );
  assert.equal(entry.unitPrice, 25000);
});

test("a deputy pass whose net price cannot be read is refused, not guessed", async () => {
  /* 지어내면 부원장의 수업 전체가 틀린 금액으로 굳고, 원장은 append-only 라
     고칠 수 없다. 부원장이 아닌 회원권은 이 값을 보지 않으므로 막히지 않는다. */
  const broken = activePass({ totalSessions: 20 });
  delete broken.netContractPrice;
  delete broken.paymentMethod;
  const store = fakeStore({ totals: settledPair() });
  await assert.rejects(
    () => deductPass(ORG, broken, deductInput({ isDeputyDirector: true }), deductOptions(store)),
    /Invalid netContractPrice/,
  );
  assert.equal(store.calls.commit.length, 0);

  const fine = fakeStore({ totals: settledPair() });
  await deductPass(ORG, broken, deductInput(), deductOptions(fine));
  assert.equal(fine.calls.commit.length, 1, "부원장이 아니면 그대로 차감된다");
});

/* ── 듀엣: 회원권 하나에 회원 둘 ──────────────────────────────────────────

   계약서가 하나이고 회원권도 하나다. 30회 계약이면 두 명이 함께 쓰는 30회고,
   수업 한 번에 1회 차감되고 잔여가 29가 된다. 두 명을 한 단위로 본다. */

const duetPass = (overrides = {}) => passDoc({
  clientId: "client-a",
  clientIds: ["client-a", "client-b"],
  locationId: "bansong",
  category: "pt_2_1_new",
  baseUnitPrice: 30000,
  totalSessions: 30,
  serviceSessions: 0,
  serviceUsed: 0,
  handedOver: false,
  remainingCount: 30,
  ...overrides,
});

test("a duet pass is issued once, and names both members", async () => {
  const store = fakeStore();
  const { pass } = await issuePass(ORG, issueInput({
    clientId: "client-a", clientIds: ["client-a", "client-b"],
    payCategory: "pt_2_1_new", totalSessions: 30,
  }), { store, newId: () => "pass-duet" });
  assert.deepEqual(pass.clientIds, ["client-a", "client-b"]);
  // 30회 계약이면 30회다. 두 명이라고 60회가 되지 않는다.
  assert.equal(pass.remainingCount, 30);
});

test("a 1:1 pass still names exactly one, so readers need no second branch", async () => {
  const store = fakeStore();
  const { pass } = await issuePass(ORG, issueInput(), { store, newId: () => "pass-solo" });
  assert.deepEqual(pass.clientIds, ["client-a"]);
});

test("the partner sees the same pass the anchor does", async () => {
  /* 대표만 보면 짝의 화면에서 잔여도 여정도 단가도 사라진다 -- 명부 id 공간
     때문에 겪었던 것과 같은 실패다. */
  const store = fakeStore({ documents: [duetPass()] });
  assert.equal((await listPasses(ORG, { clientId: "client-b", store })).length, 1);
  assert.equal((await listPasses(ORG, { clientId: "client-a", store })).length, 1);
  assert.equal((await listPasses(ORG, { clientId: "client-c", store })).length, 0);
});

test("one duet lesson takes one session and pays once", async () => {
  const store = fakeStore({ totals: {
    [`organizations/${ORG}/instructorClientTotals/instructor-a_client-a`]: { sessions: 40 },
    [`organizations/${ORG}/instructorClientTotals/instructor-a_client-b`]: { sessions: 40 },
  } });
  const { entry } = await deductPass(ORG, duetPass(), deductInput(), { store });
  assert.equal(entry.delta, -1, "한 번 수업에 한 회차");
  assert.equal(entry.unitPrice, 30000, "2:1 신규 — 수업 한 번 기준");
  const decrements = store.calls.commit[0].filter((write) => write.operation === "decrement");
  assert.equal(decrements.length, 1);
  assert.equal(decrements[0].data.remainingCount, -1);
});

test("both members get a participant row, and a no-show still deducts", async () => {
  /* 한 명이 노쇼여도 차감도 급여도 그대로다. 다만 누가 왔고 누가 안 왔는지는
     남아야 한다 -- 없으면 두 달 뒤 "그날 나는 안 갔는데" 에 답할 것이 없다. */
  const store = fakeStore();
  const { entry } = await deductPass(ORG, duetPass(), deductInput({
    lessonId: "lesson-1", attendanceByClientId: { "client-b": "noshow" },
  }), { store });
  assert.equal(entry.delta, -1);
  const rows = store.calls.commit[0].filter((write) => write.path.includes("/participants/"));
  assert.deepEqual(rows.map((write) => write.data.clientId), ["client-a", "client-b"]);
  assert.deepEqual(rows.map((write) => write.data.attendanceStatus), ["attended", "noshow"]);
});

test("the instructor's running total goes up for both members", async () => {
  // 강사는 그 시간에 두 사람을 각각 가르쳤다.
  const store = fakeStore();
  await deductPass(ORG, duetPass(), deductInput(), { store });
  const bumps = store.calls.commit[0].filter((write) => write.operation === "bump");
  assert.deepEqual(bumps.map((write) => write.data.clientId), ["client-a", "client-b"]);
  assert.ok(bumps.every((write) => write.data.delta.sessions === 1));
});

test("the pair is priced by whoever the instructor knows least", async () => {
  /* 대표는 40회지만 짝은 3회다. 강사에게 아직 새 사람이 섞여 있으므로 그 수업은
     신규 단가다 (판정 3, 25,000). 대표만 봤다면 30,000 이 되었을 것이다. */
  const store = fakeStore({ totals: {
    [`organizations/${ORG}/instructorClientTotals/instructor-a_client-a`]: { sessions: 40 },
    [`organizations/${ORG}/instructorClientTotals/instructor-a_client-b`]: { sessions: 3 },
  } });
  const { entry } = await deductPass(ORG, duetPass(), deductInput(), { store });
  assert.equal(entry.unitPrice, 25000);
  assert.equal(entry.rule, "new_to_instructor");
});

test("both totals are read, not just the anchor's", async () => {
  const store = fakeStore();
  await deductPass(ORG, duetPass(), deductInput(), { store });
  assert.deepEqual(store.calls.read, [
    `organizations/${ORG}/instructorClientTotals/instructor-a_client-a`,
    `organizations/${ORG}/instructorClientTotals/instructor-a_client-b`,
  ]);
});

test("undoing a duet deduction puts both totals back", async () => {
  /* 한쪽만 되돌리면 두 사람의 누적이 영영 1 만큼 어긋나고, 20회째 단가가 서로
     다른 날에 온다. 원장은 append-only 라 그 어긋남은 고칠 수 없다. */
  const store = fakeStore();
  await correctDeduction(ORG, duetPass({ remainingCount: 29 }), {
    id: "lesson-1_deduct", type: "deduct", instructorId: "instructor-a",
    category: "pt_2_1_new", unitPrice: 30000, passId: "pass-a",
  }, { reason: "잘못 눌렀습니다", createdBy: "owner-a" }, { store });
  const bumps = store.calls.commit[0].filter((write) => write.operation === "bump");
  assert.deepEqual(bumps.map((write) => write.data.clientId), ["client-a", "client-b"]);
  assert.ok(bumps.every((write) => write.data.delta.sessions === -1));
});

test("a 1:1 deduction is unchanged — one participant, one total", async () => {
  // 듀엣을 넣으면서 1:1 이 달라지면 안 된다. 센터의 대부분이 1:1 이다.
  const store = fakeStore();
  await deductPass(ORG, duetPass({ clientIds: undefined, category: "pt_1_1_new", baseUnitPrice: 25000 }), deductInput(), { store });
  const rows = store.calls.commit[0].filter((write) => write.path.includes("/participants/"));
  const bumps = store.calls.commit[0].filter((write) => write.operation === "bump");
  assert.equal(rows.length, 1);
  assert.equal(bumps.length, 1);
  assert.equal(bumps[0].data.clientId, "client-a");
});

/* ── 부원장이 듀엣을 맡으면 ───────────────────────────────────────────────

   계약이 하나이므로 분모도 하나다. 특별히 할 것이 없어야 하는데, 없어야 한다는
   말은 검사하지 않으면 확인되지 않는다 -- 두 사람이니 2로 한 번 더 나누거나
   한 사람 몫만 지급하는 코드가 나중에 들어올 자리다. */

test("a deputy's 5:5 splits the one contract, not one member's share of it", async () => {
  /* 현금 180만 · 30회 → 공급가액 180만(현금은 부가세 없음) ÷ 30 ÷ 2 = 30,000.
     두 사람이라고 60회로 나누거나 다시 반으로 접지 않는다. */
  const store = fakeStore();
  const { entry } = await deductPass(ORG, duetPass({
    contractPrice: 1800000, netContractPrice: 1800000, paymentMethod: "cash", totalSessions: 30,
  }), deductInput({ isDeputyDirector: true }), { store });
  assert.equal(entry.unitPrice, 30000);
  assert.equal(entry.rule, "deputy_director");
});

test("the deputy rate is the same whether the pass is a duet or not", async () => {
  // 회원 수는 이 판정에 들어가지 않는다. 들어가기 시작하면 계약이 둘이 된다.
  const of = async (overrides) => {
    const store = fakeStore();
    const { entry } = await deductPass(ORG, duetPass({
      contractPrice: 1800000, netContractPrice: 1800000, paymentMethod: "cash",
      totalSessions: 30, ...overrides,
    }), deductInput({ isDeputyDirector: true }), { store });
    return entry.unitPrice;
  };
  assert.equal(await of({ clientIds: ["client-a", "client-b"] }), await of({ clientIds: undefined }));
});

test("the deputy rule still beats the partner being new to the instructor", async () => {
  /* 판정 순서가 그대로여야 한다. 짝이 신규라고 25,000 으로 내려가면 부원장
     계약의 5:5 가 사라진다. */
  const store = fakeStore({ totals: {
    [`organizations/${ORG}/instructorClientTotals/instructor-a_client-a`]: { sessions: 40 },
    [`organizations/${ORG}/instructorClientTotals/instructor-a_client-b`]: { sessions: 0 },
  } });
  const { entry } = await deductPass(ORG, duetPass({
    contractPrice: 1800000, netContractPrice: 1800000, paymentMethod: "cash", totalSessions: 30,
  }), deductInput({ isDeputyDirector: true }), { store });
  assert.equal(entry.rule, "deputy_director");
  assert.equal(entry.unitPrice, 30000);
});

test("a card duet still takes VAT out of the one contract before halving", async () => {
  // 카드 198만 → 공급가액 1,800,000 → ÷30 ÷2 = 30,000.
  const store = fakeStore();
  const { entry } = await deductPass(ORG, duetPass({
    contractPrice: 1980000, netContractPrice: 1800000, paymentMethod: "card", totalSessions: 30,
  }), deductInput({ isDeputyDirector: true }), { store });
  assert.equal(entry.unitPrice, 30000);
});
