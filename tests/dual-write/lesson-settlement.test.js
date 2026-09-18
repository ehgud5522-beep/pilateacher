import assert from "node:assert/strict";
import test from "node:test";
import {
  SETTLEMENT_SKIP, applySettlementToLesson, canSettleLesson, clearSettlementFromLesson,
  isSettledLesson, needsSettlement, pickPassForClient, planLessonSettlement, settledDeductionsOf,
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
  const picked = pickPassForClient([
    pass({ id: "later", expiresAt: new Date(2027, 5, 1) }),
    pass({ id: "sooner", expiresAt: new Date(2026, 10, 1) }),
  ], "client-a", NOW);
  assert.equal(picked.id, "sooner");
});

test("passes that expire on the same day go oldest first", () => {
  // 먼저 팔린 것이 먼저 소진되는 것이 계약의 순서다.
  const picked = pickPassForClient([
    pass({ id: "new", createdAt: new Date(2026, 7, 1) }),
    pass({ id: "old", createdAt: new Date(2026, 3, 1) }),
  ], "client-a", NOW);
  assert.equal(picked.id, "old");
});

test("a pass with no expiry waits until the dated ones are used", () => {
  const picked = pickPassForClient([
    pass({ id: "no-expiry", expiresAt: null }),
    pass({ id: "dated", expiresAt: new Date(2027, 0, 1) }),
  ], "client-a", NOW);
  assert.equal(picked.id, "dated");
});

test("nothing usable comes back as nothing, never as a spent pass", () => {
  assert.equal(pickPassForClient([pass({ remainingCount: 0 })], "client-a", NOW), null);
  assert.equal(pickPassForClient([pass({ status: "cancelled" })], "client-a", NOW), null);
  assert.equal(pickPassForClient([pass({ expiresAt: new Date(2026, 7, 1) })], "client-a", NOW), null);
  assert.equal(pickPassForClient([pass({ clientId: "someone-else" })], "client-a", NOW), null);
  assert.equal(pickPassForClient([], "client-a", NOW), null);
  assert.equal(pickPassForClient([pass()], "", NOW), null);
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
