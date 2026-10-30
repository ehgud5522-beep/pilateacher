import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPublishedRevisions, mergeServerLessons, reapplyChanges, syncWindow,
} from "../../src/features/schedule/schedule-sync.js";
import { PUBLISH_OUTCOME, decideScheduleWrite } from "../../src/data/repositories/lesson-schedule-repository.js";
import { canEditLessonInfo, lessonDeletePolicy, settledLockNotice } from "../../src/features/schedule/schedule-edit.js";
import { canSettleLesson, needsSettlement } from "../../src/features/schedule/lesson-settlement.js";
import { isNewerWebBuild, staleTabMessage } from "../../src/features/ui/web-version.js";
import { recordSyncReads, syncReadsByDay } from "../../src/features/schedule/sync-read-counter.js";

/* 서버 기준 동기화 1 · 2단계 (2026-10-31). 예정 일정은 서버가 기준이고, 확정된 수업은
   어느 쪽도 덮지 않으며, 기기의 것은 지우지 않는다. */

const ROSTER = [
  { id: "m-1", name: "하나", orgClientId: "client-1", orgLocationId: "bansong" },
  { id: "client-2", name: "두리", orgClientId: "client-2", orgLocationId: "bansong" },
];
const doc = (extra = {}) => ({
  id: "L1", lessonId: "L1", status: "scheduled", date: "2026-11-03",
  startsAt: new Date(2026, 10, 3, 19, 0), endsAt: new Date(2026, 10, 3, 19, 50),
  clientIds: ["client-1"], lessonType: "1:1", scheduleType: "개인레슨", room: "1번룸", equipmentIds: [],
  revision: 1, instructorId: "me", ...extra,
});
const local = (extra = {}) => ({
  id: "L1", date: "2026-11-03", start: "19:00", end: "19:50", type: "개인레슨", room: "1번룸",
  memo: "기기 메모", attendees: [{ memberId: "m-1", status: "done", deductFrom: null, noshowFee: null }],
  syncRevision: 1, ...extra,
});
const merge = (schedule, docs, extra = {}) => mergeServerLessons({ schedule, docs, rosterMembers: ROSTER, staffName: "정강사", ...extra });

test("받는 범위는 7일 전 ~ 60일 뒤", () => {
  const { from, to } = syncWindow(new Date(2026, 10, 10, 15, 0));
  assert.deepEqual(from, new Date(2026, 10, 3));
  assert.deepEqual(to, new Date(2027, 0, 10));
});

test("서버에만 있는 예정 일정은 기기에 더한다 — 명부의 회원으로, 메모 없이", () => {
  const result = merge([], [doc()]);
  assert.equal(result.summary.added, 1);
  assert.deepEqual(result.schedule[0], {
    id: "L1", date: "2026-11-03", start: "19:00", end: "19:50", type: "개인레슨", room: "1번룸",
    equipmentIds: [], instructor: "정강사", memo: "",
    attendees: [{ memberId: "m-1", status: "booked", deductFrom: null, noshowFee: null }],
    syncRevision: 1,
  });
});

test("서버 번호가 더 크면 핵심 칸을 서버 것으로 — 메모 · 출석은 기기 것을 지킨다", () => {
  const result = merge([local()], [doc({ revision: 2, startsAt: new Date(2026, 10, 3, 20, 0), endsAt: new Date(2026, 10, 3, 20, 50), room: "2번룸" })]);
  assert.equal(result.summary.updated, 1);
  const entry = result.schedule[0];
  assert.equal(entry.start, "20:00");
  assert.equal(entry.room, "2번룸");
  assert.equal(entry.memo, "기기 메모");
  assert.equal(entry.attendees[0].status, "done", "출석 상태는 기기 것");
  assert.equal(entry.syncRevision, 2);
});

test("같거나 낮은 번호는 건드리지 않는다 · 아직 못 보낸 기기 수정도 건드리지 않는다", () => {
  const same = merge([local()], [doc({ room: "다른방" })]);
  assert.equal(same.changed, false);
  assert.equal(same.schedule[0].room, "1번룸");
  const pending = merge([local()], [doc({ revision: 5, room: "다른방" })], { pendingIds: ["L1"] });
  assert.equal(pending.changed, false);
});

test("서버에서 지운 일정은 지운다 — 출석으로 뺀 회차가 있으면 지우지 않는다", () => {
  const deleted = doc({ status: "cancelled", revision: 2, deletedAt: new Date() });
  const removed = merge([local()], [deleted]);
  assert.deepEqual(removed.removedIds, ["L1"]);
  assert.equal(removed.schedule.length, 0);
  const kept = merge([local({ attendees: [{ memberId: "m-1", status: "done", deductFrom: "정규" }] })], [deleted]);
  assert.equal(kept.schedule.length, 1);
  assert.equal(kept.summary.keptWithDeductions, 1);
});

test("출석 전원 취소는 일정을 남기고 출석을 취소로", () => {
  const result = merge([local({ attendees: [{ memberId: "m-1", status: "booked" }] })], [doc({ status: "cancelled", revision: 2, deletedAt: null })]);
  assert.equal(result.schedule.length, 1);
  assert.equal(result.schedule[0].attendees[0].status, "cancel");
});

test("다른 기기에서 확정됐으면 잠근다 — 고치기 · 지우기 · 또 확정하기가 막힌다", () => {
  const result = merge([local({ attendees: [{ memberId: "m-1", status: "done" }] })], [doc({ status: "completed", updatedAt: new Date("2026-11-03T11:00:00Z") })]);
  const entry = result.schedule[0];
  assert.equal(result.summary.lockedElsewhere, 1);
  assert.equal(entry.settledElsewhereAt, "2026-11-03T11:00:00.000Z");
  assert.equal(canEditLessonInfo(entry), false);
  assert.equal(lessonDeletePolicy(entry).reason, "settled_elsewhere");
  assert.equal(canSettleLesson(entry), false, "또 확정하면 두 번 나간다");
  assert.equal(needsSettlement(entry, { now: new Date(2026, 10, 4) }), false, "처리 큐에도 서지 않는다");
  assert.match(settledLockNotice({ elsewhere: true }), /다른 기기에서 확정된 수업/);
  // 다른 기기에서 확정을 되돌리면 풀린다.
  const reopened = merge([entry], [doc({ status: "scheduled", revision: 3 })]);
  assert.equal(reopened.summary.unlocked, 1);
  assert.equal(reopened.schedule[0].settledElsewhereAt, undefined);
});

test("이 기기에서 확정한 수업은 잠그지 않는다 — 확정 기록이 있다", () => {
  const result = merge([local({ orgSettledAt: "2026-11-03T11:00:00Z" })], [doc({ status: "completed" })]);
  assert.equal(result.changed, false);
});

test("같은 수업이 id 만 다르게 두 번 — 중복 의심으로 알리고 지우지 않는다", () => {
  const mine = local({ id: "L-mine", syncRevision: undefined, attendees: [{ memberId: "m-1", status: "booked" }] });
  const result = merge([mine], [doc({ id: "L-pc", lessonId: "L-pc" })]);
  assert.deepEqual(result.duplicates, [{ serverId: "L-pc", localId: "L-mine" }]);
  assert.equal(result.schedule.length, 2, "둘 다 남는다");
});

test("명부에 없는 회원은 빠지고 알린다", () => {
  const result = merge([], [doc({ clientIds: ["client-1", "client-unknown"] })]);
  assert.deepEqual(result.unmatchedClientIds, ["client-unknown"]);
  assert.equal(result.schedule[0].attendees.length, 1);
});

test("디오사 관리 등급이 따라온다 — 없으면 받는 기기가 PT 로 확정한다", () => {
  const result = merge([], [doc({ lessonType: "diosa", careGrades: { "client-1": "a" } })]);
  assert.equal(result.schedule[0].attendees[0].careGrade, "a");
});

test("쓴 결과의 번호를 기기 일정에 적는다 — 바뀐 것이 없으면 같은 배열", () => {
  const schedule = [local({ syncRevision: 1 }), local({ id: "L2", syncRevision: 3 })];
  const next = applyPublishedRevisions(schedule, [
    { lessonId: "L1", outcome: "written", revision: 2 },
    { lessonId: "L2", outcome: "conflict", revision: 9 },
  ]);
  assert.equal(next[0].syncRevision, 2);
  assert.equal(next[1].syncRevision, 3, "충돌은 번호를 바꾸지 않는다 -- 실시간 반영이 서버 것을 그린다");
  assert.equal(applyPublishedRevisions(next, [{ lessonId: "L1", outcome: "unchanged", revision: 2 }]), next);
});

test("수정 번호: 기기가 본 번호와 서버가 다르면 충돌 — 서버의 마지막 쓰기가 나면 아니다", () => {
  const document = { data: { status: "scheduled", startsAt: new Date(1), clientIds: ["c"] }, baseRevision: 1 };
  assert.equal(decideScheduleWrite({ status: "scheduled", revision: 2, updatedDevice: "pc-a" }, document, { deviceId: "pc-b" }).outcome, PUBLISH_OUTCOME.CONFLICT);
  assert.equal(decideScheduleWrite({ status: "scheduled", revision: 2, updatedDevice: "pc-b" }, document, { deviceId: "pc-b" }).outcome, PUBLISH_OUTCOME.WRITTEN, "그사이 다른 기기가 끼지 않았다");
  assert.equal(decideScheduleWrite({ status: "scheduled", revision: 1 }, document, { deviceId: "pc-b" }).write.revision, 2);
});

test("[내 수정 다시 적용] 은 내가 바꾼 칸만 서버 최신 위에 얹는다", () => {
  const before = local();
  const mine = local({ start: "21:00", end: "21:50" });
  const server = local({ room: "3번룸", syncRevision: 2 });
  const result = reapplyChanges(server, before, mine);
  assert.equal(result.start, "21:00", "내 수정");
  assert.equal(result.room, "3번룸", "다른 기기의 수정은 지킨다");
});

test("웹 새 버전: 번호가 다를 때만, 못 읽었으면 묻지 않는다", () => {
  assert.equal(isNewerWebBuild("abc", "def"), true);
  assert.equal(isNewerWebBuild("abc", "abc"), false);
  assert.equal(isNewerWebBuild("abc", ""), false, "네트워크가 흔들려도 새로고침시키지 않는다");
  assert.equal(isNewerWebBuild("", "def"), false, "개발 서버 · 네이티브");
  assert.match(staleTabMessage({ errorCode: "permission-denied", newerBuildAvailable: true }), /옛 버전.*새로고침.*코드 permission-denied/);
  assert.equal(staleTabMessage({ errorCode: "permission-denied", newerBuildAvailable: false }), "", "새 버전이 확인되지 않으면 단정하지 않는다");
});

test("받은 문서 수를 계정별로 날마다 센다", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  recordSyncReads(storage, "uid-a", 40, new Date(2026, 10, 3, 9));
  recordSyncReads(storage, "uid-a", 2, new Date(2026, 10, 3, 15));
  recordSyncReads(storage, "uid-a", 5, new Date(2026, 10, 4, 9));
  recordSyncReads(storage, "uid-b", 7, new Date(2026, 10, 4, 9));
  assert.deepEqual(syncReadsByDay(storage, "uid-a"), [
    { day: "2026-11-04", reads: 5, snapshots: 1 },
    { day: "2026-11-03", reads: 42, snapshots: 2 },
  ]);
  assert.deepEqual(syncReadsByDay(storage, "uid-b"), [{ day: "2026-11-04", reads: 7, snapshots: 1 }]);
});

test("받기 스위치 — 못 읽으면 꺼짐, 고른 계정만, 전체", async () => {
  const { scheduleSyncEnabledFor } = await import("../../src/features/schedule/sync-switch.js");
  assert.equal(scheduleSyncEnabledFor(null, "uid-owner"), false, "모르면 켜지 않는다");
  assert.equal(scheduleSyncEnabledFor({ mode: "on" }, "uid-owner"), false, "모르는 모드는 꺼짐");
  assert.equal(scheduleSyncEnabledFor({ mode: "listed", userIds: ["uid-owner"] }, "uid-owner"), true);
  assert.equal(scheduleSyncEnabledFor({ mode: "listed", userIds: ["uid-owner"] }, "uid-teacher"), false);
  assert.equal(scheduleSyncEnabledFor({ mode: "all" }, "uid-teacher"), true);
  assert.equal(scheduleSyncEnabledFor({ mode: "off", userIds: ["uid-owner"] }, "uid-owner"), false);
});
