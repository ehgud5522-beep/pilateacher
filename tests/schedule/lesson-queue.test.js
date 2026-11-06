/**
 * "확인할 수업" 큐 정리 (2026-11-07 대표 결정): 서버 대조 · 11월 1일 컷오프 · 30일 관리자
 * 확인 · 듀엣 한 묶음 · 다른 기기 확정은 완료 · 진단 개수.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  QUEUE_CUTOFF, QUEUE_TAB, SERVER_STATE, SERVER_STATE_READ_LIMIT, SERVER_STATE_TTL_MS,
  lessonIdsToCheck, mergeServerCache, organizeLessonQueue, readQueueCounts, readQueueMarks,
  readServerCache, serverStateOf, serverStatesFromCache, writeQueueCounts, writeQueueMarks, writeServerCache,
} from "../../src/features/schedule/lesson-queue.js";

const TODAY = "2026-11-07";
const lesson = (id, date, extra = {}) => ({ id, date, start: "10:00", attendees: [], ...extra });
const task = (kind, memberId, l, extra = {}) => ({ key: `${kind}|${memberId}|${l?.id || "none"}`, kind, memberId, lessonId: l?.id || "", s: l, ...extra });
const organize = (tasks, serverStates = {}, extra = {}) => organizeLessonQueue({ tasks, today: TODAY, serverStates, ...extra });
const keys = (list) => list.map((group) => group.key);

test("서버 상태: 완료 · 취소 · 삭제 표시 · 예정 · 없음", () => {
  assert.equal(serverStateOf({ status: "completed" }), SERVER_STATE.COMPLETED);
  assert.equal(serverStateOf({ status: "cancelled" }), SERVER_STATE.REMOVED);
  // 10월 미확정 정리(2026-11-07)가 남긴 모양: 취소 + 삭제 표시.
  assert.equal(serverStateOf({ status: "cancelled", deletedAt: "2026-11-07T00:00:00Z" }), SERVER_STATE.REMOVED);
  assert.equal(serverStateOf({ status: "scheduled", deletedAt: "2026-11-07T00:00:00Z" }), SERVER_STATE.REMOVED);
  assert.equal(serverStateOf({ status: "scheduled" }), SERVER_STATE.SCHEDULED);
  assert.equal(serverStateOf(null), SERVER_STATE.UNKNOWN, "없는 문서는 끝난 것이 아니라 모르는 것");
});

test("서버에서 끝난 수업은 큐에서 빠지고 '완료인데 남은 것' 으로 센다", () => {
  const done = lesson("L-done", "2026-11-05");
  const removed = lesson("L-removed", "2026-11-05");
  const open = lesson("L-open", "2026-11-05");
  const unknown = lesson("L-unknown", "2026-11-05");
  const queue = organize(
    [task("attendance", "m1", done), task("settlement", "m2", removed), task("attendance", "m3", open), task("note", "m4", unknown)],
    { "L-done": SERVER_STATE.COMPLETED, "L-removed": SERVER_STATE.REMOVED, "L-open": SERVER_STATE.SCHEDULED },
  );
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.OVERDUE]).sort(), ["lesson|L-open", "lesson|L-unknown"]);
  assert.deepEqual(queue.counts, { doneElsewhere: 2, pending: 1, unknown: 1, archived: 0 });
});

test("이 기기가 확정한 수업의 기록은 서버가 완료여도 남는다 -- 진짜 할 일", () => {
  const mine = lesson("L-mine", "2026-11-06", { orgSettledAt: "2026-11-06T02:00:00Z" });
  const queue = organize([task("note", "m1", mine)], { "L-mine": SERVER_STATE.COMPLETED });
  assert.equal(queue.tabs[QUEUE_TAB.OVERDUE].length, 1);
});

test("다른 기기에서 확정돼 잠긴 수업은 완료로 본다 (서버를 묻지 않았어도)", () => {
  const locked = lesson("L-locked", "2026-11-06", { settledElsewhereAt: "2026-11-06T03:00:00Z" });
  const queue = organize([task("attendance", "m1", locked), task("attendance", "m2", locked)]);
  assert.equal(queue.total, 0);
  assert.equal(queue.counts.doneElsewhere, 1, "한 수업은 한 번 센다");
});

test("11월 1일 이전은 '지난 항목' 에만 -- 요약에 세지 않는다", () => {
  assert.equal(QUEUE_CUTOFF, "2026-11-01");
  const october = lesson("L-oct", "2026-10-30");
  const first = lesson("L-nov1", "2026-11-01");
  const queue = organize([task("attendance", "m1", october), task("attendance", "m2", first)]);
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.ARCHIVED]), ["lesson|L-oct"]);
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.OVERDUE]), ["lesson|L-nov1"]);
  assert.equal(queue.archivedCount, 1);
  assert.equal(queue.todayCount, 0);
  assert.equal(queue.overdueCount, 1);
  assert.equal(queue.counts.archived, 1);
});

test("개인 강사에게는 컷오프가 없다 (부르는 쪽이 0000-00-00 을 준다)", () => {
  const queue = organize([task("attendance", "m1", lesson("L-oct", "2026-10-30"))], {}, { cutoff: "0000-00-00" });
  assert.equal(queue.tabs[QUEUE_TAB.OVERDUE].length, 1);
});

test("오늘 · 지난 미처리 · 30일 넘으면 관리자 확인", () => {
  const tasks = [
    task("attendance", "m1", lesson("L-today", "2026-12-15")),
    task("attendance", "m2", lesson("L-30", "2026-11-15")), // 정확히 30일 -- 아직 지난 미처리
    task("attendance", "m3", lesson("L-31", "2026-11-14")), // 31일 -- 관리자 확인
  ];
  const queue = organizeLessonQueue({ tasks, today: "2026-12-15", serverStates: {} });
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.TODAY]), ["lesson|L-today"]);
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.OVERDUE]), ["lesson|L-30"]);
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.ADMIN]), ["lesson|L-31"]);
  assert.equal(queue.todayCount, 1);
  assert.equal(queue.adminCount, 1);
});

test("듀엣 한 수업의 줄은 한 묶음 -- 회원 둘 + 확정 하나도 1건", () => {
  const duet = lesson("L-duet", TODAY);
  const queue = organize([task("note", "m1", duet), task("attendance", "m2", duet), task("settlement", "m1", duet)]);
  assert.equal(queue.todayCount, 1);
  const [group] = queue.tabs[QUEUE_TAB.TODAY];
  assert.deepEqual(group.memberIds, ["m1", "m2"]);
  assert.equal(group.tasks[0].kind, "settlement", "확정이 먼저");
  assert.equal(group.tasks.length, 3);
});

test("수업 없는 기록 확인 · 초안은 각자 한 묶음으로 지난 미처리에 남는다", () => {
  const queue = organize([{ key: "m1|session-x", kind: "confirmation", memberId: "m1", lessonId: "", s: null, session: { date: "" } }]);
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.OVERDUE]), ["m1|session-x"]);
  assert.equal(queue.counts.unknown, 1);
});

test("보류는 요약에서 빠지고 목록에는 남는다 · 관리자 확인으로 보낸 것은 그 탭으로", () => {
  const a = lesson("L-a", TODAY);
  const b = lesson("L-b", "2026-11-05");
  const queue = organize([task("attendance", "m1", a), task("attendance", "m2", b)], {}, {
    snoozed: { "lesson|L-a": true }, escalated: { "lesson|L-b": true },
  });
  assert.equal(queue.todayCount, 0);
  assert.equal(queue.tabs[QUEUE_TAB.TODAY][0].snoozed, true);
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.ADMIN]), ["lesson|L-b"]);
});

test("서버에 물을 id: 지난 항목은 묻지 않고, TTL 안의 답은 다시 묻지 않고, 상한까지만", () => {
  const now = 1_000_000_000;
  const tasks = [
    task("attendance", "m1", lesson("L-oct", "2026-10-30")),
    task("attendance", "m2", lesson("L-fresh", "2026-11-05")),
    task("attendance", "m3", lesson("L-stale", "2026-11-05")),
    task("attendance", "m4", lesson("L-new", "2026-11-05")),
    task("note", "m5", lesson("L-new", "2026-11-05")),
  ];
  const cache = { "L-fresh": { state: "scheduled", at: now - 1000 }, "L-stale": { state: "scheduled", at: now - SERVER_STATE_TTL_MS - 1 } };
  assert.deepEqual(lessonIdsToCheck({ tasks, cache, now }), ["L-stale", "L-new"]);
  const many = Array.from({ length: SERVER_STATE_READ_LIMIT + 10 }, (_, i) => task("attendance", `m${i}`, lesson(`L-${i}`, "2026-11-05")));
  assert.equal(lessonIdsToCheck({ tasks: many, cache: {}, now }).length, SERVER_STATE_READ_LIMIT);
});

test("캐시: 읽은 것만 바꾸고, 못 읽은 id 는 예전 답을 둔다", () => {
  const next = mergeServerCache({ old: { state: "scheduled", at: 1 } }, { a: { status: "completed" }, b: null }, 5);
  assert.deepEqual(next, { old: { state: "scheduled", at: 1 }, a: { state: "completed", at: 5 }, b: { state: "unknown", at: 5 } });
  assert.deepEqual(serverStatesFromCache(next), { old: "scheduled", a: "completed", b: "unknown" });
});

test("기기 저장: 캐시 · 표시 · 진단 개수 -- 저장소가 없거나 깨져도 던지지 않는다", () => {
  const box = new Map();
  const storage = { getItem: (k) => (box.has(k) ? box.get(k) : null), setItem: (k, v) => box.set(k, v) };
  writeServerCache(storage, { a: { state: "completed", at: 2 } });
  assert.deepEqual(readServerCache(storage), { a: { state: "completed", at: 2 } });
  writeQueueMarks(storage, { snoozed: { x: true }, escalated: {} });
  assert.deepEqual(readQueueMarks(storage), { snoozed: { x: true }, escalated: {} });
  writeQueueCounts(storage, { doneElsewhere: 1, pending: 2, unknown: 3, archived: 4 }, 99, 7);
  assert.deepEqual(readQueueCounts(storage), { doneElsewhere: 1, pending: 2, unknown: 3, archived: 4, reads: 7, at: 99 });
  const broken = { getItem: () => "{not json", setItem: () => { throw new Error("full"); } };
  assert.deepEqual(readServerCache(broken), {});
  assert.doesNotThrow(() => writeServerCache(broken, {}));
  assert.equal(readQueueCounts(null), null);
});
