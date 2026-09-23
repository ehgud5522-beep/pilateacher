"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FORBIDDEN_FIELDS, HISTORY_FIELDS, PASS_FIELDS, VIEW_FIELDS, buildMemberView,
} = require("../src/member-view");

const NOW = new Date(2026, 8, 20, 12, 0, 0);

const client = (overrides = {}) => ({
  id: "client-a", organizationId: "center-a", name: "김하나", userId: "uid-1",
  phone: "01012345678", status: "active", ...overrides,
});

const pass = (overrides = {}) => ({
  id: "pass-1", organizationId: "center-a", clientId: "client-a", locationId: "bansong",
  productId: "product-1", category: "pt_1_1_repurchase_event", purchaseRound: 2,
  totalSessions: 20, serviceSessions: 2, remainingCount: 8, status: "active",
  expiresAt: new Date(2027, 0, 31),
  // 새어 나가면 안 되는 것들. 원본에는 늘 함께 있다.
  baseUnitPrice: 30000, netContractPrice: 1181818, contractPrice: 1300000,
  paymentMethod: "card", handedOver: false, serviceUsed: 0,
  instructorId: "u1", createdBy: "owner-a",
  ...overrides,
});

const entry = (overrides = {}) => ({
  id: "e-1", organizationId: "center-a", passId: "pass-1", clientId: "client-a",
  type: "deduct", delta: -1, occurredAt: new Date(2026, 8, 18, 19, 0),
  // 급여가 항목마다 붙어 있다.
  category: "pt_1_1_repurchase_event", unitPrice: 30000, rule: "base_category",
  instructorId: "u1", createdBy: "u1", ...overrides,
});

const build = (overrides = {}) => buildMemberView({
  client: client(),
  passes: [pass()],
  ledger: [entry()],
  locationName: "반송점",
  instructorNames: { u1: "정예진" },
  clientNames: { "client-a": "김하나", "client-b": "박두리" },
  now: NOW,
  ...overrides,
});

/* ── 개인정보가 새지 않는가 ───────────────────────────────────────────────

   이 파일이 개인정보의 유일한 관문이다. 여기가 맞으면 나머지가 틀려도 새지
   않고, 여기가 틀리면 나머지가 맞아도 샌다. */

const everyKey = (value, found = new Set()) => {
  if (Array.isArray(value)) { for (const item of value) everyKey(item, found); return found; }
  if (!value || typeof value !== "object" || value instanceof Date) return found;
  for (const [key, child] of Object.entries(value)) { found.add(key); everyKey(child, found); }
  return found;
};

test("no forbidden field appears anywhere in the projection", () => {
  const keys = everyKey(build());
  for (const forbidden of FORBIDDEN_FIELDS) {
    assert.equal(keys.has(forbidden), false, `${forbidden} 가 투영에 실려 있다`);
  }
});

test("the amounts are gone even though the input carried them", () => {
  /* 입력에는 계약 금액도 단가도 있었다. 없는 것을 안 내보내는 것은 증명이
     아니다 -- 있는 것을 안 내보내는 것이 증명이다. */
  const source = pass();
  assert.equal(source.contractPrice, 1300000);
  assert.equal(source.baseUnitPrice, 30000);
  const json = JSON.stringify(build());
  for (const amount of ["1300000", "30000", "1181818"]) {
    assert.doesNotMatch(json, new RegExp(amount), `${amount} 가 투영에 남아 있다`);
  }
});

test("the ledger's payroll columns do not reach the history", () => {
  const [row] = build().history;
  assert.deepEqual(Object.keys(row).sort(), [...HISTORY_FIELDS].sort());
});

test("only the allowed keys are produced, at every level", () => {
  /* 허용 목록이 실제로 허용 목록인지 본다. 원본에 새 필드가 생겨도 기본이
     "안 나감" 이어야 한다. */
  const view = build();
  assert.deepEqual(Object.keys(view).sort(), [...VIEW_FIELDS].sort());
  assert.deepEqual(Object.keys(view.passes[0]).sort(), [...PASS_FIELDS].sort());
});

test("a field added to the source later does not follow it out", () => {
  const view = build({ passes: [pass({ secretNewField: "새 필드", anotherOne: 42 })] });
  const keys = everyKey(view);
  assert.equal(keys.has("secretNewField"), false);
  assert.equal(keys.has("anotherOne"), false);
});

test("the phone number never leaves the client document", () => {
  // 개인정보는 최소로. 화면이 쓰지 않는 값은 투영에 담지 않는다.
  assert.doesNotMatch(JSON.stringify(build()), /01012345678/);
});

/* ── 무엇을 보여주는가 ────────────────────────────────────────────────── */

test("the member sees their name, centre and what is left", () => {
  const view = build();
  assert.equal(view.name, "김하나");
  assert.equal(view.locationName, "반송점");
  assert.equal(view.clientId, "client-a");
  assert.equal(view.userId, "uid-1");
  assert.equal(view.remainingTotal, 8);
  assert.deepEqual(view.nextExpiresAt, new Date(2027, 0, 31));
});

test("the location is a name, not an id", () => {
  // id 를 보여주면 회원이 "bansong" 이 무엇인지 묻는다.
  assert.equal(build().locationName, "반송점");
  assert.doesNotMatch(JSON.stringify(build()), /bansong/);
});

test("the instructor's name is stamped in, so it survives their leaving", () => {
  /* 원장은 uid 만 들고 있다. uid 를 내보내고 화면에서 찾게 하면 퇴사한 강사의
     이름이 사라진다. */
  assert.equal(build().history[0].instructorName, "정예진");
  // 이름을 모르면 빈 문자열이다. uid 로 떨어지지 않는다.
  const unknown = build({ instructorNames: {} });
  assert.equal(unknown.history[0].instructorName, "");
  assert.doesNotMatch(JSON.stringify(unknown), /u1/);
});

test("history is newest first, and only the three kinds a member should see", () => {
  const view = build({
    ledger: [
      entry({ id: "old", occurredAt: new Date(2026, 8, 1) }),
      entry({ id: "new", occurredAt: new Date(2026, 8, 19) }),
      entry({ id: "corr", type: "correction", occurredAt: new Date(2026, 8, 10) }),
      entry({ id: "moved", type: "transfer", occurredAt: new Date(2026, 8, 5) }),
      // 발급과 취소는 회원권 목록에 이미 있다.
      entry({ id: "iss", type: "issue", occurredAt: new Date(2026, 8, 15) }),
      entry({ id: "can", type: "cancel", occurredAt: new Date(2026, 8, 16) }),
    ],
  });
  assert.deepEqual(view.history.map((row) => row.type), ["deduct", "correction", "transfer", "deduct"]);
});

test("a correction is shown — undoing a wrong deduction is the member's news", () => {
  const view = build({ ledger: [entry({ type: "correction" })] });
  assert.equal(view.history.length, 1);
  assert.equal(view.history[0].type, "correction");
});

test("another member's ledger entry never lands here", () => {
  const view = build({ ledger: [entry({ passId: "someone-elses-pass" })] });
  assert.deepEqual(view.history, []);
});

/* ── 잔여 ─────────────────────────────────────────────────────────────── */

test("only usable passes are counted, or the member is told they have more than they do", () => {
  const view = build({
    passes: [
      pass({ id: "live", remainingCount: 8 }),
      pass({ id: "spent", remainingCount: 0 }),
      pass({ id: "expired", remainingCount: 5, expiresAt: new Date(2026, 0, 1) }),
      pass({ id: "done", remainingCount: 3, status: "completed" }),
    ],
  });
  assert.equal(view.remainingTotal, 8);
});

test("the expiry shown is the one that comes first", () => {
  const view = build({
    passes: [
      pass({ id: "later", expiresAt: new Date(2027, 5, 1) }),
      pass({ id: "sooner", expiresAt: new Date(2026, 11, 1) }),
    ],
  });
  assert.deepEqual(view.nextExpiresAt, new Date(2026, 11, 1));
});

test("a pass with no expiry is usable and does not become the next expiry", () => {
  const view = build({ passes: [pass({ expiresAt: null })] });
  assert.equal(view.remainingTotal, 8);
  assert.equal(view.nextExpiresAt, null);
});

/* ── 취소된 회원권 ───────────────────────────────────────────────────── */

test("a cancelled pass is not part of the member's record at all", () => {
  /* 잘못 발급해 되돌린 것이라 그 회차는 일어나지 않았다. 목록에 남기면 오지
     않은 수업이 회원 화면에 선다. */
  const view = build({ passes: [pass(), pass({ id: "gone", status: "cancelled" })] });
  assert.deepEqual(view.passes.map((row) => row.passId), ["pass-1"]);
});

/* ── 듀엣 ─────────────────────────────────────────────────────────────── */

test("a duet names the partner, always", () => {
  // 확정 2번. 숨김 옵션은 없다 -- 처음부터 두 사람이 함께 등록하는 계약이다.
  const view = build({ passes: [pass({ clientIds: ["client-a", "client-b"] })] });
  assert.equal(view.passes[0].isDuet, true);
  assert.equal(view.passes[0].partnerName, "박두리");
});

test("the partner is named, never identified by id", () => {
  const view = build({ passes: [pass({ clientIds: ["client-a", "client-b"] })], clientNames: {} });
  assert.equal(view.passes[0].partnerName, "");
  assert.doesNotMatch(JSON.stringify(view), /client-b/);
});

test("the partner's own view names the other one", () => {
  const view = build({
    client: client({ id: "client-b", name: "박두리", userId: "uid-2" }),
    passes: [pass({ clientIds: ["client-a", "client-b"] })],
  });
  assert.equal(view.passes[0].partnerName, "김하나");
  assert.equal(view.remainingTotal, 8, "짝에게도 같은 잔여가 보인다");
});

test("a 1:1 pass is not a duet and names nobody", () => {
  const view = build();
  assert.equal(view.passes[0].isDuet, false);
  assert.equal(view.passes[0].partnerName, "");
});

test("a pass that is not this member's is skipped", () => {
  const view = build({ passes: [pass({ clientId: "someone-else", clientIds: ["someone-else"] })] });
  assert.deepEqual(view.passes, []);
  assert.equal(view.remainingTotal, 0);
});

/* ── 여정 ─────────────────────────────────────────────────────────────── */

test("the journey comes from the injected calculation, not a copy of it", async () => {
  /* 앱의 pass-journey 를 그대로 넣어 모양이 맞는지 본다. Functions 는
     functions/ 만 배포되므로 여기서 require 할 수 없고, 주입으로 받는다 --
     배포에 어떻게 넣을지는 트리거를 만들 때 정한다 (설계 10장 5번). */
  const { buildPassJourney } = await import("../shared/pass-journey.mjs");
  const view = build({ buildJourney: buildPassJourney, instructorSessions: 40 });
  assert.ok(view.journey);
  assert.equal(view.journey.grandTotal, 22 + view.journey.prior);
  assert.equal(view.journey.currentRound, 2);
});

test("without the calculation the journey is null, not invented", () => {
  const view = build();
  assert.equal(view.journey, null);
});

test("a calculation that throws leaves the rest of the view standing", () => {
  // 여정 한 줄 때문에 잔여와 이력을 잃지 않는다.
  const view = build({ buildJourney: () => { throw new Error("broken"); } });
  assert.equal(view.journey, null);
  assert.equal(view.remainingTotal, 8);
});

/* ── 읽을 수 없는 경우 ───────────────────────────────────────────────── */

test("no client means no document, rather than an empty one", () => {
  /* 빈 문서를 쓰면 규칙이 userId 로 판정할 것이 없고, 화면은 "회원권 없음" 을
     띄운다 -- 둘 다 틀린 답이다. */
  assert.equal(buildMemberView({ client: null }), null);
  assert.equal(buildMemberView({}), null);
  assert.equal(buildMemberView({ client: { name: "이름만" } }), null);
});

test("a client not yet linked still projects, with an empty userId", () => {
  /* userId 가 비면 규칙이 아무도 통과시키지 않는다. 그래도 문서는 만든다 --
     연결되는 순간 바로 읽히고, 트리거를 다시 돌릴 필요가 없다. */
  const view = build({ client: client({ userId: "" }) });
  assert.equal(view.userId, "");
  assert.equal(view.remainingTotal, 8);
});

test("timestamps of every shape are read, and unreadable ones do not crash it", () => {
  const view = build({
    passes: [pass({ expiresAt: { toDate: () => new Date(2027, 2, 1) } })],
    ledger: [
      entry({ id: "ok", occurredAt: "2026-09-18T10:00:00.000Z" }),
      entry({ id: "bad", occurredAt: "그런 날짜 없음" }),
      entry({ id: "broken", occurredAt: { toDate: () => { throw new Error("nope"); } } }),
    ],
  });
  assert.deepEqual(view.nextExpiresAt, new Date(2027, 2, 1));
  // 읽지 못한 항목은 조용히 빠진다 -- 잘못된 날짜로 이력을 어지럽히지 않는다.
  assert.equal(view.history.length, 1);
});

test("an empty member projects an empty record, not a broken one", () => {
  const view = buildMemberView({ client: client(), passes: [], ledger: [], now: NOW });
  assert.equal(view.remainingTotal, 0);
  assert.equal(view.nextExpiresAt, null);
  assert.deepEqual(view.passes, []);
  assert.deepEqual(view.history, []);
  assert.deepEqual(view.updatedAt, NOW);
});

/* ── 상품 이름 ────────────────────────────────────────────────────────────

   회원이 계약할 때 들은 이름이다. 금액도 카테고리도 아니고 이름 하나다 --
   그것 없이는 화면이 모든 회원권을 "N회 회원권" 으로 부른다. */

test("상품 문서의 이름을 쓴다", () => {
  const view = buildMemberView({
    client: { id: "client-a", organizationId: "center-a", userId: "uid-1", name: "김하나" },
    passes: [{ id: "pass-1", clientId: "client-a", productId: "product-1", totalSessions: 20, remainingCount: 8, status: "active" }],
    productNames: { "product-1": "1:1 퍼스널 20회" },
  });
  assert.equal(view.passes[0].displayName, "1:1 퍼스널 20회");
});

test("이관분은 productId 자체가 이름이다", () => {
  /* 엑셀 이관이 상품명을 그대로 id 로 썼다 (migration-repository.js).
     그 회원권들이 반송점 명부의 대부분이고, 못 읽으면 전부 "N회 회원권" 이 된다. */
  const view = buildMemberView({
    client: { id: "client-a", organizationId: "center-a", userId: "uid-1", name: "김하나" },
    passes: [{ id: "csv_1", clientId: "client-a", productId: "1:1 20회 가을 이벤트", totalSessions: 20, remainingCount: 8, status: "active" }],
    productNames: {},
  });
  assert.equal(view.passes[0].displayName, "1:1 20회 가을 이벤트");
});

test("만들어진 id 는 이름이 아니다", () => {
  /* 상품 문서를 못 읽었을 때 uuid 를 화면에 띄우면, 회원은 그것을 자기
     회원권 이름으로 읽는다. 차라리 비운다. */
  for (const productId of ["product-1758000000000", "9f2c4a1b-3d5e", "csv", ""]) {
    const view = buildMemberView({
      client: { id: "client-a", organizationId: "center-a", userId: "uid-1", name: "김하나" },
      passes: [{ id: "pass-1", clientId: "client-a", productId, totalSessions: 20, remainingCount: 8, status: "active" }],
      productNames: {},
    });
    assert.equal(view.passes[0].displayName, "", productId || "(빈 값)");
  }
});

test("이름이 늘어도 금지 목록은 그대로다", () => {
  /* 이름 하나를 더하면서 단가가 따라 들어오는 것이 이 변경의 유일한 위험이다. */
  const view = buildMemberView({
    client: { id: "client-a", organizationId: "center-a", userId: "uid-1", name: "김하나" },
    passes: [{
      id: "pass-1", clientId: "client-a", productId: "product-1",
      totalSessions: 20, remainingCount: 8, status: "active",
      baseUnitPrice: 30000, netContractPrice: 1181818, contractPrice: 1300000,
      category: "pt_1_1_new", paymentMethod: "card",
    }],
    productNames: { "product-1": "1:1 퍼스널 20회" },
  });
  const json = JSON.stringify(view);
  for (const forbidden of FORBIDDEN_FIELDS) {
    assert.doesNotMatch(json, new RegExp(`"${forbidden}"`), `${forbidden} 가 투영에 있다`);
  }
  for (const leak of ["30000", "1181818", "1300000", "pt_1_1_new", "card"]) {
    assert.doesNotMatch(json, new RegExp(leak), `${leak} 가 투영에 있다`);
  }
});
