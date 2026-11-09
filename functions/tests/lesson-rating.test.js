"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HTTPS_CODE_BY_REASON, lessonRatingStats, lessonRatingStatus, submitLessonRating } = require("../src/lesson-rating");
const { isActiveOwner, membershipId } = require("../src/member-link");

/* 수업 후 별점 평가 (2026-11-09). lesson-rating.js 의 본문을 그대로 지난다. index.js 는
   이 함수들을 감싸 오류를 HttpsError 로 바꿀 뿐이다. 메모리 Firestore 는 member-cancel.test.js 와 같다. */

const ORG = "bonita";
const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-10T03:00:00Z");
/* Date 를 지키는 깊은 복사 (Firestore 처럼 쓰고 읽은 값이 공유되지 않게). */
const clone = (value) => (value instanceof Date ? new Date(value) : Array.isArray(value) ? value.map(clone)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value);

/** 경로 문자열로 문서를 두는 Firestore. 트랜잭션은 차례로 돈다 -- 두 번 누르기를 재현한다. */
function memoryFirestore(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  let counter = 0;
  let chain = Promise.resolve();
  const snapshot = (path) => ({
    id: path.split("/").pop(),
    exists: docs.has(path),
    data: () => (docs.has(path) ? clone(docs.get(path)) : undefined),
  });
  const write = (path, value, options) => {
    docs.set(path, options?.merge ? { ...(docs.get(path) || {}), ...clone(value) } : clone(value));
  };
  const docRef = (path) => ({
    id: path.split("/").pop(),
    path,
    get: async () => snapshot(path),
    set: async (value, options) => write(path, value, options),
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  const collectionRef = (path) => {
    const query = (filters) => ({
      where: (field, op, value) => query([...filters, [field, op, value]]),
      get: async () => ({
        docs: [...docs.keys()]
          .filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
          .filter((key) => filters.every(([field, op, value]) => {
            const actual = docs.get(key)?.[field];
            if (op === "==") return actual === value;
            if (op === "array-contains") return Array.isArray(actual) && actual.includes(value);
            throw new Error(`unsupported ${op}`);
          }))
          .map(snapshot),
      }),
    });
    return {
      doc: (id) => docRef(`${path}/${id || `auto-${(counter += 1)}`}`),
      ...query([]),
    };
  };
  return {
    docs,
    collection: collectionRef,
    read: (path) => docs.get(path),
    runTransaction(callback) {
      const run = chain.then(async () => {
        const writes = [];
        const result = await callback({
          get: async (ref) => snapshot(ref.path),
          set: (ref, value, options) => writes.push([ref.path, value, options]),
        });
        for (const [path, value, options] of writes) write(path, value, options);
        return result;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}

const SCORES = Object.freeze({ body: 4, care: 5, again: 3 });
const lessonPath = (id) => `organizations/${ORG}/lessons/${id}`;
const ratingPath = (lessonId, clientId = "client-a") => `organizations/${ORG}/lessonRatings/${lessonId}_${clientId}`;
const statsPath = (instructorId = "teacher-1") => `organizations/${ORG}/lessonRatingStats/${instructorId}`;

function seed({ rating = { mode: "listed", userIds: ["teacher-1"] }, lesson = {}, extra = {} } = {}) {
  return memoryFirestore({
    "runtimeConfig/scheduleSync": { mode: "all", ...(rating ? { memberRating: rating } : {}) },
    [`organizations/${ORG}/clients/client-a`]: { organizationId: ORG, userId: "member-uid-a", name: "회원A", phone: "01011112222" },
    [`organizations/${ORG}/clients/client-b`]: { organizationId: ORG, userId: "member-uid-b" },
    [lessonPath("L1")]: {
      organizationId: ORG, status: "completed", clientIds: ["client-a"], instructorId: "teacher-1",
      startsAt: new Date(NOW.getTime() - 5 * HOUR), ...lesson,
    },
    [`memberships/${membershipId(ORG, "owner-uid")}`]: { role: "owner", status: "active", organizationId: ORG, userId: "owner-uid" },
    [`memberships/${membershipId(ORG, "teacher-1")}`]: { role: "instructor", status: "active", organizationId: ORG, displayName: "정예진" },
    ...extra,
  });
}
const input = (overrides = {}) => ({ callerUid: "member-uid-a", organizationId: ORG, clientId: "client-a", lessonId: "L1", ...overrides });
const deps = { now: () => NOW };
const reasonOf = async (promise) => {
  try { await promise; } catch (error) { return error.reason || error.httpsCode; }
  return "no_error";
};

test("스위치가 없으면(처음 배포 상태) 꺼져 있다 -- 카드를 그리지 않고 저장도 거절한다", async () => {
  const db = seed({ rating: null });
  assert.deepEqual(await lessonRatingStatus(db, input(), deps), { enabled: false, rated: false, reason: "feature_off", windowDays: 3 });
  assert.equal(await reasonOf(submitLessonRating(db, { ...input(), scores: SCORES }, deps)), "feature_off");
  assert.equal(db.read(ratingPath("L1")), undefined);
  assert.equal(db.read(statsPath()), undefined);
});

test("시범 강사 밖의 수업은 꺼진 것과 같다", async () => {
  const db = seed({ rating: { mode: "listed", userIds: ["teacher-9"] } });
  assert.equal((await lessonRatingStatus(db, input(), deps)).reason, "feature_off");
  assert.equal((await lessonRatingStatus(seed({ rating: { mode: "off", userIds: ["teacher-1"] } }), input(), deps)).reason, "feature_off");
});

test("켜진 강사의 끝난 수업은 평가를 받고, 담당 강사 집계가 오른다", async () => {
  const db = seed();
  assert.equal((await lessonRatingStatus(db, input(), deps)).enabled, true);
  const result = await submitLessonRating(db, { ...input(), scores: SCORES }, deps);
  assert.equal(result.outcome, "rated");
  const saved = db.read(ratingPath("L1"));
  assert.deepEqual(saved.scores, SCORES);
  assert.equal(saved.instructorId, "teacher-1");
  /* 이름 · 연락처는 평가 문서에 없다. */
  assert.doesNotMatch(JSON.stringify(saved), /회원A|0101111/);
  assert.deepEqual(db.read(statsPath()), {
    organizationId: ORG, instructorId: "teacher-1", count: 1, updatedAt: NOW,
    items: { body: { sum: 4, count: 1 }, care: { sum: 5, count: 1 }, again: { sum: 3, count: 1 } },
  });
  assert.deepEqual(await lessonRatingStatus(db, input(), deps), { enabled: true, rated: true, reason: "already_rated" });
});

test("두 번 보내면 두 번째는 '이미 보냄' 성공 -- 집계는 한 번만 오른다", async () => {
  const db = seed();
  const [first, second] = await Promise.all([
    submitLessonRating(db, { ...input(), scores: SCORES }, deps),
    submitLessonRating(db, { ...input(), scores: { body: 1, care: 1, again: 1 } }, deps),
  ]);
  assert.deepEqual([first.outcome, second.outcome], ["rated", "already_rated"]);
  assert.equal(db.read(statsPath()).count, 1);
  assert.deepEqual(db.read(ratingPath("L1")).scores, SCORES, "첫 점수가 남는다");
});

test("보낸 뒤 스위치를 꺼도 다시 누르면 '이미 보냄' 성공이다", async () => {
  const db = seed();
  await submitLessonRating(db, { ...input(), scores: SCORES }, deps);
  db.docs.set("runtimeConfig/scheduleSync", { mode: "all" });
  assert.equal((await submitLessonRating(db, { ...input(), scores: SCORES }, deps)).outcome, "already_rated");
});

test("담당 강사는 수업 문서에서 읽는다 -- 회원이 보낸 강사 id 는 쓰지 않는다", async () => {
  const db = seed();
  await submitLessonRating(db, { ...input(), instructorId: "teacher-9", scores: SCORES }, deps);
  assert.equal(db.read(statsPath("teacher-9")), undefined);
  assert.equal(db.read(statsPath()).count, 1);
});

test("남의 회원 문서 · 남의 수업은 거절 (없는 회원과 같은 답)", async () => {
  const db = seed({ extra: { [lessonPath("L2")]: { organizationId: ORG, status: "completed", clientIds: ["client-b"], instructorId: "teacher-1", startsAt: new Date(NOW.getTime() - HOUR) } } });
  assert.equal(await reasonOf(lessonRatingStatus(db, input({ clientId: "client-b" }), deps)), "not_own_lesson");
  assert.equal(await reasonOf(lessonRatingStatus(db, input({ clientId: "client-zz" }), deps)), "not_own_lesson");
  assert.equal(await reasonOf(submitLessonRating(db, { ...input({ lessonId: "L2" }), scores: SCORES }, deps)), "not_own_lesson");
  assert.equal(await reasonOf(lessonRatingStatus(db, input({ callerUid: "" }), deps)), "unauthenticated");
  assert.equal(await reasonOf(lessonRatingStatus(db, input({ lessonId: "a/b" }), deps)), "missing_fields");
});

test("받지 않는 수업: 시작 전 · 기간(3일) 지남 · 취소 · 회원 취소 · 노쇼 · 없는 수업", async () => {
  const cases = [
    [{ startsAt: new Date(NOW.getTime() + HOUR) }, "lesson_not_started"],
    [{ startsAt: new Date(NOW.getTime() - 73 * HOUR) }, "rating_expired"],
    [{ status: "cancelled" }, "lesson_cancelled"],
    [{ deletedAt: NOW }, "lesson_cancelled"],
    [{ memberCancellations: { "client-a": { by: "member" } } }, "lesson_cancelled"],
    [{ status: "noshow" }, "lesson_not_attended"],
  ];
  for (const [lesson, reason] of cases) {
    const db = seed({ lesson });
    assert.equal((await lessonRatingStatus(db, input(), deps)).reason, reason, reason);
    assert.equal(await reasonOf(submitLessonRating(db, { ...input(), scores: SCORES }, deps)), reason, reason);
    assert.equal(db.read(statsPath()), undefined, `${reason} 는 쓰지 않는다`);
  }
  assert.equal((await lessonRatingStatus(seed(), input({ lessonId: "nope" }), deps)).reason, "lesson_not_found");
});

test("점수 모양이 틀리면 invalid-argument (scores_invalid) -- 빠진 항목 · 모르는 항목 · 범위 밖 · 소수", async () => {
  for (const scores of [null, {}, { body: 4, care: 5 }, { ...SCORES, extra: 3 }, { ...SCORES, body: 0 }, { ...SCORES, body: 6 }, { ...SCORES, body: 4.5 }, [4, 5, 3]]) {
    const db = seed();
    let caught = null;
    try { await submitLessonRating(db, { ...input(), scores }, deps); } catch (error) { caught = error; }
    assert.equal(caught?.reason, "scores_invalid", JSON.stringify(scores));
    assert.equal(caught?.httpsCode, "invalid-argument");
    assert.equal(db.read(ratingPath("L1")), undefined);
  }
});

test("모든 이유 코드에 Firebase 코드가 있다", () => {
  for (const reason of ["feature_off", "lesson_not_found", "not_own_lesson", "lesson_cancelled", "lesson_not_attended", "lesson_not_started", "rating_expired", "scores_invalid", "not_owner"]) {
    assert.ok(HTTPS_CODE_BY_REASON[reason], reason);
  }
});

test("대표 화면 집계: 대표만, 강사 이름 · 건수 · 평균만 -- 회원 · 개별 점수는 없다", async () => {
  const db = seed();
  await submitLessonRating(db, { ...input(), scores: SCORES }, deps);
  db.docs.set(lessonPath("L3"), { organizationId: ORG, status: "completed", clientIds: ["client-a"], instructorId: "teacher-1", startsAt: new Date(NOW.getTime() - 2 * HOUR) });
  await submitLessonRating(db, { ...input({ lessonId: "L3" }), scores: { body: 5, care: 4, again: 4 } }, deps);

  const stats = await lessonRatingStats(db, { callerUid: "owner-uid", organizationId: ORG }, { membershipId, isActiveOwner });
  assert.deepEqual(stats.rows, [{
    instructorId: "teacher-1", instructorName: "정예진", count: 2,
    items: [{ id: "body", average: 4.5, count: 2 }, { id: "care", average: 4.5, count: 2 }, { id: "again", average: 3.5, count: 2 }],
  }]);
  assert.deepEqual(stats.items.map((item) => item.id), ["body", "care", "again"]);
  assert.doesNotMatch(JSON.stringify(stats), /client-a|member-uid|회원A|L1|L3/);

  for (const callerUid of ["teacher-1", "member-uid-a", "nobody"]) {
    assert.equal(await reasonOf(lessonRatingStats(db, { callerUid, organizationId: ORG }, { membershipId, isActiveOwner })), "not_owner", callerUid);
  }
  assert.equal(await reasonOf(lessonRatingStats(db, { callerUid: "", organizationId: ORG }, { membershipId, isActiveOwner })), "unauthenticated");
});

test("스위치 저장: scheduleSync 문서의 memberRating 칸에만 -- 일정 동기화 · 취소 설정은 그대로", async () => {
  const { writeRuntimeConfig, readRuntimeConfig } = require("../src/runtime-config-admin");
  const db = memoryFirestore({
    "runtimeConfig/scheduleSync": { mode: "all", userIds: [], memberCancel: { mode: "listed", userIds: ["teacher-1"], limit: 3, period: "month" } },
  });
  await writeRuntimeConfig(db, { document: "memberRating", value: { mode: "listed", userIds: ["teacher-1"] }, actorId: "owner-uid", now: () => NOW });
  const saved = db.read("runtimeConfig/scheduleSync");
  assert.equal(saved.mode, "all");
  assert.equal(saved.memberCancel.limit, 3);
  assert.deepEqual({ mode: saved.memberRating.mode, userIds: saved.memberRating.userIds }, { mode: "listed", userIds: ["teacher-1"] });
  assert.deepEqual((await readRuntimeConfig(db, ["memberRating"])).memberRating.userIds, ["teacher-1"]);
  /* 이름 · 전화번호 모양은 받지 않는다 (scheduleSync 와 같은 검사). */
  await assert.rejects(writeRuntimeConfig(db, { document: "memberRating", value: { mode: "listed", userIds: ["01012345678"] }, actorId: "owner-uid" }), /schedule_sync_user_invalid/);
});
