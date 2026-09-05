import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ONBOARDING_SAMPLE_MEMBER_ID,
  claimNotificationSoftPrompt,
  createOnboardingSampleData,
  notificationSoftPromptKey,
  removeOnboardingSampleData,
  withoutSampleData,
} from "../../src/features/onboarding/first-run.js";
import { selectPendingLessonSessions } from "../../src/features/lesson-record/member-detail-selectors.js";
import { buildLessonNotificationPlan } from "../../src/features/notifications/local-notifications.js";

const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};

test("sample creation is additive, deterministic, displayable, and idempotent", () => {
  const real = { id: "real-member", name: "실회원", notes: [] };
  const base = { settings: { staff: "강사" }, members: [real], schedule: [{ id: "real-lesson", memberId: real.id }] };
  const first = createOnboardingSampleData(base, { instructor: "강사", now: new Date("2026-09-06T12:00:00Z") });
  const second = createOnboardingSampleData(first.db, { instructor: "강사", now: new Date("2026-09-07T12:00:00Z") });
  const sample = first.db.members.find((member) => member.id === ONBOARDING_SAMPLE_MEMBER_ID);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.db.members.filter((member) => member.isSample).length, 1);
  assert.equal(first.db.members.some((member) => member.id === real.id), true);
  assert.equal(sample.name, "김예시");
  assert.equal(sample.regular, 5);
  assert.equal(sample.notes.length, 3);
  assert.equal(new Set(sample.notes.map((note) => note.date)).size, 3);
  assert.equal(sample.notes.every((note) => note.sid && note.lessonRecord?.stage === "confirmed_record"), true);
});

test("sample data is excluded from operational backup and pending selectors", () => {
  const result = createOnboardingSampleData({ settings: {}, members: [], schedule: [] }, { now: new Date("2026-09-06T12:00:00Z") });
  const operational = withoutSampleData(result.db, { [ONBOARDING_SAMPLE_MEMBER_ID]: { front: [{ id: "photo" }] } });
  assert.equal(operational.db.members.length, 0);
  assert.equal(operational.db.schedule.length, 0);
  assert.equal(ONBOARDING_SAMPLE_MEMBER_ID in operational.photos, false);
  assert.equal(selectPendingLessonSessions({ members: result.db.members, schedule: result.db.schedule, now: new Date("2026-10-01T00:00:00Z") }).count, 0);
});

test("sample lessons never become notification or operational aggregate work", () => {
  const sample = createOnboardingSampleData({ settings: {}, members: [], schedule: [] }, { now: new Date("2026-09-06T12:00:00Z") });
  const futureSchedule = sample.db.schedule.map((lesson) => ({ ...lesson, date: "2026-09-20", start: "10:00" }));
  assert.equal(buildLessonNotificationPlan({ schedule: futureSchedule, members: sample.db.members, now: new Date("2026-09-19T00:00:00Z") }).length, 0);
});

test("sample deletion changes only sample-related member, lessons, and photos", () => {
  const base = { settings: {}, members: [{ id: "real", name: "실회원" }], schedule: [{ id: "real-lesson", memberId: "real" }] };
  const sample = createOnboardingSampleData(base, { now: new Date("2026-09-06T12:00:00Z") });
  const removed = removeOnboardingSampleData(sample.db, { real: { front: [{ id: "real-photo" }] }, [ONBOARDING_SAMPLE_MEMBER_ID]: { front: [{ id: "sample-photo" }] } });
  assert.deepEqual(removed.db.members, base.members);
  assert.deepEqual(removed.db.schedule, base.schedule);
  assert.deepEqual(removed.photos, { real: { front: [{ id: "real-photo" }] } });
});

test("notification soft prompt is one-time and account scoped", () => {
  const local = storage();
  assert.equal(claimNotificationSoftPrompt(local, "account-a"), true);
  assert.equal(claimNotificationSoftPrompt(local, "account-a"), false);
  assert.equal(claimNotificationSoftPrompt(local, "account-b"), true);
  assert.notEqual(notificationSoftPromptKey("account-a"), notificationSoftPromptKey("account-b"));
});

test("startup notification sync never calls the permission request API", () => {
  const notifications = fs.readFileSync(path.resolve("src/features/notifications/local-notifications.js"), "utf8");
  const syncBody = notifications.slice(notifications.indexOf("const synchronizeLessonNotifications"), notifications.indexOf("export function syncLessonNotifications"));
  assert.match(syncBody, /checkLessonNotificationPermission/);
  assert.doesNotMatch(syncBody, /requestPermissions/);
  assert.match(notifications, /export async function requestLessonNotificationPermission/);
  const app = fs.readFileSync(path.resolve("src/App.jsx"), "utf8");
  assert.match(app, /알림 받기/);
  assert.match(app, /requestLessonNotificationPermission\(\)/);
  assert.match(app, /나중에/);
});

test("empty states, sample badges, replay, and permission guide are wired without storage reset", () => {
  const app = fs.readFileSync(path.resolve("src/App.jsx"), "utf8");
  assert.match(app, /아직 등록한 회원이 없습니다/);
  assert.match(app, /먼저 회원을 등록해 주세요/);
  assert.match(app, /등록된 수업이 없습니다/);
  assert.match(app, /아직 수업 기록이 없습니다/);
  assert.match(app, /예시 회원을 지울까요/);
  assert.match(app, /사용법 다시 보기/);
  assert.match(app, /접근권한 안내/);
  assert.doesNotMatch(app.slice(app.indexOf("finishOnboardingWithSample"), app.indexOf("deleteSampleMembers")), /sampleDb|resetSample/);
});
