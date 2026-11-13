import assert from "node:assert/strict";
import test from "node:test";
import { holdBlocksLesson, isPassHeld, planPassHold } from "../../functions/shared/pass-hold.mjs";
import { isUsablePass } from "../../src/features/membership/pass-cards.js";
import { deductPass, isDeductablePass } from "../../src/data/repositories/pass-repository.js";
import { planPassSelection } from "../../src/features/schedule/lesson-settlement.js";

const now = new Date("2026-11-10T03:00:00Z");
const pass = { id: "p", clientId: "c", locationId: "l", status: "active", remainingCount: 10,
  category: "pt_1_1_new", expiresAt: new Date("2027-03-01T00:00:00Z") };
const plan = planPassHold(pass, { action: "hold", days: 7, reason: "여행" }, now);
const held = { ...pass, ...plan };

test("hold preserves balance, extends expiry, blocks both app predicates and resumes at boundary", () => {
  assert.equal(held.remainingCount, 10);
  assert.equal(plan.expiresAt - pass.expiresAt, 7 * 86400000);
  assert.equal(isPassHeld(held, now), true);
  assert.equal(isDeductablePass(held, now), false);
  assert.equal(isUsablePass(held, now), false);
  assert.equal(isUsablePass(held, plan.holdUntil), true);
  assert.equal(isPassHeld(held, new Date(now.getTime() - 1)), false);
  assert.equal(isPassHeld({ holdFrom: { seconds: now.getTime() / 1000 }, holdUntil: plan.holdUntil.toISOString() }, now), true);
});

test("duplicate hold cannot extend twice and early release credits only actual time", () => {
  assert.throws(() => planPassHold(held, { action: "hold", days: 7, reason: "중복" }, now), /hold_already_active/);
  const releaseAt = new Date(now.getTime() + 2 * 86400000);
  const release = planPassHold(held, { action: "release", reason: "복귀" }, releaseAt);
  assert.equal(release.expiresAt - pass.expiresAt, 2 * 86400000);
  assert.equal(isPassHeld({ ...held, ...release }, releaseAt), false);
  assert.throws(() => planPassHold({ ...held, ...release }, { action: "release", reason: "중복" }, releaseAt), /hold_not_active/);
});

test("hold validates period, reason and pass state", () => {
  for (const days of [0, -1, 366, 1.5, NaN]) assert.throws(() => planPassHold(pass, { action: "hold", days, reason: "사유" }, now), /hold_days_invalid/);
  assert.throws(() => planPassHold(pass, { action: "hold", days: 1 }, now), /hold_reason_required/);
  assert.throws(() => planPassHold({ ...pass, status: "cancelled" }, { action: "hold", days: 1, reason: "사유" }, now), /hold_pass_unusable/);
});

const lesson = { id: "s", date: "2026-11-10", start: "12:00", end: "12:50", type: "개인레슨", attendees: [{ memberId: "m", status: "done" }] };
const input = { lesson, members: [{ id: "m", orgClientId: "c" }], passes: [held], now, requireAttendance: false };
test("booking and settlement explain hold; another usable pass remains usable", () => {
  assert.equal(planPassSelection(input).skips[0].reason, "pass_on_hold");
  const another = { ...pass, id: "other" };
  assert.equal(planPassSelection({ ...input, passes: [held, another] }).deductions[0].pass.id, "other");
  const after = new Date(plan.holdUntil.getTime() + 86400000);
  assert.equal(planPassSelection({ ...input, now: after }).skips[0].reason, "pass_on_hold", "past lesson during hold stays blocked after expiry");
});

test("duet shared hold blocks both participants", () => {
  const result = planPassSelection({ ...input,
    lesson: { ...lesson, type: "듀엣", attendees: [{ memberId: "m", status: "done" }, { memberId: "m2", status: "done" }] },
    members: [...input.members, { id: "m2", orgClientId: "c2" }],
    passes: [{ ...held, clientIds: ["c", "c2"], category: "pt_2_1_new" }],
  });
  assert.equal(result.deductions.length, 0);
  assert.ok(result.skips.every((row) => row.reason === "pass_on_hold"));
});

/* 2026-11-14 대표: 홀딩을 걸기 전에 한 수업은 지금 홀딩 중이어도 차감한다.
   지금 시각으로 막으면 홀딩이 풀릴 때 7일 차감 기한이 지나 영영 확정할 수 없다. */
test("a lesson taught before the hold started still settles while the hold is active", () => {
  const settleAt = new Date(now.getTime() + 2 * 86400000);
  const before = { ...lesson, date: "2026-11-09", start: "10:00", end: "10:50" };
  const result = planPassSelection({ ...input, lesson: before, now: settleAt });
  assert.equal(result.skips.length, 0);
  assert.equal(result.deductions[0].pass.id, "p");
  assert.equal(holdBlocksLesson(held, new Date("2026-11-09T10:00:00"), settleAt), false);
  assert.equal(holdBlocksLesson(held, new Date(now.getTime() + 3600000), settleAt), true);
  // 수업 시각을 모르면 지금으로 본다 -- 예전처럼 막는다.
  assert.equal(holdBlocksLesson(held, null, settleAt), true);
  assert.equal(holdBlocksLesson(held, "not-a-date", settleAt), true);
});

test("a lesson inside the hold window stays blocked while the hold is active", () => {
  const settleAt = new Date(now.getTime() + 2 * 86400000);
  const inside = { ...lesson, date: "2026-11-11", start: "10:00", end: "10:50" };
  assert.equal(planPassSelection({ ...input, lesson: inside, now: settleAt }).skips[0].reason, "pass_on_hold");
});

test("direct deduction of a pre-hold lesson is not stopped by the hold", async () => {
  const settleAt = new Date(now.getTime() + 2 * 86400000);
  // 홀딩 검사를 지나 다음 검사까지 간다 -- 여기서 멈추는 이유가 pass_on_hold 가 아니어야 한다.
  await assert.rejects(deductPass("org", held, { instructorId: "teacher", createdBy: "teacher",
    occurredAt: new Date(now.getTime() - 86400000) }, {
    now: () => settleAt, store: { commit: () => assert.fail("must not reach commit") },
  }), (error) => { assert.notEqual(error.code, "pass_on_hold"); assert.doesNotMatch(error.message, /pass_on_hold/); return true; });
});

test("direct deduction of a held pass writes nothing", async () => {
  await assert.rejects(deductPass("org", held, { instructorId: "teacher", createdBy: "teacher", occurredAt: now }, {
    now: () => now, store: { commit: () => assert.fail("must not write") },
  }), /pass_on_hold/);
});
