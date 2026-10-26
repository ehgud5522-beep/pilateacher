import assert from "node:assert/strict";
import test from "node:test";

import {
  HANDOVER_BLOCK, handoverPlan, instructorsForHandover, isHandoverable,
  reassignUpcomingLessons, unitPriceAfterHandover, unsettledBeforeHandover,
} from "../../src/features/members/instructor-handover.js";

/**
 * 담당 인계.
 *
 * 회원권 하나를 넘기는 것과 퇴사 강사의 전부를 넘기는 것은 **같은 길로 간다.**
 * 서버에서 일어나는 일이 같기 때문이다 -- 둘을 따로 짜면 한쪽만 고쳐지는 날이
 * 오고, 그날 틀리는 것은 급여다.
 *
 * ── 이 파일이 지키는 것 ──
 * 하나. **실행 전에 보는 목록이 실행과 같아야 한다.** 미리보기가 25,000 이라고
 *       말했는데 26,000 이 나가면 그 화면은 다시 안 읽힌다.
 * 둘.  **듀엣은 갈라지지 않는다.** 두 사람이 다른 강사로 가면 함께 수업을 받을
 *       수 없다.
 * 셋.  **누적은 회원당 한 번 넘어간다.** 회원권이 세 장이어도 누적은 하나다.
 */

const NOW = new Date(2026, 9, 16, 12, 0);

const pass = (overrides = {}) => ({
  id: "p1", clientId: "c1", instructorId: "u-old", status: "active",
  category: "pt_1_1_repurchase_event", baseUnitPrice: 30000,
  remainingCount: 8, locationId: "bansong", expiresAt: new Date(2027, 0, 1),
  ...overrides,
});

const NAMES = { c1: "김하나", c2: "이두리", c3: "박세인" };
const INSTRUCTORS = {
  "u-new": { userId: "u-new", displayName: "정예진", locationId: "bansong", status: "active" },
  "u-far": { userId: "u-far", displayName: "최센텀", locationId: "centum", status: "active" },
  "u-deputy": { userId: "u-deputy", displayName: "한부원", locationId: "bansong", status: "active", isDeputyDirector: true },
};

const planOf = (passes, assignments, extra = {}) => handoverPlan({
  passes, assignments, fromInstructorId: "u-old", now: NOW,
  clientNameOf: (id) => NAMES[id] || "",
  instructorOf: (id) => INSTRUCTORS[id] || null,
  ...extra,
});

/* ── 무엇을 넘기는가 ─────────────────────────────────────────────────────── */

test("only passes that still have sessions to spend are handed over", () => {
  /* 끝난 회원권을 함께 옮기면 목록이 길어져 대표가 무엇을 보고 있는지 알 수
     없고, 넘겨 봐야 차감될 회차가 없다. 그 지난 원장 항목은 그대로 전 강사의
     급여로 남는다. */
  assert.equal(isHandoverable(pass(), NOW), true);
  assert.equal(isHandoverable(pass({ remainingCount: 0 }), NOW), false);
  assert.equal(isHandoverable(pass({ status: "cancelled" }), NOW), false);
  assert.equal(isHandoverable(pass({ expiresAt: new Date(2026, 8, 1) }), NOW), false, "만료");
  assert.equal(isHandoverable(pass({ expiresAt: null }), NOW), true, "만료일 없는 옛 회원권");
});

test("only the leaving instructor's passes are listed", () => {
  const found = planOf([pass(), pass({ id: "p2", instructorId: "u-other" })], { p1: "u-new" });
  assert.deepEqual(found.rows.map((row) => row.passId), ["p1"]);
});

/* ── 미리보기 금액 ───────────────────────────────────────────────────────── */

test("the preview says the exact rate, because a handover does not depend on the count", () => {
  /* 넘겨받은 회원권은 남은 회차 전부가 신규 단가다 (판정 2). 누적과 무관하므로
     미리 정확히 말할 수 있다 -- 그래서 이 화면이 값어치가 있다. */
  assert.equal(unitPriceAfterHandover(pass()).unitPrice, 25000);
  assert.equal(unitPriceAfterHandover(pass({ category: "pt_2_1_repurchase" })).unitPrice, 30000);
  assert.equal(unitPriceAfterHandover(pass({ category: "pt_2_1_new" })).unitPrice, 30000);
});

test("diosa keeps its own rate, because it sits before the handover rule", () => {
  // 판정 1.2 가 판정 2 보다 앞이다. 25,000 이라고 말하면 거짓이 된다.
  const found = unitPriceAfterHandover(pass({ category: "diosa_a", baseUnitPrice: 20000 }));
  assert.equal(found.unitPrice, 20000);
  assert.equal(found.rule, "diosa_fixed");
});

test("a deputy director's rate is not guessed", () => {
  /* 5:5 는 계약마다 다르다. 숫자를 지어내면 미리보기가 거짓말을 하고, 그
     화면은 다시 안 읽힌다. */
  const found = unitPriceAfterHandover(pass(), { isDeputyDirector: true });
  assert.equal(found.unitPrice, null);
  assert.equal(found.rule, "deputy_director");
});

test("the plan carries the preview rate onto every row", () => {
  const found = planOf([pass(), pass({ id: "p2", clientId: "c2", category: "pt_2_1_repurchase" })],
    { p1: "u-new", p2: "u-new" });
  assert.deepEqual(found.rows.map((row) => row.unitPriceAfter).sort(), [25000, 30000]);
});

/* ── 막히는 자리 ─────────────────────────────────────────────────────────── */

test("a row with no target is not ready, and says so", () => {
  const found = planOf([pass()], {});
  assert.deepEqual(found.rows[0].blocks, [HANDOVER_BLOCK.NO_TARGET]);
  assert.equal(found.canRun, false);
});

test("another branch's instructor is refused", () => {
  /* 넘기면 그 회원은 다니던 곳에서 수업을 받을 수 없다. */
  const found = planOf([pass()], { p1: "u-far" });
  assert.deepEqual(found.rows[0].blocks, [HANDOVER_BLOCK.OTHER_LOCATION]);
});

test("a pass or an instructor with no branch recorded is not blocked", () => {
  /* 이 칸이 생기기 전 소속이 있다. 거르면 받을 사람이 없어진다 -- 아는 값끼리
     다를 때만 막는다. */
  assert.deepEqual(planOf([pass({ locationId: "" })], { p1: "u-far" }).rows[0].blocks, []);
  const noBranch = { "u-blank": { userId: "u-blank", displayName: "무지점", locationId: "", status: "active" } };
  assert.deepEqual(
    handoverPlan({
      passes: [pass()], assignments: { p1: "u-blank" }, fromInstructorId: "u-old", now: NOW,
      instructorOf: (id) => noBranch[id] || null,
    }).rows[0].blocks,
    [],
  );
});

test("handing a pass to its current owner is refused", () => {
  assert.deepEqual(planOf([pass()], { p1: "u-old" }).rows[0].blocks, [HANDOVER_BLOCK.SAME_INSTRUCTOR]);
});

/* ── 듀엣 ────────────────────────────────────────────────────────────────── */

test("a member split across two instructors blocks every row they are on", () => {
  /* 한 줄만 막으면 대표는 나머지가 맞는 줄 안다. 그 회원은 두 강사에게
     나뉘어 다닐 수 없다. */
  const found = planOf([
    pass({ id: "p1", clientId: "c1" }),
    pass({ id: "p2", clientId: "c1" }),
  ], { p1: "u-new", p2: "u-deputy" });

  assert.equal(found.rows.every((row) => row.blocks.includes(HANDOVER_BLOCK.DUET_SPLIT)), true);
  assert.equal(found.canRun, false);
});

test("a duet pass moves both members together", () => {
  const found = planOf([pass({ clientIds: ["c1", "c2"] })], { p1: "u-new" });
  assert.deepEqual(found.rows[0].clientIds, ["c1", "c2"]);
  assert.deepEqual(found.rows[0].clientNames, ["김하나", "이두리"]);
  assert.equal(found.rows[0].isDuet, true);
  assert.deepEqual(found.rows[0].blocks, []);
});

test("a duet whose partner is also on a solo pass elsewhere must agree", () => {
  /* 짝이 따로 1:1 을 가지고 있고 그것을 다른 강사에게 보내면, 두 사람은 2:1
     수업을 함께 받을 수 없다. */
  const found = planOf([
    pass({ id: "duet", clientIds: ["c1", "c2"] }),
    pass({ id: "solo", clientId: "c2" }),
  ], { duet: "u-new", solo: "u-deputy" });
  assert.equal(found.canRun, false);
  assert.equal(found.blocked.length, 2);
});

/* ── 누적은 따라가지 않는다 (2026-10-23 대표 결정) ─────────────────────── */

test("the plan carries nothing, however many passes or sessions there are", () => {
  /* **새 강사의 누적은 새 강사가 실제로 한 수업만 센다.** 전 강사의 누적을
     더하면 새 강사는 한 번도 보지 않은 회원을 "이미 20회 넘긴 회원" 으로
     물려받고 첫 수업부터 기준 단가가 된다.

     회원권 자체는 그대로 인수인계 단가다 (handedOver → 판정 2) -- 남은 회차
     전부가 신규 단가라 누적과 무관하게 낮게 유지된다. */
  const many = planOf([
    pass({ id: "p1", clientId: "c1" }),
    pass({ id: "p2", clientId: "c1" }),
    pass({ id: "p3", clientId: "c1" }),
  ], { p1: "u-new", p2: "u-new", p3: "u-new" }, { sessionsOf: () => 30 });
  assert.deepEqual(many.carries, []);
  assert.equal(many.ready.length, 3, "넘기는 것 자체는 그대로다");

  const duet = planOf([pass({ clientIds: ["c1", "c2"] })], { p1: "u-new" },
    { sessionsOf: (id) => (id === "c1" ? 30 : 12) });
  assert.deepEqual(duet.carries, [], "듀엣도 둘 다 안 옮긴다");
});

/* ── 받을 수 있는 강사 ───────────────────────────────────────────────────── */

test("the picker offers the same branch, never the person leaving", () => {
  const found = instructorsForHandover(Object.values(INSTRUCTORS), {
    locationId: "bansong", excludeUserId: "u-old",
  });
  assert.deepEqual(found.map((item) => item.userId).sort(), ["u-deputy", "u-new"]);
});

test("a revoked instructor cannot receive a handover", () => {
  /* 퇴사한 사람에게 넘기면 그 회원권은 다시 주인이 없다. */
  const found = instructorsForHandover(
    [...Object.values(INSTRUCTORS), { userId: "u-gone", displayName: "퇴사", locationId: "bansong", status: "revoked" }],
    { locationId: "bansong" },
  );
  assert.equal(found.some((item) => item.userId === "u-gone"), false);
});

/* ── 먼저 처리해야 하는 수업 ─────────────────────────────────────────────── */

test("lessons already taught but not settled are surfaced before the handover", () => {
  /* 담당이 바뀐 뒤에 확정하면 그 회차가 새 강사의 급여로 들어간다 -- 수업한
     사람은 전 강사인데. 원장은 append-only 라 되돌릴 수 없다. */
  const found = unsettledBeforeHandover({
    now: NOW,
    isSettled: (lesson) => Boolean(lesson.orgSettledAt),
    schedule: [
      { id: "done", date: "2026-10-15", attendees: [{ memberId: "m1", status: "done" }] },
      { id: "settled", date: "2026-10-15", orgSettledAt: "x", attendees: [{ memberId: "m1", status: "done" }] },
      { id: "booked", date: "2026-10-15", attendees: [{ memberId: "m1", status: "booked" }] },
      { id: "future", date: "2026-10-20", attendees: [{ memberId: "m1", status: "done" }] },
      { id: "off", date: "2026-10-15", personal: true, attendees: [] },
    ],
  });
  assert.deepEqual(found.map((item) => item.id), ["done"]);
});

test("a no-show counts too, because it is money as well", () => {
  const found = unsettledBeforeHandover({
    now: NOW, isSettled: () => false,
    schedule: [{ id: "n", date: "2026-10-15", attendees: [{ memberId: "m1", status: "noshow" }] }],
  });
  assert.equal(found.length, 1);
});

/* ── 앞으로의 예약 ───────────────────────────────────────────────────────── */

test("upcoming bookings move, and past lessons do not", () => {
  /* 지난 수업은 그때 그 강사가 한 것이고, 확정됐으면 원장이 이미 그 사람을
     가리킨다. 옮기면 기록과 원장이 서로 다른 말을 한다. */
  const { schedule, moved } = reassignUpcomingLessons({
    now: NOW, clientIds: ["m1"], toInstructorName: "정예진",
    schedule: [
      { id: "past", date: "2026-10-10", instructor: "김전임", attendees: [{ memberId: "m1", status: "done" }] },
      { id: "next", date: "2026-10-20", instructor: "김전임", attendees: [{ memberId: "m1", status: "booked" }] },
      { id: "other", date: "2026-10-20", instructor: "김전임", attendees: [{ memberId: "m9", status: "booked" }] },
    ],
  });
  assert.equal(moved, 1);
  assert.equal(schedule[0].instructor, "김전임", "지난 수업은 그대로");
  assert.equal(schedule[1].instructor, "정예진");
  assert.equal(schedule[2].instructor, "김전임", "남의 회원은 그대로");
});

test("today's already-marked lesson is not moved", () => {
  /* 오늘이지만 이미 출석을 찍었다. 그 수업은 전 강사가 했다. */
  const { moved } = reassignUpcomingLessons({
    now: NOW, clientIds: ["m1"], toInstructorName: "정예진",
    schedule: [{ id: "t", date: "2026-10-16", instructor: "김전임", attendees: [{ memberId: "m1", status: "done" }] }],
  });
  assert.equal(moved, 0);
});
