import assert from "node:assert/strict";
import test from "node:test";
import { isPassHeld, planPassHold } from "../../functions/shared/pass-hold.mjs";
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

test("direct deduction of a held pass writes nothing", async () => {
  await assert.rejects(deductPass("org", held, { instructorId: "teacher", createdBy: "teacher", occurredAt: now }, {
    now: () => now, store: { commit: () => assert.fail("must not write") },
  }), /pass_on_hold/);
});
