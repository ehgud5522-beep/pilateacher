import assert from "node:assert/strict";
import test from "node:test";
import {
  createFirestorePayrollStore, loadInstructorMonthlyPay, monthRange,
  summarizeInstructorPay, toDate,
} from "../../src/data/repositories/payroll-repository.js";
import { PAY_RATES } from "../../src/data/schema/pay-rates.js";
import { RepositoryReadError, connectRepositoryLog, disconnectRepositoryLog } from "../../src/data/repositories/repository-read.js";

const ORG = "center-a";
const ME = "instructor-a";

function fakeStore(documents = []) {
  const calls = [];
  return {
    calls,
    listDeductions: async (query) => { calls.push(query); return documents; },
  };
}

const entry = (overrides = {}) => ({
  id: "entry-1",
  organizationId: ORG,
  passId: "pass-a",
  type: "deduct",
  delta: -1,
  category: "pt_1_1_new",
  unitPrice: 25000,
  instructorId: ME,
  lessonId: "lesson-1",
  occurredAt: new Date(2026, 8, 15, 10, 0, 0),
  ...overrides,
});

/* ── 달의 경계 ───────────────────────────────────────────────────────────
   occurredAt 으로 묶는 이유가 경계에서 드러난다. createdAt 으로 묶으면 말일
   수업을 다음날 밤에 누른 건이 다음 달로 넘어가고, 강사는 자기가 한 수업이
   이달 급여에서 빠진 것을 보게 된다. */

test("a month starts at its first midnight and ends at the next one", () => {
  const { start, end } = monthRange("2026-09");
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 8);
  assert.equal(start.getDate(), 1);
  assert.equal(start.getHours(), 0);
  assert.equal(end.getMonth(), 9);
  assert.equal(end.getDate(), 1);
});

test("december rolls into the next year", () => {
  const { end } = monthRange("2026-12");
  assert.equal(end.getFullYear(), 2027);
  assert.equal(end.getMonth(), 0);
});

test("a month has to be a real month", () => {
  for (const bad of ["", "2026", "2026-13", "2026-00", "26-09", "9월", null]) {
    assert.throws(() => monthRange(bad), /month/, JSON.stringify(bad));
  }
});

test("a lesson at the last minute of the month is in that month", async () => {
  /* 말일 23:30 수업을 다음날 아침에 눌러도 이달 급여다. 이것이 occurredAt
     기준의 전부이고, 틀리면 강사가 매달 말일에 손해를 본다. */
  const store = fakeStore([
    entry({ id: "last-minute", occurredAt: new Date(2026, 8, 30, 23, 30, 0) }),
    entry({ id: "first-minute", occurredAt: new Date(2026, 9, 1, 0, 30, 0) }),
    entry({ id: "month-before", occurredAt: new Date(2026, 7, 31, 23, 59, 0) }),
  ]);
  const september = await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  assert.deepEqual(september.entries.map((item) => item.id), ["last-minute"]);
  assert.equal(september.total, 25000);
});

test("the query asks the server for the same window", async () => {
  const store = fakeStore([]);
  await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  const [query] = store.calls;
  assert.equal(query.organizationId, ORG);
  assert.equal(query.instructorId, ME);
  assert.equal(query.start.getMonth(), 8);
  assert.equal(query.end.getMonth(), 9);
});

/* ── 금액은 원장에 박힌 값으로만 ───────────────────────────────────────── */

test("the amount comes from the entry, never from the rate table", async () => {
  /* 단가가 오른 뒤에 지난달을 다시 열면 그때 숫자가 바뀌어야 한다. 표를
     참조하는 순간 이미 정산이 끝난 달이 움직인다. */
  const stale = PAY_RATES.pt_1_1_new - 5000;
  const store = fakeStore([entry({ unitPrice: stale })]);
  const pay = await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  assert.equal(pay.total, stale);
  assert.notEqual(pay.total, PAY_RATES.pt_1_1_new, "표를 다시 읽으면 안 된다");
});

test("two entries of one category can carry different prices", async () => {
  // 같은 카테고리라도 발급 시점이 다르면 단가가 다르고, 그것이 맞다.
  const store = fakeStore([
    entry({ id: "old", unitPrice: 25000 }),
    entry({ id: "new", unitPrice: 30000 }),
  ]);
  const pay = await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  assert.equal(pay.total, 55000);
  assert.equal(pay.byCategory.length, 1);
  assert.equal(pay.byCategory[0].sessions, 2);
  assert.equal(pay.byCategory[0].amount, 55000);
});

test("categories are grouped and the biggest comes first", () => {
  const summary = summarizeInstructorPay([
    entry({ category: "service", unitPrice: 10000 }),
    entry({ category: "pt_1_1_repurchase_normal", unitPrice: 45000 }),
    entry({ category: "pt_1_1_repurchase_normal", unitPrice: 45000 }),
    entry({ category: "pt_1_1_new", unitPrice: 25000 }),
  ]);
  assert.deepEqual(summary.byCategory.map((row) => row.category), [
    "pt_1_1_repurchase_normal", "pt_1_1_new", "service",
  ]);
  assert.equal(summary.total, 125000);
  assert.equal(summary.sessions, 4);
});

test("an entry that spends more than one session counts them all", () => {
  const summary = summarizeInstructorPay([entry({ delta: -2, unitPrice: 25000 })]);
  assert.equal(summary.sessions, 2);
  assert.equal(summary.total, 50000);
});

test("an empty month is zero, not a failure", async () => {
  const store = fakeStore([]);
  const pay = await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  assert.equal(pay.total, 0);
  assert.equal(pay.sessions, 0);
  assert.deepEqual(pay.byCategory, []);
  assert.deepEqual(pay.entries, []);
});

/* ── 남의 것이 섞이지 않는다 ───────────────────────────────────────────── */

test("another instructor's lessons never reach this total", async () => {
  /* 서버가 이미 걸러 주지만 한 번 더 본다. 인덱스나 쿼리를 잘못 고치면 남의
     항목이 조용히 섞이고, 급여 화면에서 그것을 알아차릴 방법이 없다. */
  const store = fakeStore([
    entry({ id: "mine" }),
    entry({ id: "theirs", instructorId: "instructor-b", unitPrice: 999000 }),
  ]);
  const pay = await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  assert.deepEqual(pay.entries.map((item) => item.id), ["mine"]);
  assert.equal(pay.total, 25000);
});

test("issues and transfers are not pay", async () => {
  // 발급은 수업이 아니고, 담당 교체는 돈이 오가지 않는다.
  const store = fakeStore([
    entry({ id: "mine" }),
    entry({ id: "issued", type: "issue", delta: 20, unitPrice: 25000 }),
    entry({ id: "moved", type: "transfer", delta: 0 }),
  ]);
  const pay = await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  assert.deepEqual(pay.entries.map((item) => item.id), ["mine"]);
});

test("another organization's entries never reach this total", async () => {
  const store = fakeStore([entry({ id: "mine" }), entry({ id: "elsewhere", organizationId: "center-b" })]);
  const pay = await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  assert.deepEqual(pay.entries.map((item) => item.id), ["mine"]);
});

/* ── 그 밖 ─────────────────────────────────────────────────────────────── */

test("recent lessons come first", async () => {
  const store = fakeStore([
    entry({ id: "early", occurredAt: new Date(2026, 8, 2, 9, 0, 0) }),
    entry({ id: "late", occurredAt: new Date(2026, 8, 20, 9, 0, 0) }),
    entry({ id: "middle", occurredAt: new Date(2026, 8, 10, 9, 0, 0) }),
  ]);
  const pay = await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  assert.deepEqual(pay.entries.map((item) => item.id), ["late", "middle", "early"]);
});

test("a Firestore timestamp reads as a date", () => {
  const stamped = { toDate: () => new Date(2026, 8, 15) };
  assert.equal(toDate(stamped).getMonth(), 8);
  assert.equal(toDate(new Date(2026, 8, 15)).getMonth(), 8);
  assert.equal(Number.isFinite(toDate("망가진 값").getTime()), false);
});

test("an entry with an unreadable time is left out rather than counted at zero", async () => {
  const store = fakeStore([entry({ id: "mine" }), entry({ id: "broken", occurredAt: "언젠가" })]);
  const pay = await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  assert.deepEqual(pay.entries.map((item) => item.id), ["mine"]);
});

test("an organization and an instructor are required before anything is read", async () => {
  const store = fakeStore();
  await assert.rejects(() => loadInstructorMonthlyPay("", { instructorId: ME, month: "2026-09", store }), /Missing organizationId/);
  await assert.rejects(() => loadInstructorMonthlyPay(ORG, { instructorId: "", month: "2026-09", store }), /Missing instructorId/);
  assert.equal(store.calls.length, 0);
});

test("a refused read throws instead of showing a zero month", async () => {
  /* 급여가 0원으로 보이는 것과 못 읽은 것은 다르다. 강사가 0원을 보고
     "이번 달 수업이 없었나" 하고 넘어가면 안 된다. */
  const entries = [];
  connectRepositoryLog((code, detail) => entries.push({ code, detail }));
  const store = fakeStore();
  store.listDeductions = async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); };
  await assert.rejects(
    () => loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store }),
    RepositoryReadError,
  );
  assert.equal(entries[0].code, "instructor_payroll_read_failed");
  assert.equal(entries[0].detail.errorCode, "permission-denied");
  disconnectRepositoryLog();
});

test("the Firestore store is what a caller gets when none is injected", async () => {
  const error = await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09" })
    .then(() => null, (thrown) => thrown);
  assert.ok(error);
  assert.notEqual(error.name, "TypeError", `기본 store 가 사라졌다: ${error.message}`);
  assert.equal(error.code, "app/no-app", error.message);
});

test("the Firestore store answers the whole PayrollStore shape", () => {
  assert.equal(typeof createFirestorePayrollStore().listDeductions, "function");
});
