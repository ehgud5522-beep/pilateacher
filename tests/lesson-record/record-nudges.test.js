/**
 * 권장 문구 (2026-11-21 대표): 수업기록 3번에 1번 · 비포애프터 한 달에 한 장. 판정 → 문구 → 코드.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NUDGE_CODE, beforeAfterNudge, lastSentAtOf, recordGapBefore, recordNudge,
} from "../../src/features/records/record-nudges.js";

const NOW = new Date(2026, 10, 21, 20, 0).getTime();
const DAY = 86400000;
const lesson = (id, date, status = "done", extra = {}) => ({ id, date, start: "10:00", end: "10:50", attendees: [{ memberId: "m1", status }], ...extra });
const note = (sid, extra = {}) => ({ sid, body: "골반 안정 좋아짐", type: "수업", ...extra });

const schedule = [
  lesson("l1", "2026-11-03"),
  lesson("l2", "2026-11-07"),
  lesson("l3", "2026-11-10"),
  lesson("l4", "2026-11-14", "noshow"),
  lesson("l5", "2026-11-17"),
  lesson("l6", "2026-11-21"),
  lesson("future", "2026-11-28"),
];

test("기록 없이 이어진 출석 수업: 노쇼 · 미래 · 이번 수업은 세지 않고, 기록이 나오면 멈춘다", () => {
  const member = { id: "m1", notes: [note("l2")] };
  assert.equal(recordGapBefore({ member, schedule, currentLessonId: "l6", now: NOW }), 2); // l5, l3
  assert.equal(recordGapBefore({ member: { id: "m1", notes: [] }, schedule, currentLessonId: "l6", now: NOW }), 4);
  /* 상담 · 인바디 기록은 수업일지가 아니다 */
  assert.equal(recordGapBefore({ member: { id: "m1", notes: [note("l5", { type: "상담" })] }, schedule, currentLessonId: "l6", now: NOW }), 4);
  /* 예시 회원은 세지 않는다 */
  assert.equal(recordGapBefore({ member: { id: "m1", isSample: true, notes: [] }, schedule, currentLessonId: "l6", now: NOW }), 0);
});

test("수업기록 권장: 지난 2번이 비었으면 이번에 · 이번 수업을 쓰면 사라짐 · 1번만 비었으면 아직", () => {
  const nudge = recordNudge({ member: { id: "m1", notes: [note("l2")] }, schedule, currentLessonId: "l6", now: NOW });
  assert.deepEqual(nudge, { code: NUDGE_CODE.RECORD, gap: 2, text: "최근 2번 수업에 일지가 없어요 · 3번에 한 번은 남기기를 권해요" });
  assert.equal(recordNudge({ member: { id: "m1", notes: [note("l2"), note("l6")] }, schedule, currentLessonId: "l6", now: NOW }), null);
  assert.equal(recordNudge({ member: { id: "m1", notes: [note("l3")] }, schedule, currentLessonId: "l6", now: NOW }), null);
  /* AI 초안도 남긴 것이다 */
  assert.equal(recordNudge({ member: { id: "m1", notes: [note("l5", { aiDraft: true })] }, schedule, currentLessonId: "l6", now: NOW }), null);
});

test("비포애프터 권장: 함께한 지 한 달 넘음 + 보낸 적 없음 / 30일 지남. 모름 · 꺼짐 · 앱 미연결이면 안 뜸", () => {
  const member = { id: "m1", notes: [] };
  assert.equal(beforeAfterNudge({ member, schedule, share: { linked: true, lastSentAt: null }, now: NOW }), null, "첫 출석 11/3 -- 아직 한 달 안 됨");
  const longer = [lesson("l0", "2026-09-20"), ...schedule];
  assert.equal(beforeAfterNudge({ member, schedule: longer, share: { linked: true, lastSentAt: null }, now: NOW }).code, NUDGE_CODE.BEFORE_AFTER_NEVER);
  const stale = beforeAfterNudge({ member, schedule: longer, share: { linked: true, lastSentAt: NOW - 40 * DAY }, now: NOW });
  assert.deepEqual(stale, { code: NUDGE_CODE.BEFORE_AFTER_STALE, days: 40, text: "비포애프터를 보낸 지 40일 지났어요 · 한 달에 한 장은 보내기를 권해요" });
  assert.equal(beforeAfterNudge({ member, schedule: longer, share: { linked: true, lastSentAt: NOW - 10 * DAY }, now: NOW }), null);
  assert.equal(beforeAfterNudge({ member, schedule: longer, share: null, now: NOW }), null);
  assert.equal(beforeAfterNudge({ member, schedule: longer, share: { linked: false, lastSentAt: null }, now: NOW }), null);
  assert.equal(beforeAfterNudge({ member, schedule: longer, share: { linked: true, lastSentAt: null, disabled: true }, now: NOW }), null);
});

test("마지막으로 보낸 시각: 공개 중인 카드만, 가장 늦은 것", () => {
  assert.equal(lastSentAtOf([]), null);
  assert.equal(lastSentAtOf([
    { status: "active", sharedAt: "2026-10-01T00:00:00.000Z" },
    { status: "draft", sharedAt: null },
    { status: "active", sharedAt: "2026-11-01T00:00:00.000Z" },
  ]), Date.parse("2026-11-01T00:00:00.000Z"));
});

test("화면 배선: 수업 후 탭 일지 칸 위 · 코드 표시", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  for (const needle of ["data-record-nudge={recordNudgeView.code}", "data-before-after-nudge={beforeAfterNudgeView.code}", "requestBeforeAfter("]) {
    assert.ok(app.includes(needle), `App.jsx 에 ${needle} 없음`);
  }
  const post = app.indexOf('data-lesson-stage="post"');
  const nudge = app.indexOf("{nudgeLines}", post);
  const record = app.indexOf("{recordSection}", post);
  assert.ok(post > 0 && nudge > post && nudge < record, "권장 문구는 수업 후 탭의 일지 칸 바로 위");
});
