import assert from "node:assert/strict";
import test from "node:test";
import {
  DELETE_MODE, canEditLessonInfo, lessonDeletePolicy, opensEditingFirst, restoreDeletedLesson, settledLockNotice,
} from "../../src/features/schedule/schedule-edit.js";

/* 일정 고치기 · 지우기를 한 번에 (2026-10-30, 회원 앱 개편 4단계). */

const lesson = (extra = {}) => ({
  id: "L1", date: "2026-11-03", start: "19:00", end: "19:50", type: "개인레슨",
  attendees: [{ memberId: "m1", status: "booked", deductFrom: null }],
  ...extra,
});

test("확정된 수업은 지울 수 없다 — 원장의 차감과 급여가 되짚을 수업을 잃지 않게", () => {
  const settled = lesson({ orgSettledAt: "2026-11-03T11:00:00.000Z" });
  assert.deepEqual(lessonDeletePolicy(settled), { mode: DELETE_MODE.BLOCKED, reason: "settled" });
  assert.equal(canEditLessonInfo(settled), false, "시간도 바꾸지 않는다 -- 원장의 수업 시각과 어긋난다");
});

test("출석으로 회차를 뺀 수업은 한 번 묻는다 — 되돌리기로 회차까지 되짚을 수 없다", () => {
  const deducted = lesson({ attendees: [{ memberId: "m1", status: "done", deductFrom: "정규" }] });
  assert.equal(lessonDeletePolicy(deducted).mode, DELETE_MODE.CONFIRM);
});

test("그 밖의 일정은 바로 지운다 (되돌리기를 준다)", () => {
  assert.equal(lessonDeletePolicy(lesson()).mode, DELETE_MODE.ONE_TAP);
  assert.equal(lessonDeletePolicy(lesson({ personal: true, title: "휴무", attendees: [] })).mode, DELETE_MODE.ONE_TAP);
  assert.equal(lessonDeletePolicy(null).mode, DELETE_MODE.BLOCKED);
});

test("앞날의 일정은 열자마자 고치는 칸이 펼쳐진다 — 오늘 · 지난 수업은 출석이 먼저", () => {
  assert.equal(opensEditingFirst(lesson({ date: "2026-11-04" }), "2026-11-03"), true);
  assert.equal(opensEditingFirst(lesson({ date: "2026-11-03" }), "2026-11-03"), false);
  assert.equal(opensEditingFirst(lesson({ date: "2026-11-02" }), "2026-11-03"), false);
  assert.equal(opensEditingFirst(lesson({ date: "2026-11-04", orgSettledAt: "x" }), "2026-11-03"), false);
  assert.equal(opensEditingFirst({ id: null, date: "2026-11-09" }, "2026-11-03"), false, "새 일정은 이미 펼쳐져 있다");
});

test("되돌리기는 같은 id 로 한 건만 돌아온다", () => {
  const removed = lesson();
  const restored = restoreDeletedLesson([lesson({ id: "L2" })], removed);
  assert.deepEqual(restored.map((item) => item.id), ["L2", "L1"]);
  assert.equal(restoreDeletedLesson(restored, removed), restored, "두 번 눌러도 한 건");
});

test("확정 잠금 문구는 다음 할 일을 말한다 — 되돌릴 수 있는 사람인지에 따라", () => {
  assert.match(settledLockNotice({ canUnsettle: true }), /확정을 먼저 되돌려/);
  assert.match(settledLockNotice(), /대표에게/);
});
