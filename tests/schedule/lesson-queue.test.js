/**
 * "확인할 수업" 큐 정리 (2026-11-07 대표 결정): 서버 대조 · 11월 1일 컷오프 · 확정 마감(7일)이
 * 지나면 지난 항목 · 마감 표시 · 듀엣 한 묶음 · 다른 기기 확정은 완료 · 진단 개수.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEADLINE_WARN_DAYS, QUEUE_CUTOFF, QUEUE_TAB, QUEUE_TABS, SERVER_STATE, SERVER_STATE_READ_LIMIT, SERVER_STATE_TTL_MS,
  deadlineBadgeOf, lessonIdsToCheck, mergeServerCache, organizeLessonQueue, queueDeadlineOf, readQueueCounts, readQueueMarks,
  readServerCache, serverStateOf, serverStatesFromCache, writeQueueCounts, writeQueueMarks, writeServerCache,
} from "../../src/features/schedule/lesson-queue.js";
import { DEDUCT_BACKDATE_LIMIT_DAYS, settleDeadline } from "../../src/data/repositories/pass-repository.js";

const TODAY = "2026-11-07";
const NOW = new Date(`${TODAY}T12:00:00`).getTime();
const lesson = (id, date, extra = {}) => ({ id, date, start: "10:00", attendees: [], ...extra });
const task = (kind, memberId, l, extra = {}) => ({ key: `${kind}|${memberId}|${l?.id || "none"}`, kind, memberId, lessonId: l?.id || "", s: l, ...extra });
const organize = (tasks, serverStates = {}, extra = {}) => organizeLessonQueue({ tasks, today: TODAY, now: NOW, serverStates, ...extra });
const keys = (list) => list.map((group) => group.key);

test("탭은 셋 -- 오늘 · 지난 미처리 · 지난 항목. 관리자 확인 탭은 없다", () => {
  assert.deepEqual(QUEUE_TABS, ["today", "overdue", "archived"]);
  assert.equal(QUEUE_TAB.ADMIN, undefined);
  const queue = organize([task("attendance", "m1", lesson("L", "2026-11-05"))]);
  assert.deepEqual(Object.keys(queue.tabs).sort(), ["archived", "overdue", "today"]);
  assert.equal(queue.adminCount, undefined);
});

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
  assert.deepEqual(queue.counts, { doneElsewhere: 2, pending: 1, unknown: 1, archived: 0, expired: 0 });
});

test("이 기기가 확정한 수업의 기록은 서버가 완료여도 남는다 -- 진짜 할 일", () => {
  const mine = lesson("L-mine", "2026-11-06", { orgSettledAt: "2026-11-06T02:00:00Z" });
  const queue = organize([task("note", "m1", mine)], { "L-mine": SERVER_STATE.COMPLETED });
  assert.equal(queue.tabs[QUEUE_TAB.OVERDUE].length, 1);
});

test("다른 기기에서 확정돼 잠긴 수업은 완료로 본다 -- 어느 탭에도 없다 (서버를 묻지 않았어도)", () => {
  const locked = lesson("L-locked", "2026-11-06", { settledElsewhereAt: "2026-11-06T03:00:00Z" });
  const queue = organize([task("attendance", "m1", locked), task("attendance", "m2", locked)]);
  assert.equal(queue.total, 0);
  for (const tab of QUEUE_TABS) assert.equal(queue.tabs[tab].length, 0, tab);
  assert.equal(queue.counts.doneElsewhere, 1, "한 수업은 한 번 센다");
  // 마감이 지났어도 지난 항목이 아니라 완료다.
  const oldLocked = lesson("L-old-locked", "2026-11-02", { settledElsewhereAt: "2026-11-02T03:00:00Z" });
  const later = organize([task("attendance", "m1", oldLocked)], {}, { now: new Date("2026-11-20T12:00:00").getTime(), today: "2026-11-20" });
  assert.equal(later.total, 0);
  assert.equal(later.counts.doneElsewhere, 1);
  assert.equal(later.counts.archived, 0);
});

test("11월 1일 이전은 '지난 항목' 에만 -- 요약에 세지 않는다", () => {
  assert.equal(QUEUE_CUTOFF, "2026-11-01");
  const october = lesson("L-oct", "2026-10-31");
  const first = lesson("L-nov1", "2026-11-01", { start: "23:00" });
  const queue = organize([task("attendance", "m1", october), task("attendance", "m2", first)]);
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.ARCHIVED]), ["lesson|L-oct"]);
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.OVERDUE]), ["lesson|L-nov1"]);
  assert.equal(queue.archivedCount, 1);
  assert.equal(queue.todayCount, 0);
  assert.equal(queue.overdueCount, 1);
  assert.equal(queue.counts.archived, 1);
  assert.equal(queue.counts.expired, 0, "컷오프로 간 것은 '마감 지남' 이 아니다");
});

test("개인 강사에게는 컷오프가 없다 (부르는 쪽이 0000-00-00 을 준다) -- 마감은 같다", () => {
  const recent = organize([task("attendance", "m1", lesson("L-recent", "2026-11-03"))], {}, { cutoff: "0000-00-00" });
  assert.equal(recent.tabs[QUEUE_TAB.OVERDUE].length, 1);
  const old = organize([task("attendance", "m1", lesson("L-oct", "2026-10-30"))], {}, { cutoff: "0000-00-00" });
  assert.equal(old.tabs[QUEUE_TAB.ARCHIVED].length, 1, "확정할 수 없는 수업은 개인 모드에서도 지난 항목");
});

/* ── 확정 마감: 확정과 같은 선 ──────────────────────────────────────────── */

test("마감은 확정 검사와 같은 helper -- 수업 시작 + 7일", () => {
  assert.equal(DEDUCT_BACKDATE_LIMIT_DAYS, 7);
  const deadline = queueDeadlineOf(lesson("L", "2026-11-03", { start: "19:00" }));
  assert.equal(deadline.getTime(), settleDeadline(new Date("2026-11-03T19:00:00")).getTime());
  assert.equal(deadline.getTime(), new Date("2026-11-10T19:00:00").getTime());
  assert.equal(queueDeadlineOf(null), null, "수업 없는 항목은 마감이 없다");
});

test("7일째와 8일째 경계 -- 마감 순간부터 지난 항목, 그 직전까지는 지난 미처리", () => {
  const l = lesson("L-edge", "2026-11-03", { start: "19:00" });
  const tasks = [task("attendance", "m1", l)];
  const at = (iso, today) => organizeLessonQueue({ tasks, today, now: new Date(iso).getTime(), serverStates: {} });
  // 7일째(11/10) 마감 1분 전: 아직 확정할 수 있다 -- 지난 미처리, "오늘까지".
  const before = at("2026-11-10T18:59:00", "2026-11-10");
  assert.deepEqual(keys(before.tabs[QUEUE_TAB.OVERDUE]), ["lesson|L-edge"]);
  assert.equal(before.tabs[QUEUE_TAB.OVERDUE][0].badge.label, "오늘까지 확정해야 해요");
  // 마감 그 순간: 규칙이 거절한다(occurredAt > now - 7d 가 거짓) -- 지난 항목.
  const exact = at("2026-11-10T19:00:00", "2026-11-10");
  assert.deepEqual(keys(exact.tabs[QUEUE_TAB.ARCHIVED]), ["lesson|L-edge"]);
  assert.equal(exact.tabs[QUEUE_TAB.ARCHIVED][0].expired, true);
  assert.equal(exact.counts.expired, 1);
  assert.equal(exact.overdueCount, 0, "첫 화면 숫자에서 빠진다");
  // 8일째(11/11): 지난 항목.
  const eighth = at("2026-11-11T09:00:00", "2026-11-11");
  assert.equal(eighth.tabs[QUEUE_TAB.ARCHIVED].length, 1);
  assert.equal(eighth.tabs[QUEUE_TAB.ARCHIVED][0].badge, null, "지난 항목에는 마감 표시가 없다");
});

test("출석 · 확정 · 기록 알림 모두 같은 마감으로 넘어간다", () => {
  const l = lesson("L-all", "2026-10-31", { start: "10:00" });
  const tasks = [task("attendance", "m1", l), task("settlement", "m1", l), task("note", "m2", l)];
  const queue = organizeLessonQueue({ tasks, today: "2026-11-08", now: new Date("2026-11-08T10:00:00").getTime(), serverStates: {}, cutoff: "0000-00-00" });
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.ARCHIVED]), ["lesson|L-all"]);
  assert.equal(queue.tabs[QUEUE_TAB.ARCHIVED][0].tasks.length, 3);
});

test("마감 표시: 2일 · 1일 · 0일 남았을 때만, 문구는 모레 · 내일 · 오늘", () => {
  assert.equal(DEADLINE_WARN_DAYS, 2);
  const deadline = new Date("2026-11-10T19:00:00");
  const badge = (iso) => deadlineBadgeOf(deadline, new Date(iso).getTime());
  assert.equal(badge("2026-11-07T23:00:00"), null, "3일 전에는 없다");
  assert.deepEqual(badge("2026-11-08T09:00:00"), { daysLeft: 2, label: "모레까지 확정해야 해요" });
  assert.deepEqual(badge("2026-11-09T09:00:00"), { daysLeft: 1, label: "내일까지 확정해야 해요" });
  assert.deepEqual(badge("2026-11-10T18:59:00"), { daysLeft: 0, label: "오늘까지 확정해야 해요" });
  assert.equal(badge("2026-11-10T19:00:00"), null, "마감이 지나면 없다");
  assert.equal(deadlineBadgeOf(null, NOW), null);
});

test("마감 표시는 확정하지 않은 수업에만, 날짜 없는 항목에는 없다", () => {
  const near = lesson("L-near", "2026-11-01", { start: "13:00" }); // 마감 11/8 13:00 -- 11/7 기준 내일
  const settledHere = lesson("L-mine", "2026-11-01", { start: "13:00", orgSettledAt: "2026-11-01T05:00:00Z" });
  const queue = organize([
    task("attendance", "m1", near),
    task("note", "m2", settledHere),
    { key: "m3|draft", kind: "local_draft", memberId: "m3", lessonId: "", s: null, session: { date: "" } },
  ]);
  const byKey = Object.fromEntries(queue.tabs[QUEUE_TAB.OVERDUE].map((group) => [group.key, group]));
  assert.equal(byKey["lesson|L-near"].badge.label, "내일까지 확정해야 해요");
  assert.equal(byKey["lesson|L-mine"].badge, null, "이 기기에서 확정한 수업의 기록 알림에는 달지 않는다");
  assert.equal(byKey["m3|draft"].badge, null);
});

test("듀엣 한 수업의 줄은 한 묶음 -- 회원 둘 + 확정 하나도 1건, 마감도 함께 넘어간다", () => {
  const duet = lesson("L-duet", TODAY);
  const queue = organize([task("note", "m1", duet), task("attendance", "m2", duet), task("settlement", "m1", duet)]);
  assert.equal(queue.todayCount, 1);
  const [group] = queue.tabs[QUEUE_TAB.TODAY];
  assert.deepEqual(group.memberIds, ["m1", "m2"]);
  assert.equal(group.tasks[0].kind, "settlement", "확정이 먼저");
  assert.equal(group.tasks.length, 3);

  const oldDuet = lesson("L-old-duet", "2026-11-02", { start: "09:00" });
  const later = organizeLessonQueue({
    tasks: [task("attendance", "m1", oldDuet), task("attendance", "m2", oldDuet), task("settlement", "m1", oldDuet)],
    today: "2026-11-09", now: new Date("2026-11-09T10:00:00").getTime(), serverStates: {},
  });
  assert.deepEqual(keys(later.tabs[QUEUE_TAB.ARCHIVED]), ["lesson|L-old-duet"], "한 카드로 함께 지난 항목");
  assert.equal(later.tabs[QUEUE_TAB.ARCHIVED][0].tasks.length, 3);
  assert.equal(later.tabs[QUEUE_TAB.OVERDUE].length, 0);
});

test("수업 없는 기록 확인 · 초안은 각자 한 묶음으로 지난 미처리에 남는다 (마감 없음)", () => {
  const queue = organize([{ key: "m1|session-x", kind: "confirmation", memberId: "m1", lessonId: "", s: null, session: { date: "" } }]);
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.OVERDUE]), ["m1|session-x"]);
  assert.equal(queue.counts.unknown, 1);
});

test("보류는 요약에서 빠지고 목록에는 남는다", () => {
  const a = lesson("L-a", TODAY);
  const b = lesson("L-b", "2026-11-05");
  const queue = organize([task("attendance", "m1", a), task("attendance", "m2", b)], {}, {
    snoozed: { "lesson|L-a": true, "lesson|L-b": true },
  });
  assert.equal(queue.todayCount, 0);
  assert.equal(queue.overdueCount, 0);
  assert.equal(queue.tabs[QUEUE_TAB.TODAY][0].snoozed, true);
  assert.deepEqual(keys(queue.tabs[QUEUE_TAB.OVERDUE]), ["lesson|L-b"], "보류는 지난 미처리에 남는다");
});

test("첫 화면 숫자는 지난 항목을 세지 않는다", () => {
  const queue = organize([
    task("attendance", "m1", lesson("L-today", TODAY)),
    task("attendance", "m2", lesson("L-recent", "2026-11-05")),
    task("attendance", "m3", lesson("L-expired", "2026-11-01", { start: "09:00" })), // 마감 11/8 09:00 -- 아직
    task("attendance", "m4", lesson("L-gone", "2026-10-31")),
  ]);
  assert.equal(queue.todayCount, 1);
  assert.equal(queue.overdueCount, 2);
  assert.equal(queue.archivedCount, 1);
});

test("서버에 물을 id: 지난 항목(컷오프 · 마감 지남)은 묻지 않고, TTL 안의 답은 다시 묻지 않고, 상한까지만", () => {
  const now = new Date("2026-11-07T12:00:00").getTime();
  const tasks = [
    task("attendance", "m1", lesson("L-oct", "2026-10-30")),
    task("attendance", "m0", lesson("L-expired", "2026-11-01", { start: "08:00" })), // 마감 11/8 08:00 -- 아직 묻는다
    task("attendance", "m2", lesson("L-fresh", "2026-11-05")),
    task("attendance", "m3", lesson("L-stale", "2026-11-05")),
    task("attendance", "m4", lesson("L-new", "2026-11-05")),
    task("note", "m5", lesson("L-new", "2026-11-05")),
  ];
  const cache = { "L-fresh": { state: "scheduled", at: now - 1000 }, "L-stale": { state: "scheduled", at: now - SERVER_STATE_TTL_MS - 1 } };
  assert.deepEqual(lessonIdsToCheck({ tasks, cache, now }), ["L-expired", "L-stale", "L-new"]);
  const later = new Date("2026-11-08T09:00:00").getTime();
  assert.deepEqual(lessonIdsToCheck({ tasks, cache: {}, now: later }), ["L-fresh", "L-stale", "L-new"], "마감이 지나면 묻지 않는다");
  const many = Array.from({ length: SERVER_STATE_READ_LIMIT + 10 }, (_, i) => task("attendance", `m${i}`, lesson(`L-${i}`, "2026-11-05")));
  assert.equal(lessonIdsToCheck({ tasks: many, cache: {}, now }).length, SERVER_STATE_READ_LIMIT);
});

test("캐시: 읽은 것만 바꾸고, 못 읽은 id 는 예전 답을 둔다", () => {
  const next = mergeServerCache({ old: { state: "scheduled", at: 1 } }, { a: { status: "completed" }, b: null }, 5);
  assert.deepEqual(next, { old: { state: "scheduled", at: 1 }, a: { state: "completed", at: 5 }, b: { state: "unknown", at: 5 } });
  assert.deepEqual(serverStatesFromCache(next), { old: "scheduled", a: "completed", b: "unknown" });
});

test("기기 저장: 캐시 · 보류 · 진단 개수 -- 저장소가 없거나 깨져도 던지지 않는다", () => {
  const box = new Map();
  const storage = { getItem: (k) => (box.has(k) ? box.get(k) : null), setItem: (k, v) => box.set(k, v) };
  writeServerCache(storage, { a: { state: "completed", at: 2 } });
  assert.deepEqual(readServerCache(storage), { a: { state: "completed", at: 2 } });
  // 예전 기기에 남은 관리자 확인 표시는 읽지 않는다.
  writeQueueMarks(storage, { snoozed: { x: true }, escalated: { y: true } });
  assert.deepEqual(readQueueMarks(storage), { snoozed: { x: true } });
  writeQueueCounts(storage, { doneElsewhere: 1, pending: 2, unknown: 3, archived: 4, expired: 1 }, 99, 7);
  assert.deepEqual(readQueueCounts(storage), { doneElsewhere: 1, pending: 2, unknown: 3, archived: 4, expired: 1, reads: 7, at: 99 });
  const broken = { getItem: () => "{not json", setItem: () => { throw new Error("full"); } };
  assert.deepEqual(readServerCache(broken), {});
  assert.doesNotThrow(() => writeServerCache(broken, {}));
  assert.equal(readQueueCounts(null), null);
});
