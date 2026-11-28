import assert from "node:assert/strict";
import test from "node:test";
import {
  CONDITION_MOOD, cleanCondition, conditionError, conditionExpireAt, conditionHeadline,
} from "../../functions/shared/lesson-condition.mjs";
import { conditionFailure } from "../../member/src/condition-copy.js";
import { conditionTarget } from "../../member/src/push.js";

/* 2026-11-28 대표: 보니따에서 수업 전 몸 상태를 담당 강사에게. */

test("고르는 규칙: 불편한 곳일 때만 부위, 부위나 메모 중 하나는 있어야", () => {
  assert.equal(conditionError({ mood: "good", areas: [], memo: "" }), "");
  assert.equal(conditionError({ mood: "discomfort", areas: ["back"], memo: "" }), "");
  assert.equal(conditionError({ mood: "discomfort", areas: [], memo: "왼쪽 어깨" }), "", "부위 없이 메모만도 된다");
  assert.equal(conditionError({ mood: "discomfort", areas: [], memo: " " }), "condition_discomfort_empty");
  assert.equal(conditionError({ mood: "tired", areas: ["knee"], memo: "" }), "condition_areas_without_discomfort");
  assert.equal(conditionError({ mood: "discomfort", areas: ["knee", "knee"], memo: "" }), "condition_bad_area");
  assert.equal(conditionError({ mood: "discomfort", areas: ["elbow"], memo: "" }), "condition_bad_area");
  assert.equal(conditionError({ mood: "", areas: [], memo: "" }), "condition_bad_mood");
  assert.equal(conditionError({ mood: "good", areas: [], memo: "가".repeat(101) }), "condition_memo_too_long");
});

test("다듬기 · 강사 한 줄 · 30일 뒤 지울 날", () => {
  assert.deepEqual(cleanCondition({ mood: "discomfort", areas: ["knee", "neck"], memo: " 조심 " }), { mood: "discomfort", areas: ["neck", "knee"], memo: "조심" });
  assert.deepEqual(cleanCondition({ mood: "good", areas: ["neck"], memo: "" }).areas, [], "불편한 곳이 아니면 부위를 버린다");
  assert.equal(conditionHeadline({ mood: CONDITION_MOOD.DISCOMFORT, areas: ["back", "knee"] }), "허리 · 무릎 불편");
  assert.equal(conditionHeadline({ mood: CONDITION_MOOD.DISCOMFORT, areas: [] }), "불편한 곳 있어요");
  assert.equal(conditionHeadline({ mood: CONDITION_MOOD.TIRED }), "피곤해요");
  const start = new Date("2026-11-28T02:00:00Z");
  assert.equal(conditionExpireAt(start).getTime() - start.getTime(), 30 * 86400000);
});

test("실패 문구: 코드 → 종류 → 문구, 원본 코드를 함께", () => {
  const cases = [
    [{ code: "functions/permission-denied", details: { reason: "not_own_lesson" } }, "permission"],
    [{ code: "functions/failed-precondition", details: { reason: "lesson_started" } }, "invalid_request"],
    [{ code: "functions/failed-precondition", details: { reason: "consent_required" } }, "invalid_request"],
    [{ code: "functions/unavailable" }, "network"],
    [{ code: "functions/unauthenticated" }, "authentication"],
    [{ code: "functions/invalid-argument", details: { reason: "condition_bad_area" } }, "invalid_request"],
    [{}, "unknown"],
  ];
  for (const [error, kind] of cases) {
    const view = conditionFailure(error);
    assert.equal(view.kind, kind, JSON.stringify(error));
    assert.ok(view.message.includes(`(코드 ${view.code})`), view.message);
  }
  assert.match(conditionFailure({ code: "functions/unavailable" }).message, /고른 것은 그대로/, "네트워크 실패에도 고른 것을 버리지 않는다");
});

test("수업 30분 전 알림을 누르면 그 수업을 연다 -- 옛 알림은 홈", () => {
  assert.deepEqual(conditionTarget({ data: { kind: "lesson30m", open: "condition", organizationId: "org", lessonId: "L1" } }), { organizationId: "org", lessonId: "L1" });
  assert.equal(conditionTarget({ data: { kind: "lesson30m", open: "home", organizationId: "org", lessonId: "L1" } }), null);
  assert.equal(conditionTarget({ data: { kind: "lesson30m", open: "condition", organizationId: "org", lessonId: "a/b" } }), null);
  assert.equal(conditionTarget({ data: { kind: "lessonRating", open: "condition", organizationId: "org", lessonId: "L1" } }), null);
});
