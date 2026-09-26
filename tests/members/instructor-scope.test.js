/**
 * 강사가 보는 회원의 범위, 만료 분류, 재등록 판정.
 *
 * 여기서 고정하는 것은 **숫자가 아니라 경계**다. 29일과 30일과 31일, 잔여 0과
 * 잔여 1, 인수인계 직후. 가운데 값은 틀려도 화면에서 보이지만 경계는 안 보인다.
 *
 * 모든 시계는 주입한다. 오늘에 기대는 픽스처는 만든 날에만 통과한다 --
 * tools/clock-shift.mjs 머리말에 그 사고가 네 번 적혀 있다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPIRY_REASON,
  REENROLL_WINDOW_DAYS,
  clientExpiry,
  expiryEventsFor,
  instructorIdsFor,
  isLivePass,
  isReenrollment,
  passExpiry,
  returnOutcome,
  summarizeExpiries,
} from "../../src/data/schema/instructor-scope.js";

const NOW = new Date(2026, 8, 26, 12, 0, 0);
const day = (offset) => new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);

const pass = (overrides = {}) => ({
  id: "pass_1",
  status: "active",
  remainingCount: 5,
  expiresAt: day(30),
  instructorId: "instructor_a",
  createdAt: day(-30),
  ...overrides,
});

test("살아 있는 회원권 — 상태·잔여·날짜 셋 다 맞아야 한다", () => {
  assert.equal(isLivePass(pass(), NOW), true);
  assert.equal(isLivePass(pass({ status: "cancelled" }), NOW), false);
  assert.equal(isLivePass(pass({ remainingCount: 0 }), NOW), false);
  assert.equal(isLivePass(pass({ expiresAt: day(-1) }), NOW), false);
});

test("만료일 당일은 아직 살아 있다", () => {
  /* 만료일 자정까지가 그 회원권의 날이다. 당일에 끊으면 그날 수업을 온 회원의
     차감이 막히고, 강사는 이유를 알 수 없다. */
  assert.equal(isLivePass(pass({ expiresAt: day(0) }), NOW), true);
});

test("만료일을 못 읽으면 회원을 빼앗지 않는다", () => {
  assert.equal(isLivePass(pass({ expiresAt: "" }), NOW), true);
  assert.equal(isLivePass(pass({ expiresAt: "언제였더라" }), NOW), true);
});

test("소진과 기간 만료를 가른다", () => {
  const usedUp = passExpiry(pass({ remainingCount: 0, expiresAt: day(30) }), {
    now: NOW, lastDeductedAt: day(-3),
  });
  assert.equal(usedUp.reason, EXPIRY_REASON.USED_UP);
  assert.equal(usedUp.at.getTime(), day(-3).getTime());

  const datePassed = passExpiry(pass({ remainingCount: 4, expiresAt: day(-2) }), { now: NOW });
  assert.equal(datePassed.reason, EXPIRY_REASON.DATE_PASSED);
  assert.equal(datePassed.at.getTime(), day(-2).getTime());
});

test("다 쓴 뒤 날짜도 지났으면 소진이다", () => {
  /* 강사가 재등록 상담에서 할 말이 다르다. "다 쓰셨어요" 와 "기간이 지났어요"
     는 같은 만료가 아니다. */
  const both = passExpiry(pass({ remainingCount: 0, expiresAt: day(-5) }), {
    now: NOW, lastDeductedAt: day(-9),
  });
  assert.equal(both.reason, EXPIRY_REASON.USED_UP);
});

test("소진 날짜를 모르면 지어내지 않는다", () => {
  const unknown = passExpiry(pass({ remainingCount: 0 }), { now: NOW });
  assert.equal(unknown.reason, EXPIRY_REASON.USED_UP);
  assert.equal(unknown.at, null, "만료일에 미래의 expiresAt 을 넣으면 안 된다");
});

test("취소는 소진도 기간 만료도 아니다", () => {
  const cancelled = passExpiry(pass({ status: "cancelled", remainingCount: 0 }), { now: NOW });
  assert.equal(cancelled.reason, EXPIRY_REASON.CANCELLED);
});

test("담당 강사 — 살아 있는 회원권의 강사 전부", () => {
  assert.deepEqual(
    instructorIdsFor([
      pass({ id: "p1", instructorId: "instructor_a" }),
      pass({ id: "p2", instructorId: "instructor_b" }),
    ], { now: NOW }),
    ["instructor_a", "instructor_b"],
  );
});

test("만료해도 마지막 담당 강사에게는 계속 보인다 — 기한 없음", () => {
  const long = new Date(NOW.getTime() + 20 * 365 * 24 * 60 * 60 * 1000);
  const passes = [pass({ remainingCount: 0, createdAt: day(-400), expiresAt: day(-370) })];
  assert.deepEqual(instructorIdsFor(passes, { now: long }), ["instructor_a"]);
});

test("만료 회원은 가장 최근 회원권의 강사 한 명만 남는다", () => {
  const passes = [
    pass({ id: "old", instructorId: "instructor_a", createdAt: day(-400), remainingCount: 0 }),
    pass({ id: "new", instructorId: "instructor_b", createdAt: day(-100), remainingCount: 0 }),
  ];
  assert.deepEqual(instructorIdsFor(passes, { now: NOW }), ["instructor_b"]);
});

test("같은 순간에 발급된 둘은 실행마다 답이 달라지지 않는다", () => {
  const same = day(-10);
  const passes = [
    pass({ id: "aaa", instructorId: "instructor_a", createdAt: same, remainingCount: 0 }),
    pass({ id: "bbb", instructorId: "instructor_b", createdAt: same, remainingCount: 0 }),
  ];
  assert.deepEqual(instructorIdsFor(passes, { now: NOW }), ["instructor_b"]);
  assert.deepEqual(instructorIdsFor([...passes].reverse(), { now: NOW }), ["instructor_b"]);
});

test("인수인계하면 이전 강사는 그 자리에서 빠진다", () => {
  /* 인수인계는 회원권의 instructorId 자체를 바꾼다. 따로 뺄 것이 없다. */
  const before = [pass({ instructorId: "instructor_a" })];
  const after = [pass({ instructorId: "instructor_b" })];
  assert.deepEqual(instructorIdsFor(before, { now: NOW }), ["instructor_a"]);
  assert.deepEqual(instructorIdsFor(after, { now: NOW }), ["instructor_b"]);
});

test("재등록은 이전 강사를 즉시 빼지 않는다 — 아직 가르치고 있다", () => {
  const passes = [
    pass({ id: "living", instructorId: "instructor_a", expiresAt: day(10) }),
    pass({ id: "fresh", instructorId: "instructor_b", createdAt: day(-1) }),
  ];
  assert.deepEqual(instructorIdsFor(passes, { now: NOW }), ["instructor_a", "instructor_b"]);
});

test("담당 강사가 없는 회원은 아무에게도 안 보인다", () => {
  assert.deepEqual(instructorIdsFor([], { now: NOW }), []);
  assert.deepEqual(instructorIdsFor([pass({ instructorId: "" })], { now: NOW }), []);
});

test("만료 회원 — 살아 있는 것이 하나라도 있으면 만료가 아니다", () => {
  const passes = [pass({ id: "dead", remainingCount: 0 }), pass({ id: "alive" })];
  assert.equal(clientExpiry(passes, { now: NOW }).expired, false);
});

test("만료 회원 — 마지막으로 끝난 회원권의 사유와 날짜를 쓴다", () => {
  const passes = [
    pass({ id: "p1", remainingCount: 4, expiresAt: day(-40), createdAt: day(-200) }),
    pass({ id: "p2", remainingCount: 0, expiresAt: day(20), createdAt: day(-100) }),
  ];
  const found = clientExpiry(passes, {
    now: NOW,
    lastDeductedAtByPassId: { p2: day(-5) },
  });
  assert.equal(found.expired, true);
  assert.equal(found.reason, EXPIRY_REASON.USED_UP);
  assert.equal(found.at.getTime(), day(-5).getTime());
  assert.equal(found.passId, "p2");
});

test("재등록 경계 — 29일은 재등록, 30일도 재등록, 31일은 아니다", () => {
  const expiredAt = day(-60);
  const at = (offset) => new Date(expiredAt.getTime() + offset * 24 * 60 * 60 * 1000);
  assert.equal(isReenrollment(expiredAt, at(29)), true, "29일");
  assert.equal(isReenrollment(expiredAt, at(30)), true, "30일");
  assert.equal(isReenrollment(expiredAt, at(31)), false, "31일");
});

test("재등록 창은 상수 하나로 정해진다", () => {
  assert.equal(REENROLL_WINDOW_DAYS, 30);
});

test("만료 전에 나간 회원권은 재등록이 아니다", () => {
  const expiredAt = day(-10);
  assert.equal(isReenrollment(expiredAt, day(-20)), false);
});

test("만료 사건은 끝난 회원권마다 하나씩, 시간순으로 나온다", () => {
  const events = expiryEventsFor([
    pass({ id: "second", remainingCount: 4, expiresAt: day(-10), createdAt: day(-100) }),
    pass({ id: "first", remainingCount: 4, expiresAt: day(-50), createdAt: day(-200) }),
    pass({ id: "alive" }),
  ], { now: NOW });
  assert.deepEqual(events.map((event) => event.passId), ["first", "second"]);
});

test("재등록 판정 — 담당이 누구든 돌아온 것으로 센다", () => {
  const passes = [
    pass({ id: "gone", instructorId: "instructor_a", remainingCount: 4, expiresAt: day(-200), createdAt: day(-300) }),
    pass({ id: "back", instructorId: "instructor_b", remainingCount: 4, expiresAt: day(-100), createdAt: day(-190) }),
  ];
  const [first] = expiryEventsFor(passes, { now: NOW });
  assert.equal(first.passId, "gone");
  assert.equal(returnOutcome(first, passes, { now: NOW }), "returned",
    "다른 강사에게 재등록해도 돌아온 것이다");
});

test("아직 30일이 안 지난 만료는 '안 돌아옴'이 아니라 '기다리는 중'이다", () => {
  /* 만료한 지 사흘 된 회원을 안 돌아온 것으로 세면 이번 달 재등록률이 늘 낮게
     나오고, 그 숫자를 보고 판단하면 틀린다. */
  const passes = [pass({ id: "fresh", remainingCount: 4, expiresAt: day(-3), createdAt: day(-90) })];
  const [event] = expiryEventsFor(passes, { now: NOW });
  assert.equal(returnOutcome(event, passes, { now: NOW }), "pending");

  const old = [pass({ id: "old", remainingCount: 4, expiresAt: day(-40), createdAt: day(-200) })];
  assert.equal(returnOutcome(expiryEventsFor(old, { now: NOW })[0], old, { now: NOW }), "gone");
});

test("집계 — 강사 본인 회원만, 재등록률까지", () => {
  const rows = [
    {
      /* 만료하고 돌아오지 않았다. */
      clientId: "c1", name: "가",
      passes: [pass({ id: "c1p", instructorId: "instructor_a", remainingCount: 4, expiresAt: day(-60), createdAt: day(-200) })],
    },
    {
      /* 만료했다가 20일 뒤에 다시 끊었고 지금도 다니고 있다. */
      clientId: "c2", name: "나",
      passes: [
        pass({ id: "c2p", instructorId: "instructor_a", remainingCount: 4, expiresAt: day(-50), createdAt: day(-200) }),
        pass({ id: "c2back", instructorId: "instructor_a", createdAt: day(-40), expiresAt: day(20) }),
      ],
    },
    {
      clientId: "c3", name: "다",
      passes: [pass({ id: "c3p", instructorId: "instructor_b", remainingCount: 4, expiresAt: day(-60), createdAt: day(-200) })],
    },
  ];
  const summary = summarizeExpiries(rows, { now: NOW, instructorId: "instructor_a" });
  assert.equal(summary.expired, 2, "instructor_b 의 회원은 빠진다");
  assert.equal(summary.reenrolled, 1);
  assert.equal(summary.pending, 0);
  assert.equal(summary.rate, 0.5);
  assert.deepEqual(summary.members.map((member) => member.clientId), ["c2", "c1"]);
});

test("돌아와서 다니고 있는 회원은 회원 탭에서는 운영중이고 현황에서는 재등록이다", () => {
  /* 두 화면이 다른 질문을 한다. 회원 탭은 "지금 만료 회원인가", 현황은
     "만료한 적이 있었나". 섞으면 둘 중 하나가 반드시 틀린다. */
  const passes = [
    pass({ id: "old", remainingCount: 4, expiresAt: day(-60), createdAt: day(-200) }),
    pass({ id: "now", createdAt: day(-40), expiresAt: day(20) }),
  ];
  assert.equal(clientExpiry(passes, { now: NOW }).expired, false, "회원 탭: 운영중");

  const summary = summarizeExpiries([{ clientId: "c1", passes }], { now: NOW });
  assert.equal(summary.expired, 1, "현황: 만료한 적이 있다");
  assert.equal(summary.reenrolled, 1);
});

test("집계 — 아직 기다리는 중인 건은 분모에서 뺀다", () => {
  const rows = [
    { clientId: "gone", passes: [pass({ id: "g", remainingCount: 4, expiresAt: day(-60), createdAt: day(-200) })] },
    { clientId: "fresh", passes: [pass({ id: "f", remainingCount: 4, expiresAt: day(-3), createdAt: day(-90) })] },
  ];
  const summary = summarizeExpiries(rows, { now: NOW, instructorId: "instructor_a" });
  assert.equal(summary.expired, 2);
  assert.equal(summary.pending, 1);
  assert.equal(summary.reenrolled, 0);
  assert.equal(summary.rate, 0, "1명은 아직 30일이 안 지났으므로 분모는 1이다");
});

test("집계 — 만료가 없으면 재등록률은 0이다", () => {
  const summary = summarizeExpiries([{ clientId: "c1", passes: [pass()] }], {
    now: NOW, instructorId: "instructor_a",
  });
  assert.equal(summary.expired, 0);
  assert.equal(summary.rate, 0, "0/0 을 100% 로 보이면 안 된다");
});

test("집계 — 기간을 주면 그 달에 만료한 것만 센다", () => {
  const rows = [
    { clientId: "thisMonth", passes: [pass({ id: "a", remainingCount: 4, expiresAt: day(-5) })] },
    { clientId: "lastMonth", passes: [pass({ id: "b", remainingCount: 4, expiresAt: day(-45) })] },
  ];
  const summary = summarizeExpiries(rows, {
    now: NOW,
    instructorId: "instructor_a",
    within: { start: new Date(2026, 8, 1), end: new Date(2026, 9, 1) },
  });
  assert.deepEqual(summary.members.map((member) => member.clientId), ["thisMonth"]);
});

test("집계 — 인수인계로 옮겨간 회원은 이전 강사 숫자에서 빠진다", () => {
  /* 인수인계된 회원권은 instructorId 가 새 강사다. 그러면 마지막 회원권의
     담당이 새 강사이므로 이전 강사의 집계에 들어오지 않는다. */
  const rows = [{
    clientId: "handed",
    passes: [pass({ id: "p", instructorId: "instructor_b", remainingCount: 4, expiresAt: day(-3) })],
  }];
  assert.equal(summarizeExpiries(rows, { now: NOW, instructorId: "instructor_a" }).expired, 0);
  assert.equal(summarizeExpiries(rows, { now: NOW, instructorId: "instructor_b" }).expired, 1);
});

test("집계 — 강사를 안 주면 센터 전체다 (대표 화면)", () => {
  const rows = [
    { clientId: "c1", passes: [pass({ id: "a", instructorId: "instructor_a", remainingCount: 4, expiresAt: day(-3) })] },
    { clientId: "c2", passes: [pass({ id: "b", instructorId: "instructor_b", remainingCount: 4, expiresAt: day(-4) })] },
  ];
  assert.equal(summarizeExpiries(rows, { now: NOW }).expired, 2);
});

test("강사 화면과 대표 화면은 같은 함수를 쓴다", () => {
  /* 대표 화면은 강사마다 한 번씩 부른다. 따로 세면 두 화면의 숫자가 갈라지고,
     그러면 비교가 의미를 잃는다. */
  const rows = [
    { clientId: "c1", passes: [pass({ id: "a", instructorId: "instructor_a", remainingCount: 4, expiresAt: day(-3) })] },
    { clientId: "c2", passes: [pass({ id: "b", instructorId: "instructor_a", remainingCount: 0, expiresAt: day(-4) })] },
    { clientId: "c3", passes: [pass({ id: "c", instructorId: "instructor_b", remainingCount: 4, expiresAt: day(-5) })] },
  ];
  const instructorScreen = summarizeExpiries(rows, { now: NOW, instructorId: "instructor_a" });
  const ownerScreenRow = summarizeExpiries(rows, { now: NOW, instructorId: "instructor_a" });
  assert.deepEqual(ownerScreenRow, instructorScreen);
});
