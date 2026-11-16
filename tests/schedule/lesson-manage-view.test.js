/**
 * 수업 관리 시트 개편 (2026-11-17 대표 지시서). 하단 버튼 문구 · 출석 기본값 · 만료 날 수.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ATTENDANCE, LESSON_STAGE, confirmBarView, doneTitle, effectiveNoshowFee, effectiveStatus, expirySuffix, expiryView,
  initialStage, nextConfirmStep, nextWeekLabel, remainingIsLow, willDeduct,
} from "../../src/features/schedule/lesson-manage-view.js";

const one = (status, extra = {}) => [{ memberId: "m1", status, ...extra }];
const remainingOf = () => 160;

test("출석은 기본값: 아직 고르지 않은 사람은 출석으로 보이고 차감에 든다", () => {
  assert.equal(effectiveStatus({ status: "booked" }), ATTENDANCE.ATTEND);
  assert.equal(effectiveStatus({}), ATTENDANCE.ATTEND);
  assert.equal(effectiveStatus({ status: "noshow" }), ATTENDANCE.NOSHOW);
  assert.equal(willDeduct({ status: "booked" }), true);
  assert.equal(willDeduct({ status: "cancel" }), false);
});

test("노쇼는 기본 1회 차감, 차감 안 함을 고르면 차감에서 빠진다", () => {
  assert.equal(effectiveNoshowFee({ status: "noshow" }), true);
  assert.equal(effectiveNoshowFee({ status: "noshow", noshowFee: false }), false);
  assert.equal(willDeduct({ status: "noshow" }), true);
  assert.equal(willDeduct({ status: "noshow", noshowFee: false }), false);
});

test("하단 버튼: 지시서 표 그대로 (상태 → 문구 / 보조 문구), 잔여는 받은 값으로 센다", () => {
  assert.deepEqual(confirmBarView({ stage: LESSON_STAGE.PRE, attendees: one("booked"), remainingOf }),
    { label: "수업 끝 · 처리하기", hint: "수업이 끝나면 눌러 주세요", action: "advance" });
  const post = (attendees) => confirmBarView({ stage: LESSON_STAGE.POST, attendees, remainingOf });
  assert.deepEqual(post(one("booked")), { label: "수업 확정 · 1회 차감", hint: "잔여 160회 → 159회", action: "confirm" });
  assert.deepEqual(post(one("done")), { label: "수업 확정 · 1회 차감", hint: "잔여 160회 → 159회", action: "confirm" });
  assert.deepEqual(post(one("noshow")), { label: "노쇼 처리 · 1회 차감", hint: "잔여 160회 → 159회", action: "confirm" });
  assert.deepEqual(post(one("noshow", { noshowFee: true })), { label: "노쇼 처리 · 1회 차감", hint: "잔여 160회 → 159회", action: "confirm" });
  assert.deepEqual(post(one("noshow", { noshowFee: false })), { label: "노쇼 처리 · 차감 없음", hint: "잔여 160회 유지", action: "confirm" });
  assert.deepEqual(post(one("cancel")), { label: "취소 처리 · 차감 없음", hint: "잔여 160회 유지", action: "confirm" });
  // 하드코딩이 아니다: 받은 잔여로 센다, 0 아래로 내려가지 않는다.
  assert.equal(confirmBarView({ stage: LESSON_STAGE.POST, attendees: one("booked"), remainingOf: () => 7 }).hint, "잔여 7회 → 6회");
  assert.equal(confirmBarView({ stage: LESSON_STAGE.POST, attendees: one("booked"), remainingOf: () => 0 }).hint, "잔여 0회 → 0회");
  // 잔여를 모르면 지어내지 않는다.
  assert.equal(confirmBarView({ stage: LESSON_STAGE.POST, attendees: one("booked"), remainingOf: () => null }).hint, "");
});

test("두 명 이상이면 N명 차감, 함께 쓰는 회원권은 1회", () => {
  const duet = [{ memberId: "a", status: "booked" }, { memberId: "b", status: "done" }];
  assert.deepEqual(confirmBarView({ stage: LESSON_STAGE.POST, attendees: duet, remainingOf }),
    { label: "수업 확정 · 2명 차감", hint: "2명 각 1회 차감", action: "confirm" });
  assert.equal(confirmBarView({ stage: LESSON_STAGE.POST, attendees: duet, remainingOf, sharedPass: true }).label, "수업 확정 · 1회 차감");
  const mixed = [{ memberId: "a", status: "done" }, { memberId: "b", status: "noshow", noshowFee: false }];
  assert.equal(confirmBarView({ stage: LESSON_STAGE.POST, attendees: mixed, remainingOf }).label, "수업 확정 · 1명 차감");
  const cancelled = [{ memberId: "a", status: "cancel" }, { memberId: "b", status: "cancel" }];
  assert.deepEqual(confirmBarView({ stage: LESSON_STAGE.POST, attendees: cancelled, remainingOf }),
    { label: "취소 처리 · 차감 없음", hint: "잔여 그대로 유지", action: "confirm" });
});

test("누르는 중 · 실패 뒤에는 그 말을 한다", () => {
  assert.equal(confirmBarView({ stage: LESSON_STAGE.POST, attendees: one("done"), remainingOf, busy: true }).label, "처리 중");
  assert.equal(confirmBarView({ stage: LESSON_STAGE.POST, attendees: one("done"), remainingOf, failedBefore: true }).label, "다시 확정 · 1회 차감");
});

test("[수업 확정] 은 한 걸음씩: 안 고른 사람 → 노쇼 차감 → 확정", () => {
  assert.deepEqual(nextConfirmStep([{ memberId: "a", status: "noshow" }, { memberId: "b", status: "booked" }]), { type: "status", memberId: "b" });
  assert.deepEqual(nextConfirmStep([{ memberId: "a", status: "noshow" }, { memberId: "b", status: "done" }]), { type: "fee", memberId: "a" });
  assert.deepEqual(nextConfirmStep([{ memberId: "a", status: "noshow", noshowFee: false }, { memberId: "b", status: "done" }]), { type: "finish" });
  assert.deepEqual(nextConfirmStep(one("cancel")), { type: "finish" });
});

test("처음 단계: 아무것도 안 고른 수업은 수업 전, 고른 것이 있으면 수업 후", () => {
  assert.equal(initialStage(one("booked")), LESSON_STAGE.PRE);
  assert.equal(initialStage([{ memberId: "a", status: "booked" }, { memberId: "b", status: "noshow" }]), LESSON_STAGE.POST);
});

test("완료 화면 제목", () => {
  assert.equal(doneTitle(one("done")), "수업이 확정됐어요");
  assert.equal(doneTitle(one("noshow")), "노쇼로 처리했어요");
  assert.equal(doneTitle(one("cancel")), "취소로 처리했어요");
  assert.equal(doneTitle([{ status: "done" }, { status: "noshow" }]), "수업이 확정됐어요");
});

test("만료: 날짜와 'N일' 을 같은 값에서 센다 (11.17 → 12.18 은 31일), 한국 날짜 기준", () => {
  const now = new Date("2026-11-17T10:00:00+09:00");
  const view = expiryView("2026-12-18", now);
  assert.deepEqual(view, { date: "2026-12-18", label: "12.18", days: 31, soon: false, expired: false });
  assert.equal(expirySuffix(view), "");
  // 서버 타임스탬프(밤 11시 59분 KST)도 같은 날로 읽는다.
  assert.equal(expiryView({ seconds: Date.parse("2026-12-18T23:59:00+09:00") / 1000 }, now).label, "12.18");
  // 한국 자정 직후에 기기가 UTC 여도 날 수가 흔들리지 않는다.
  assert.equal(expiryView("2026-12-18", new Date("2026-11-17T15:30:00Z")).days, 30);
  const soon = expiryView("2026-11-27", now);
  assert.equal(soon.soon, true);
  assert.equal(expirySuffix(soon), " · 10일 남음");
  assert.equal(expirySuffix(expiryView("2026-11-17", now)), " · 오늘 만료");
  assert.equal(expirySuffix(expiryView("2026-11-10", now)), " · 만료됨");
  assert.equal(expiryView("", now), null);
  assert.equal(expiryView(null, now), null);
});

test("잔여 강조는 부족할 때만", () => {
  assert.equal(remainingIsLow(3), true);
  assert.equal(remainingIsLow(4), false);
  assert.equal(remainingIsLow(160), false);
  assert.equal(remainingIsLow(null), false);
});

test("다음 주 같은 시간 버튼의 날짜", () => {
  const addDays = (iso, days) => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
  const dow = (iso) => "일월화수목금토"[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  assert.equal(nextWeekLabel("2026-11-16", "16:00", addDays, dow), "11.23 월 16:00");
  assert.equal(nextWeekLabel("", "16:00", addDays, dow), "");
});

test("시트 배선: 단계 탭 · 하단 고정 버튼 · 확정 걸음 · 모션은 동작 줄이기에서 멈춘다", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const form = app.slice(app.indexOf("function ScheduleForm("), app.indexOf("function ScheduleQueueSheet("));
  assert.match(form, /role="tablist" aria-label="수업 단계"/);
  assert.match(form, /data-lesson-confirm-bar className="sticky bottom-0/);
  assert.match(form, /const step = nextConfirmStep\(attendeesOf\(draft\)\)/);
  assert.match(form, /onStatus\?\.\(draft\.id, "done", step\.memberId, \{ single: true \}\)/);
  assert.match(form, /onNoshowFee\?\.\(draft\.id, true, step\.memberId\)/);
  assert.match(form, /errorCode: `confirm_\$\{step\.type\}_stalled`/);
  assert.match(form, /data-undo-settle/);
  // 짝이 노쇼로 골라 둔 것을 "둘 다 출석" 이 덮지 않는다.
  const status = app.slice(app.indexOf("const setStatus = (id, status, memberId, options = {}) => {"));
  assert.match(status.slice(0, 300), /lessonTypeKeyOf\(s0\) === "duet" && !options\.single\) return setStatusAll/);
  const motion = readFileSync(new URL("../../src/features/ui/motion.css", import.meta.url), "utf8");
  const reduced = motion.slice(motion.indexOf("/* ── 수업 관리 시트"));
  const animated = reduced.slice(reduced.indexOf("@media (prefers-reduced-motion: no-preference)"));
  for (const name of ["lm-stage-in-right", "lm-tab-pill { transition", "lm-done-check { animation"]) assert.ok(animated.includes(name), name);
  // 움직임은 transform · opacity · grid-template-rows 만 -- 레이아웃을 흔들지 않는다.
  assert.doesNotMatch(animated, /transition:[^;]*(height|top|left|margin)/);
});
