/**
 * 강사 앱 버전 기록.
 *
 * 이 숫자 하나로 대표가 규칙을 켤지 말지 정한다. 틀리면 강사 앱이 멈추고,
 * 그 사람은 고칠 자리에 있지 않다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  SEEN_REFRESH_HOURS,
  VERSION_STATE,
  instructorVersionRows,
  readinessMessage,
  rulesReadiness,
  shouldReportVersion,
} from "../../src/features/members/app-version-report.js";

const NOW = new Date(2026, 8, 26, 12, 0, 0);
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);
const current = { version: "1.1.29", build: "62" };

test("버전이 바뀌면 쓴다", () => {
  assert.equal(shouldReportVersion({
    current, now: NOW,
    stored: { appVersion: "1.1.29", appBuild: "61", lastSeenAt: hoursAgo(1) },
  }), true);
});

test("같은 버전이고 방금 썼으면 다시 쓰지 않는다", () => {
  /* 앱을 열 때마다 쓰면 그것이 그대로 비용이 된다. */
  assert.equal(shouldReportVersion({
    current, now: NOW,
    stored: { appVersion: "1.1.29", appBuild: "62", lastSeenAt: hoursAgo(1) },
  }), false);
});

test("반나절이 지나면 다시 쓴다 — 경계", () => {
  const stored = (hours) => ({ appVersion: "1.1.29", appBuild: "62", lastSeenAt: hoursAgo(hours) });
  assert.equal(shouldReportVersion({ current, now: NOW, stored: stored(SEEN_REFRESH_HOURS - 0.1) }), false);
  assert.equal(shouldReportVersion({ current, now: NOW, stored: stored(SEEN_REFRESH_HOURS) }), true);
});

test("기록이 없으면 쓴다", () => {
  assert.equal(shouldReportVersion({ current, now: NOW, stored: {} }), true);
});

test("시각을 못 읽으면 쓴다", () => {
  /* 못 읽는 값 때문에 영영 안 쓰는 것보다 한 번 더 쓰는 편이 낫다. */
  assert.equal(shouldReportVersion({
    current, now: NOW,
    stored: { appVersion: "1.1.29", appBuild: "62", lastSeenAt: "언제였더라" },
  }), true);
});

test("버전을 모르면 쓰지 않는다", () => {
  /* 빈 값을 남기면 대표 화면에 "알 수 없음" 이 뜨는데, 그것은 앱을 안 연
     사람과 구별되지 않는다. */
  assert.equal(shouldReportVersion({ current: { version: "", build: "62" }, now: NOW, stored: {} }), false);
  assert.equal(shouldReportVersion({ current: { version: "1.1.29", build: "" }, now: NOW, stored: {} }), false);
});

test("낡은 앱과 확인 안 된 앱을 가른다", () => {
  const rows = instructorVersionRows([
    { userId: "a", displayName: "가강사", appVersion: "1.1.29", appBuild: "62", lastSeenAt: hoursAgo(2) },
    { userId: "b", displayName: "나강사", appVersion: "1.1.29", appBuild: "61", lastSeenAt: hoursAgo(50) },
    { userId: "c", displayName: "다강사" },
  ], { minimumBuild: 62 });
  const byId = new Map(rows.map((row) => [row.userId, row]));
  assert.equal(byId.get("a").state, VERSION_STATE.READY);
  assert.equal(byId.get("b").state, VERSION_STATE.OUTDATED);
  assert.equal(byId.get("c").state, VERSION_STATE.UNKNOWN);
});

test("문제 있는 줄이 위로 온다", () => {
  /* 대표가 보는 순간 할 일이 먼저 보여야 한다. */
  const rows = instructorVersionRows([
    { userId: "a", displayName: "가강사", appBuild: "62" },
    { userId: "b", displayName: "나강사" },
    { userId: "c", displayName: "다강사", appBuild: "60" },
  ], { minimumBuild: 62 });
  assert.deepEqual(rows.map((row) => row.state), [
    VERSION_STATE.OUTDATED, VERSION_STATE.UNKNOWN, VERSION_STATE.READY,
  ]);
});

test("이름을 모르는 강사도 어느 줄인지 안다", () => {
  const [row] = instructorVersionRows([{ userId: "uid-zzzzzz", appBuild: "62" }], { minimumBuild: 62 });
  assert.match(row.name, /uid-zz/);
});

test("확인 안 된 사람이 있으면 규칙을 켜면 안 된다", () => {
  /* "아직 안 열었다" 와 "낡았다" 는 규칙 앞에서 같은 결과를 낸다 --
     그 사람의 앱이 멈춘다. */
  const rows = instructorVersionRows([
    { userId: "a", appBuild: "62" },
    { userId: "b" },
  ], { minimumBuild: 62 });
  const readiness = rulesReadiness(rows);
  assert.equal(readiness.safe, false);
  assert.equal(readiness.unknown, 1);
  assert.match(readinessMessage(readiness, 62), /확인 안 됨 1명/);
  assert.doesNotMatch(readinessMessage(readiness, 62), /규칙을 켜도 됩니다/);
});

test("전원이 기준 이상이면 켜도 된다고 말한다", () => {
  const rows = instructorVersionRows([
    { userId: "a", appBuild: "62" },
    { userId: "b", appBuild: "63" },
  ], { minimumBuild: 62 });
  const readiness = rulesReadiness(rows);
  assert.equal(readiness.safe, true);
  assert.match(readinessMessage(readiness, 62), /규칙을 켜도 됩니다/);
});

test("강사가 없으면 켜도 된다고 말하지 않는다", () => {
  /* 0명은 "전원 통과" 가 아니라 "아직 못 읽었다" 일 수 있다. */
  const readiness = rulesReadiness([]);
  assert.equal(readiness.safe, false);
  assert.match(readinessMessage(readiness, 62), /강사가 없습니다/);
});
