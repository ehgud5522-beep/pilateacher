import assert from "node:assert/strict";
import test from "node:test";
import {
  SCHEDULE_LESSON_TYPE, SCHEDULE_STATUS, scheduleChanges, scheduleTime, scheduledLessonDocument,
} from "../../src/features/schedule/schedule-publish.js";
import {
  PUBLISH_OUTCOME, outcomeWithoutWrite, publishScheduledLessons, scheduleWriteFor,
} from "../../src/data/repositories/lesson-schedule-repository.js";

/* 강사 일정 → 센터 서버 (2026-10-30, 회원 앱 개편 3단계).
   등록 · 수정 · 취소가 확정 단계 없이 곧바로 회원 데이터의 재료가 된다. */

const ORG = "center-a";
const MEMBERS = [
  { id: "m-local-1", name: "김하나", orgClientId: "client-a", orgLocationId: "bansong" },
  { id: "m-local-2", name: "박서연", orgClientId: "client-b", orgLocationId: "bansong" },
  { id: "m-device-only", name: "이두리", orgClientId: "" },
];
const base = { members: MEMBERS, organizationId: ORG, instructorId: "uid-instructor" };
const lesson = (extra = {}) => ({
  id: "L1", date: "2026-11-03", start: "19:00", end: "19:50", type: "개인레슨",
  instructor: "정예진", room: "1번룸", memo: "허리 통증 있음 — 강사 메모",
  attendees: [{ memberId: "m-local-1", status: "booked" }],
  ...extra,
});

test("일정 한 건은 날짜 · 시각 · 수업 유형 · 강사 · 지점 · 센터 회원 id · 종류 · 방 · 기구만 싣는다", () => {
  const document = scheduledLessonDocument({ ...base, entry: lesson() });
  assert.equal(document.lessonId, "L1");
  assert.deepEqual(Object.keys(document.data).sort(), [
    "careGrades", "clientId", "clientIds", "date", "endsAt", "equipmentIds", "instructorId", "lessonId", "lessonType",
    "locationId", "organizationId", "room", "scheduleType", "startsAt", "status",
  ]);
  /* 동기화 2단계: 다른 기기가 이 일정을 다시 그리는 데 쓴다. 센터 직원이 봐도 되는
     것만이고 회원 데이터에는 싣지 않는다 (member-view.js 허용 목록). */
  assert.equal(document.data.scheduleType, "개인레슨");
  assert.equal(document.data.room, "1번룸");
  assert.equal(document.baseRevision, 0, "처음 보내는 일정");
  assert.equal(document.data.status, SCHEDULE_STATUS.SCHEDULED);
  assert.deepEqual(document.data.clientIds, ["client-a"]);
  assert.equal(document.data.lessonType, SCHEDULE_LESSON_TYPE.SOLO);
  assert.equal(document.data.locationId, "bansong");
  assert.deepEqual(document.data.startsAt, new Date(2026, 10, 3, 19, 0));
  assert.deepEqual(document.data.endsAt, new Date(2026, 10, 3, 19, 50));
  // 메모 · 강사 이름 문자열 · 기기 회원 id 는 싣지 않는다.
  assert.doesNotMatch(JSON.stringify(document.data), /허리 통증|강사 메모|정예진|m-local-1/);
});

test("수업 유형 — 개인레슨 1:1, 듀엣 2:1, 관리 등급이 있으면 디오사, 그 밖은 other", () => {
  const typeOf = (entry) => scheduledLessonDocument({ ...base, entry }).data.lessonType;
  assert.equal(typeOf(lesson({ type: "듀엣", attendees: [{ memberId: "m-local-1" }, { memberId: "m-local-2" }] })), "2:1");
  assert.equal(typeOf(lesson({ attendees: [{ memberId: "m-local-1", careGrade: "a" }] })), "diosa");
  assert.equal(typeOf(lesson({ type: "그룹" })), "other");
});

test("보낼 것이 없으면 null — 개인 일정 · 센터 회원이 없는 수업 · 읽을 수 없는 시각", () => {
  assert.equal(scheduledLessonDocument({ ...base, entry: lesson({ personal: true }) }), null);
  assert.equal(scheduledLessonDocument({ ...base, entry: lesson({ attendees: [{ memberId: "m-device-only" }] }) }), null);
  assert.equal(scheduledLessonDocument({ ...base, entry: lesson({ start: "7pm" }) }), null);
  assert.equal(scheduledLessonDocument({ ...base, organizationId: "", entry: lesson() }), null);
  assert.equal(scheduleTime("2026-02-30", "10:00"), null, "없는 날짜");
});

test("한 사람만 취소한 듀엣은 남은 사람에게만 · 모두 취소하면 cancelled", () => {
  const duet = (statusB) => lesson({
    type: "듀엣",
    attendees: [{ memberId: "m-local-1", status: "booked" }, { memberId: "m-local-2", status: statusB }],
  });
  const partly = scheduledLessonDocument({ ...base, entry: duet("cancel") });
  assert.equal(partly.data.status, "scheduled");
  assert.deepEqual(partly.data.clientIds, ["client-a"]);

  const all = scheduledLessonDocument({ ...base, entry: lesson({
    attendees: [{ memberId: "m-local-1", status: "cancel" }],
  }) });
  assert.equal(all.data.status, "cancelled");
  // 취소된 수업에도 회원을 남긴다 -- 서버가 그 사람의 화면에서 지운다.
  assert.deepEqual(all.data.clientIds, ["client-a"]);
});

test("저장 전후를 견주어 바뀐 것만 보낸다 — 메모 · 출석 기록만 바뀐 것은 보내지 않는다", () => {
  const before = [lesson(), lesson({ id: "L2", date: "2026-11-04" })];
  const memoOnly = [lesson({ memo: "다른 메모" }), lesson({ id: "L2", date: "2026-11-04" })];
  assert.deepEqual(scheduleChanges({ ...base, before, after: memoOnly }), []);

  const moved = [lesson({ start: "20:00", end: "20:50" }), lesson({ id: "L2", date: "2026-11-04" })];
  const changed = scheduleChanges({ ...base, before, after: moved });
  assert.deepEqual(changed.map((item) => item.lessonId), ["L1"]);
  assert.deepEqual(changed[0].data.startsAt, new Date(2026, 10, 3, 20, 0));
});

test("새 일정은 보내고, 지운 일정은 cancelled 로 남긴다", () => {
  const before = [lesson()];
  const after = [lesson({ id: "L9", date: "2026-11-05" })];
  const changed = scheduleChanges({ ...base, before, after });
  const byId = Object.fromEntries(changed.map((item) => [item.lessonId, item.data.status]));
  assert.deepEqual(byId, { L9: "scheduled", L1: "cancelled" });
});

test("이미 확정(completed)된 수업은 일정 쪽에서 쓰지 않는다 — 완료가 되돌아가지 않게", () => {
  const document = scheduledLessonDocument({ ...base, entry: lesson() });
  assert.equal(scheduleWriteFor({ status: "completed" }, document), null);
  assert.deepEqual(scheduleWriteFor(null, document), { ...document.data, revision: 1 }, "처음 만드는 문서는 번호 1");
  assert.deepEqual(scheduleWriteFor({ status: "scheduled" }, document), { ...document.data, revision: 1 }, "번호 없던 옛 문서도 1");
});

test("서버와 같은 문서는 다시 쓰지 않는다 — 앱을 열 때마다 회원 데이터를 다시 만들지 않게", () => {
  const document = scheduledLessonDocument({ ...base, entry: lesson() });
  const stored = {
    ...document.data,
    startsAt: { toMillis: () => document.data.startsAt.getTime() },
    endsAt: { toMillis: () => document.data.endsAt.getTime() },
  };
  assert.equal(scheduleWriteFor(stored, document), null);
  assert.deepEqual(scheduleWriteFor({ ...stored, clientIds: ["client-b"] }, document), { ...document.data, revision: 1 });
});

test("쓰기 결과는 건마다 — 실패는 원본 코드와 함께", async () => {
  const writes = [];
  const store = {
    async transact(path, decide) {
      if (path.endsWith("/L-fail")) throw Object.assign(new Error("denied"), { code: "permission-denied" });
      const current = path.endsWith("/L-done") ? { status: "completed", revision: 4 } : null;
      const { write, outcome } = decide(current);
      if (write) writes.push({ path, write });
      return { outcome, revision: write ? write.revision : current?.revision || 0 };
    },
  };
  const documents = ["L-new", "L-done", "L-fail"].map((id) => ({ lessonId: id, data: { status: "scheduled" } }));
  const results = await publishScheduledLessons(ORG, documents, { store, createdBy: "uid-instructor" });
  assert.deepEqual(results, [
    { lessonId: "L-new", outcome: "written", errorCode: "", revision: 1 },
    { lessonId: "L-done", outcome: "settled", errorCode: "", revision: 4 },
    { lessonId: "L-fail", outcome: "failed", errorCode: "permission-denied", revision: 0 },
  ]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, `organizations/${ORG}/lessons/L-new`);
  // 처음 만드는 문서에만 만든 사람을 적는다.
  assert.equal(writes[0].write.createdBy, "uid-instructor");
});

test("취소된 서버 문서는 아무 기기나 되살리지 못한다 — PC 두 대 (2026-10-31)", () => {
  const document = scheduledLessonDocument({ ...base, entry: lesson() });
  const cancelledBy = (device) => ({ ...document.data, status: "cancelled", updatedDevice: device });
  assert.equal(scheduleWriteFor(cancelledBy("pc-a"), document, { deviceId: "pc-b" }), null, "다른 PC 의 취소 -- 처음 맞추기 · 고치기");
  assert.deepEqual(scheduleWriteFor(cancelledBy("pc-a"), document, { deviceId: "pc-a" }), { ...document.data, revision: 1 }, "내가 취소한 것은 내가 되돌린다");
  assert.deepEqual(scheduleWriteFor(cancelledBy("pc-a"), { ...document, allowRevive: true }, { deviceId: "pc-b" }), { ...document.data, revision: 1 }, "되돌리기를 누른 것");
  assert.equal(scheduleWriteFor({ ...document.data, status: "cancelled" }, document, { deviceId: "pc-b" }), null, "누가 취소했는지 모르는 옛 문서도 되살리지 않는다");
  assert.equal(outcomeWithoutWrite({ status: "cancelled" }), PUBLISH_OUTCOME.CANCELLED_ELSEWHERE);
  assert.equal(outcomeWithoutWrite({ status: "completed" }), PUBLISH_OUTCOME.SETTLED);
});
