import assert from "node:assert/strict";
import test from "node:test";

import {
  careChoices, careGradeForMinutes, careGradeLabel, careMinutesOfGrade,
  careOnlyClient, settlementSkipMessage,
} from "../../src/features/schedule/care-options.js";
import {
  CARE_GRADE, SETTLEMENT_SKIP, SETTLEMENT_SKIP_LABEL, planLessonSettlement,
} from "../../src/features/schedule/lesson-settlement.js";
import {
  LESSON_TYPES, careKeyForMinutes, isCareLessonKey, lessonTypeKeyOf,
} from "../../src/features/schedule/lesson-types.js";
import { NEXT_DEDUCT, passCardList } from "../../src/features/membership/pass-cards.js";
import { previewLessonRates } from "../../src/features/schedule/lesson-rate-preview.js";
import { PAY_CATEGORY, SESSION_TYPE } from "../../src/data/schema/constants.js";
import { payCategoriesFor } from "../../src/data/schema/display-names.js";

/**
 * 단독 디오사 관리 수업.
 *
 * ── 왜 안 되던 일인가 ──
 * 디오사는 PT 수업의 "추가 관리" 로만 고를 수 있었다. 그래서 **디오사만 끊은
 * 회원**(PT 회원권 없음)은 아무 수업도 넣을 수 없었다 -- 관리 수업 종류는
 * 있었지만 회원 칸이 뜨지 않아 참가자 없는 일정으로 저장됐고, 그것은 그룹
 * 수업으로 읽혔다.
 *
 * ── A 와 B 는 따로 파는 회원권이다 ──
 * 30분은 A, 50분은 B. 섞어 쓰지 못한다. A 회원권으로 50분 수업을 하면
 * 20,000 짜리 회차가 35,000 짜리 수업에 나가고, 원장은 append-only 라
 * 되돌릴 수 없다.
 */

const NOW = new Date(2026, 9, 10);
const later = new Date(2027, 0, 1);

const pass = (overrides = {}) => ({
  id: "p", clientId: "c1", clientIds: ["c1"], status: "active",
  category: PAY_CATEGORY.PT_1_1_NEW, remainingCount: 8, purchaseRound: 1,
  baseUnitPrice: 25000, expiresAt: later, ...overrides,
});
/* baseUnitPrice 는 발급이 박아 둔 기준값이다 (규칙이 필수로 요구한다).
   디오사는 표가 단가를 정하므로 이 값이 쓰이지는 않지만, 없으면 판정이
   "Invalid baseUnitPrice" 로 멈춘다 -- 실제 회원권에는 언제나 있다. */
const diosaA = (overrides = {}) => pass({
  id: "dia", category: PAY_CATEGORY.DIOSA_A, baseUnitPrice: 20000, ...overrides,
});
const diosaB = (overrides = {}) => pass({
  id: "dib", category: PAY_CATEGORY.DIOSA_B, baseUnitPrice: 35000, ...overrides,
});

const member = { id: "m1", orgClientId: "c1" };
const careLesson = (type, status = "done") => ({
  id: "l1", type, attendees: [{ memberId: "m1", status }],
});
const plan = (lesson, passes) => planLessonSettlement({
  lesson, members: [member], passes, now: NOW,
});

/* ── 수업 종류 ─────────────────────────────────────────────────────────── */

test("the two care lessons are named by their length and sit together", () => {
  /* 디오사만 끊은 회원의 수업을 넣는 사람은 "관리 A" 가 몇 분짜리인지부터
     물어야 했다. 고를 때 보는 것은 길이다. */
  const a = LESSON_TYPES.find((item) => item.key === "care_a");
  const b = LESSON_TYPES.find((item) => item.key === "care_b");

  assert.equal(a.label, "디오사 관리 30분");
  assert.equal(b.label, "디오사 관리 50분");
  assert.equal(a.minutes, 30);
  assert.equal(b.minutes, 50);
  // PT 와 같은 폭이다. 한쪽만 PT 줄에 끼면 둘이 한 쌍이라는 것이 끊긴다.
  const solo = LESSON_TYPES.find((item) => item.key === "private");
  assert.equal(a.span, solo.span);
  assert.equal(b.span, solo.span);
});

test("a length picks its care lesson, and nothing else is guessed at", () => {
  assert.equal(careKeyForMinutes(30), "care_a");
  assert.equal(careKeyForMinutes(50), "care_b");
  /* 40분짜리 관리 수업을 A 로 밀면 회원은 30분 회차를 40분 수업에 쓴다.
     모르면 비워 둔다. */
  assert.equal(careKeyForMinutes(40), "");
  assert.equal(careKeyForMinutes(undefined), "");
  assert.equal(careGradeForMinutes(30), CARE_GRADE.A);
  assert.equal(careGradeForMinutes(50), CARE_GRADE.B);
  assert.equal(careGradeForMinutes(60), CARE_GRADE.NONE);
  assert.equal(careMinutesOfGrade(CARE_GRADE.B), 50);
  assert.equal(isCareLessonKey("care_b"), true);
  assert.equal(isCareLessonKey("private"), false);
});

test("a saved care lesson is read back as a care lesson, not as a private one", () => {
  /* 적힌 종류가 그대로 답이다. 사람 수로 맞히면 혼자 받는 관리 수업이
     개인으로 떨어지고, PT 회원권에서 빠진다. */
  assert.equal(lessonTypeKeyOf(careLesson("관리A")), "care_a");
  assert.equal(lessonTypeKeyOf(careLesson("관리B")), "care_b");
});

/* ── 디오사만 끊은 회원 ─────────────────────────────────────────────────── */

test("a client with only a 30-minute pass settles a 30-minute lesson", () => {
  /* 이것이 이 작업의 요점이다. PT 회원권이 한 장도 없어도 확정된다. */
  const { deductions, skips } = plan(careLesson("관리A"), [diosaA()]);
  assert.deepEqual(skips, []);
  assert.equal(deductions.length, 1);
  assert.equal(deductions[0].pass.id, "dia");
});

test("a 50-minute lesson never reaches into the 30-minute pass", () => {
  /* 둘은 따로 파는 회원권이다. 섞으면 20,000 짜리 회차가 35,000 짜리
     수업에 나가고, 원장은 되돌릴 수 없다. */
  const { deductions, skips } = plan(careLesson("관리B"), [diosaA()]);
  assert.deepEqual(deductions, []);
  assert.equal(skips.length, 1);
  assert.equal(skips[0].reason, SETTLEMENT_SKIP.CARE_PASS_MISSING);
  assert.equal(skips[0].careCategory, PAY_CATEGORY.DIOSA_B);
  // 어느 쪽이 없는지 말한다. "디오사 회원권이 없어요" 로는 할 일을 알 수 없다.
  assert.match(
    settlementSkipMessage(skips[0], SETTLEMENT_SKIP_LABEL),
    /디오사 B\(50분\) 회원권이 없어요/,
  );
});

test("a PT pass is never spent on a care lesson, however much is left", () => {
  const { deductions, skips } = plan(careLesson("관리A"), [pass({ remainingCount: 50 })]);
  assert.deepEqual(deductions, [], "PT 회원권은 후보가 아니다");
  assert.equal(skips[0].reason, SETTLEMENT_SKIP.CARE_PASS_MISSING);
});

test("a spent diosa pass is told apart from a missing one", () => {
  // 앞은 발급이고 뒤는 재등록이다. 대표가 할 일이 다르다.
  const { skips } = plan(careLesson("관리A"), [diosaA({ remainingCount: 0 })]);
  assert.equal(skips[0].reason, SETTLEMENT_SKIP.CARE_PASS_SPENT);
  assert.match(
    settlementSkipMessage(skips[0], SETTLEMENT_SKIP_LABEL),
    /디오사 A\(30분\) 회원권에 남은 회차가 없습니다/,
  );
});

test("a no-show on a care lesson still spends one session, a cancellation none", () => {
  /* 강사는 그 시간을 비워 두었고 회원은 알리지 않았다 -- PT 와 같은 규칙이다. */
  const noshow = plan(careLesson("관리A", "noshow"), [diosaA()]);
  assert.equal(noshow.deductions.length, 1);
  assert.equal(noshow.deductions[0].pass.id, "dia");

  const cancelled = plan(careLesson("관리A", "cancel"), [diosaA()]);
  assert.deepEqual(cancelled.deductions, []);
  assert.deepEqual(cancelled.skips, []);
});

/* ── PT + 추가 관리 (지금 기능 유지) ────────────────────────────────────── */

const ptWithCare = (grade) => ({
  id: "l2", type: "개인레슨",
  attendees: [{ memberId: "m1", status: "done", careGrade: grade }],
});

test("PT and the add-on come out together", () => {
  const { deductions, skips } = plan(ptWithCare("a"), [pass(), diosaA()]);
  assert.deepEqual(skips, []);
  assert.deepEqual(deductions.map((item) => item.pass.id).sort(), ["dia", "p"]);
});

test("without the diosa pass the PT does not move either", () => {
  /* 반쪽으로 끝내지 않는다. 한쪽만 나가면 회원은 받지 않은 관리의 회차를
     잃거나, 받은 관리가 공짜가 된다. */
  const { deductions, skips } = plan(ptWithCare("a"), [pass()]);
  assert.deepEqual(deductions, []);
  assert.equal(skips[0].careCategory, PAY_CATEGORY.DIOSA_A);
});

test("the add-on chips are closed when there is nothing behind them", () => {
  /* 열어 두면 강사가 고르고, 그 순간 PT 까지 막힌다 -- 확정 화면에서야
     드러나고, 왜 막혔는지는 어디에도 없다. */
  const [none, a, b] = careChoices([pass(), diosaA()], "c1", { now: NOW });

  assert.equal(none.key, CARE_GRADE.NONE);
  assert.equal(none.usable, true);
  assert.equal(a.usable, true);
  assert.equal(a.note, "");
  assert.equal(b.usable, false);
  assert.equal(b.note, "회원권 없음");
  assert.match(a.label, /30분/);
  assert.match(b.label, /50분/);
});

test("a spent diosa pass closes its chip with a different reason", () => {
  const [, a] = careChoices([diosaA({ remainingCount: 0 })], "c1", { now: NOW });
  assert.equal(a.usable, false);
  assert.equal(a.note, "잔여 없음", "발급이 아니라 재등록이 필요하다");
});

test("a client with no diosa at all has both chips closed", () => {
  const [, a, b] = careChoices([pass()], "c1", { now: NOW });
  assert.equal(a.usable, false);
  assert.equal(b.usable, false);
});

/* ── 디오사만 있는 회원을 PT 로 넣으려 할 때 ─────────────────────────────── */

test("a diosa-only client is recognised, and which grade is named", () => {
  const found = careOnlyClient([diosaB()], "c1", { now: NOW });
  assert.equal(found.careOnly, true);
  assert.equal(found.grade, CARE_GRADE.B);
  assert.equal(found.label, careGradeLabel(CARE_GRADE.B));
  assert.match(found.label, /50분/, "길이를 말해야 고를 수 있다");
});

test("a client who also has PT is left alone", () => {
  /* 둘 다 있으면 강사가 고른 대로 가는 것이 맞다. */
  assert.equal(careOnlyClient([pass(), diosaA()], "c1", { now: NOW }).careOnly, false);
});

test("a client with nothing is not offered a care lesson", () => {
  /* 할 말이 "회원권이 없습니다" 이지 "관리 수업으로 넣을까요" 가 아니다. */
  assert.equal(careOnlyClient([], "c1", { now: NOW }).careOnly, false);
  assert.equal(careOnlyClient([pass({ remainingCount: 0 })], "c1", { now: NOW }).careOnly, false);
});

test("a client holding both diosa kinds is not pushed towards one of them", () => {
  // 어느 쪽인지 모르면 고르게 두지 않는다. 틀린 길이를 고르면 확정되지 않는다.
  const found = careOnlyClient([diosaA(), diosaB()], "c1", { now: NOW });
  assert.equal(found.careOnly, true);
  assert.equal(found.grade, CARE_GRADE.NONE);
});

/* ── 단가 ──────────────────────────────────────────────────────────────── */

/** 미리보기는 memberId 로 찾는 Map 을 돌려준다. */
const rateOf = (lesson, passes, extra = {}) => previewLessonRates({
  lesson, members: [member], passes, totals: [], instructorId: "u1", now: NOW, ...extra,
}).get(member.id);

test("the care lesson is priced at its fixed rate", () => {
  assert.equal(rateOf(careLesson("관리A"), [diosaA()]).unitPrice, 20000);
  assert.equal(rateOf(careLesson("관리B"), [diosaB()]).unitPrice, 35000);
});

test("a deputy director splits the contract instead, on a care lesson too", () => {
  /* 판정 1 이 고정 단가보다 먼저다. 부원장에게는 카테고리도 누적도 보지
     않는다 -- 디오사라고 달라지지 않는다. */
  const row = rateOf(
    careLesson("관리A"),
    [diosaA({ contractPrice: 1100000, netContractPrice: 1000000, totalSessions: 20 })],
    { isDeputyDirector: true },
  );
  assert.equal(row.unitPrice, 25000, "1,000,000 ÷ 20 ÷ 2");
});

/* ── 회원권 카드 ───────────────────────────────────────────────────────── */

test("the card says which length spends this pass", () => {
  /* 디오사만 끊은 회원에게는 이 줄이 카드의 전부다. "관리 수업 시 차감" 으로
     뭉치면 50분 수업을 넣은 회원은 자기 A 회원권이 왜 안 빠지는지 모른다. */
  const { active } = passCardList({
    passes: [diosaA(), diosaB()],
    now: NOW,
    nextCareAPassId: "dia",
    nextCareBPassId: "dib",
  });
  const byId = new Map(active.map((card) => [card.passId, card]));
  assert.equal(byId.get("dia").nextDeduct, NEXT_DEDUCT.CARE_A);
  assert.equal(byId.get("dib").nextDeduct, NEXT_DEDUCT.CARE_B);
});

/* ── 상품 ──────────────────────────────────────────────────────────────── */

test("diosa is its own session type, with exactly two categories", () => {
  /* 상품을 못 만들면 회원권도 못 발급한다 -- 2026-10-10 까지 디오사가 그
     상태였다. 서비스도 기타도 붙이지 않는다: 관리 수업의 단가는 고정이다. */
  assert.deepEqual(
    [...payCategoriesFor(SESSION_TYPE.DIOSA)],
    [PAY_CATEGORY.DIOSA_A, PAY_CATEGORY.DIOSA_B],
  );
  // PT 쪽에는 섞이지 않는다.
  for (const sessionType of [SESSION_TYPE.PT_1_1, SESSION_TYPE.PT_2_1]) {
    assert.equal(payCategoriesFor(sessionType).includes(PAY_CATEGORY.DIOSA_A), false, sessionType);
    assert.equal(payCategoriesFor(sessionType).includes(PAY_CATEGORY.DIOSA_B), false, sessionType);
  }
});
