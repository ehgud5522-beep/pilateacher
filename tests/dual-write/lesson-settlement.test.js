import assert from "node:assert/strict";
import test from "node:test";
import {
  SETTLEMENT_SKIP, applySettlementToLesson, canSettleLesson, clearSettlementFromLesson,
  SETTLEMENT_OUTCOME, closesSettlement, isSettledLesson, needsSettlement, pickSoloPass,
  planLessonSettlement, recordSettlementAttempt, settledDeductionsOf, settlementOutcome,
  settlementSkipsOf,
} from "../../src/features/schedule/lesson-settlement.js";
import { deductPass } from "../../src/data/repositories/pass-repository.js";

const NOW = new Date(2026, 8, 18, 20, 0, 0);

const member = (overrides = {}) => ({
  id: "m-1", name: "김하나", orgClientId: "client-a", orgRemaining: 8, rosterSource: "org_linked", ...overrides,
});

const pass = (overrides = {}) => ({
  id: "pass-a",
  clientId: "client-a",
  locationId: "bansong",
  instructorId: "u1",
  category: "pt_1_1_repurchase_event",
  baseUnitPrice: 30000,
  serviceUsed: 0,
  handedOver: false,
  contractPrice: 1300000,
  totalSessions: 20,
  remainingCount: 8,
  status: "active",
  expiresAt: new Date(2027, 0, 1),
  createdAt: new Date(2026, 5, 1),
  ...overrides,
});

const lesson = (overrides = {}) => ({
  id: "lesson-1",
  date: "2026-09-18",
  start: "19:00",
  end: "19:50",
  type: "개인레슨",
  attendees: [{ memberId: "m-1", status: "done", deductFrom: null, noshowFee: null }],
  ...overrides,
});

/* ── 어느 회원권을 쓰는가 ───────────────────────────────────────────────── */

test("the pass that expires soonest is spent first", () => {
  /* 늦게 만료되는 것을 먼저 쓰면 이른 쪽이 쓰이지 못한 채 만료되고, 회원은
     돈을 낸 회차를 잃는다. */
  const picked = pickSoloPass([
    pass({ id: "later", expiresAt: new Date(2027, 5, 1) }),
    pass({ id: "sooner", expiresAt: new Date(2026, 10, 1) }),
  ], "client-a", NOW);
  assert.equal(picked.id, "sooner");
});

test("passes that expire on the same day go oldest first", () => {
  // 먼저 팔린 것이 먼저 소진되는 것이 계약의 순서다.
  const picked = pickSoloPass([
    pass({ id: "new", createdAt: new Date(2026, 7, 1) }),
    pass({ id: "old", createdAt: new Date(2026, 3, 1) }),
  ], "client-a", NOW);
  assert.equal(picked.id, "old");
});

test("a pass with no expiry waits until the dated ones are used", () => {
  const picked = pickSoloPass([
    pass({ id: "no-expiry", expiresAt: null }),
    pass({ id: "dated", expiresAt: new Date(2027, 0, 1) }),
  ], "client-a", NOW);
  assert.equal(picked.id, "dated");
});

test("nothing usable comes back as nothing, never as a spent pass", () => {
  assert.equal(pickSoloPass([pass({ remainingCount: 0 })], "client-a", NOW), null);
  assert.equal(pickSoloPass([pass({ status: "cancelled" })], "client-a", NOW), null);
  assert.equal(pickSoloPass([pass({ expiresAt: new Date(2026, 7, 1) })], "client-a", NOW), null);
  assert.equal(pickSoloPass([pass({ clientId: "someone-else" })], "client-a", NOW), null);
  assert.equal(pickSoloPass([], "client-a", NOW), null);
  assert.equal(pickSoloPass([pass()], "", NOW), null);
});

/* ── 차감 규칙 (2026-09-23 대표 확정) ───────────────────────────────────────

   회원 A(성승현)와 B(김민정). A 는 1:1 회원권 2장, 그리고 B 와 함께 쓰는
   2:1 회원권 2장을 동시에 갖고 있다. **공유 회원권의 만료가 더 이르다** --
   만료 순서만 보면 1:1 수업이 짝의 회차를 가져가는 배치다.

   여섯 줄 하나하나가 실제로 일어나는 경우이고, 틀리면 원장은 append-only 라
   되돌리는 것도 대표만 할 수 있다. */

const A = "client-a";
const B = "client-b";

const soloPass = (id, overrides = {}) => pass({
  id, clientId: A, clientIds: [A], category: "pt_1_1_repurchase_event", ...overrides,
});
const duetPass = (id, overrides = {}) => pass({
  id, clientId: A, clientIds: [A, B], category: "pt_2_1_new", baseUnitPrice: 35000, ...overrides,
});

/** A 의 1:1 2장 + A·B 공유 2장. 공유 쪽이 먼저 만료된다. */
const bothKinds = (overrides = {}) => [
  soloPass("solo-late", { expiresAt: new Date(2027, 6, 1) }),
  soloPass("solo-soon", { expiresAt: new Date(2027, 5, 1), ...(overrides.solo || {}) }),
  duetPass("duet-late", { expiresAt: new Date(2026, 11, 1) }),
  duetPass("duet-soon", { expiresAt: new Date(2026, 10, 1), ...(overrides.duet || {}) }),
];

const memberA = () => member({ id: "m-a", name: "성승현", orgClientId: A });
const memberB = () => member({ id: "m-b", name: "김민정", orgClientId: B });

const planWith = (attendees, passes = bothKinds()) => planLessonSettlement({
  lesson: lesson({ attendees }),
  members: [memberA(), memberB()],
  passes,
  now: NOW,
});

test("규칙 1 — A 혼자 출석하면 1:1 만, 만료 빠른 것부터", () => {
  /* 공유 회원권이 더 먼저 만료되지만 쓰지 않는다. 혼자 온 수업에 그것을 쓰면
     둘이 나눠 쓰기로 한 회차가 한 사람의 1:1 로 사라지고, 짝은 자기 잔여가 왜
     줄었는지 알 길이 없다. */
  const plan = planWith([{ memberId: "m-a", status: "done" }]);
  assert.deepEqual(plan.deductions.map((item) => item.pass.id), ["solo-soon"]);
  assert.deepEqual(plan.skips, []);
});

test("규칙 2 — A·B 둘 다 출석하면 공유 2:1 에서 1회만, 만료 빠른 것부터", () => {
  const plan = planWith([
    { memberId: "m-a", status: "done" },
    { memberId: "m-b", status: "done" },
  ]);
  assert.equal(plan.deductions.length, 1, "수업 한 번에 1회 차감");
  assert.equal(plan.deductions[0].pass.id, "duet-soon");
  assert.deepEqual(plan.deductions[0].clientIds, [A, B]);
  assert.deepEqual(plan.deductions[0].attendanceByClientId, {
    [A]: "attended", [B]: "attended",
  });
  assert.deepEqual(plan.skips, []);
});

test("규칙 3 — 한 명이 노쇼여도 공유 2:1 에서 1회 차감", () => {
  // 수업은 일어났다. 노쇼 여부는 참가자 문서에만 남는다.
  const plan = planWith([
    { memberId: "m-a", status: "done" },
    { memberId: "m-b", status: "noshow" },
  ]);
  assert.equal(plan.deductions.length, 1);
  assert.equal(plan.deductions[0].pass.id, "duet-soon");
  assert.deepEqual(plan.deductions[0].attendanceByClientId, {
    [A]: "attended", [B]: "noshow",
  });
  // 노쇼인 사람을 "차감하지 못했다"로 적지 않는다 -- 차감은 일어났다.
  assert.deepEqual(plan.skips, []);
});

test("규칙 4 — 둘 다 노쇼거나 취소면 차감이 없다", () => {
  for (const statuses of [["noshow", "noshow"], ["cancel", "cancel"], ["noshow", "cancel"]]) {
    const plan = planWith([
      { memberId: "m-a", status: statuses[0] },
      { memberId: "m-b", status: statuses[1] },
    ]);
    assert.deepEqual(plan.deductions, [], statuses.join("·"));
    // 오지 않은 것은 실패가 아니다. 사유 줄을 띄우지 않는다.
    assert.deepEqual(plan.skips, [], statuses.join("·"));
  }
});

test("규칙 5 — 명단에 A 만 있으면(B 미리 취소) 1:1 수업으로 본다", () => {
  const onlyA = planWith([{ memberId: "m-a", status: "done" }]);
  assert.deepEqual(onlyA.deductions.map((item) => item.pass.id), ["solo-soon"]);

  // B 가 명단에 남아 취소로 표시돼 있어도 같다 -- 그 수업에 오지 않았다.
  const cancelledB = planWith([
    { memberId: "m-a", status: "done" },
    { memberId: "m-b", status: "cancel" },
  ]);
  assert.deepEqual(cancelledB.deductions.map((item) => item.pass.id), ["solo-soon"]);
  assert.equal(cancelledB.deductions[0].shared, false);
});

test("규칙 6 — A 혼자이고 1:1 잔여 0 이면 차감 없이 solo_pass_missing", () => {
  /* 2:1 에서 절대 빼지 않는다. 여기서 한 번 빼면 짝의 회차가 사라지고, 그
     사실은 아무도 모른다. */
  const plan = planWith([{ memberId: "m-a", status: "done" }], [
    soloPass("solo-late", { expiresAt: new Date(2027, 6, 1), remainingCount: 0 }),
    soloPass("solo-soon", { expiresAt: new Date(2027, 5, 1), remainingCount: 0 }),
    duetPass("duet-soon", { expiresAt: new Date(2026, 10, 1) }),
  ]);
  assert.deepEqual(plan.deductions, []);
  assert.deepEqual(plan.skips, [
    { memberId: "m-a", clientId: A, reason: SETTLEMENT_SKIP.SOLO_PASS_MISSING },
  ]);
});

test("추가 — 각자 1:1 만 가진 두 사람이 한 타임이면 각자 1:1 에서 2회", () => {
  /* 화면에는 듀엣으로 보이지만 계약이 둘이다. 함께 적힌 회원권이 없다는 것이
     가르는 기준이고, 수업 유형 글자는 보지 않는다. */
  const plan = planWith([
    { memberId: "m-a", status: "done" },
    { memberId: "m-b", status: "done" },
  ], [
    soloPass("solo-a", { expiresAt: new Date(2027, 5, 1) }),
    pass({ id: "solo-b", clientId: B, clientIds: [B], expiresAt: new Date(2027, 5, 1) }),
  ]);
  assert.deepEqual(plan.deductions.map((item) => [item.memberId, item.pass.id]), [
    ["m-a", "solo-a"], ["m-b", "solo-b"],
  ]);
});

test("공유 회원권의 잔여가 없으면 각자 1:1 로 새지 않는다", () => {
  /* 한 수업에 두 회차가 나가는 것을 막는다. 둘은 듀엣이라는 사실이 먼저이고,
     잔여가 없다는 것은 재등록으로 풀 일이다. */
  const plan = planWith([
    { memberId: "m-a", status: "done" },
    { memberId: "m-b", status: "done" },
  ], [
    soloPass("solo-a", { expiresAt: new Date(2027, 5, 1) }),
    pass({ id: "solo-b", clientId: B, clientIds: [B], expiresAt: new Date(2027, 5, 1) }),
    duetPass("duet-spent", { expiresAt: new Date(2026, 10, 1), remainingCount: 0 }),
  ]);
  assert.deepEqual(plan.deductions, []);
  assert.deepEqual(plan.skips.map((item) => [item.memberId, item.reason]), [
    ["m-a", SETTLEMENT_SKIP.DUET_PASS_SPENT], ["m-b", SETTLEMENT_SKIP.DUET_PASS_SPENT],
  ]);
});

test("짝이 혼자 와도 공유 회원권에서 빠지지 않는다", () => {
  /* B 는 1:1 회원권이 없고 공유 회원권만 있다. 전에는 "회원권이 없습니다"로
     끝났는데, 그 문구는 발급을 하라는 말이라 대표를 헛걸음시킨다. */
  const plan = planWith([{ memberId: "m-b", status: "done" }]);
  assert.deepEqual(plan.deductions, []);
  assert.deepEqual(plan.skips, [
    { memberId: "m-b", clientId: B, reason: SETTLEMENT_SKIP.SOLO_PASS_MISSING },
  ]);
});

/* ── 확정하면 무엇이 일어나는가 ─────────────────────────────────────────── */

test("only attendance is deducted — a no-show or a cancellation moves nothing", () => {
  /* 노쇼 과금은 센터의 정책이고 이 앱의 자동 계산 범위 밖이다. 여기서 차감하면
     정책을 코드가 정해 버린다. */
  for (const status of ["noshow", "cancel", "booked"]) {
    const plan = planLessonSettlement({
      lesson: lesson({ attendees: [{ memberId: "m-1", status }] }),
      members: [member()],
      passes: [pass()],
      now: NOW,
    });
    assert.deepEqual(plan.deductions, [], status);
    assert.deepEqual(plan.skips, [], status);
  }
});

test("a lesson with two members deducts each of them from their own pass", () => {
  const plan = planLessonSettlement({
    lesson: lesson({
      type: "듀엣",
      attendees: [{ memberId: "m-1", status: "done" }, { memberId: "m-2", status: "done" }],
    }),
    members: [member(), member({ id: "m-2", name: "박서연", orgClientId: "client-b" })],
    passes: [pass(), pass({ id: "pass-b", clientId: "client-b" })],
    now: NOW,
  });
  assert.deepEqual(plan.deductions.map((item) => [item.memberId, item.pass.id]), [
    ["m-1", "pass-a"], ["m-2", "pass-b"],
  ]);
});

test("one member without a pass never stops the other from being deducted", () => {
  /* 조용히 전부 건너뛰면 급여가 빠진다. 되는 것은 하고, 안 된 것은 이유와 함께
     돌려준다. */
  const plan = planLessonSettlement({
    lesson: lesson({ attendees: [{ memberId: "m-1", status: "done" }, { memberId: "m-2", status: "done" }] }),
    members: [member(), member({ id: "m-2", orgClientId: "client-b" })],
    passes: [pass()],
    now: NOW,
  });
  assert.deepEqual(plan.deductions.map((item) => item.memberId), ["m-1"]);
  assert.deepEqual(plan.skips, [{ memberId: "m-2", clientId: "client-b", reason: SETTLEMENT_SKIP.NO_PASS }]);
});

test("the three reasons for skipping are told apart, because the fixes differ", () => {
  /* 회원권이 없으면 발급이고, 잔여가 0이면 재등록이고, 센터에 없으면 등록이다.
     한 문구로 뭉개면 대표가 무엇을 해야 하는지 알 수 없다. */
  const plan = planLessonSettlement({
    lesson: lesson({
      attendees: [
        { memberId: "no-client", status: "done" },
        { memberId: "no-pass", status: "done" },
        { memberId: "spent", status: "done" },
      ],
    }),
    members: [
      member({ id: "no-client", orgClientId: "", rosterSource: "local_only" }),
      member({ id: "no-pass", orgClientId: "client-b" }),
      member({ id: "spent", orgClientId: "client-c" }),
    ],
    passes: [pass({ id: "empty", clientId: "client-c", remainingCount: 0 })],
    now: NOW,
  });
  assert.deepEqual(plan.skips.map((item) => [item.memberId, item.reason]), [
    ["no-client", SETTLEMENT_SKIP.NO_CLIENT],
    ["no-pass", SETTLEMENT_SKIP.NO_PASS],
    ["spent", SETTLEMENT_SKIP.SPENT],
  ]);
  assert.deepEqual(plan.deductions, []);
});

test("a linked member is found by the centre's id, not by the device's", () => {
  /* 맞물린 회원은 기기의 id 를 그대로 쓴다(roster-bridge). 바꿔 읽지 않으면
     모든 회원이 "회원권 없음"으로 건너뛰어진다. */
  const plan = planLessonSettlement({
    lesson: lesson({ attendees: [{ memberId: "m-local-legacy", status: "done" }] }),
    members: [member({ id: "m-local-legacy", orgClientId: "client-a" })],
    passes: [pass()],
    now: NOW,
  });
  assert.equal(plan.deductions.length, 1);
  assert.equal(plan.deductions[0].clientId, "client-a");
});

/* ── 확정을 잊지 않게 ───────────────────────────────────────────────────── */

test("an ended lesson with attendance and no settlement is waiting to be settled", () => {
  /* 확정을 잊으면 출석은 눌렸는데 원장에 아무것도 없고, 그 회차는 아무에게도
     지급되지 않는다. */
  assert.equal(needsSettlement(lesson(), { now: NOW }), true);
});

test("a lesson still in progress is not nagged about", () => {
  // 끝나기 전에 확정을 권하면 수업 중에 회원권이 빠진다.
  assert.equal(needsSettlement(lesson(), { now: new Date(2026, 8, 18, 19, 20) }), false);
});

test("a settled lesson, a cancelled group and a personal event are all done with", () => {
  assert.equal(needsSettlement(lesson({ orgSettledAt: "2026-09-18T20:00:00.000Z" }), { now: NOW }), false);
  assert.equal(needsSettlement(lesson({ groupCancelled: true }), { now: NOW }), false);
  assert.equal(needsSettlement(lesson({ personal: true }), { now: NOW }), false);
  assert.equal(needsSettlement(lesson({ isSample: true }), { now: NOW }), false);
  // 기구 그룹은 참석자가 없다. 회원권이 아니라 진행 완료로 세는 수업이다.
  assert.equal(needsSettlement(lesson({ attendees: [] }), { now: NOW }), false);
  // 아무도 출석으로 정해지지 않았으면 그것은 "출석 미기록"이고 다른 줄이 잡는다.
  assert.equal(needsSettlement(lesson({ attendees: [{ memberId: "m-1", status: "booked" }] }), { now: NOW }), false);
});

test("a no-show-only lesson can still be settled, and settling it deducts nothing", () => {
  /* 노쇼만 있는 수업도 확정해서 닫아야 한다. 열어 두면 큐에 남아 강사가 매일
     같은 줄을 본다. */
  const noshow = lesson({ attendees: [{ memberId: "m-1", status: "noshow" }] });
  assert.equal(canSettleLesson(noshow), true);
  const plan = planLessonSettlement({ lesson: noshow, members: [member()], passes: [pass()], now: NOW });
  assert.deepEqual(plan.deductions, []);
});

/* ── 확정한 결과를 적는다 ───────────────────────────────────────────────── */

test("what was deducted is written onto the lesson, so it can be undone later", () => {
  /* 없으면 대표가 되돌릴 때 회원권마다 원장을 훑어야 한다. */
  const settled = applySettlementToLesson(
    lesson({ attendees: [{ memberId: "m-1", status: "done" }, { memberId: "m-2", status: "done" }] }),
    {
      at: "2026-09-18T20:00:00.000Z",
      results: [{ memberId: "m-1", passId: "pass-a", entryId: "lesson-1_deduct" }],
      skips: [{ memberId: "m-2", reason: SETTLEMENT_SKIP.NO_PASS }],
    },
  );
  assert.equal(isSettledLesson(settled), true);
  assert.equal(settled.orgSettledAt, "2026-09-18T20:00:00.000Z");
  assert.deepEqual(settledDeductionsOf(settled), [
    { memberId: "m-1", passId: "pass-a", entryId: "lesson-1_deduct" },
  ]);
  assert.equal(settled.attendees[1].orgSkip, SETTLEMENT_SKIP.NO_PASS);
  // 출석 상태는 확정이 건드리지 않는다. 그것은 강사가 정한 사실이다.
  assert.deepEqual(settled.attendees.map((item) => item.status), ["done", "done"]);
});

test("undoing a settlement clears the deduction trail and leaves the attendance", () => {
  const settled = applySettlementToLesson(lesson(), {
    results: [{ memberId: "m-1", passId: "pass-a", entryId: "e1" }],
  });
  const cleared = clearSettlementFromLesson(settled);
  assert.equal(isSettledLesson(cleared), false);
  assert.equal("orgSettledAt" in cleared, false);
  assert.deepEqual(settledDeductionsOf(cleared), []);
  assert.equal(cleared.attendees[0].status, "done", "출석은 그대로다");
});

/* ── 확정이 실제로 무엇을 쓰는가 ────────────────────────────────────────

   화면의 확정 버튼이 부르는 것과 같은 경로를 여기서 그대로 돈다. 계획 → 차감 →
   원장 → 잔여가 한 배치로 일어나야 한다. 우회로를 만들지 않는 이유가 이것이다:
   판정 엔진과 원장 기록이 전부 deductPass 안에 있다. */

function fakeStore(totals = {}) {
  const commits = [];
  return {
    commits,
    list: async () => [],
    read: async (path) => totals[path] || null,
    commit: async (writes) => { commits.push(writes); },
    serverTimestamp: async () => "SERVER_TIME",
  };
}

const settleWith = async (plan, lesson, store, extra = {}) => {
  const results = [];
  for (const item of plan.deductions) {
    const deducted = await deductPass("center-a", item.pass, {
      instructorId: "u1",
      createdBy: "u1",
      occurredAt: new Date(`${lesson.date}T${lesson.start}:00`),
      isDeputyDirector: false,
      lessonId: lesson.id,
      ...extra,
    }, { store, now: () => new Date(`${lesson.date}T21:00:00`) });
    results.push({ memberId: item.memberId, passId: item.pass.id, entryId: deducted.entryId });
  }
  return results;
};

test("settling a lesson writes the deduction, the ledger entry and the new remaining count", async () => {
  const store = fakeStore({
    "organizations/center-a/instructorClientTotals/u1_client-a": { sessions: 40 },
  });
  const settleLesson = lesson({ date: "2026-09-18", start: "19:00", end: "19:50" });
  const plan = planLessonSettlement({
    lesson: settleLesson,
    members: [member()],
    passes: [pass()],
    now: NOW,
  });
  const results = await settleWith(plan, settleLesson, store);

  assert.equal(store.commits.length, 1, "한 배치다 -- 갈라지면 잔여의 근거가 사라진다");
  const written = store.commits[0];
  assert.deepEqual(written.map((item) => item.path), [
    "organizations/center-a/lessons/lesson-1",
    "organizations/center-a/lessons/lesson-1/participants/client-a",
    "organizations/center-a/passes/pass-a/ledger/lesson-1_deduct",
    "organizations/center-a/passes/pass-a",
    "organizations/center-a/instructorClientTotals/u1_client-a",
  ]);

  /* 조직 수업 문서가 이 일정과 같은 id 를 쓴다. 원장의 lessonId 가 일정을
     가리켜야 "이 수업의 차감"을 되짚을 수 있다. */
  const entry = written[2].data;
  assert.equal(entry.type, "deduct");
  assert.equal(entry.delta, -1);
  assert.equal(entry.lessonId, "lesson-1");
  assert.equal(entry.unitPrice, 30000, "판정이 정한 단가가 원장에 박힌다");
  assert.equal(entry.rule, "base_category");

  // 잔여는 서버가 하나 줄인다. 읽어서 빼면 두 사람이 동시에 눌렀을 때 하나가 사라진다.
  assert.equal(written[3].operation, "decrement");
  assert.deepEqual(written[3].data, { remainingCount: -1 });

  // 확정 결과가 일정에 적혀야 대표가 되돌릴 때 어느 항목인지 찾을 수 있다.
  const settled = applySettlementToLesson(settleLesson, { results, skips: plan.skips });
  assert.deepEqual(settledDeductionsOf(settled), [
    { memberId: "m-1", passId: "pass-a", entryId: "lesson-1_deduct" },
  ]);
});

test("a two-person lesson deducts each member from their own pass, in one batch each", async () => {
  const store = fakeStore({
    "organizations/center-a/instructorClientTotals/u1_client-a": { sessions: 40 },
    "organizations/center-a/instructorClientTotals/u1_client-b": { sessions: 40 },
  });
  const duet = lesson({
    type: "듀엣",
    attendees: [{ memberId: "m-1", status: "done" }, { memberId: "m-2", status: "done" }],
  });
  const plan = planLessonSettlement({
    lesson: duet,
    members: [member(), member({ id: "m-2", orgClientId: "client-b" })],
    passes: [pass(), pass({ id: "pass-b", clientId: "client-b" })],
    now: NOW,
  });
  await settleWith(plan, duet, store);

  assert.equal(store.commits.length, 2, "사람마다 자기 배치다");
  assert.deepEqual(store.commits.map((batch) => batch[2].path), [
    "organizations/center-a/passes/pass-a/ledger/lesson-1_deduct",
    "organizations/center-a/passes/pass-b/ledger/lesson-1_deduct",
  ]);
  // 둘 다 같은 수업을 가리킨다. 한 수업에서 두 사람이 차감된 것이 읽혀야 한다.
  for (const batch of store.commits) assert.equal(batch[2].data.lessonId, "lesson-1");
});

test("a member with no pass is skipped and the other is still deducted", async () => {
  /* 조용히 전부 건너뛰면 급여가 빠진다. 되는 것은 하고, 안 된 것은 이유와 함께
     일정에 적어 화면이 말한다. */
  const store = fakeStore({
    "organizations/center-a/instructorClientTotals/u1_client-a": { sessions: 40 },
  });
  const mixed = lesson({
    attendees: [{ memberId: "m-1", status: "done" }, { memberId: "m-2", status: "done" }],
  });
  const plan = planLessonSettlement({
    lesson: mixed,
    members: [member(), member({ id: "m-2", orgClientId: "client-b" })],
    passes: [pass()],
    now: NOW,
  });
  const results = await settleWith(plan, mixed, store);

  assert.equal(store.commits.length, 1, "한 사람만 차감된다");
  const settled = applySettlementToLesson(mixed, { results, skips: plan.skips });
  assert.equal(settled.attendees[0].orgEntryId, "lesson-1_deduct");
  assert.equal(settled.attendees[1].orgSkip, SETTLEMENT_SKIP.NO_PASS);
  assert.equal(settled.attendees[1].orgEntryId, "");
});

test("the deputy answer and the accumulated count reach the engine through this path", async () => {
  /* 확정이 deductPass 를 그대로 부르므로 판정이 살아 있다. 우회로를 만들면
     여기서부터 단가가 틀린다. */
  const store = fakeStore({
    "organizations/center-a/instructorClientTotals/u1_client-a": { sessions: 3 },
  });
  const one = lesson();
  const plan = planLessonSettlement({ lesson: one, members: [member()], passes: [pass({ baseUnitPrice: 45000 })], now: NOW });
  await settleWith(plan, one, store);
  const entry = store.commits[0][2].data;
  assert.equal(entry.unitPrice, 25000, "누적 20회 미만이면 신규 단가다");
  assert.equal(entry.rule, "new_to_instructor");
});

/* ── 전원 성공 / 일부 성공 / 전원 실패 ──────────────────────────────────

   "차감 완료"와 "한 건도 못 했다"가 같은 문구로 나오면 강사는 끝난 줄 알고
   넘어가고, 그 회차는 아무에게도 지급되지 않는다. */

test("the four ways a settlement can end are told apart", () => {
  assert.equal(settlementOutcome({ attempted: 2, written: 2, skipped: 0 }), SETTLEMENT_OUTCOME.COMPLETE);
  assert.equal(settlementOutcome({ attempted: 2, written: 1, skipped: 1 }), SETTLEMENT_OUTCOME.PARTIAL);
  assert.equal(settlementOutcome({ attempted: 1, written: 0, skipped: 1 }), SETTLEMENT_OUTCOME.FAILED);
  // 전원 노쇼·취소. 차감할 회차가 애초에 없었다.
  assert.equal(settlementOutcome({ attempted: 0, written: 0, skipped: 0 }), SETTLEMENT_OUTCOME.NOTHING);
});

test("a settlement that wrote nothing does not close the lesson", () => {
  /* "쓰다 실패하면 닫는다"는 일부라도 나갔을 때의 이야기다. 나간 차감은 되돌릴
     수 없으니 다시 확정하면 두 번 나간다 -- 그래서 닫는다.

     한 건도 나가지 않았으면 그 이유가 사라진다. 닫으면 대가만 남는다: 카드가
     잠기고, 큐가 조용해지고, 강사는 처리된 줄 안다. 원장은 비어 있는데. */
  assert.equal(closesSettlement(SETTLEMENT_OUTCOME.COMPLETE), true);
  assert.equal(closesSettlement(SETTLEMENT_OUTCOME.PARTIAL), true);
  assert.equal(closesSettlement(SETTLEMENT_OUTCOME.NOTHING), true);
  assert.equal(closesSettlement(SETTLEMENT_OUTCOME.FAILED), false);
});

test("a failed attempt stays open but keeps the reason it failed", () => {
  const attempt = recordSettlementAttempt(lesson(), {
    results: [],
    skips: [{ memberId: "m-1", reason: SETTLEMENT_SKIP.WRITE_FAILED, code: "Missing baseUnitPrice" }],
    outcome: SETTLEMENT_OUTCOME.FAILED,
  });
  assert.equal(isSettledLesson(attempt), false, "잠기지 않는다 -- 다시 시도할 수 있어야 한다");
  assert.equal("orgSettledOutcome" in attempt, false);
  /* 사유는 남는다. 다시 확정하기 전에 무엇을 고쳐야 하는지 화면이 말해야 한다.
     원본 코드를 버리면 "저장되지 않았습니다"만 남고 원인 확정이 불가능하다. */
  assert.deepEqual(settlementSkipsOf(attempt), [
    { memberId: "m-1", reason: SETTLEMENT_SKIP.WRITE_FAILED, code: "Missing baseUnitPrice" },
  ]);
});

test("a partial attempt closes, and says it was partial", () => {
  const attempt = recordSettlementAttempt(
    lesson({ attendees: [{ memberId: "m-1", status: "done" }, { memberId: "m-2", status: "done" }] }),
    {
      results: [{ memberId: "m-1", passId: "pass-a", entryId: "e1" }],
      skips: [{ memberId: "m-2", reason: SETTLEMENT_SKIP.NO_PASS }],
      outcome: SETTLEMENT_OUTCOME.PARTIAL,
    },
  );
  assert.equal(isSettledLesson(attempt), true, "나간 차감은 되돌릴 수 없어 닫는다");
  assert.equal(attempt.orgSettledOutcome, SETTLEMENT_OUTCOME.PARTIAL);
  assert.equal(settlementSkipsOf(attempt).length, 1);
});

test("a lesson with nothing to deduct closes quietly", () => {
  // 열어 두면 큐에 남아 강사가 매일 같은 줄을 보고, 그 줄에는 할 일이 없다.
  const attempt = recordSettlementAttempt(
    lesson({ attendees: [{ memberId: "m-1", status: "noshow" }] }),
    { results: [], skips: [], outcome: SETTLEMENT_OUTCOME.NOTHING },
  );
  assert.equal(isSettledLesson(attempt), true);
  assert.equal(attempt.orgSettledOutcome, SETTLEMENT_OUTCOME.NOTHING);
});

test("a pass issued before the rename is still deductable", async () => {
  /* 개명 전에 발급된 회원권은 기준값을 unitPrice 라는 이름으로 들고 있다. 읽지
     않으면 이미 팔린 회원권이 차감되지 않고, 그 회원권을 다시 발급할 방법은 없다. */
  const store = fakeStore({
    "organizations/center-a/instructorClientTotals/u1_client-a": { sessions: 40 },
  });
  const legacyPass = /** @type {Record<string, any>} */ (pass());
  delete legacyPass.baseUnitPrice;
  legacyPass.unitPrice = 30000;
  const one = lesson();
  const plan = planLessonSettlement({ lesson: one, members: [member()], passes: [legacyPass], now: NOW });
  await settleWith(plan, one, store);
  assert.equal(store.commits.length, 1, "차감이 나가야 한다");
  assert.equal(store.commits[0][2].data.unitPrice, 30000, "옛 이름의 값이 그대로 쓰인다");
});

test("a pass with neither name is refused rather than priced at zero", async () => {
  const store = fakeStore({
    "organizations/center-a/instructorClientTotals/u1_client-a": { sessions: 40 },
  });
  const broken = pass();
  delete broken.baseUnitPrice;
  const one = lesson();
  const plan = planLessonSettlement({ lesson: one, members: [member()], passes: [broken], now: NOW });
  await assert.rejects(() => settleWith(plan, one, store), /Missing baseUnitPrice/);
  assert.equal(store.commits.length, 0);
});
