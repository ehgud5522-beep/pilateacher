"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FORBIDDEN_FIELDS, HISTORY_FIELDS, LESSON_TYPE, MEMBER_NOTE_MAX, PASS_FIELDS, VIEW_FIELDS, buildMemberView,
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
  const full = buildPassJourney({ passes: [], instructorSessions: 40 });
  assert.ok(view.journey);
  /* 회원 화면이 쓰는 "지금까지 몇 번" 하나만 나간다. 계산 결과의 차수
     (round · currentRound)와 passId 는 나가지 않는다 -- 2026-10-30 결정. */
  assert.deepEqual(Object.keys(view.journey), ["usedTotal"]);
  assert.ok(Number.isInteger(view.journey.usedTotal));
  assert.ok("currentRound" in full || "segments" in full, "계산 결과 모양이 바뀌었다");
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

/* ── 수업 유형 (상품명 · 차수는 나가지 않는다) ─────────────────────────────

   2026-10-30 대표 결정. 상품명("깍두기 · 양도권 · 세일즈" 같은 센터 안의 이름)과
   차수는 관리용이다. 회원 화면은 수업 유형과 횟수로 이름을 짓고, 투영은 그
   재료만 보낸다. */

const lessonView = (pass, extra = {}) => buildMemberView({
  client: { id: "client-a", organizationId: "center-a", userId: "uid-1", name: "김하나" },
  passes: [{ id: "pass-1", clientId: "client-a", totalSessions: 10, remainingCount: 8, status: "active", ...pass }],
  ...extra,
});

test("상품명 · 차수는 투영에 없다 — 이름이 아무리 그럴듯해도", () => {
  const view = lessonView(
    { productId: "1:1 깍두기 양도권 세일즈", purchaseRound: 3, category: "pt_1_1_new" },
    { productNames: { "1:1 깍두기 양도권 세일즈": "깍두기" } },
  );
  const json = JSON.stringify(view);
  for (const leak of ["깍두기", "양도권", "세일즈", "displayName", "purchaseRound"]) {
    assert.doesNotMatch(json, new RegExp(leak), `${leak} 가 투영에 있다`);
  }
  assert.ok(!PASS_FIELDS.includes("displayName"));
  assert.ok(!PASS_FIELDS.includes("purchaseRound"));
});

test("수업 유형 — 상품의 sessionType 이 먼저다", () => {
  const types = { "product-1": "pt_1_1", "product-2": "pt_2_1" };
  assert.equal(lessonView({ productId: "product-1", category: "pt_2_1_new" }, { productSessionTypes: types }).passes[0].lessonType, LESSON_TYPE.SOLO);
  assert.equal(lessonView({ productId: "product-2" }, { productSessionTypes: types }).passes[0].lessonType, LESSON_TYPE.DUET);
});

test("수업 유형 — 상품이 말하지 않으면 급여카테고리로 가른다", () => {
  const cases = [
    ["pt_1_1_new", LESSON_TYPE.SOLO], ["pt_1_1_repurchase_event", LESSON_TYPE.SOLO],
    ["pt_2_1_repurchase", LESSON_TYPE.DUET], ["diosa_a", LESSON_TYPE.DIOSA], ["diosa_b", LESSON_TYPE.DIOSA],
    ["service", LESSON_TYPE.OTHER], ["", LESSON_TYPE.OTHER],
  ];
  for (const [category, expected] of cases) {
    assert.equal(lessonView({ productId: "csv", category }).passes[0].lessonType, expected, category || "(빈 값)");
  }
});

test("수업 유형 — 아무것도 모르면 함께 쓰는 회원권은 2:1 이다", () => {
  const view = lessonView({ clientIds: ["client-a", "client-b"] });
  assert.equal(view.passes[0].lessonType, LESSON_TYPE.DUET);
});

test("수업 유형은 급여카테고리 문자열을 그대로 내보내지 않는다", () => {
  assert.deepEqual(Object.values(LESSON_TYPE).sort(), ["1:1", "2:1", "diosa", "other"]);
});

test("유형 판정에 쓰는 값이 공용 상수와 같다", async () => {
  /* member-view.js 는 CommonJS 라 shared/constants.mjs 를 require 하지 않고 값을
     옮겨 적었다. 상수가 바뀌면 여기서 깨진다. */
  const { SESSION_TYPE, DIOSA_CATEGORIES } = await import("../shared/constants.mjs");
  assert.equal(lessonView({ productId: "p" }, { productSessionTypes: { p: SESSION_TYPE.PT_1_1 } }).passes[0].lessonType, LESSON_TYPE.SOLO);
  assert.equal(lessonView({ productId: "p" }, { productSessionTypes: { p: SESSION_TYPE.PT_2_1 } }).passes[0].lessonType, LESSON_TYPE.DUET);
  for (const category of DIOSA_CATEGORIES) {
    assert.equal(lessonView({ category }).passes[0].lessonType, LESSON_TYPE.DIOSA, category);
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
    productSessionTypes: { "product-1": "pt_1_1" },
  });
  const json = JSON.stringify(view);
  for (const forbidden of FORBIDDEN_FIELDS) {
    assert.doesNotMatch(json, new RegExp(`"${forbidden}"`), `${forbidden} 가 투영에 있다`);
  }
  for (const leak of ["30000", "1181818", "1300000", "pt_1_1_new", "card"]) {
    assert.doesNotMatch(json, new RegExp(leak), `${leak} 가 투영에 있다`);
  }
});

/* ── 강사가 회원에게 보낸 말 ─────────────────────────────────────────────

   수업기록 원문은 강사가 다음 수업을 준비하려고 쓴 글이고, 이 한 줄은 회원을
   향해 따로 적은 문장이다. 두 칸이 나뉘어 있다는 것을 여기서 고정한다. */

test("회원에게 보낼 말은 그 수업의 차감 줄에 붙는다", () => {
  const view = build({
    ledger: [entry({ lessonId: "lesson-1" })],
    memberNotes: { "lesson-1": "오늘 어깨가 한결 편해 보이셨어요" },
  });
  assert.equal(view.history[0].memberNote, "오늘 어깨가 한결 편해 보이셨어요");
});

test("말이 없는 수업은 빈 문자열이지 빠진 필드가 아니다", () => {
  /* 화면은 이 값이 비었는지로 줄을 그릴지 정한다. 어떤 줄에는 있고 어떤
     줄에는 없으면 그 판단이 undefined 를 만나 무너진다. */
  const view = build({ ledger: [entry({ lessonId: "lesson-1" })] });
  assert.equal(view.history[0].memberNote, "");
  assert.deepEqual(Object.keys(view.history[0]).sort(), [...HISTORY_FIELDS].sort());
});

test("다른 수업의 말이 이 줄에 오지 않는다", () => {
  const view = build({
    ledger: [entry({ lessonId: "lesson-1" })],
    memberNotes: { "lesson-2": "다른 수업의 말" },
  });
  assert.equal(view.history[0].memberNote, "");
});

test("lessonId 가 없는 옛 차감에는 말이 붙지 않는다", () => {
  /* 규칙이 지금은 lessonId 를 요구하지만 그 전에 쌓인 항목이 있다. 빈
     문자열을 열쇠로 쓰면 아무 말이나 걸린다. */
  const view = build({
    ledger: [entry({ lessonId: "" })],
    memberNotes: { "": "열쇠 없는 말" },
  });
  assert.equal(view.history[0].memberNote, "");
});

test("되돌린 차감과 담당 강사 변경에는 말을 붙이지 않는다", () => {
  /* 그 수업에 대한 말이 아니고, 같은 문구가 두 줄에 겹쳐 보이면 회원은
     수업이 두 번 있었다고 읽는다. */
  const view = build({
    ledger: [
      entry({ id: "d", lessonId: "lesson-1" }),
      entry({ id: "c", type: "correction", lessonId: "lesson-1", occurredAt: new Date(2026, 8, 19) }),
      entry({ id: "t", type: "transfer", lessonId: "lesson-1", occurredAt: new Date(2026, 8, 17) }),
    ],
    memberNotes: { "lesson-1": "오늘 어깨가 한결 편해 보이셨어요" },
  });
  const byType = Object.fromEntries(view.history.map((row) => [row.type, row.memberNote]));
  assert.equal(byType.deduct, "오늘 어깨가 한결 편해 보이셨어요");
  assert.equal(byType.correction, "");
  assert.equal(byType.transfer, "");
});

test("긴 말은 투영에서 잘린다", () => {
  /* 화면과 리포지토리가 이미 막지만, 투영은 회원에게 나가는 마지막 관문이라
     스스로 지켜야 한다. */
  const view = build({
    ledger: [entry({ lessonId: "lesson-1" })],
    memberNotes: { "lesson-1": "가".repeat(MEMBER_NOTE_MAX + 50) },
  });
  assert.equal(view.history[0].memberNote.length, MEMBER_NOTE_MAX);
});

test("수업기록 원문 쪽 필드는 이름부터 금지 목록에 있다", () => {
  /* 회원에게 가는 것은 강사가 따로 적은 한 줄뿐이다. 언젠가 누군가 원문을
     투영에 실으려 할 때 이 목록이 먼저 막는다. */
  for (const field of ["notes", "lessonRecord", "confirmedRecord", "transcript", "rawTranscript"]) {
    assert.ok(FORBIDDEN_FIELDS.includes(field), `${field} 가 금지 목록에 없다`);
  }
});

test("원문이 입력에 섞여 들어와도 따라 나가지 않는다", () => {
  const view = build({
    client: client({ notes: [{ body: "코어근육이 많이 약해짐" }], aiMemory: ["무릎 주의"] }),
    ledger: [entry({ lessonId: "lesson-1", lessonRecord: { rawTranscript: "오늘 너무 힘들어했고" } })],
    memberNotes: { "lesson-1": "오늘 정말 잘하셨어요" },
  });
  const json = JSON.stringify(view);
  assert.doesNotMatch(json, /코어근육/);
  assert.doesNotMatch(json, /너무 힘들어했고/);
  assert.doesNotMatch(json, /무릎 주의/);
  assert.match(json, /오늘 정말 잘하셨어요/);
});

test("이력 한 줄은 차감된 회원권의 수업 유형을 싣는다 — passId 는 싣지 않는다", () => {
  /* 회원 앱이 "1:1 필라테스 수업" 처럼 부른다 (2026-10-30). */
  const view = buildMemberView({
    client: { id: "client-a", organizationId: "center-a", userId: "uid-1", name: "김하나" },
    passes: [
      { id: "solo", clientId: "client-a", category: "pt_1_1_new", totalSessions: 10, remainingCount: 5, status: "active" },
      { id: "diosa", clientId: "client-a", category: "diosa_a", totalSessions: 4, remainingCount: 3, status: "active" },
    ],
    ledger: [
      { passId: "solo", type: "deduct", occurredAt: new Date(2026, 9, 21, 19, 0), instructorId: "u1" },
      { passId: "diosa", type: "deduct", occurredAt: new Date(2026, 9, 18, 10, 0), instructorId: "u1" },
    ],
  });
  assert.deepEqual(view.history.map((row) => row.lessonType), [LESSON_TYPE.SOLO, LESSON_TYPE.DIOSA]);
  assert.doesNotMatch(JSON.stringify(view.history), /"solo"|passId|diosa_a|pt_1_1_new/);
});

/* ── 예정 수업 (2026-10-30) ───────────────────────────────────────────────

   강사가 일정을 등록하면 확정 없이 곧바로 회원 데이터에 들어간다. 날짜 · 시간 ·
   수업 유형 · 강사 · 지점만 -- 메모 · 상품명 · 차수 · 단가 · 다른 회원 id 는 없다. */

const scheduleView = (scheduled, now = new Date(2026, 9, 30, 12)) => buildMemberView({
  client: { id: "client-a", organizationId: "center-a", userId: "uid-1", name: "김하나", locationId: "bansong" },
  passes: [],
  scheduled,
  instructorNames: { u1: "정예진" },
  locationNames: { bansong: "반송점", haeundae: "해운대점" },
  locationName: "반송점",
  now,
});

test("예정 수업은 날짜 · 시간 · 유형 · 강사 · 지점만 싣는다", () => {
  const { SCHEDULE_FIELDS } = require("../src/member-view");
  const view = scheduleView([{
    id: "L1", status: "scheduled", clientIds: ["client-a", "client-b"], instructorId: "u1",
    startsAt: new Date(2026, 10, 3, 19), endsAt: new Date(2026, 10, 3, 19, 50),
    lessonType: "2:1", locationId: "haeundae", memo: "허리 통증 — 강사 메모", productId: "깍두기",
  }]);
  assert.equal(view.schedule.length, 1);
  assert.deepEqual(Object.keys(view.schedule[0]).sort(), [...SCHEDULE_FIELDS].sort());
  assert.deepEqual(view.schedule[0], {
    startsAt: new Date(2026, 10, 3, 19), endsAt: new Date(2026, 10, 3, 19, 50),
    lessonType: "2:1", instructorName: "정예진", locationName: "해운대점",
  });
  assert.doesNotMatch(JSON.stringify(view.schedule), /client-b|L1|u1|허리|메모|깍두기/);
});

test("취소된 수업 · 지난 수업 · 남의 수업은 싣지 않는다", () => {
  const view = scheduleView([
    { status: "scheduled", clientIds: ["client-a"], startsAt: new Date(2026, 10, 1, 10), lessonType: "1:1" },
    { status: "cancelled", clientIds: ["client-a"], startsAt: new Date(2026, 10, 2, 10), lessonType: "1:1" },
    { status: "completed", clientIds: ["client-a"], startsAt: new Date(2026, 10, 3, 10), lessonType: "1:1" },
    { status: "scheduled", clientIds: ["client-a"], startsAt: new Date(2026, 9, 20, 10), lessonType: "1:1" },
    { status: "scheduled", clientIds: ["client-z"], startsAt: new Date(2026, 10, 4, 10), lessonType: "1:1" },
  ]);
  assert.deepEqual(view.schedule.map((lesson) => lesson.startsAt.getDate()), [1]);
});

test("오늘 이미 시작한 수업도 그날 칸에 남는다 — 하루 전부터 싣는다", () => {
  const view = scheduleView([
    { status: "scheduled", clientIds: ["client-a"], startsAt: new Date(2026, 9, 30, 9), lessonType: "1:1" },
  ], new Date(2026, 9, 30, 21));
  assert.equal(view.schedule.length, 1);
});

test("모르는 유형은 other · 지점을 모르면 회원의 지점 · 이른 시각부터", () => {
  const view = scheduleView([
    { status: "scheduled", clientIds: ["client-a"], startsAt: new Date(2026, 10, 5, 19), lessonType: "pt_1_1_new" },
    { status: "scheduled", clientIds: ["client-a"], startsAt: new Date(2026, 10, 5, 9), lessonType: "diosa" },
  ]);
  assert.deepEqual(view.schedule.map((lesson) => [lesson.startsAt.getHours(), lesson.lessonType, lesson.locationName]), [
    [9, "diosa", "반송점"], [19, "other", "반송점"],
  ]);
});

test("일정 문서가 바뀌면 앞뒤 회원 모두를 다시 만든다 — 듀엣에서 빠진 사람도", () => {
  const { clientIdsFromLessonChange } = require("../src/member-view-triggers.js");
  assert.deepEqual(
    clientIdsFromLessonChange({ clientIds: ["a", "b"] }, { clientIds: ["a"] }).sort(),
    ["a", "b"],
  );
  assert.deepEqual(clientIdsFromLessonChange(null, { clientId: "c" }), ["c"]);
  assert.deepEqual(clientIdsFromLessonChange(null, null), []);
});

test("예정 수업을 못 읽었으면 schedule 은 null — '없음' 이 아니라 '모름'", () => {
  assert.equal(scheduleView(null).schedule, null);
  assert.deepEqual(scheduleView([]).schedule, []);
});
