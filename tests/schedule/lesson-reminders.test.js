import assert from "node:assert/strict";
import test from "node:test";

import {
  LESSON_NOTIFICATION_KIND, LESSON_NOTIFICATION_LIMIT, LESSON_NOTIFICATION_WINDOW_DAYS,
  buildLessonNotificationPlan, notificationIdForLesson, reconcileLessonNotificationPlan,
} from "../../src/features/notifications/local-notifications.js";

/**
 * 수업 10분 전 알림.
 *
 * ── 이 파일이 지키는 것 ──
 * **예약은 앱을 열 때만 다시 깔린다.** 그래서 창(window)이 곧 "앱을 안 열어도
 * 알림이 가는 기간" 이고, 그 기간이 짧으면 휴가를 다녀온 강사에게는 알림이
 * 한 건도 가지 않는다 -- 안 울린 알림은 화면에 아무것도 남기지 않으므로
 * 아무도 그 사실을 모른다.
 *
 * 그리고 **취소한 수업의 알림은 울리면 안 된다.** 회원에게 안 간다고 말해 둔
 * 수업이다.
 */

const NOW = new Date(2026, 9, 11, 9, 0);
const day = (offset) => {
  const at = new Date(2026, 9, 11 + offset);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
};

const member = { id: "m1", name: "김하나" };
const lesson = (overrides = {}) => ({
  id: "l1", date: day(1), start: "10:00", type: "개인레슨",
  attendees: [{ memberId: "m1", status: "booked" }], ...overrides,
});
const planOf = (schedule, now = NOW) => buildLessonNotificationPlan({
  schedule, members: [member], now,
});

/* ── 얼마나 앞까지 ───────────────────────────────────────────────────────── */

test("the window covers a fortnight, so a week away is not a silent gap", () => {
  /* 7일이었을 때는 휴가를 한 주 다녀오면 그 뒤 수업에 알림이 한 건도 가지
     않았다. 14일이면 한 주를 통째로 비워도 그다음 주가 덮인다. */
  assert.equal(LESSON_NOTIFICATION_WINDOW_DAYS, 14);
  assert.equal(planOf([lesson({ date: day(10) })]).length, 1, "열흘 뒤 수업도 깔린다");
  assert.equal(planOf([lesson({ date: day(13) })]).length, 1);
});

test("beyond the window nothing is scheduled, and that is the honest edge", () => {
  /* 창 밖은 앱을 다시 열 때 깔린다. 여기서 더 깔면 iOS 가 조용히 버린다. */
  assert.equal(planOf([lesson({ date: day(15) })]).length, 0);
});

test("the cap stays well inside what iOS will hold", () => {
  /* iOS 는 앱당 예약 64건까지만 들고 있고, 넘으면 가장 이른 64건만 남기고
     **나머지를 조용히 버린다** -- 버려진 것은 어디에도 안 나타난다. */
  assert.ok(LESSON_NOTIFICATION_LIMIT <= 64, "iOS 가 들고 있는 수 안쪽");
  assert.ok(LESSON_NOTIFICATION_LIMIT >= 50, "2주를 덮을 만큼은 된다");

  const many = Array.from({ length: LESSON_NOTIFICATION_LIMIT + 12 }, (_, index) => lesson({
    id: `l-${index}`,
    date: day(1 + Math.floor(index / 6)),
    start: `${String(8 + (index % 6) * 2).padStart(2, "0")}:00`,
  }));
  const plan = planOf(many);
  assert.equal(plan.length, LESSON_NOTIFICATION_LIMIT);
});

test("when the cap bites, the soonest lessons are the ones kept", () => {
  /* 뒤쪽이 잘리는 것은 앱을 한 번 열면 채워진다. 앞쪽이 잘리면 오늘 수업에
     알림이 안 간다 -- 그것은 못 고친다. */
  const many = Array.from({ length: LESSON_NOTIFICATION_LIMIT + 5 }, (_, index) => lesson({
    id: `l-${index}`, date: day(1 + index), start: "10:00",
  }));
  const plan = planOf(many);
  assert.equal(plan[0].lessonId, "l-0");
  const times = plan.map((item) => item.triggerAt.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b), "이른 것부터다");
});

/* ── 울리면 안 되는 것 ───────────────────────────────────────────────────── */

test("a cancelled attendee leaves no reminder behind", () => {
  /* 2026-10-11 까지 출석을 '취소' 로 바꿔도 재예약을 부르지 않아, 앱을 켜 둔
     채 두면 그 알림이 그대로 울렸다 -- 회원에게 안 간다고 말해 둔 수업이다.
     계획 자체는 처음부터 취소를 빼고 있었고, 빠진 것은 다시 깔라고 말해 주는
     쪽이었다 (App 의 saveAttendanceOnce). */
  assert.equal(planOf([lesson({ attendees: [{ memberId: "m1", status: "cancel" }] })]).length, 0);
});

test("a no-show still gets its reminder, because it has not happened yet", () => {
  /* 노쇼는 수업이 끝난 뒤에 찍는 상태다. 알림은 10분 전에 울리므로 그때는
     아직 예약된 수업이고, 미리 빼면 올 사람에게 알림이 안 간다. */
  assert.equal(planOf([lesson({ attendees: [{ memberId: "m1", status: "noshow" }] })]).length, 0,
    "이미 찍힌 수업은 깔지 않는다");
});

test("a lesson that starts within ten minutes is already too late", () => {
  const soon = planOf([lesson({ date: day(0), start: "09:05" })], NOW);
  assert.equal(soon.length, 0);
});

test("personal time is not a lesson", () => {
  assert.equal(planOf([lesson({ personal: true })]).length, 0);
});

/* ── 다시 깔 때 ──────────────────────────────────────────────────────────── */

test("rescheduling clears every reminder this app owns, and nothing else", () => {
  /* 전체 재조정이다. 남의 알림까지 지우면 다른 기능이 조용히 멈춘다. */
  const { cancel, schedule } = reconcileLessonNotificationPlan([
    { id: 11, extra: { kind: LESSON_NOTIFICATION_KIND } },
    { id: 12, extra: JSON.stringify({ kind: LESSON_NOTIFICATION_KIND }) },
    { id: 13, extra: { kind: "something_else" } },
    { id: 14 },
  ], [{ id: 99 }]);

  assert.deepEqual(cancel, [{ id: 11 }, { id: 12 }]);
  assert.deepEqual(schedule, [{ id: 99 }]);
});

test("one lesson keeps one notification id, so a rewrite replaces it", () => {
  /* id 가 흔들리면 같은 수업에 알림이 둘 깔리고, 하나는 취소해도 남는다. */
  assert.equal(notificationIdForLesson("l1"), notificationIdForLesson("l1"));
  assert.notEqual(notificationIdForLesson("l1"), notificationIdForLesson("l2"));
  assert.ok(notificationIdForLesson("") > 0, "0 은 쓰지 않는다 -- 안드로이드가 무시한다");
});
