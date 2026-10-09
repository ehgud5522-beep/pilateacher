import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_SHEET_COLUMNS, MIGRATION_ERROR, PASS_SHEET_COLUMNS, applyClientMigration,
  applyPassMigration, clientIdForPhone, groupFailures, parseCsv, passIdFor,
  PASS_SHEET_DUET_COLUMNS, planClientMigration, planPassMigration, readSheet,
  totalLooksLikeItIncludesService,
} from "../../src/data/repositories/migration-repository.js";

const ORG = "center-a";
const LOCATIONS = [{ id: "bansong", name: "반송점" }, { id: "centum", name: "센텀점" }];
const INSTRUCTORS = [
  { userId: "u1", displayName: "정예진", fullRoomRate: 45000 },
  { userId: "u2", displayName: "박서연" },
];

const clientSheet = (...rows) => [CLIENT_SHEET_COLUMNS.join(","), ...rows].join("\n");
const passSheet = (...rows) => [PASS_SHEET_COLUMNS.join(","), ...rows].join("\n");

const passRow = (overrides = {}) => {
  const values = {
    회원명: "김하나", 연락처: "010-1234-5678", 지점: "반송점", 담당강사: "정예진",
    상품명: "1:1 20회 가을", 급여카테고리: "1:1 재등록(이벤트)",
    총세션: "20", 서비스세션: "2", 남은횟수: "8", 강사누적진행: "35",
    인수인계여부: "N", 계약금액: "1300000", 차수: "2", 결제수단: "카드",
    계약일: "2026-08-01", 만료일: "2027-02-01",
    ...overrides,
  };
  return PASS_SHEET_COLUMNS.map((column) => values[column]).join(",");
};

/**
 * @param {{ failPaths?: Array<string>, existingPaths?: Array<string> }} [options]
 *   failPaths    규칙이 거부하는 경로
 *   existingPaths 그중 실제로 이미 문서가 있는 경로. 나머지는 규칙이 거부한 것이다.
 */
function fakeStore({ failPaths = [], existingPaths = failPaths } = {}) {
  const written = new Map();
  const commits = [];
  const probed = [];
  return {
    written,
    commits,
    probed,
    commit: async (writes) => {
      for (const write of writes) {
        if (failPaths.includes(write.path)) {
          throw Object.assign(new Error("denied"), { code: "permission-denied" });
        }
      }
      commits.push(writes);
      for (const write of writes) written.set(write.path, write.data);
    },
    serverTimestamp: async () => "SERVER_TIME",
    exists: async (path) => { probed.push(path); return existingPaths.includes(path); },
  };
}

/* ── CSV 파싱 ─────────────────────────────────────────────────────────── */

test("quoted commas and newlines survive parsing", () => {
  const rows = parseCsv('a,b\n"김,하나","줄\n바꿈"\n');
  assert.deepEqual(rows, [["a", "b"], ["김,하나", "줄\n바꿈"]]);
});

test("a doubled quote is one quote", () => {
  assert.deepEqual(parseCsv('a\n"그는 ""안녕"" 했다"'), [["a"], ['그는 "안녕" 했다']]);
});

test("excel's trailing blank lines and BOM are ignored", () => {
  const rows = parseCsv("﻿a,b\r\n1,2\r\n\r\n,\r\n");
  assert.deepEqual(rows, [["a", "b"], ["1", "2"]]);
});

test("a sheet reports the columns it is missing rather than guessing", () => {
  const { missingColumns } = readSheet("회원명,연락처\n김하나,01012345678", CLIENT_SHEET_COLUMNS);
  assert.deepEqual(missingColumns, ["지점"]);
});

/* ── 1차: 회원 ────────────────────────────────────────────────────────── */

test("a client row becomes a document keyed by the phone alone", () => {
  /* 이름을 id 에 넣으면 개명이나 오타 수정으로 같은 사람이 두 명이 된다. */
  const { writes, failures } = planClientMigration(
    clientSheet("김하나,010-1234-5678,반송점"),
    { locations: LOCATIONS, createdBy: "owner-a" },
  );
  assert.deepEqual(failures, []);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].clientId, "csv_01012345678");
  assert.equal(writes[0].data.locationId, "bansong");
  assert.equal(writes[0].data.phone, "01012345678", "연락처는 숫자만 저장한다");
});

test("the same phone twice is reported, never silently merged", () => {
  /* 가족이 한 번호를 쓰는 경우가 있는지 우리는 모른다. 덮어쓰면 한 사람이 사라진다. */
  const { writes, failures } = planClientMigration(
    clientSheet("김하나,010-1234-5678,반송점", "김두리,010-1234-5678,반송점"),
    { locations: LOCATIONS },
  );
  assert.equal(writes.length, 1, "첫 행만 살린다");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, MIGRATION_ERROR.DUPLICATE_PHONE);
  assert.equal(failures[0].line, 3, "엑셀에서 찾는 행 번호와 맞는다");
});

test("a bad row does not stop the good ones", () => {
  // 120건 중 3건 때문에 전부 되돌리면 다시 올리는 비용이 크다.
  const { writes, failures } = planClientMigration(
    clientSheet(
      "김하나,010-1111-1111,반송점",
      ",010-2222-2222,반송점",
      "박세명,,반송점",
      "이두리,010-3333-3333,없는지점",
      "정네리,010-4444-4444,센텀점",
    ),
    { locations: LOCATIONS },
  );
  assert.deepEqual(writes.map((item) => item.name), ["김하나", "정네리"]);
  assert.deepEqual(failures.map((item) => item.reason), [
    MIGRATION_ERROR.MISSING_FIELD,
    MIGRATION_ERROR.MISSING_FIELD,
    MIGRATION_ERROR.LOCATION_NOT_FOUND,
  ]);
});

/* ── 2차: 회원권 ──────────────────────────────────────────────────────── */

const clients = [{ id: "csv_01012345678", name: "김하나", phone: "01012345678", locationId: "bansong" }];
const planPasses = (sheet, extra = {}) => planPassMigration(sheet, {
  clients, locations: LOCATIONS, instructors: INSTRUCTORS, createdBy: "owner-a", ...extra,
});

test("a pass row finds its client by phone and gets a deterministic id", () => {
  const { writes, failures } = planPasses(passSheet(passRow()));
  assert.deepEqual(failures, []);
  assert.equal(writes[0].clientId, "csv_01012345678");
  assert.equal(writes[0].passId, passIdFor("csv_01012345678", 2));
  assert.equal(writes[0].instructorId, "u1");
});

test("korean labels become stored values through the one shared table", () => {
  const { writes } = planPasses(passSheet(
    passRow({ 급여카테고리: "1:1 재등록(정상)", 결제수단: "계좌", 차수: "3" }),
  ));
  assert.equal(writes[0].pass.category, "pt_1_1_repurchase_normal");
  assert.equal(writes[0].pass.paymentMethod, "transfer");
});

test("a label that is not on the list fails the row instead of being guessed", () => {
  /* 잘못 추측한 카테고리는 그 회원권의 모든 차감 단가를 틀리게 만든다. */
  const { failures } = planPasses(passSheet(
    passRow({ 급여카테고리: "1:1 특별" }),
    passRow({ 결제수단: "수표", 차수: "3" }),
  ));
  assert.equal(failures.length, 2);
  assert.ok(failures.every((item) => item.reason === MIGRATION_ERROR.UNKNOWN_LABEL));
});

test("an unknown or ambiguous instructor name fails the row", () => {
  // 대표는 uid 를 모른다. 잘못 고른 강사에게 한 달치 급여가 쌓인다.
  const twins = [...INSTRUCTORS, { userId: "u3", displayName: "정예진" }];
  const missing = planPasses(passSheet(passRow({ 담당강사: "없는강사" })));
  assert.equal(missing.failures[0].reason, MIGRATION_ERROR.INSTRUCTOR_NOT_FOUND);
  const ambiguous = planPasses(passSheet(passRow()), { instructors: twins });
  assert.equal(ambiguous.failures[0].reason, MIGRATION_ERROR.INSTRUCTOR_AMBIGUOUS);
});

test("a client that first-stage upload never made fails the row", () => {
  const { failures } = planPasses(passSheet(passRow({ 연락처: "010-9999-8888" })));
  assert.equal(failures[0].reason, MIGRATION_ERROR.CLIENT_NOT_FOUND);
});

test("the hand-over column becomes the flag the pricing rule reads", () => {
  for (const yes of ["Y", "y", "예", "O", "true", "1"]) {
    assert.equal(planPasses(passSheet(passRow({ 인수인계여부: yes }))).writes[0].pass.handedOver, true, yes);
  }
  for (const no of ["N", "", "아니오", "-"]) {
    assert.equal(planPasses(passSheet(passRow({ 인수인계여부: no }))).writes[0].pass.handedOver, false, JSON.stringify(no));
  }
});

test("the accumulated count rides along for the totals document", () => {
  assert.equal(planPasses(passSheet(passRow({ 강사누적진행: "99" }))).writes[0].priorSessions, 99);
  assert.equal(planPasses(passSheet(passRow({ 강사누적진행: "0" }))).writes[0].priorSessions, 0);
});

test("numbers and dates are read strictly", () => {
  const broken = [
    { 총세션: "스무번" }, { 총세션: "0" }, { 남은횟수: "-1" },
    { 계약금액: "백삼십만" }, { 차수: "0" }, { 강사누적진행: "" },
    { 만료일: "내년" }, { 계약일: "" },
  ];
  for (const override of broken) {
    const { failures } = planPasses(passSheet(passRow(override)));
    assert.equal(failures.length, 1, JSON.stringify(override));
    assert.ok(
      [MIGRATION_ERROR.INVALID_NUMBER, MIGRATION_ERROR.INVALID_DATE, MIGRATION_ERROR.MISSING_FIELD]
        .includes(failures[0].reason),
      JSON.stringify(override),
    );
  }
  // 천 단위 쉼표와 슬래시 날짜는 엑셀이 실제로 내보내는 모양이다.
  const { writes } = planPasses(passSheet(passRow({ 계약금액: '"1,300,000"', 만료일: "2027/2/1" })));
  assert.equal(writes[0].pass.contractPrice, 1300000);
  assert.equal(writes[0].pass.expiresAt.getFullYear(), 2027);
});

/* ── 업로드 ───────────────────────────────────────────────────────────── */

test("a client upload writes one document per row", async () => {
  const store = fakeStore();
  const { writes } = planClientMigration(clientSheet("김하나,010-1234-5678,반송점"), { locations: LOCATIONS });
  const result = await applyClientMigration(ORG, writes, { store });
  assert.equal(result.succeeded.length, 1);
  assert.deepEqual(result.failures, []);
  const written = store.written.get("organizations/center-a/clients/csv_01012345678");
  assert.equal(written.organizationId, ORG);
  assert.equal(written.createdAt, "SERVER_TIME", "규칙이 createdAt == request.time 을 요구한다");
});

test("a pass upload writes the pass, its issue entry and the totals together", async () => {
  const store = fakeStore();
  const { writes } = planPasses(passSheet(passRow()));
  await applyPassMigration(ORG, writes, { store });
  assert.equal(store.commits.length, 1, "한 행은 한 배치다");
  assert.deepEqual(store.commits[0].map((write) => write.path), [
    "organizations/center-a/passes/csv_csv_01012345678_2",
    "organizations/center-a/passes/csv_csv_01012345678_2/ledger/csv_csv_01012345678_2_issue",
    "organizations/center-a/instructorClientTotals/u1_csv_01012345678",
  ]);
});

test("the issue entry carries the sessions that were actually left", async () => {
  /* 이미 진행한 회차는 옛 엑셀에 있고 원장으로 옮기지 않는다 -- 옮기면 지난
     급여가 이 앱에서 두 번 계산된다. */
  const store = fakeStore();
  const { writes } = planPasses(passSheet(passRow({ 남은횟수: "8" })));
  await applyPassMigration(ORG, writes, { store });
  const entry = store.commits[0][1].data;
  assert.equal(entry.delta, 8);
  assert.equal(entry.type, "issue");
  assert.equal(entry.clientId, "csv_01012345678");
});

test("the totals document is seeded with the count from the sheet", async () => {
  const store = fakeStore();
  const { writes } = planPasses(passSheet(passRow({ 강사누적진행: "35" })));
  await applyPassMigration(ORG, writes, { store });
  assert.deepEqual(store.commits[0][2].data, {
    organizationId: ORG, instructorId: "u1", clientId: "csv_01012345678", sessions: 35,
  });
});

test("a second upload of the same file adds nothing and says so", async () => {
  /* 이미 있는 문서에 대한 set 은 create 가 아니라 update 다. 대표는 자기 센터의
     회원권을 고칠 수 있는 사람이므로 규칙은 그것을 막지 않는다 -- 막는 것은
     쓰기 전의 확인이다. 그러지 않으면 두 번째 업로드가 그 사이 차감된 잔여
     횟수를 9월 말 값으로 되돌린다. */
  const { writes } = planPasses(passSheet(passRow()));
  const store = fakeStore({ failPaths: [], existingPaths: ["organizations/center-a/passes/csv_csv_01012345678_2"] });
  const result = await applyPassMigration(ORG, writes, { store });
  assert.equal(result.succeeded.length, 0);
  assert.equal(result.failures[0].reason, MIGRATION_ERROR.ALREADY_EXISTS);
  assert.equal(store.written.size, 0, "이미 있는 행은 아무것도 건드리지 않는다");
  assert.equal(store.commits.length, 0, "쓰기를 시도조차 하지 않는다");
});

test("a row is not written when we cannot tell whether it is already there", async () => {
  /* "있는지 모르겠다"에서 덮어쓰기로 넘어가면 잃는 쪽이 회원의 잔여 횟수다. */
  const { writes } = planPasses(passSheet(passRow()));
  const store = fakeStore();
  store.exists = async () => { throw Object.assign(new Error("nope"), { code: "unavailable" }); };
  const result = await applyPassMigration(ORG, writes, { store });
  assert.equal(result.succeeded.length, 0);
  assert.equal(store.written.size, 0);
  assert.equal(result.failures[0].reason, MIGRATION_ERROR.WRITE_FAILED);
  assert.match(result.failures[0].message, /코드 unavailable/, "원본 코드를 남긴다");
});

test("one refused row does not stop the others", async () => {
  const sheet = passSheet(passRow(), passRow({ 차수: "3", 남은횟수: "4" }));
  const { writes } = planPasses(sheet);
  const store = fakeStore({ failPaths: ["organizations/center-a/passes/csv_csv_01012345678_2"] });
  const result = await applyPassMigration(ORG, writes, { store });
  assert.equal(result.succeeded.length, 1);
  assert.equal(result.failures.length, 1);
  assert.ok(store.written.has("organizations/center-a/passes/csv_csv_01012345678_3"));
});

test("a rules rejection is not reported as a row that was already uploaded", async () => {
  /* 없던 문서인데 규칙이 거부했다. 이것을 "이미 올렸다"로 읽으면 대표는 한 줄도
     저장되지 않은 업로드를 끝난 것으로 보고 넘어간다. */
  const path = "organizations/center-a/passes/csv_csv_01012345678_2";
  const { writes } = planPasses(passSheet(passRow()));
  const store = fakeStore({ failPaths: [path], existingPaths: [] });
  const result = await applyPassMigration(ORG, writes, { store });
  assert.equal(result.failures[0].reason, MIGRATION_ERROR.WRITE_FAILED);
  assert.match(result.failures[0].message, /코드 permission-denied/, "원본 코드를 남긴다");
});

/* ── 기준 단가 ────────────────────────────────────────────────────────── */

test("the base unit price comes from the table, not from the sheet", async () => {
  /* 대표가 백 줄에 단가를 손으로 적으면 그 오타가 곧 급여 숫자가 된다.
     그래서 양식에 단가 칸이 없고, 카테고리가 값을 정한다. */
  const { writes } = planPasses(passSheet(passRow({ 급여카테고리: "1:1 신규" })));
  assert.equal(writes[0].pass.baseUnitPrice, 25000);
});

test("a full-room category takes the rate of the instructor who teaches it", () => {
  const { writes } = planPasses(passSheet(passRow({ 급여카테고리: "1:1 재등록(정상)" })));
  assert.equal(writes[0].pass.baseUnitPrice, 45000, "정예진의 풀방금액");
});

test("a full-room category without a rate fails instead of being seeded with zero", () => {
  /* 0 으로 심으면 그 회원권의 수업이 통째로 무보수로 기록되고, 원장은 고칠 수
     없다. 강사 단가를 먼저 채우라고 말한다. */
  const { failures, writes } = planPasses(passSheet(passRow({
    급여카테고리: "1:1 재등록(정상)", 담당강사: "박서연",
  })));
  assert.equal(writes.length, 0);
  assert.equal(failures[0].reason, MIGRATION_ERROR.MISSING_RATE);
  assert.match(failures[0].message, /풀방금액/);
});

test("a category the table cannot price fails with a row the owner can act on", () => {
  const { failures } = planPasses(passSheet(passRow({ 급여카테고리: "기타" })));
  assert.equal(failures[0].reason, MIGRATION_ERROR.MISSING_RATE);
  assert.match(failures[0].message, /직접 발급/);
});

test("failures are grouped so the owner knows what to fix", () => {
  const grouped = groupFailures([
    { line: 5, reason: MIGRATION_ERROR.UNKNOWN_LABEL },
    { line: 2, reason: MIGRATION_ERROR.UNKNOWN_LABEL },
    { line: 9, reason: MIGRATION_ERROR.CLIENT_NOT_FOUND },
  ]);
  assert.equal(grouped[0].reason, MIGRATION_ERROR.UNKNOWN_LABEL, "많은 사유가 앞이다");
  assert.deepEqual(grouped[0].rows.map((item) => item.line), [2, 5], "행 번호순");
  assert.equal(grouped[1].rows.length, 1);
});

test("a phone with no digits gets no id at all", () => {
  assert.equal(clientIdForPhone("---"), "");
  assert.equal(clientIdForPhone(undefined), "");
});

/* ── 듀엣 이관 ────────────────────────────────────────────────────────────

   듀엣은 계약서가 하나이고 회원권도 하나다. 그래서 한 줄에 회원 둘을 적는다 --
   두 줄로 적으면 회원권 문서 id 가 passIdFor(clientId, 차수) 라 두 개가
   만들어지고, 그것을 합칠 키가 틀리면 30회짜리가 두 개 생긴다. 이관은
   되돌릴 수 없다. */

const DUET_COLUMNS = [...PASS_SHEET_COLUMNS, ...PASS_SHEET_DUET_COLUMNS];
const duetSheet = (...rows) => [DUET_COLUMNS.join(","), ...rows].join("\n");
const duetRow = (overrides = {}) => {
  const values = {
    회원명: "김하나", 연락처: "010-1234-5678", 지점: "반송점", 담당강사: "정예진",
    상품명: "2:1 30회", 급여카테고리: "2:1 신규",
    총세션: "30", 서비스세션: "0", 남은횟수: "30", 강사누적진행: "35",
    인수인계여부: "N", 계약금액: "1800000", 차수: "1", 결제수단: "카드",
    계약일: "2026-08-01", 만료일: "2027-02-01",
    회원명2: "박두리", 연락처2: "010-9999-8888", 강사누적진행2: "35",
    ...overrides,
  };
  return DUET_COLUMNS.map((column) => values[column]).join(",");
};
const duetClients = [
  ...clients,
  { id: "csv_01099998888", name: "박두리", phone: "01099998888", locationId: "bansong" },
];
const planDuet = (sheet, extra = {}) => planPassMigration(sheet, {
  clients: duetClients, locations: LOCATIONS, instructors: INSTRUCTORS, createdBy: "owner-a", ...extra,
});

test("one row with two members makes one pass", () => {
  const { writes, failures } = planDuet(duetSheet(duetRow()));
  assert.deepEqual(failures, []);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].pass.clientIds, ["csv_01012345678", "csv_01099998888"]);
  // 30회 계약이면 30회다. 두 명이라고 60회가 되지 않는다.
  assert.equal(writes[0].pass.remainingCount, 30);
});

test("the duet columns are optional, so a file without them still uploads", () => {
  /* 1:1 이 센터의 대부분이고, 이 열들이 없는 파일이 그대로 올라가야 한다.
     그때 회원권에는 clientIds 가 아예 붙지 않는다 -- 읽는 쪽이 대표 한 명으로 읽는다. */
  const { writes, failures } = planPasses(passSheet(passRow()));
  assert.deepEqual(failures, []);
  assert.equal("clientIds" in writes[0].pass, false);
  /* 열이 있어도 비어 있으면 1:1 이다 -- 단, 카테고리가 1:1 일 때만이다.
     이 줄은 한동안 2:1 행으로 적혀 있었고, 그래서 "짝 없는 2:1 이 1:1
     회원권이 된다" 를 통과로 못 박고 있었다. */
  const blank = planDuet(duetSheet(
    duetRow({ 급여카테고리: "1:1 신규", 회원명2: "", 연락처2: "", 강사누적진행2: "" }),
  ));
  assert.deepEqual(blank.failures, []);
  assert.equal("clientIds" in blank.writes[0].pass, false);
});

test("a duet without the partner's phone fails that row and says what to get", () => {
  /* 대표 한 명만 적어 두는 경우가 많다. 업로드를 멈추지 않고 그 행만 돌려준다 --
     대표가 강사에게 번호를 받아 그 행만 고쳐 다시 올린다. */
  const { writes, failures } = planDuet(duetSheet(
    duetRow(),
    duetRow({ 회원명: "이세리", 연락처: "010-1234-5678", 차수: "2", 회원명2: "최네리", 연락처2: "" }),
  ));
  assert.equal(writes.length, 1, "좋은 행은 그대로 올라간다");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, MIGRATION_ERROR.DUET_PARTNER_PHONE_MISSING);
  assert.match(failures[0].message, /듀엣 상대의 연락처가 필요합니다/);
  assert.equal(failures[0].line, 3, "엑셀에서 찾는 행 번호와 맞는다");
});

test("no temporary phone number is invented for a missing partner", () => {
  /* 한 번 심으면 그 번호가 그 회원의 정체가 되어 그대로 남고, 나중에 진짜
     번호가 오면 같은 사람이 둘이 된다. */
  const { writes } = planDuet(duetSheet(duetRow({ 연락처2: "" })));
  assert.equal(writes.length, 0);
});

test("a partner who is not in the client sheet is a different problem", () => {
  // 고칠 것이 다르다 -- 번호를 받아 오는 일이 아니라 1차 시트에 줄을 더하는 일이다.
  const { failures } = planDuet(duetSheet(duetRow({ 연락처2: "010-0000-0000" })));
  assert.equal(failures[0].reason, MIGRATION_ERROR.DUET_PARTNER_NOT_FOUND);
});

test("the same person cannot be both halves of a duet", () => {
  // 회차는 하나인데 누적이 둘 오르고, 20회 판정이 두 배 속도로 지나간다.
  const { failures } = planDuet(duetSheet(duetRow({ 연락처2: "010-1234-5678" })));
  assert.equal(failures[0].reason, MIGRATION_ERROR.DUET_PARTNER_NOT_FOUND);
  assert.match(failures[0].message, /본인과 같은 연락처/);
});

test("the partner's cumulative count is asked for, never copied from the anchor", () => {
  /* 짐작하면 급여가 틀린다. 심지 않으면 0 에서 시작해 처음 스무 회차가 전부
     신규 단가 25,000 으로 기록되고, 대표의 값을 복사하면 그것대로 거짓이다. */
  const { failures } = planDuet(duetSheet(duetRow({ 강사누적진행2: "" })));
  assert.equal(failures[0].reason, MIGRATION_ERROR.DUET_PARTNER_SESSIONS_MISSING);
  assert.match(failures[0].message, /강사누적진행이 필요합니다/);
});

/* ── 카테고리와 짝이 어긋난 행 ─────────────────────────────────────────
   isDuetPass 는 사람 수만 본다 (pass-clients.js:69). 상품명도 카테고리도 보지
   않으므로, 짝 없는 2:1 은 1:1 회원권이 되어 혼자 온 수업에서 빠진다. 이관이
   막지 않으면 아무도 막지 않는다. */

test("a duet category with no partner at all fails that row", () => {
  /* 조용한 쪽이라 테스트가 필요하다. 아래의 짝 블록은 "짝이 적혔으면" 으로
     시작하므로, 세 칸이 모두 비면 거기까지 가지도 않고 1:1 회원권이 된다. */
  const { writes, failures } = planDuet(duetSheet(
    duetRow(),
    duetRow({ 회원명: "이세리", 연락처: "010-1234-5678", 차수: "2", 회원명2: "", 연락처2: "", 강사누적진행2: "" }),
  ));
  assert.equal(writes.length, 1, "좋은 행은 그대로 올라간다");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, MIGRATION_ERROR.DUET_PARTNER_REQUIRED);
  assert.equal(failures[0].line, 3, "엑셀에서 찾는 행 번호와 맞는다");
  assert.match(failures[0].message, /급여카테고리를 1:1 로/, "고칠 방법이 두 가지라 둘 다 적는다");
});

test("a duet category fails even when the sheet has no partner columns", () => {
  /* 열이 아예 없는 파일로도 2:1 을 올릴 수 있었다. 그 경로가 지금까지
     열려 있었고, 반송·율하의 2:1 이 그리로 들어갔다면 전부 1:1 이 된다. */
  const { writes, failures } = planPasses(passSheet(passRow({ 급여카테고리: "2:1 신규" })));
  assert.equal(writes.length, 0);
  assert.equal(failures[0].reason, MIGRATION_ERROR.DUET_PARTNER_REQUIRED);
});

test("the new 2:1 event category needs a partner like every other 2:1", () => {
  /* 2026-10-09 에 늘린 카테고리다. 짝 목록이 네 곳에 흩어져 있었고, 이관
     검사만 빠지면 **짝 없는 2:1 이 그대로 들어와 1:1 회원권이 된다** -- 그
     회원권은 2:1 수업에서 빠지지 않고, 회원은 자기가 산 것과 다른 회차를
     잃는다. 목록을 constants.mjs 하나로 모은 이유가 이것이다. */
  const { writes, failures } = planPasses(passSheet(passRow({ 급여카테고리: "2:1 재등록(이벤트)" })));
  assert.equal(writes.length, 0);
  assert.equal(failures[0].reason, MIGRATION_ERROR.DUET_PARTNER_REQUIRED);
});

test("a duet row with only the partner's count fails rather than slipping through", () => {
  /* 강사누적진행2 만 적힌 행. "짝을 가리켰는가" 를 세 칸으로 판단하면 이 행이
     검사도 짝 블록도 모두 지나가, 막으려던 바로 그 모양이 만들어진다. */
  const { writes, failures } = planDuet(duetSheet(duetRow({ 회원명2: "", 연락처2: "" })));
  assert.equal(writes.length, 0);
  assert.equal(failures[0].reason, MIGRATION_ERROR.DUET_PARTNER_REQUIRED);
});

test("a solo category with a partner fails that row", () => {
  // 짝은 자기가 사지 않은 회원권에서 회차가 빠진다.
  const { failures } = planDuet(duetSheet(duetRow({ 급여카테고리: "1:1 신규" })));
  assert.equal(failures[0].reason, MIGRATION_ERROR.DUET_PARTNER_UNEXPECTED);
  assert.match(failures[0].message, /급여카테고리를 2:1 로/);
});

test("a solo row with a half-written partner fails instead of uploading quietly", () => {
  /* 세 칸 중 하나라도 손댔으면 걸린다. 이름을 적다 만 행이 1:1 로 올라가면
     대표는 자기가 적은 짝이 어디로 갔는지 영영 모른다. */
  for (const stray of [{ 회원명2: "박두리" }, { 연락처2: "010-9999-8888" }, { 강사누적진행2: "35" }]) {
    const blank = { 회원명2: "", 연락처2: "", 강사누적진행2: "" };
    const { failures } = planDuet(duetSheet(duetRow({ 급여카테고리: "1:1 신규", ...blank, ...stray })));
    assert.equal(failures[0]?.reason, MIGRATION_ERROR.DUET_PARTNER_UNEXPECTED, JSON.stringify(stray));
  }
});

test("categories that do not decide the head count are left as written", () => {
  /* 서비스·렛미인·기타는 사람 수가 상품으로 정해지지 않는다. 모르는 것을
     규칙으로 만들면 멀쩡한 행이 막힌다. */
  const withPartner = planDuet(duetSheet(duetRow({ 급여카테고리: "서비스" })));
  assert.deepEqual(withPartner.failures, []);
  assert.equal(withPartner.writes[0].pass.clientIds.length, 2);

  const alone = planDuet(duetSheet(
    duetRow({ 급여카테고리: "렛미인", 회원명2: "", 연락처2: "", 강사누적진행2: "" }),
  ));
  assert.deepEqual(alone.failures, []);
  assert.equal("clientIds" in alone.writes[0].pass, false);
});

test("both members get their own running total seeded", async () => {
  const { writes } = planDuet(duetSheet(duetRow({ 강사누적진행: "35", 강사누적진행2: "12" })));
  const store = fakeStore();
  await applyPassMigration("center-a", writes, { store });
  const totals = [...store.written.keys()].filter((path) => path.includes("instructorClientTotals"));
  assert.deepEqual(totals, [
    "organizations/center-a/instructorClientTotals/u1_csv_01012345678",
    "organizations/center-a/instructorClientTotals/u1_csv_01099998888",
  ]);
  assert.equal(store.written.get(totals[0]).sessions, 35);
  assert.equal(store.written.get(totals[1]).sessions, 12);
});

/* ── 번호가 바뀐 회원이 섞인 엑셀 ────────────────────────────────────

   예전에는 `csv_<번호>` 를 만들어 그것을 그 회원으로 삼았다. 번호를 바꿀 수
   있게 된 뒤로 그 가정이 깨진다 -- 연락처를 고친 회원은 문서 id 가 옛 번호인
   채로 남아 있고(그게 정상이다), 새 번호로 적힌 엑셀을 올리면 같은 사람이
   회원 둘이 된다. */

test("새 번호로 적힌 행은 기존 회원을 그대로 쓴다", () => {
  const clients = [
    { id: "csv_01012345678", name: "김하나", phone: "01099998888", previousPhones: ["01012345678"] },
  ];
  const { writes, failures } = planClientMigration(
    clientSheet("김하나,010-9999-8888,반송점"),
    { locations: LOCATIONS, clients },
  );
  assert.deepEqual(failures, []);
  assert.equal(writes.length, 1);
  // 문서 id 는 옛 번호 그대로다. 원장·누적·수업이 전부 이 id 를 가리킨다.
  assert.equal(writes[0].clientId, "csv_01012345678");
  assert.equal(writes[0].existing, true);
  assert.equal(writes[0].data.phone, "01099998888");
});

test("예전 번호로 적힌 행은 막는다", () => {
  /* 번호를 바꾸기 전에 내려받은 엑셀이다. 새로 만들면 또 회원 둘이 된다. */
  const clients = [
    { id: "csv_01012345678", name: "김하나", phone: "01099998888", previousPhones: ["01012345678"] },
  ];
  const { writes, failures } = planClientMigration(
    clientSheet("김하나,010-1234-5678,반송점"),
    { locations: LOCATIONS, clients },
  );
  assert.deepEqual(writes, []);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, "previous_phone");
  assert.match(failures[0].message, /김하나 회원의 예전 번호/);
});

test("예전 번호를 다른 회원이 새로 쓰고 있으면 그쪽이 이긴다", () => {
  /* 번호는 회수됐다 재발급된다. 지금 누군가 쓰는 번호를 "예전 번호" 라고
     막으면 실재하는 회원을 못 올린다. */
  const clients = [
    { id: "csv_01012345678", name: "김하나", phone: "01099998888", previousPhones: ["01012345678"] },
    { id: "csv_01055556666", name: "정세인", phone: "01012345678" },
  ];
  const { writes, failures } = planClientMigration(
    clientSheet("정세인,010-1234-5678,반송점"),
    { locations: LOCATIONS, clients },
  );
  assert.deepEqual(failures, []);
  assert.equal(writes[0].clientId, "csv_01055556666");
});

test("처음 보는 번호는 예전처럼 새로 만든다", () => {
  const { writes, failures } = planClientMigration(
    clientSheet("박두리,010-5555-6666,반송점"),
    { locations: LOCATIONS, clients: [] },
  );
  assert.deepEqual(failures, []);
  assert.equal(writes[0].clientId, "csv_01055556666");
  assert.equal(writes[0].existing, false);
});

/* ── 이관 전에 이미 쓴 서비스 ─────────────────────────────────────────────
   엑셀에 "쓴 서비스" 칸이 없다. 0 으로 두면 이미 쓴 서비스가 다시 주어지고,
   이관 후 첫 수업이 서비스로 빠져 센터가 그 회차를 한 번 더 지원한다. */

test("쓴 횟수에서 서비스 사용량을 센다", () => {
  /* 서비스부터 쓰는 규칙이라 쓴 횟수가 서비스 개수를 넘기 전까지는 전부
     서비스다: serviceUsed = min(서비스, (총 + 서비스) - 잔여) */
  const used = (total, service, remaining) => planPasses(passSheet(passRow({
    총세션: String(total), 서비스세션: String(service), 남은횟수: String(remaining),
  }))).writes[0].pass.serviceUsed;

  assert.equal(used(20, 2, 22), 0, "한 번도 안 썼다");
  assert.equal(used(20, 2, 21), 1, "서비스부터 빠진다");
  assert.equal(used(20, 2, 20), 2, "서비스를 다 썼다");
  assert.equal(used(20, 2, 8), 2, "그 뒤로는 정규만 줄어든다");
  assert.equal(used(20, 0, 8), 0, "서비스가 없으면 0 이다");
});

test("잔여가 총보다 크면 음수로 가지 않는다", () => {
  /* 이관분은 총 횟수와 잔여가 따로 적혀 와서 어긋난 행이 있다. */
  const { writes } = planPasses(passSheet(passRow({
    총세션: "20", 서비스세션: "2", 남은횟수: "99",
  })));
  assert.equal(writes[0].pass.serviceUsed, 0);
});

/* ── 총세션에 서비스가 섞인 행 ────────────────────────────────────────── */

test("상품명 숫자 + 서비스 = 총세션이면 섞인 것으로 본다", () => {
  const mixed = (productName, totalSessions, serviceSessions) =>
    totalLooksLikeItIncludesService({ productName, totalSessions, serviceSessions });

  assert.equal(mixed("깍두기 40회e", 43, 3), true);
  assert.equal(mixed("30회 2차", 34, 4), true);
  assert.equal(mixed("50회", 51, 1), true);
  // 맞지 않으면 건드리지 않는다.
  assert.equal(mixed("깍두기 40회e", 40, 3), false);
  assert.equal(mixed("깍두기 40회e", 43, 0), false, "서비스가 없으면 섞일 것이 없다");
});

test("숫자가 여럿이면 뒤쪽을 판 횟수로 본다", () => {
  // "2:1 PT 33 ->100 세션업" 은 100회를 판 것이다.
  assert.equal(totalLooksLikeItIncludesService({
    productName: "2:1 PT 33회 ->100회 세션업", totalSessions: 102, serviceSessions: 2,
  }), true);
});

test("상품명에 숫자가 없으면 맞혀 보지 않는다", () => {
  assert.equal(totalLooksLikeItIncludesService({ productName: "깍두기", totalSessions: 43, serviceSessions: 3 }), false);
  assert.equal(totalLooksLikeItIncludesService({}), false);
});

test("섞인 행은 그 행만 실패하고 나머지는 올라간다", () => {
  /* 짐작해서 빼 주지 않는다 -- 상품명의 숫자가 실제로 판 횟수가 아닌 경우가
     있고, 그때 조용히 깎으면 회원이 산 회차가 사라진다. */
  const { writes, failures } = planPasses(passSheet(
    passRow(),
    passRow({ 회원명: "이세리", 차수: "2", 상품명: "깍두기 40회e", 총세션: "43", 서비스세션: "3", 남은횟수: "43" }),
  ));
  assert.equal(writes.length, 1, "좋은 행은 그대로 올라간다");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, MIGRATION_ERROR.TOTAL_INCLUDES_SERVICE);
  assert.match(failures[0].message, /총세션에는 서비스를 빼고 적어 주세요/);
});
