import assert from "node:assert/strict";
import test from "node:test";
import {
  NEW_PASS_CATEGORIES, isMigratedPass, issueReportCsv, loadOrganizationMonthlyIssues, summarizeIssues,
} from "../../src/data/repositories/issue-report-repository.js";

const at = (day, hour = 10) => new Date(2026, 8, day, hour, 0, 0);

const issue = (overrides = {}) => ({
  id: "e-1", type: "issue", passId: "pass-1", clientId: "client-1", locationId: "bansong",
  category: "pt_1_1_new", delta: 20, createdBy: "fc-1", instructorId: "u1",
  unitPrice: 25000, occurredAt: at(10), ...overrides,
});

const pass = (overrides = {}) => ({
  id: "pass-1", clientId: "client-1", locationId: "bansong", productId: "product-1",
  category: "pt_1_1_new", totalSessions: 20, serviceSessions: 0, contractPrice: 1300000,
  paymentMethod: "card", status: "active", baseUnitPrice: 25000, netContractPrice: 1181818,
  ...overrides,
});

const run = (overrides = {}) => summarizeIssues({
  month: "2026-09", entries: [issue()], passes: [pass()], ...overrides,
});

/* ── 기본 ─────────────────────────────────────────────────────────────── */

test("one issue becomes one row, grouped by location then issuer", () => {
  const summary = run();
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.byLocation[0].locationId, "bansong");
  assert.equal(summary.byLocation[0].byIssuer[0].issuedBy, "fc-1");
  assert.equal(summary.totals.count, 1);
  assert.equal(summary.totals.amount, 1300000);
});

test("the issuer is who sold it, not who teaches it", () => {
  /* FC매니저가 팔고 강사가 가르친다. instructorId 로 묶으면 FC 실적이 강사에게
     붙는다. */
  const summary = run({ entries: [issue({ createdBy: "fc-1", instructorId: "u9" })] });
  assert.equal(summary.byLocation[0].byIssuer[0].issuedBy, "fc-1");
});

test("payroll fields never reach the row", () => {
  // 발급 내역이지 급여가 아니다. 한 화면에 섞이면 둘 중 하나를 다른 하나로 읽는다.
  const [row] = run().rows;
  for (const forbidden of ["unitPrice", "rule", "baseUnitPrice", "netContractPrice"]) {
    assert.equal(forbidden in row, false, `${forbidden} 가 줄에 실려 있다`);
  }
});

/* ── 취소 ─────────────────────────────────────────────────────────────── */

test("a cancelled pass keeps its row but leaves the totals", () => {
  /* 지우면 대표가 "분명 팔았는데" 를 찾게 된다. 줄은 남기고 합계에서만 뺀다. */
  const summary = run({ passes: [pass({ status: "cancelled" })] });
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].cancelled, true);
  assert.equal(summary.totals.count, 0);
  assert.equal(summary.totals.amount, 0);
  assert.equal(summary.totals.cancelledCount, 1);
});

test("the cancel date is shown as M/D when the cancel entry is at hand", () => {
  const summary = run({
    passes: [pass({ status: "cancelled" })],
    entries: [issue(), { id: "e-c", type: "cancel", passId: "pass-1", occurredAt: at(20) }],
  });
  assert.equal(summary.rows[0].cancelledAtLabel, "9/20");
});

test("September issue cancelled in October: out of September totals, one notice in October", () => {
  /* 대표가 지정한 경우다. 9월 화면은 줄을 긋고 합계에서 빼되, 10월 매출에서는
     깎지 않는다 -- 그러면 두 달의 합이 실제와 달라진다. */
  const cancelledInOctober = { id: "e-c", type: "cancel", passId: "pass-1", occurredAt: new Date(2026, 9, 5, 10, 0) };

  const september = summarizeIssues({
    month: "2026-09",
    entries: [issue()],
    passes: [pass({ status: "cancelled" })],
    // 10월 취소는 9월 질의에 안 잡히므로 부르는 쪽이 따로 읽어 넘긴다.
    cancelEntries: [cancelledInOctober],
  });
  assert.equal(september.rows[0].cancelled, true, "9월 화면에서 줄이 그어진다");
  assert.equal(september.rows[0].cancelledAtLabel, "10/5");
  assert.equal(september.totals.count, 0, "9월 합계에서 빠진다");
  assert.equal(september.totals.priorMonthCancelCount, 0, "9월에는 알림이 없다");

  const october = summarizeIssues({
    month: "2026-10",
    entries: [cancelledInOctober],
    passes: [pass({ status: "cancelled" })],
  });
  assert.equal(october.rows.length, 0, "10월 목록에는 서지 않는다");
  assert.equal(october.totals.amount, 0, "10월 매출을 깎지 않는다");
  assert.equal(october.totals.priorMonthCancelCount, 1, "이전 달 발급 취소 1건");
});

/* ── 이관 ─────────────────────────────────────────────────────────────── */

test("a migrated pass is known by either marker", () => {
  // contractedAt 은 이관만 쓰고, csv_ 는 이관이 정해서 만드는 문서 id 다.
  assert.equal(isMigratedPass({ id: "csv_01012345678_2" }), true);
  assert.equal(isMigratedPass({ id: "abc", contractedAt: new Date(2026, 0, 1) }), true);
  assert.equal(isMigratedPass(pass()), false);
  assert.equal(isMigratedPass(null), false);
  // unitPrice 0 은 표식으로 쓰지 않는다 -- 0원 기타 상품이 정상 발급될 수 있다.
  assert.equal(isMigratedPass(pass({ baseUnitPrice: 0 })), false);
});

test("migrated issues stay out of the list and the totals, counted apart", () => {
  const summary = summarizeIssues({
    month: "2026-09",
    entries: [issue(), issue({ id: "e-2", passId: "csv_01099998888_1" })],
    passes: [pass(), pass({ id: "csv_01099998888_1", contractPrice: 900000 })],
  });
  assert.equal(summary.rows.length, 1, "이관 줄은 목록에도 없다");
  assert.equal(summary.totals.count, 1);
  assert.equal(summary.totals.amount, 1300000, "이관 금액이 매출에 안 섞인다");
  assert.equal(summary.totals.migratedCount, 1);
});

/* ── 신규 분리 ───────────────────────────────────────────────────────── */

test("new contracts are counted apart, and 2:1 new counts as new", () => {
  assert.deepEqual([...NEW_PASS_CATEGORIES], ["pt_1_1_new", "pt_2_1_new"]);
  const summary = summarizeIssues({
    month: "2026-09",
    entries: [
      issue({ id: "a", passId: "p-a", category: "pt_1_1_new" }),
      issue({ id: "b", passId: "p-b", category: "pt_2_1_new" }),
      issue({ id: "c", passId: "p-c", category: "pt_1_1_repurchase_event" }),
    ],
    passes: [
      pass({ id: "p-a", contractPrice: 1000000 }),
      pass({ id: "p-b", contractPrice: 2000000 }),
      pass({ id: "p-c", contractPrice: 3000000 }),
    ],
  });
  assert.equal(summary.totals.count, 3);
  assert.equal(summary.totals.amount, 6000000);
  assert.equal(summary.totals.newCount, 2);
  assert.equal(summary.totals.newAmount, 3000000);
});

test("a cancelled new contract leaves the new totals too", () => {
  const summary = run({ passes: [pass({ status: "cancelled" })] });
  assert.equal(summary.totals.newCount, 0);
  assert.equal(summary.totals.newAmount, 0);
});

/* ── 월 경계 ─────────────────────────────────────────────────────────── */

test("the month is cut by the centre's clock, not UTC", () => {
  /* 9월 30일 밤 발급이 10월로 넘어가면 FC 실적이 달을 건너뛴다. monthRange 와
     같은 경계를 쓴다. */
  const summary = summarizeIssues({
    month: "2026-09",
    entries: [
      issue({ id: "last", passId: "p-last", occurredAt: new Date(2026, 8, 30, 23, 59, 59) }),
      issue({ id: "next", passId: "p-next", occurredAt: new Date(2026, 9, 1, 0, 0, 0) }),
      issue({ id: "prev", passId: "p-prev", occurredAt: new Date(2026, 7, 31, 23, 59, 59) }),
    ],
    passes: [pass({ id: "p-last" }), pass({ id: "p-next" }), pass({ id: "p-prev" })],
  });
  assert.deepEqual(summary.rows.map((row) => row.entryId), ["last"]);
});

/* ── 못 읽은 회원권 ──────────────────────────────────────────────────── */

test("an issue whose pass is missing keeps its row and refuses to invent a price", () => {
  /* 0 으로 채우면 합계가 조용히 낮아진다. null 로 두고 몇 건인지 센다 -- 화면이
     "합계가 실제보다 낮을 수 있다" 를 말할 수 있어야 한다. */
  const summary = summarizeIssues({ month: "2026-09", entries: [issue()], passes: [] });
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].contractPrice, null);
  assert.equal(summary.rows[0].passMissing, true);
  assert.equal(summary.totals.missingPassCount, 1);
  assert.equal(summary.totals.amount, 0);
});

/* ── 빈 달 ───────────────────────────────────────────────────────────── */

test("an empty month is empty, not broken", () => {
  const summary = summarizeIssues({ month: "2026-09", entries: [], passes: [] });
  assert.deepEqual(summary.rows, []);
  assert.deepEqual(summary.byLocation, []);
  assert.equal(summary.totals.count, 0);
  assert.equal(summary.totals.migratedCount, 0);
});

/* ── CSV ─────────────────────────────────────────────────────────────── */

test("the csv is one line per issue, with the payroll columns absent", () => {
  const summary = run({ passes: [pass({ status: "cancelled" })] });
  const csv = issueReportCsv(summary, {
    nameOfLocation: () => "반송점",
    nameOfIssuer: () => "정예진",
    nameOfClient: () => "김하나",
    nameOfProduct: () => "1:1 20회",
    labelOfCategory: () => "1:1 신규",
    labelOfPayment: () => "카드",
    dayLabel: () => "2026-09-10",
  });
  const lines = csv.replace("﻿", "").split("\n");
  assert.equal(lines.length, 2, "머리말 한 줄 + 건 한 줄");
  assert.match(lines[0], /^월,날짜,지점,발급자,회원,상품,카테고리,총횟수,계약금액,결제수단,신규,취소$/);
  assert.match(lines[1], /반송점/);
  assert.match(lines[1], /1300000/);
  assert.match(lines[1], /취소/);
  for (const forbidden of ["단가", "25000", "1181818"]) {
    assert.doesNotMatch(csv, new RegExp(forbidden), `${forbidden} 가 CSV 에 있다`);
  }
});

/* ── 읽기 ─────────────────────────────────────────────────────────────── */

test("the loader asks for issues and cancels in one indexed query", async () => {
  /* 급여 집계와 같은 인덱스를 쓴다 (organizationId > type > occurredAt).
     organizationId 필터를 빼면 규칙이 질의 전체를 거부한다. */
  const asked = [];
  const store = {
    listOrganizationIssues: async (query) => { asked.push(query); return [issue()]; },
    readCancelEntry: async () => null,
  };
  const summary = await loadOrganizationMonthlyIssues("center-a", {
    month: "2026-09", store, listPassesFn: async () => [pass()],
  });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].organizationId, "center-a");
  assert.equal(asked[0].start.getMonth(), 8);
  assert.equal(asked[0].end.getMonth(), 9);
  assert.equal(summary.totals.count, 1);
});

test("a cancel outside the month is fetched one document at a time", async () => {
  /* 문서 id 가 정해져 있어 질의도 인덱스도 필요 없다. 보통 0건이다. */
  const read = [];
  const store = {
    listOrganizationIssues: async () => [issue()],
    readCancelEntry: async (organizationId, passId) => {
      read.push(passId);
      return { id: `${passId}_cancel`, type: "cancel", passId, occurredAt: new Date(2026, 9, 5) };
    },
  };
  const summary = await loadOrganizationMonthlyIssues("center-a", {
    month: "2026-09", store, listPassesFn: async () => [pass({ status: "cancelled" })],
  });
  assert.deepEqual(read, ["pass-1"]);
  assert.equal(summary.rows[0].cancelledAtLabel, "10/5");
});

test("a cancel date that cannot be read leaves the row standing", async () => {
  // 날짜 하나 때문에 화면 전체를 세우지 않는다. 그 줄은 날짜 없이 "취소" 로 선다.
  const store = {
    listOrganizationIssues: async () => [issue()],
    readCancelEntry: async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); },
  };
  const summary = await loadOrganizationMonthlyIssues("center-a", {
    month: "2026-09", store, listPassesFn: async () => [pass({ status: "cancelled" })],
  });
  assert.equal(summary.rows[0].cancelled, true);
  assert.equal(summary.rows[0].cancelledAtLabel, "");
});

test("a cancel already in this month is not fetched again", async () => {
  const read = [];
  const store = {
    listOrganizationIssues: async () => [issue(), { id: "e-c", type: "cancel", passId: "pass-1", occurredAt: at(20) }],
    readCancelEntry: async (organizationId, passId) => { read.push(passId); return null; },
  };
  await loadOrganizationMonthlyIssues("center-a", {
    month: "2026-09", store, listPassesFn: async () => [pass({ status: "cancelled" })],
  });
  assert.deepEqual(read, [], "이미 가진 항목을 다시 읽지 않는다");
});

test("an organizationId is required before anything is read", async () => {
  const store = { listOrganizationIssues: async () => { throw new Error("읽으면 안 된다"); }, readCancelEntry: async () => null };
  await assert.rejects(
    () => loadOrganizationMonthlyIssues("", { month: "2026-09", store, listPassesFn: async () => [] }),
    /Missing organizationId/,
  );
});

/* ── 심사용 회원은 발급 내역에서 빠진다 ────────────────────────────

   0원으로 발급하기로 했더라도 건수는 는다. 이달 판매가 실제보다 많아 보이면
   대표가 옛 엑셀과 맞춰 보며 한 건을 손으로 찾게 된다. */

test("a review-demo member's pass never reaches the issue report", async () => {
  const store = {
    listOrganizationIssues: async () => [
      issue({ id: "real", clientId: "client-1", passId: "pass-1" }),
      issue({ id: "demo", clientId: "review-demo-1", passId: "pass-demo" }),
    ],
    readCancelEntry: async () => null,
  };
  const summary = await loadOrganizationMonthlyIssues("center-a", {
    month: "2026-09", store,
    listPassesFn: async () => [pass(), pass({ id: "pass-demo", clientId: "review-demo-1" })],
    excludedClientIds: new Set(["review-demo-1"]),
  });
  assert.equal(summary.totals.count, 1, "가짜 발급이 세어졌다");
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].clientId, "client-1");
});

test("without the exclusion set the report is unchanged", async () => {
  const store = {
    listOrganizationIssues: async () => [issue()],
    readCancelEntry: async () => null,
  };
  const summary = await loadOrganizationMonthlyIssues("center-a", {
    month: "2026-09", store, listPassesFn: async () => [pass()],
  });
  assert.equal(summary.totals.count, 1);
});
