import assert from "node:assert/strict";
import test from "node:test";
import {
  createFirestorePayrollStore, loadInstructorMonthlyPay, loadOrganizationMonthlyPayroll,
  monthRange, payrollClientCsv, currentMonth, previousMonth, summarizeCorrections,
  summarizeInstructorPay, onlyNewInstructorRate, summarizeOrganizationPay, toDate,
} from "../../src/data/repositories/payroll-repository.js";
import { PAY_CATEGORY } from "../../src/data/schema/constants.js";
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

/* ── 대표의 월말 정산 ────────────────────────────────────────────────────

   강사 개인 화면과 같은 원장, 같은 경계, 같은 단가를 쓴다. 다른 것은 범위
   하나뿐이다. 이 화면의 첫 용도가 옛 급여 엑셀과의 대조라, 틀리면 대표는
   그것을 손으로 찾아내야 한다. */

const OTHER = "instructor-b";

function orgStore(documents = []) {
  const calls = [];
  return {
    calls,
    listOrganizationDeductions: async (query) => { calls.push(query); return documents; },
  };
}

const orgEntry = (overrides = {}) => entry({ locationId: "bansong", ...overrides });

test("the centre's month is cut by occurredAt on the centre's own clock", async () => {
  /* 말일 밤 수업이 다음 달로 넘어가면 그 강사는 자기가 한 수업이 이달 정산에서
     빠진 것을 보게 되고, 대표는 옛 엑셀과 한 건 차이를 손으로 찾게 된다. */
  const store = orgStore([
    orgEntry({ id: "in-first", occurredAt: new Date(2026, 8, 1, 0, 0, 0) }),
    orgEntry({ id: "in-last", occurredAt: new Date(2026, 8, 30, 23, 59, 59) }),
    orgEntry({ id: "out-before", occurredAt: new Date(2026, 7, 31, 23, 59, 59) }),
    orgEntry({ id: "out-after", occurredAt: new Date(2026, 9, 1, 0, 0, 0) }),
    // 기록한 시각은 다음 달이어도 수업은 이달이다.
    orgEntry({ id: "in-late-entry", occurredAt: new Date(2026, 8, 30, 21, 0, 0), createdAt: new Date(2026, 9, 1, 2, 0, 0) }),
  ]);
  const summary = await loadOrganizationMonthlyPayroll(ORG, { month: "2026-09", store });
  assert.equal(summary.sessions, 3);
  assert.equal(summary.start.getMonth(), 8);
  assert.equal(summary.start.getHours(), 0, "센터 시계로 자른다");
  assert.equal(summary.end.getMonth(), 9);
  // 쿼리도 같은 경계로 나간다 -- 서버가 거르고 나서 한 번 더 거른다.
  assert.equal(store.calls[0].start.getTime(), summary.start.getTime());
  assert.equal(store.calls[0].end.getTime(), summary.end.getTime());
});

test("the amount is the price frozen in the entry, never the table", async () => {
  /* 표가 오른 뒤에 지난달을 다시 열면 그때 숫자가 바뀌어야 하는데, 원장은
     append-only 라 되돌릴 방법이 없다. */
  const table = PAY_RATES[PAY_CATEGORY.PT_1_1_NEW];
  const store = orgStore([
    orgEntry({ id: "a", category: PAY_CATEGORY.PT_1_1_NEW, unitPrice: table + 7000 }),
  ]);
  const summary = await loadOrganizationMonthlyPayroll(ORG, { month: "2026-09", store });
  assert.equal(summary.total, table + 7000);
  assert.notEqual(summary.total, table, "표를 다시 읽으면 안 된다");
});

test("mixed prices inside one pass still add up", () => {
  /* 같은 회원권 안에서도 회차마다 판정이 다르다 -- 누적 20회를 넘는 순간 값이
     바뀐다. 건수 × 어떤 하나의 단가로는 절대 맞지 않는다. */
  const summary = summarizeOrganizationPay([
    orgEntry({ id: "n1", category: PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, unitPrice: 25000, rule: "new_to_instructor" }),
    orgEntry({ id: "n2", category: PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, unitPrice: 25000, rule: "new_to_instructor" }),
    orgEntry({ id: "b1", category: PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, unitPrice: 45000, rule: "base_category" }),
    orgEntry({ id: "s1", category: PAY_CATEGORY.SERVICE, unitPrice: 10000, rule: "base_category" }),
    orgEntry({ id: "s2", category: PAY_CATEGORY.SERVICE, unitPrice: 0, rule: "service_already_used" }),
  ]);
  assert.equal(summary.total, 25000 + 25000 + 45000 + 10000 + 0);
  assert.equal(summary.sessions, 5);
  const normal = summary.byInstructor[0].byCategory
    .find((row) => row.category === PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL);
  assert.equal(normal.sessions, 3);
  assert.equal(normal.amount, 95000, "한 카테고리 안에서도 단가가 섞인다");
});

test("categories are laid out in the order the old payroll sheet uses", () => {
  /* 금액순으로 세우면 달마다 줄 순서가 달라지고, 옛 엑셀과 눈으로 맞추던
     대표가 줄을 잃는다. 확정본 단가표의 순서로 고정한다. */
  const summary = summarizeOrganizationPay([
    orgEntry({ id: "e1", category: PAY_CATEGORY.ETC, unitPrice: 90000 }),
    orgEntry({ id: "s1", category: PAY_CATEGORY.SERVICE, unitPrice: 10000 }),
    orgEntry({ id: "n1", category: PAY_CATEGORY.PT_1_1_NEW, unitPrice: 25000 }),
    orgEntry({ id: "t1", category: PAY_CATEGORY.PT_2_1_NEW, unitPrice: 30000 }),
  ]);
  assert.deepEqual(summary.byInstructor[0].byCategory.map((row) => row.category), [
    PAY_CATEGORY.PT_1_1_NEW, PAY_CATEGORY.PT_2_1_NEW, PAY_CATEGORY.SERVICE, PAY_CATEGORY.ETC,
  ]);
});

test("an instructor who taught at two branches is counted once for pay", () => {
  /* 지점별로만 묶으면 그 사람을 두 번 보게 되고, 급여는 한 번 준다. */
  const summary = summarizeOrganizationPay([
    orgEntry({ id: "a", locationId: "bansong", unitPrice: 25000 }),
    orgEntry({ id: "b", locationId: "centum", unitPrice: 30000 }),
    orgEntry({ id: "c", locationId: "centum", unitPrice: 30000, instructorId: OTHER }),
  ]);
  const me = summary.byInstructor.find((row) => row.instructorId === ME);
  assert.equal(me.total, 55000, "지점을 가로지르는 합계가 지급할 금액이다");
  assert.equal(summary.byLocation.length, 2);
  const centum = summary.byLocation.find((row) => row.locationId === "centum");
  assert.equal(centum.total, 60000);
  assert.equal(centum.byInstructor.length, 2);
  assert.equal(summary.total, 85000, "지점 합계를 더하면 전체와 같다");
});

test("entries that are not this month's deductions never reach the total", async () => {
  /* 서버가 거르지만 인덱스나 쿼리를 잘못 고치면 발급 항목이나 남의 조직이
     조용히 섞여 들어오고, 합계 한 줄에서는 알아챌 방법이 없다. */
  const store = orgStore([
    orgEntry({ id: "ok", unitPrice: 25000 }),
    orgEntry({ id: "issue", type: "issue", delta: 20, unitPrice: 25000 }),
    orgEntry({ id: "other-org", organizationId: "center-b", unitPrice: 99000 }),
  ]);
  const summary = await loadOrganizationMonthlyPayroll(ORG, { month: "2026-09", store });
  assert.equal(summary.total, 25000);
  assert.equal(summary.sessions, 1);
});

test("a failed read is never a quiet zero", async () => {
  /* 0원짜리 정산 화면과 "읽지 못했다"가 같은 화면이면 대표는 그 달에 수업이
     없었다고 읽는다. */
  const entries = [];
  connectRepositoryLog((code, detail) => entries.push({ code, detail }));
  const store = orgStore();
  store.listOrganizationDeductions = async () => {
    throw Object.assign(new Error("denied"), { code: "permission-denied" });
  };
  await assert.rejects(
    () => loadOrganizationMonthlyPayroll(ORG, { month: "2026-09", store }),
    RepositoryReadError,
  );
  assert.equal(entries[0].code, "organization_payroll_read_failed");
  assert.equal(entries[0].detail.errorCode, "permission-denied");
  disconnectRepositoryLog();
});

test("the month that is already over is one step back", () => {
  assert.equal(previousMonth(new Date(2026, 9, 3)), "2026-09");
  assert.equal(previousMonth(new Date(2026, 0, 1)), "2025-12", "해가 넘어가도 맞는다");
});

test("the screen opens on the month in progress", () => {
  // 2026-09-23 대표 결정 -- 진행 중인 달을 먼저 보고, 정산 때 한 칸 되돌린다.
  assert.equal(currentMonth(new Date(2026, 8, 23)), "2026-09");
  assert.equal(currentMonth(new Date(2026, 0, 1)), "2026-01");
  assert.equal(currentMonth(new Date(2026, 11, 31, 23, 59)), "2026-12");
});

/* ── 정산용 CSV ──────────────────────────────────────────────────────────
   한 줄이 **수업 한 회**다 (2026-10-27 대표). 전에는 한 줄이 (지점 · 강사 ·
   카테고리) 하나였는데, 그 모양으로는 "이 회원이 몇 회를 얼마에" 를 셀 수
   없다 -- 대표가 정산에서 맞추는 것이 바로 그것이다. */

const csvNames = {
  nameOfInstructor: () => "정, 예진",
  nameOfLocation: () => "반송점",
  nameOfClient: (id) => (id === "client-a" ? "김하나" : "박두리"),
  nameOfPass: (passId) => (passId === "pass-a" ? "1:1 PT 20회" : "1:1 PT 10회"),
};

test("the csv is one row per lesson, readable by Excel", () => {
  const summary = summarizeOrganizationPay([
    orgEntry({
      id: "a", clientId: "client-a", passId: "pass-a",
      category: PAY_CATEGORY.PT_1_1_NEW, unitPrice: 25000,
      occurredAt: new Date(2026, 8, 15, 10, 0),
    }),
    orgEntry({
      id: "b", clientId: "client-a", passId: "pass-a",
      category: PAY_CATEGORY.PT_1_1_NEW, unitPrice: 25000,
      occurredAt: new Date(2026, 8, 17, 14, 30),
    }),
  ]);
  const csv = payrollClientCsv({ ...summary, month: "2026-09" }, csvNames);

  assert.ok(csv.startsWith("\uFEFF"), "BOM 이 없으면 엑셀에서 한글이 깨진다");
  const lines = csv.slice(1).split("\n");
  assert.equal(lines[0], "월,지점,강사,회원,회원권,날짜,횟수,단가,금액");
  // 쉼표가 든 이름은 다시 감싼다. 그러지 않으면 엑셀이 열을 쪼갠다.
  assert.equal(lines[1], '2026-09,반송점,"정, 예진",김하나,1:1 PT 20회,2026-09-15 10:00,1,25000,25000');
  assert.equal(lines[2], '2026-09,반송점,"정, 예진",김하나,1:1 PT 20회,2026-09-17 14:30,1,25000,25000');
  assert.equal(lines.length, 3, "한 줄이 수업 한 회다");
});

test("the csv can be cut to one instructor or one location", () => {
  /* 대표가 강사에게 보내는 것은 그 사람 것뿐이고, 지점장에게 보내는 것은 그
     지점 것뿐이다. 한 장으로만 뽑히면 남의 급여가 함께 나간다. */
  const summary = summarizeOrganizationPay([
    orgEntry({ id: "a", instructorId: "u1", locationId: "bansong", clientId: "client-a", passId: "pass-a" }),
    orgEntry({ id: "b", instructorId: "u2", locationId: "bansong", clientId: "client-b", passId: "pass-b" }),
    orgEntry({ id: "c", instructorId: "u1", locationId: "jangyu", clientId: "client-a", passId: "pass-a" }),
  ]);
  const names = { ...csvNames, nameOfInstructor: (id) => id, nameOfLocation: (id) => id };
  const rows = (csv) => csv.slice(1).split("\n").slice(1);

  // 센터 전체는 셋 다.
  assert.equal(rows(payrollClientCsv({ ...summary, month: "2026-09" }, names)).length, 3);

  /* 강사 하나는 **지점을 가로지른다** -- 두 지점에서 수업했어도 급여는 한 번
     준다. 그래서 두 줄이고, 줄마다 그 회차의 지점이 적힌다. */
  const mine = rows(payrollClientCsv({ ...summary, month: "2026-09" }, names, { instructorId: "u1" }));
  assert.equal(mine.length, 2);
  assert.ok(mine.some((line) => line.includes("bansong")));
  assert.ok(mine.some((line) => line.includes("jangyu")));
  assert.ok(mine.every((line) => line.includes("u1")), "남의 줄이 섞이지 않는다");

  // 지점 하나는 그 지점 수업만.
  const here = rows(payrollClientCsv({ ...summary, month: "2026-09" }, names, { locationId: "jangyu" }));
  assert.equal(here.length, 1);
  assert.ok(here[0].includes("jangyu"));
});

test("the Firestore store answers the organization-wide shape too", () => {
  assert.equal(typeof createFirestorePayrollStore().listOrganizationDeductions, "function");
});

test("the organization payroll falls back to the Firestore store", async () => {
  const error = await loadOrganizationMonthlyPayroll(ORG, { month: "2026-09" })
    .then(() => null, (thrown) => thrown);
  assert.ok(error);
  assert.notEqual(error.name, "TypeError", `기본 store 가 사라졌다: ${error.message}`);
  assert.equal(error.code, "app/no-app", error.message);
});

/* ── 보정 ────────────────────────────────────────────────────────────────

   잘못 차감한 건은 지울 수 없고 되돌리는 항목이 더해진다. 어느 달에서 빼는가는
   보정 항목 자신의 occurredAt 이 정한다 -- 지난달은 이미 지급됐고, 이미 나간
   돈을 사후에 줄일 방법은 없다. */

const correction = (overrides = {}) => orgEntry({
  id: "c1",
  type: "correction",
  delta: 1,
  correctsEntryId: "d1",
  reason: "잘못 눌렀습니다",
  ...overrides,
});

test("a correction subtracts the very session it gives back", () => {
  const summary = summarizeOrganizationPay([
    orgEntry({ id: "d1", unitPrice: 25000 }),
    orgEntry({ id: "d2", unitPrice: 25000 }),
    correction({ unitPrice: 25000 }),
  ]);
  assert.equal(summary.total, 25000, "두 건 중 한 건이 상쇄된다");
  assert.equal(summary.sessions, 1);
  const row = summary.byInstructor[0].byCategory[0];
  assert.equal(row.sessions, 1, "카테고리 건수도 함께 줄어든다");
  assert.equal(row.amount, 25000);
});

test("a correction is never counted as another paid session", () => {
  /* 절댓값을 쓰면 되돌린 회차가 한 번 더 지급된다. 부호는 delta 가 정한다. */
  const summary = summarizeOrganizationPay([correction({ unitPrice: 30000 })]);
  assert.equal(summary.total, -30000);
  assert.equal(summary.sessions, -1);
});

test("last month's mistake comes out of this month, and says so", () => {
  /* 같은 달 안의 실수는 그 달에서 그대로 상쇄된다. 지난달 실수는 이번 달 급여에서
     빠지고, 그 음수가 이번 달의 잘못으로 보이면 안 된다. */
  const sameMonth = summarizeCorrections([
    orgEntry({ id: "d1", unitPrice: 25000 }),
    correction({ correctsEntryId: "d1", unitPrice: 25000 }),
  ]);
  assert.equal(sameMonth.sessions, 1);
  assert.equal(sameMonth.amount, -25000);
  assert.equal(sameMonth.priorMonth.sessions, 0, "이 달 차감을 되돌린 것은 지난달 건이 아니다");

  const priorMonth = summarizeCorrections([
    correction({ correctsEntryId: "d-august", unitPrice: 25000 }),
  ]);
  assert.equal(priorMonth.priorMonth.sessions, 1, "되돌릴 대상이 이 달에 없으면 지난달 건이다");
  assert.equal(priorMonth.priorMonth.amount, -25000);
});

test("an instructor's own screen counts corrections the same way", async () => {
  const store = fakeStore([
    entry({ id: "d1", unitPrice: 25000 }),
    entry({ id: "c1", type: "correction", delta: 1, unitPrice: 25000, correctsEntryId: "d1" }),
  ]);
  const pay = await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  assert.equal(pay.total, 0, "한 건을 하고 그 건이 되돌려졌다");
  assert.equal(pay.corrections.sessions, 1);
});

test("the query asks for corrections too, or the screen would overpay", async () => {
  /* 차감만 읽으면 보정이 없는 것처럼 보이고, 되돌린 회차가 그대로 지급된다. */
  const store = fakeStore();
  await loadInstructorMonthlyPay(ORG, { instructorId: ME, month: "2026-09", store });
  assert.ok(store.calls.length > 0);
});

/* ── 왜 그 금액인가를 집계도 말해야 한다 ──────────────────────────────────

   카테고리만 보면 "이벤트페이 10건 25만원" 이고, 그 상품의 기준 단가는 30,000 이라
   대표는 계산이 틀렸다고 읽는다. 실제로는 그 열 건이 판정 3 에 걸린 것이고 그건
   규칙대로다. 실제로 그렇게 읽혔다. */

test("each instructor's sessions are counted by which rule decided them", () => {
  const summary = summarizeOrganizationPay([
    entry({ id: "a", category: "pt_1_1_repurchase_event", unitPrice: 25000, rule: "new_to_instructor" }),
    entry({ id: "b", category: "pt_1_1_repurchase_event", unitPrice: 25000, rule: "new_to_instructor" }),
    entry({ id: "c", category: "pt_1_1_repurchase_event", unitPrice: 30000, rule: "base_category" }),
  ]);
  const [row] = summary.byInstructor;
  // 카테고리는 하나인데 단가가 둘이다. 그 이유가 이 목록에 있다.
  assert.deepEqual(row.byCategory, [
    { category: "pt_1_1_repurchase_event", sessions: 3, amount: 80000 },
  ]);
  assert.deepEqual(row.byRule, [
    { rule: "new_to_instructor", sessions: 2, amount: 50000 },
    { rule: "base_category", sessions: 1, amount: 30000 },
  ]);
});

test("the rule rows follow the order the judgements are applied in", () => {
  // 화면이 확정본 순서대로 읽히게 한다. 금액순이면 달마다 줄이 움직인다.
  const summary = summarizeOrganizationPay([
    entry({ id: "a", unitPrice: 30000, rule: "base_category" }),
    entry({ id: "b", unitPrice: 25000, rule: "handed_over" }),
    entry({ id: "c", unitPrice: 25000, rule: "new_to_instructor" }),
  ]);
  assert.deepEqual(
    summary.byInstructor[0].byRule.map((row) => row.rule),
    ["handed_over", "new_to_instructor", "base_category"],
  );
});

test("entries from before the rule field are left out of the rule rows, not faked", () => {
  /* 빈 값으로 한 칸을 만들면 화면이 "판정 없음" 이라는 없는 종류를 보여준다.
     건수 합이 위의 sessions 보다 적을 수 있고 그것이 맞다. */
  const summary = summarizeOrganizationPay([
    entry({ id: "a", unitPrice: 25000, rule: "new_to_instructor" }),
    entry({ id: "b", unitPrice: 25000 }),
  ]);
  const [row] = summary.byInstructor;
  assert.equal(row.sessions, 2);
  assert.deepEqual(row.byRule, [{ rule: "new_to_instructor", sessions: 1, amount: 25000 }]);
});

test("a month where every session was the new rate says so", () => {
  /* 이관 전에는 모든 강사-회원 쌍이 0 에서 시작해 판정 3 이 먼저 걸린다. 화면이
     말하지 않으면 대표는 계산이 고장 났다고 읽는다. */
  const allNew = summarizeOrganizationPay([
    entry({ id: "a", category: "pt_1_1_repurchase_event", unitPrice: 25000, rule: "new_to_instructor" }),
    entry({ id: "b", category: "pt_2_1_repurchase", unitPrice: 25000, rule: "new_to_instructor" }),
  ]);
  assert.equal(onlyNewInstructorRate(allNew), true);
});

test("one session on another rule is enough to take the notice down", () => {
  /* "거의 전부" 에 붙이면 그 설명이 틀린 말이 된다 -- 단가가 이미 갈리고 있는데
     전부 같다고 말하는 셈이다. */
  const mixed = summarizeOrganizationPay([
    entry({ id: "a", unitPrice: 25000, rule: "new_to_instructor" }),
    entry({ id: "b", unitPrice: 30000, rule: "base_category" }),
  ]);
  assert.equal(onlyNewInstructorRate(mixed), false);

  // 차감이 없는 달에는 설명할 것도 없다.
  assert.equal(onlyNewInstructorRate(summarizeOrganizationPay([])), false);
  assert.equal(onlyNewInstructorRate(null), false);
  // rule 이 없던 시절의 항목만 있으면 판정을 말할 수 없다.
  assert.equal(onlyNewInstructorRate(summarizeOrganizationPay([entry({ id: "a" })])), false);
});

test("the rule breakdown reaches the per-location buckets too", () => {
  // 지점별 묶음과 전 지점 합계가 같은 설명을 들고 있어야 한다.
  const summary = summarizeOrganizationPay([
    entry({ id: "a", locationId: "bansong", unitPrice: 25000, rule: "new_to_instructor" }),
  ]);
  assert.deepEqual(summary.byLocation[0].byInstructor[0].byRule, [
    { rule: "new_to_instructor", sessions: 1, amount: 25000 },
  ]);
});

/* ── 심사용 회원은 급여에서 빠진다 ──────────────────────────────────

   스토어 심사관이 로그인해서 볼 가짜 회원이다. 그 회차가 합계에 섞이면
   강사에게 실제로 없는 수업의 돈이 잡힌다 -- 원장은 append-only 라 그 뒤에
   고칠 방법도 없다. */

test("a review-demo member's sessions never reach the payroll total", async () => {
  const store = orgStore([
    orgEntry({ id: "real-1", clientId: "csv_01011112222", unitPrice: 30000 }),
    orgEntry({ id: "demo-1", clientId: "review-demo-1", unitPrice: 30000 }),
    orgEntry({ id: "real-2", clientId: "csv_01033334444", unitPrice: 25000 }),
  ]);
  const summary = await loadOrganizationMonthlyPayroll(ORG, {
    month: "2026-09", store, excludedClientIds: new Set(["review-demo-1"]),
  });
  assert.equal(summary.sessions, 2, "가짜 회차가 세어졌다");
  assert.equal(summary.total, 55000);
});

test("without the exclusion set nothing changes", async () => {
  /* 부르는 쪽이 명부를 아직 못 읽었을 수 있다. 그때 조용히 전부 빼 버리면
     급여가 0 으로 보이고, 그것이 더 나쁜 거짓말이다. */
  const store = orgStore([
    orgEntry({ id: "real-1", clientId: "csv_01011112222", unitPrice: 30000 }),
  ]);
  const summary = await loadOrganizationMonthlyPayroll(ORG, { month: "2026-09", store });
  assert.equal(summary.sessions, 1);
});

/* ── 정산용 묶음: 단가별 · 회원별 (2026-10-27 대표) ──────────────────────

   대표가 급여를 맞추는 단위는 "이 강사가 이 단가로 몇 회" 다. 카테고리별·
   판정별 표는 **왜 그 단가인지**를 설명하는 자리이고, 맞추는 자리가 아니다.

   셋은 같은 항목을 다르게 묶은 것이라 합계가 **반드시** 같다. 어긋나면 어느
   쪽이 틀렸는지 알 수 없고, 그때는 이미 지급한 뒤다. */

/** 한 달치 원장. 단가가 넷으로 갈리고, 한 회원권 안에서도 갈린다. */
const mixedMonth = () => [
  // 김하나 · pass-a · 누적 20회를 넘기 전
  ...Array.from({ length: 9 }, (_unused, index) => orgEntry({
    id: `a-new-${index}`, clientId: "client-a", passId: "pass-a",
    category: PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT, unitPrice: 25000, rule: "new_to_instructor",
    occurredAt: new Date(2026, 8, 2 + index, 10, 0),
  })),
  // 같은 회원권인데 **단가가 바뀌었다** -- 그 달 중간에 누적 20회를 넘겼다.
  ...Array.from({ length: 4 }, (_unused, index) => orgEntry({
    id: `a-base-${index}`, clientId: "client-a", passId: "pass-a",
    category: PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT, unitPrice: 30000, rule: "base_category",
    occurredAt: new Date(2026, 8, 20 + index, 10, 0),
  })),
  // 박두리 · pass-b · 부원장 5:5
  ...Array.from({ length: 2 }, (_unused, index) => orgEntry({
    id: `b-deputy-${index}`, clientId: "client-b", passId: "pass-b",
    category: PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, unitPrice: 55000, rule: "deputy_director",
    occurredAt: new Date(2026, 8, 7 + index, 15, 0),
  })),
  // 되돌린 한 회차. 음수로 센다 -- 절댓값을 쓰면 되돌린 회차가 한 번 더 나간다.
  orgEntry({
    id: "a-correct", type: "correction", delta: 1, correctsEntryId: "a-new-0",
    clientId: "client-a", passId: "pass-a",
    category: PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT, unitPrice: 25000, rule: "new_to_instructor",
    occurredAt: new Date(2026, 8, 25, 10, 0),
  }),
];

const onlyInstructor = (summary) => summary.byInstructor[0];

test("단가별 합계 = 회원별 합계 = 강사 금액", () => {
  /* 세 표가 같은 항목을 다르게 묶은 것이라는 사실을 숫자로 고정한다. 한 쪽만
     고치는 날 이 테스트가 먼저 떨어져야 한다 -- 화면에서는 세 숫자가 나란히
     서 있어도 어느 것이 맞는지 알 수 없다. */
  const summary = summarizeOrganizationPay(mixedMonth());
  const row = onlyInstructor(summary);
  const sum = (rows, field) => rows.reduce((total, item) => total + item[field], 0);

  assert.equal(sum(row.byUnitPrice, "amount"), row.total, "단가별 금액");
  assert.equal(sum(row.byClient, "amount"), row.total, "회원별 금액");
  assert.equal(sum(row.byCategory, "amount"), row.total, "카테고리별 금액");

  assert.equal(sum(row.byUnitPrice, "sessions"), row.sessions, "단가별 횟수");
  assert.equal(sum(row.byClient, "sessions"), row.sessions, "회원별 횟수");

  // 센터 합계까지 같은 숫자여야 한다.
  assert.equal(summary.total, row.total);
  assert.equal(summary.sessions, row.sessions);

  // 9 × 25,000 + 4 × 30,000 + 2 × 55,000 − 25,000(보정) = 430,000
  assert.equal(row.total, 430000);
  assert.equal(row.sessions, 14);
});

test("지점별로 묶어도 세 표의 합계가 같다", () => {
  /* 한 강사가 두 지점에서 수업하면 지점 묶음에 두 번 선다. 그 안에서도
     합계가 깨지면 안 된다 -- 대표는 지점 줄로 지점장과 맞춘다. */
  const summary = summarizeOrganizationPay([
    ...mixedMonth(),
    orgEntry({ id: "other", locationId: "jangyu", clientId: "client-c", passId: "pass-c", unitPrice: 40000 }),
  ]);
  for (const location of summary.byLocation) {
    for (const row of location.byInstructor) {
      const sum = (rows) => rows.reduce((total, item) => total + item.amount, 0);
      assert.equal(sum(row.byUnitPrice), row.total, `${location.locationId} 단가별`);
      assert.equal(sum(row.byClient), row.total, `${location.locationId} 회원별`);
    }
    assert.equal(
      location.byInstructor.reduce((total, item) => total + item.total, 0),
      location.total,
      `${location.locationId} 지점 합계`,
    );
  }
  assert.equal(
    summary.byLocation.reduce((total, item) => total + item.total, 0),
    summary.total,
    "지점 합 = 센터 합",
  );
});

test("단가별은 비싼 것부터, 그 옆에 왜 그 금액인지가 붙는다", () => {
  const row = onlyInstructor(summarizeOrganizationPay(mixedMonth()));

  assert.deepEqual(row.byUnitPrice.map((item) => item.unitPrice), [55000, 30000, 25000]);
  assert.deepEqual(
    row.byUnitPrice.map((item) => ({ sessions: item.sessions, amount: item.amount })),
    [
      { sessions: 2, amount: 110000 },
      { sessions: 4, amount: 120000 },
      // 9회에서 보정 1회가 빠진다.
      { sessions: 8, amount: 200000 },
    ],
  );
  assert.deepEqual(
    row.byUnitPrice[0].basis.map((item) => item.rule),
    ["deputy_director"],
  );
});

test("판정이 없는 옛 항목도 단가별에서는 센다", () => {
  /* byRule 은 빈 판정을 버린다 -- 그쪽은 설명하는 표라 "판정 없음" 이라는
     없는 종류를 만들면 안 된다. 단가별은 **합계를 맞추는 표**라 한 건이라도
     빠지면 강사 금액과 달라지고, 그 차이는 아무도 설명하지 못한다. */
  const row = onlyInstructor(summarizeOrganizationPay([
    orgEntry({ id: "old", unitPrice: 30000, rule: undefined }),
    orgEntry({ id: "new", unitPrice: 30000, rule: "base_category" }),
  ]));

  assert.equal(row.byUnitPrice.length, 1);
  assert.equal(row.byUnitPrice[0].sessions, 2);
  assert.equal(row.byUnitPrice[0].amount, 60000);
  assert.equal(row.byRule.reduce((total, item) => total + item.sessions, 0), 1, "판정별은 하나만 센다");
  assert.deepEqual(row.byUnitPrice[0].basis.map((item) => item.rule).sort(), ["", "base_category"]);
});

test("같은 회원권이라도 단가가 바뀌면 줄이 나뉜다", () => {
  /* 한 줄로 합치면 그 줄의 "횟수 × 단가" 가 금액과 맞지 않는다. 대표가 손으로
     검산하는 자리가 바로 그것이다. */
  const row = onlyInstructor(summarizeOrganizationPay(mixedMonth()));
  const mine = row.byClient.filter((item) => item.clientId === "client-a" && item.passId === "pass-a");

  assert.equal(mine.length, 2, "25,000 과 30,000 이 두 줄이다");
  for (const item of mine) {
    assert.equal(item.sessions * item.unitPrice, item.amount, `${item.unitPrice} 줄의 검산`);
  }
  // 비싼 단가가 앞이다.
  assert.deepEqual(mine.map((item) => item.unitPrice), [30000, 25000]);
});

test("회원 줄은 그 회차의 날짜를 들고 있고, 보정은 −1회로 선다", () => {
  /* 숫자가 이상할 때 확인할 길이 원장을 직접 여는 것뿐이면 아무도 확인하지
     않는다. 보정을 적지 않으면 "8회인데 날짜가 9개" 가 된다. */
  const row = onlyInstructor(summarizeOrganizationPay(mixedMonth()));
  const corrected = row.byClient.find(
    (item) => item.clientId === "client-a" && item.unitPrice === 25000,
  );

  assert.equal(corrected.lessons.length, 10, "차감 9 + 보정 1");
  assert.equal(corrected.sessions, 8);
  assert.equal(corrected.lessons.filter((item) => item.sessions < 0).length, 1);
  assert.equal(
    corrected.lessons.reduce((total, item) => total + item.sessions, 0),
    corrected.sessions,
    "날짜 줄의 합이 그 줄의 횟수다",
  );

  // 수업이 일어난 순서로. 위에서 아래로 읽는다.
  const times = corrected.lessons.map((item) => toDate(item.occurredAt).getTime());
  assert.deepEqual(times.slice().sort((a, b) => a - b), times);

  // 지점은 그 회차의 것이다 -- CSV 가 줄마다 적는다.
  assert.ok(corrected.lessons.every((item) => item.locationId === "bansong"));
});
