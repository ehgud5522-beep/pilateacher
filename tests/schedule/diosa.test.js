import assert from "node:assert/strict";
import test from "node:test";

import {
  CARE_GRADE, SETTLEMENT_SKIP, carePayCategory, careGradeOf, isSoloCandidate,
  planLessonSettlement,
} from "../../src/features/schedule/lesson-settlement.js";
import { lessonTypeKeyOf } from "../../src/features/schedule/lesson-types.js";
import { PAY_CATEGORY, isDiosaCategory } from "../../src/data/schema/constants.js";
import { PRICING_RULE, resolveDeductionUnitPrice } from "../../src/data/schema/deduction-pricing.js";
import { defaultUnitPriceFor } from "../../src/data/schema/pay-rates.js";

/**
 * 디오사 — 관리 수업 (2026-10-05).
 *
 * 이 파일이 지키는 것은 하나다: **수업 종류가 곧 회원권 종류다.** 관리 A 는
 * 디오사 A 에서만, 관리 B 는 디오사 B 에서만 빠진다.
 *
 * 양쪽 다 막아야 한다. 관리 수업이 PT 에서 빠지면 회원은 45,000 짜리 회차를
 * 20,000 짜리 수업에 잃고, 반대로 1:1 PT 수업이 디오사에서 빠지면 그 반대다.
 * 뒤쪽이 더 조용하다 -- 만료가 이른 것을 먼저 쓰는 규칙에 걸리면 아무 화면도
 * 그 사실을 말하지 않는다.
 */

const NOW = new Date(2026, 9, 5, 12, 0);
const members = [{ id: "m1", name: "김하나", orgClientId: "c1", orgRemaining: 8, rosterSource: "org_linked" }];

const pass = (id, category, overrides = {}) => ({
  id, clientId: "c1", clientIds: ["c1"], status: "active",
  remainingCount: 8, totalSessions: 20, serviceSessions: 0, serviceUsed: 0,
  contractPrice: 800000, netContractPrice: 800000, baseUnitPrice: 0,
  category, paymentMethod: "cash", expiresAt: new Date(2027, 0, 1), instructorId: "u1",
  ...overrides,
});

const lesson = (type, attendees = [{ memberId: "m1", status: "done" }]) => ({
  id: "L", date: "2026-10-05", start: "10:00", end: "11:00", type, attendees,
});

const picked = (type, passes) => {
  const plan = planLessonSettlement({ lesson: lesson(type), members, passes, now: NOW });
  return {
    passIds: plan.deductions.map((item) => item.pass.id),
    skips: plan.skips.map((item) => item.reason),
  };
};

/* ── 단가 ────────────────────────────────────────────────────────────────── */

test("the table fixes 20,000 for A and 35,000 for B", () => {
  assert.equal(defaultUnitPriceFor(PAY_CATEGORY.DIOSA_A), 20000);
  assert.equal(defaultUnitPriceFor(PAY_CATEGORY.DIOSA_B), 35000);
});

test("the diosa rate ignores the handover, the under-20 and the senior title", () => {
  /* 저 셋은 전부 PT 를 전제로 한 판정이다. 디오사에 걸리면 20,000 짜리 관리
     수업이 25,000 으로 나가고, 그 차이는 원장에 박혀 고칠 수 없다. */
  const base = {
    category: PAY_CATEGORY.DIOSA_A, baseUnitPrice: 20000,
    totalSessions: 20, netContractPrice: 800000, priorSessions: 50, serviceUsedCount: 0,
  };
  for (const extra of [{}, { handedOver: true }, { priorSessions: 3 }, { title: "branch_manager" }, { title: "team_lead" }]) {
    const result = resolveDeductionUnitPrice({ ...base, ...extra });
    assert.equal(result.unitPrice, 20000, JSON.stringify(extra));
    assert.equal(result.rule, PRICING_RULE.DIOSA_FIXED, JSON.stringify(extra));
  }
});

test("the deputy director still gets five-five on a diosa pass", () => {
  /* 2026-10-05 에 대표가 정했다 -- 디오사도 5:5 는 그대로다. 카드 금액이
     그대로 분자가 되면 22,000 이 되는데, 공급가액이 분자라 20,000 이다. */
  const cardA = resolveDeductionUnitPrice({
    category: PAY_CATEGORY.DIOSA_A, baseUnitPrice: 20000, isDeputyDirector: true,
    // 카드 20회 88만 → 공급가액 80만
    netContractPrice: 800000, totalSessions: 20, priorSessions: 50, serviceUsedCount: 0,
  });
  assert.equal(cardA.rule, PRICING_RULE.DEPUTY_DIRECTOR);
  assert.equal(cardA.unitPrice, 20000);

  const cardB = resolveDeductionUnitPrice({
    category: PAY_CATEGORY.DIOSA_B, baseUnitPrice: 35000, isDeputyDirector: true,
    // 카드 20회 154만 → 공급가액 140만
    netContractPrice: 1400000, totalSessions: 20, priorSessions: 50, serviceUsedCount: 0,
  });
  assert.equal(cardB.unitPrice, 35000);
});

/* ── 수업 종류 ↔ 회원권 종류 ─────────────────────────────────────────────── */

test("a care lesson names the pass it comes out of", () => {
  assert.equal(carePayCategory(lesson("관리A")), PAY_CATEGORY.DIOSA_A);
  assert.equal(carePayCategory(lesson("관리B")), PAY_CATEGORY.DIOSA_B);
  assert.equal(carePayCategory(lesson("개인레슨")), "");
  assert.equal(carePayCategory(lesson("듀엣")), "");
});

test("care A never touches a 1:1 PT pass", () => {
  /* 대표가 지시한 그 조건이다. PT 와 디오사를 둘 다 가진 회원. */
  const pt = pass("pt", PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT);
  const diosaA = pass("dio-a", PAY_CATEGORY.DIOSA_A);
  const diosaB = pass("dio-b", PAY_CATEGORY.DIOSA_B);

  assert.deepEqual(picked("관리A", [pt, diosaA, diosaB]).passIds, ["dio-a"]);
  assert.deepEqual(picked("관리B", [pt, diosaA, diosaB]).passIds, ["dio-b"]);
  // 1:1 수업은 그대로 PT 에서 빠진다.
  assert.deepEqual(picked("개인레슨", [pt, diosaA, diosaB]).passIds, ["pt"]);
});

test("a 1:1 PT lesson never takes a diosa pass, even when it expires first", () => {
  /* 만료가 이른 것을 먼저 쓰는 규칙에 걸리는 자리다. 막지 않으면 아무 화면도
     말하지 않은 채 관리 회차가 PT 수업에 사라진다. */
  const pt = pass("pt", PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT, { expiresAt: new Date(2027, 5, 1) });
  const diosaA = pass("dio-a", PAY_CATEGORY.DIOSA_A, { expiresAt: new Date(2026, 11, 1) });

  assert.deepEqual(picked("개인레슨", [pt, diosaA]).passIds, ["pt"]);
  assert.equal(isSoloCandidate(diosaA), false);

  // 디오사밖에 없으면 차감하지 않고 이유를 남긴다.
  const only = picked("개인레슨", [diosaA]);
  assert.deepEqual(only.passIds, []);
  assert.deepEqual(only.skips, [SETTLEMENT_SKIP.SOLO_PASS_MISSING]);
});

test("a care lesson says whether to issue or to re-register", () => {
  /* 없는 것과 다 쓴 것은 고칠 방법이 다르다 -- 앞은 발급이고 뒤는 재등록이다. */
  const pt = pass("pt", PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT);

  assert.deepEqual(picked("관리A", [pt]).skips, [SETTLEMENT_SKIP.CARE_PASS_MISSING]);
  assert.deepEqual(
    picked("관리A", [pt, pass("dio-a", PAY_CATEGORY.DIOSA_A, { remainingCount: 0 })]).skips,
    [SETTLEMENT_SKIP.CARE_PASS_SPENT],
  );
  // 등급이 다르면 가진 것으로 쳐 주지 않는다.
  assert.deepEqual(picked("관리B", [pass("dio-a", PAY_CATEGORY.DIOSA_A)]).skips, [SETTLEMENT_SKIP.CARE_PASS_MISSING]);
});

/* ── 노쇼 ────────────────────────────────────────────────────────────────── */

test("a no-show care lesson deducts one, exactly like PT", () => {
  /* 2026-10-04 에 정한 노쇼 규칙이 디오사에도 그대로 간다. */
  const diosaA = pass("dio-a", PAY_CATEGORY.DIOSA_A);
  const plan = planLessonSettlement({
    lesson: lesson("관리A", [{ memberId: "m1", status: "noshow" }]),
    members, passes: [diosaA], now: NOW,
  });
  assert.deepEqual(plan.deductions.map((item) => item.pass.id), ["dio-a"]);

  // 취소는 그대로 0 회다.
  const cancelled = planLessonSettlement({
    lesson: lesson("관리A", [{ memberId: "m1", status: "cancel" }]),
    members, passes: [diosaA], now: NOW,
  });
  assert.deepEqual(cancelled.deductions, []);
});

/* ── 분류 ────────────────────────────────────────────────────────────────── */

test("only the two diosa categories answer to the diosa check", () => {
  assert.equal(isDiosaCategory(PAY_CATEGORY.DIOSA_A), true);
  assert.equal(isDiosaCategory(PAY_CATEGORY.DIOSA_B), true);
  for (const category of [PAY_CATEGORY.PT_1_1_NEW, PAY_CATEGORY.SERVICE, PAY_CATEGORY.LETMEIN, PAY_CATEGORY.ETC, "", null]) {
    assert.equal(isDiosaCategory(category), false, String(category));
  }
});

test("the care lesson type is written, never guessed", () => {
  /* 혼자 받는 수업이라 사람 수로는 개인과 구분되지 않는다. 적힌 종류를 못
     읽으면 개인으로 떨어지고, 그러면 PT 에서 빠진다. */
  assert.equal(lessonTypeKeyOf({ type: "관리A", attendees: [{ memberId: "a" }] }), "care_a");
  assert.equal(lessonTypeKeyOf({ type: "관리B", attendees: [{ memberId: "a" }] }), "care_b");
  assert.equal(lessonTypeKeyOf({ type: "", attendees: [{ memberId: "a" }] }), "private");
});

/* ── 추가 관리 ───────────────────────────────────────────────────────────

   디오사는 PT 와 별도로 끊는 추가 관리권이다 (2026-10-05). 한 수업에서 PT
   회원권과 디오사 회원권이 **함께** 빠진다.

   이 묶음이 지키는 것은 하나다: **반쪽으로 끝나지 않는다.** 한쪽만 나가면
   회원은 받지 않은 관리의 회차를 잃거나, 받은 관리가 공짜가 된다 -- 원장은
   append-only 라 어느 쪽도 되돌릴 수 없다. */

const duetPass = (id, overrides = {}) => pass(id, PAY_CATEGORY.PT_2_1_REPURCHASE, {
  clientIds: ["c1", "c2"], ...overrides,
});
const bothMembers = [
  members[0],
  { id: "m2", name: "박두리", orgClientId: "c2", orgRemaining: 8, rosterSource: "org_linked" },
];

const planOf = (lessonInput, passes, people = members) => planLessonSettlement({
  lesson: lessonInput, members: people, passes, now: NOW,
});
const idsOf = (plan) => plan.deductions.map((item) => `${item.pass.id}${item.care ? "(관리)" : ""}`);

test("a PT lesson with an add-on deducts both passes", () => {
  const plan = planOf(
    lesson("개인레슨", [{ memberId: "m1", status: "done", careGrade: CARE_GRADE.A }]),
    [pass("pt", PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT), pass("dio-a", PAY_CATEGORY.DIOSA_A)],
  );
  assert.deepEqual(idsOf(plan), ["pt", "dio-a(관리)"]);
  assert.deepEqual(plan.skips, []);
});

test("no add-on means nothing extra comes out", () => {
  /* 디오사를 가지고 있어도 고르지 않았으면 빠지지 않는다. 추가 관리는
     수업마다 고르는 것이지 회원권이 있으면 자동인 것이 아니다. */
  const plan = planOf(
    lesson("개인레슨", [{ memberId: "m1", status: "done" }]),
    [pass("pt", PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT), pass("dio-a", PAY_CATEGORY.DIOSA_A)],
  );
  assert.deepEqual(idsOf(plan), ["pt"]);
});

test("a missing or spent diosa pass blocks the PT deduction too", () => {
  /* 반쪽 차감 금지. PT 만 빠지면 회원은 받지 않은 관리 때문에 PT 회차를
     잃는다 -- 그리고 그 사실은 확정 화면에만 잠깐 뜬다. */
  const pt = pass("pt", PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT);
  const withAddOn = lesson("개인레슨", [{ memberId: "m1", status: "done", careGrade: CARE_GRADE.A }]);

  const missing = planOf(withAddOn, [pt]);
  assert.deepEqual(idsOf(missing), [], "PT 도 빠지지 않는다");
  assert.deepEqual(missing.skips.map((item) => item.reason), [SETTLEMENT_SKIP.CARE_PASS_MISSING]);

  const spent = planOf(withAddOn, [pt, pass("dio-a", PAY_CATEGORY.DIOSA_A, { remainingCount: 0 })]);
  assert.deepEqual(idsOf(spent), []);
  assert.deepEqual(spent.skips.map((item) => item.reason), [SETTLEMENT_SKIP.CARE_PASS_SPENT]);
});

test("a missing PT pass never leaves the diosa deducted on its own", () => {
  /* 반대 방향도 반쪽이다. 디오사만 빠지면 받은 PT 수업이 공짜가 된다. */
  const plan = planOf(
    lesson("개인레슨", [{ memberId: "m1", status: "done", careGrade: CARE_GRADE.A }]),
    [pass("dio-a", PAY_CATEGORY.DIOSA_A)],
  );
  assert.deepEqual(idsOf(plan), []);
  assert.deepEqual(plan.skips.map((item) => item.reason), [SETTLEMENT_SKIP.SOLO_PASS_MISSING]);
});

test("a no-show deducts both, a cancellation deducts neither", () => {
  const passes = [pass("pt", PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT), pass("dio-a", PAY_CATEGORY.DIOSA_A)];

  const noshow = planOf(lesson("개인레슨", [{ memberId: "m1", status: "noshow", careGrade: CARE_GRADE.A }]), passes);
  assert.deepEqual(idsOf(noshow), ["pt", "dio-a(관리)"], "노쇼도 둘 다 1회씩");

  const cancelled = planOf(lesson("개인레슨", [{ memberId: "m1", status: "cancel", careGrade: CARE_GRADE.A }]), passes);
  assert.deepEqual(idsOf(cancelled), []);
  assert.deepEqual(cancelled.skips, []);
});

test("each member of a duet chooses their own add-on", () => {
  /* 2:1 은 한 사람만 받을 수도, 둘이 다른 등급을 받을 수도 있다. 수업이 아니라
     참가자에 붙는 이유가 이것이다. */
  const duet = duetPass("duet");
  const dioA = pass("dio-a", PAY_CATEGORY.DIOSA_A);
  const dioB = pass("dio-b", PAY_CATEGORY.DIOSA_B, { clientId: "c2", clientIds: ["c2"] });

  const onlyOne = planOf(
    lesson("듀엣", [{ memberId: "m1", status: "done" }, { memberId: "m2", status: "done", careGrade: CARE_GRADE.B }]),
    [duet, dioB], bothMembers,
  );
  assert.deepEqual(idsOf(onlyOne), ["duet", "dio-b(관리)"], "PT 는 공유 한 장, 관리는 그 사람 것만");

  const bothDifferent = planOf(
    lesson("듀엣", [
      { memberId: "m1", status: "done", careGrade: CARE_GRADE.A },
      { memberId: "m2", status: "done", careGrade: CARE_GRADE.B },
    ]),
    [duet, dioA, dioB], bothMembers,
  );
  assert.deepEqual(idsOf(bothDifferent), ["duet", "dio-a(관리)", "dio-b(관리)"]);
});

test("a duet where one add-on is missing stops the whole lesson", () => {
  /* 둘이 한 장을 나눠 쓰므로 한 명만 빼는 길이 없다. 짝의 회차는 그 사람의
     것이기도 하다. */
  const plan = planOf(
    lesson("듀엣", [{ memberId: "m1", status: "done" }, { memberId: "m2", status: "done", careGrade: CARE_GRADE.B }]),
    [duetPass("duet")], bothMembers,
  );
  assert.deepEqual(idsOf(plan), []);
  assert.deepEqual(plan.skips.map((item) => item.reason), [SETTLEMENT_SKIP.CARE_PASS_MISSING]);
});

test("a duet with one no-show still deducts the shared pass and the add-on", () => {
  const plan = planOf(
    lesson("듀엣", [{ memberId: "m1", status: "done" }, { memberId: "m2", status: "noshow", careGrade: CARE_GRADE.B }]),
    [duetPass("duet"), pass("dio-b", PAY_CATEGORY.DIOSA_B, { clientId: "c2", clientIds: ["c2"] })],
    bothMembers,
  );
  assert.deepEqual(idsOf(plan), ["duet", "dio-b(관리)"]);
});

test("a standalone care lesson ignores the add-on, so diosa never goes out twice", () => {
  /* 단독 관리 수업은 PT 대신이고 추가 관리는 PT 에 더하는 것이다. 섞이면
     한 수업에서 디오사가 두 번 빠진다. */
  const plan = planOf(
    lesson("관리A", [{ memberId: "m1", status: "done", careGrade: CARE_GRADE.A }]),
    [pass("pt", PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT), pass("dio-a", PAY_CATEGORY.DIOSA_A)],
  );
  assert.deepEqual(idsOf(plan), ["dio-a"], "한 번만, 그리고 PT 는 건드리지 않는다");
});

test("a session-upped diosa pass is still the one that gets used", () => {
  /* 세션업한 회원권은 totalSessions 와 contractPrice 가 함께 늘어난 같은
     회원권이다. 새 회원권이 아니므로 고르는 자리가 달라질 이유가 없다. */
  const grown = pass("dio-a", PAY_CATEGORY.DIOSA_A, {
    totalSessions: 30, contractPrice: 1320000, netContractPrice: 1320000, remainingCount: 22,
  });
  const plan = planOf(
    lesson("개인레슨", [{ memberId: "m1", status: "done", careGrade: CARE_GRADE.A }]),
    [pass("pt", PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT), grown],
  );
  assert.deepEqual(idsOf(plan), ["pt", "dio-a(관리)"]);

  // 부원장이면 늘어난 금액과 회차로 다시 센다: 1,320,000 ÷ 30 ÷ 2 = 22,000
  const deputy = resolveDeductionUnitPrice({
    category: PAY_CATEGORY.DIOSA_A, baseUnitPrice: 20000, isDeputyDirector: true,
    netContractPrice: 1320000, totalSessions: 30, priorSessions: 50, serviceUsedCount: 0,
  });
  assert.equal(deputy.unitPrice, 22000);
});
