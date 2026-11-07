import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CANCEL_DONE_NOTIFIED, CANCEL_DONE_NOT_NOTIFIED, CANCEL_DONE_TITLE, CANCEL_FAILURE_KIND,
  blockedMessage, cancelDoneNote, cancelFailure, deadlineLabel, remainingLabel,
} from "../../member/src/cancel-copy.js";
import {
  CANCEL_REASON, decideMemberCancel, memberCancelEnabledFor, monthKey, validateGrant,
} from "../../functions/shared/member-cancel.mjs";

/* 회원 앱 수업 취소 (2026-11-07, 5차 1단계). 서버 이유 코드 → 종류 → 문구가 한 줄로
   이어지는지 고정한다 (CLAUDE.md §8). 문구는 대표가 정한 그대로다. */

const callableError = (code, reason) => Object.assign(new Error(code), { code: `functions/${code}`, details: reason ? { reason } : undefined });

test("횟수를 다 쓰면: '취소 가능 횟수가 없습니다. {강사} 선생님에게 문의하세요' — 전화번호 없음", () => {
  const view = cancelFailure(callableError("failed-precondition", "no_remaining"), "정예진");
  assert.equal(view.kind, CANCEL_FAILURE_KIND.BLOCKED);
  assert.equal(view.code, "no_remaining");
  assert.equal(view.retry, false);
  assert.equal(view.message, "취소 가능 횟수가 없습니다. 정예진 선생님에게 문의하세요");
  assert.doesNotMatch(view.message, /\d{3,}/, "전화번호를 쓰지 않는다");
});

test("마감이 지나면: '취소 가능 시간이 지났어요. {강사} 선생님에게 문의해 주세요'", () => {
  assert.equal(blockedMessage("deadline_passed", "정예진"), "취소 가능 시간이 지났어요. 정예진 선생님에게 문의해 주세요");
  assert.equal(blockedMessage("deadline_passed", ""), "취소 가능 시간이 지났어요. 담당 선생님에게 문의해 주세요", "이름을 모르면 담당 선생님");
});

test("서버 이유마다 종류가 갈린다 — 막힘은 재시도 없음, 연결은 다시 시도, 모르는 것은 코드와 함께", () => {
  const rows = [
    [callableError("failed-precondition", "lesson_settled"), CANCEL_FAILURE_KIND.BLOCKED, false, /이미 확정/],
    [callableError("failed-precondition", "lesson_cancelled"), CANCEL_FAILURE_KIND.BLOCKED, false, /이미 취소/],
    [callableError("permission-denied", "not_own_lesson"), CANCEL_FAILURE_KIND.PERMISSION, false, /not_own_lesson/],
    [callableError("failed-precondition", "feature_off"), CANCEL_FAILURE_KIND.BLOCKED, false, /문의/],
    [callableError("unavailable"), CANCEL_FAILURE_KIND.NETWORK, true, /연결.*코드 unavailable/],
    [callableError("deadline-exceeded"), CANCEL_FAILURE_KIND.NETWORK, true, /코드 deadline-exceeded/],
    [callableError("unavailable", "member_cancel_failed"), CANCEL_FAILURE_KIND.UNAVAILABLE, true, /코드 member_cancel_failed/],
    [callableError("unauthenticated"), CANCEL_FAILURE_KIND.AUTH, false, /로그인/],
    [callableError("internal"), CANCEL_FAILURE_KIND.UNKNOWN, false, /처리하지 못했어요 \(코드 internal\)/],
    [new Error("boom"), CANCEL_FAILURE_KIND.UNKNOWN, false, /코드 unknown/],
  ];
  for (const [error, kind, retry, pattern] of rows) {
    const view = cancelFailure(error, "정예진");
    assert.equal(view.kind, kind, error.code);
    assert.equal(view.retry, retry, error.code);
    assert.match(view.message, pattern, error.code);
    assert.ok(view.code, "코드 없는 실패는 없다");
  }
});

/* ── 취소 완료 화면 (2026-11-07 대표 시안) ── */
test("완료 화면: 제목은 시안 그대로, 강사 알림이 실제로 갔을 때만 '전달했어요'", () => {
  assert.equal(CANCEL_DONE_TITLE, "수업 취소가 완료되었어요");
  assert.equal(cancelDoneNote({ outcome: "cancelled", teacherNotice: "sent" }), "담당 강사님께 취소 알림을 전달했어요");
  assert.equal(CANCEL_DONE_NOTIFIED, "담당 강사님께 취소 알림을 전달했어요");
  /* 꺼짐 · 강사 기기 없음 · 실패 · 보낼 상대 없음 · 예전 서버(값 없음) -- 전달했다고 말하지 않는다. */
  for (const teacherNotice of ["off", "no_device", "failed", "skipped", undefined, ""]) {
    const note = cancelDoneNote({ outcome: "cancelled", teacherNotice });
    assert.equal(note, CANCEL_DONE_NOT_NOTIFIED, String(teacherNotice));
    assert.doesNotMatch(note, /전달/, String(teacherNotice));
    assert.doesNotMatch(note, /오류|실패|코드/, "취소는 성공이다 -- 오류처럼 말하지 않는다");
  }
  assert.equal(cancelDoneNote(null), CANCEL_DONE_NOT_NOTIFIED);
  /* 강사 앱 알림함에 들어갔으면 푸시가 없어도 전달된 것이다 (2026-11-07). */
  assert.equal(cancelDoneNote({ teacherNotice: "off", teacherInbox: "written" }), CANCEL_DONE_NOTIFIED);
  assert.equal(cancelDoneNote({ teacherNotice: "no_device", teacherInbox: "duplicate" }), CANCEL_DONE_NOTIFIED);
  assert.equal(cancelDoneNote({ teacherNotice: "failed", teacherInbox: "failed" }), CANCEL_DONE_NOT_NOTIFIED);
  assert.equal(cancelDoneNote({ teacherNotice: "off", teacherInbox: "skipped" }), CANCEL_DONE_NOT_NOTIFIED);
});

test("완료 화면은 시트의 done 단계에 있고 문구는 cancel-copy 에서 온다 (하드코딩 없음)", () => {
  const sheet = readFileSync(new URL("../../member/src/lesson-sheet.jsx", import.meta.url), "utf8");
  const done = sheet.slice(sheet.indexOf('phase === "done"'));
  assert.ok(done.includes("{CANCEL_DONE_TITLE}"));
  assert.ok(done.includes("cancelDoneNote(done)"));
  assert.match(done, /donecheck/, "초록 체크");
  assert.ok(!sheet.includes("수업을 취소했어요."), "예전 완료 문구는 없다");
  assert.doesNotMatch(sheet, /전달했어요/, "문구는 cancel-copy.js 한 곳에");
});

test("마감 · 남은 횟수 표시", () => {
  assert.equal(deadlineLabel(new Date(2026, 10, 9, 19, 0)), "11월 9일(월) 19:00까지");
  assert.equal(deadlineLabel("nope"), "");
  assert.equal(remainingLabel({ remaining: 2, period: "month" }), "이번 달 남은 취소 2회");
  assert.equal(remainingLabel({ remaining: 0, period: "pass" }), "이 회원권 남은 취소 0회");
  assert.equal(remainingLabel({ remaining: null }), "");
});

/* ── 판정 한 벌 (서버 · 강사 앱 · 회원 앱이 같이 쓴다) ───────────────────── */

const HOUR = 3600 * 1000;
const NOW = new Date("2026-11-10T03:00:00Z");
const syncDoc = (cancel = {}) => ({
  mode: "listed", userIds: ["t1"],
  memberCancel: { mode: "listed", userIds: ["t1"], limit: 3, period: "month", ...cancel },
});
const lesson = (overrides = {}) => ({ status: "scheduled", clientIds: ["c1"], instructorId: "t1", startsAt: new Date(NOW.getTime() + 30 * HOUR), ...overrides });

test("판정 순서 — 꺼짐 · 남의 수업 · 확정 · 취소됨 · 마감 · 횟수", () => {
  const decide = (input) => decideMemberCancel({ now: NOW, clientId: "c1", scheduleSyncDoc: syncDoc(), lesson: lesson(), ...input }).reason;
  assert.equal(decide({}), "");
  assert.equal(decide({ scheduleSyncDoc: syncDoc({ mode: "off" }) }), CANCEL_REASON.FEATURE_OFF);
  assert.equal(decide({ lesson: null }), CANCEL_REASON.NOT_FOUND);
  assert.equal(decide({ lesson: lesson({ clientIds: ["c2"] }) }), CANCEL_REASON.NOT_OWN);
  assert.equal(decide({ lesson: lesson({ status: "completed" }) }), CANCEL_REASON.SETTLED);
  assert.equal(decide({ lesson: lesson({ status: "cancelled" }) }), CANCEL_REASON.CANCELLED);
  assert.equal(decide({ lesson: lesson({ startsAt: new Date(NOW.getTime() + 23 * HOUR) }) }), CANCEL_REASON.DEADLINE);
  assert.equal(decide({ ledger: { buckets: { "m:2026-11": { used: 3, granted: 0 } } } }), CANCEL_REASON.NO_REMAINING);
  assert.equal(decide({ ledger: { buckets: { "m:2026-11": { used: 3, granted: 1 } } } }), "");
  /* 듀엣에서 이미 빠진 회원의 두 번째 클릭은 '남의 수업' 이 아니라 '이미 취소함' */
  assert.equal(decide({ lesson: lesson({ clientIds: ["c2"], memberCancellations: { c1: { by: "member" } } }) }), CANCEL_REASON.ALREADY);
});

test("동기화가 꺼진 강사에게는 켜지지 않는다 — 강사가 모르는 취소가 생기지 않게", () => {
  assert.equal(memberCancelEnabledFor(syncDoc(), "t1"), true);
  assert.equal(memberCancelEnabledFor({ ...syncDoc(), mode: "off" }, "t1"), false);
  assert.equal(memberCancelEnabledFor(syncDoc({ mode: "all" }), "t9"), false, "취소가 all 이어도 그 강사 동기화가 꺼져 있으면");
  assert.equal(memberCancelEnabledFor({ ...syncDoc({ mode: "all" }), mode: "all" }, "t9"), true);
});

test("월은 한국 시각, 추가 부여 입력 범위", () => {
  assert.equal(monthKey(new Date("2026-11-30T14:59:00Z")), "2026-11");
  assert.equal(monthKey(new Date("2026-11-30T15:00:00Z")), "2026-12");
  assert.equal(validateGrant({ amount: 2, reason: " 병원 " }).reason, "병원");
  assert.equal(validateGrant({ amount: 2, reason: "" }).reason, "grant_reason_required");
});
