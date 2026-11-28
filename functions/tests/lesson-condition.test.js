"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CONDITION_REASON, lessonConditionStatus, saveLessonCondition } = require("../src/lesson-condition");

/* 2026-11-28 대표: 보니따에서 수업 전 몸 상태를 담당 강사에게. 30일 뒤 지움 · 처음 한 번 동의. */

function fakeFirestore(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const ref = (path) => ({
    path,
    collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  });
  return {
    docs,
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    batch: () => {
      const writes = [];
      return { set: (target, value) => writes.push([target.path, value]), commit: async () => writes.forEach(([path, value]) => docs.set(path, value)) };
    },
  };
}

const NOW = new Date("2026-11-28T00:00:00Z");
const STARTS = new Date("2026-11-28T02:00:00Z");
const seed = (lesson = {}) => ({
  "organizations/org/clients/c1": { userId: "uid-1", name: "김하나" },
  "organizations/org/lessons/L1": { status: "scheduled", clientIds: ["c1"], instructorId: "t1", startsAt: STARTS, ...lesson },
});
const input = (extra = {}) => ({ callerUid: "uid-1", organizationId: "org", clientId: "c1", lessonId: "L1", ...extra });
const deps = { now: () => NOW };

test("처음에는 동의가 있어야 하고, 동의하면 동의 기록 · 몸 상태가 함께 남는다", async () => {
  const db = fakeFirestore(seed());
  const condition = { mood: "discomfort", areas: ["knee", "back"], memo: "어제 계단에서 삐끗" };
  await assert.rejects(saveLessonCondition(db, input({ condition }), deps), (error) => error.reason === CONDITION_REASON.CONSENT);
  const result = await saveLessonCondition(db, input({ condition, consent: true }), deps);
  assert.deepEqual(result, { saved: true, notified: true, mood: "discomfort" });
  const saved = db.docs.get("organizations/org/lessonConditions/L1_c1");
  assert.deepEqual(saved.areas, ["back", "knee"], "부위는 정해진 순서로");
  assert.equal(saved.instructorId, "t1");
  assert.equal(saved.expireAt.getTime(), STARTS.getTime() + 30 * 86400000, "수업 30일 뒤 지운다");
  assert.equal(db.docs.get("organizations/org/memberConsents/c1_lesson_condition").version, "2026-11-28");
});

test("불편한 곳일 때만 강사 알림 -- 알림에는 부위 · 메모 · 이름이 없다", async () => {
  const db = fakeFirestore(seed());
  await saveLessonCondition(db, input({ condition: { mood: "discomfort", areas: ["neck"], memo: "목이 뻐근" }, consent: true }), deps);
  const item = db.docs.get("users/t1/inbox/cond_L1_c1");
  assert.equal(item.kind, "member_condition");
  assert.equal(item.lessonId, "L1", "누르면 그 수업이 열린다");
  assert.doesNotMatch(JSON.stringify(item), /목|neck|뻐근|김하나|uid-1/);

  const quiet = fakeFirestore(seed());
  const result = await saveLessonCondition(quiet, input({ condition: { mood: "tired", areas: [], memo: "" }, consent: true }), deps);
  assert.equal(result.notified, false);
  assert.equal(quiet.docs.has("users/t1/inbox/cond_L1_c1"), false);
});

test("한 번 동의하면 다음부터는 묻지 않는다 -- status 가 동의와 남긴 것을 돌려준다", async () => {
  const db = fakeFirestore(seed());
  await saveLessonCondition(db, input({ condition: { mood: "good", areas: [], memo: "" }, consent: true }), deps);
  const status = await lessonConditionStatus(db, input(), deps);
  assert.equal(status.consented, true);
  assert.equal(status.editable, true);
  assert.deepEqual(status.condition, { mood: "good", areas: [], memo: "" });
  await saveLessonCondition(db, input({ condition: { mood: "tired", areas: [], memo: "" } }), deps);
  assert.equal(db.docs.get("organizations/org/lessonConditions/L1_c1").mood, "tired");
});

test("시작한 수업 · 취소된 수업 · 남의 수업은 막는다", async () => {
  const condition = { mood: "good", areas: [], memo: "" };
  await assert.rejects(saveLessonCondition(fakeFirestore(seed({ startsAt: new Date("2026-11-27T23:00:00Z") })), input({ condition, consent: true }), deps),
    (error) => error.reason === CONDITION_REASON.STARTED);
  await assert.rejects(saveLessonCondition(fakeFirestore(seed({ status: "cancelled" })), input({ condition, consent: true }), deps),
    (error) => error.reason === CONDITION_REASON.NOT_SCHEDULED);
  await assert.rejects(saveLessonCondition(fakeFirestore(seed({ clientIds: ["c2"] })), input({ condition, consent: true }), deps),
    (error) => error.reason === CONDITION_REASON.NOT_OWN && error.httpsCode === "permission-denied");
  await assert.rejects(lessonConditionStatus(fakeFirestore(seed()), input({ callerUid: "someone" }), deps),
    (error) => error.reason === CONDITION_REASON.NOT_OWN);
  const started = await lessonConditionStatus(fakeFirestore(seed({ startsAt: new Date("2026-11-27T23:00:00Z") })), input(), deps);
  assert.equal(started.editable, false);
});

test("고를 수 없는 값은 서버가 다시 막는다", async () => {
  const db = fakeFirestore(seed());
  for (const condition of [
    { mood: "angry", areas: [], memo: "" },
    { mood: "good", areas: ["knee"], memo: "" },
    { mood: "discomfort", areas: [], memo: "" },
    { mood: "discomfort", areas: ["elbow"], memo: "" },
    { mood: "good", areas: [], memo: "가".repeat(101) },
  ]) {
    await assert.rejects(saveLessonCondition(db, input({ condition, consent: true }), deps), (error) => error.httpsCode === "invalid-argument", JSON.stringify(condition));
  }
});
