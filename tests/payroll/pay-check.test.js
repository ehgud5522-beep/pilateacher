/**
 * 정산 점검 (2026-11-22): 지난 수업 미처리 · 완료인데 차감 없음 · 듀엣 차감 부족 · 남은 횟수 불일치 · 중복 차감,
 * 차단/확인 구분, 같은 건은 확인함 유지 · 내용이 바뀌면 다시, 못 읽으면 점검 미완료, 동기화 꺼진 강사는 범위에.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CHECK_KIND, CHECK_SEVERITY, ackDocId, kstTodayStart, runPayCheck, withAcks } from "../../functions/shared/pay-check.mjs";

const ORG = "o1";
const MONTH = "2026-11";
const NOW = new Date("2026-11-20T01:00:00Z"); // 한국 11월 20일 10시
const at = (iso) => new Date(iso);
const lesson = (id, extra = {}) => ({ id, lessonId: id, instructorId: "t1", locationId: "bansong", clientIds: ["c1"], status: "scheduled", startsAt: at("2026-11-18T01:00:00Z"), ...extra });
const deduct = (id, extra = {}) => ({ organizationId: ORG, type: "deduct", delta: -1, unitPrice: 30000, instructorId: "t1", clientId: "c1", passId: "p1", lessonId: id, locationId: "bansong", occurredAt: at("2026-11-18T01:00:00Z"), ...extra });
const kinds = (check) => check.items.map((item) => [item.kind, item.severity]);

test("지난 수업 미처리는 어제까지만 (오늘 수업은 아직) · 회원 없는 개인 일정 · 취소 · 다른 달은 뺀다", () => {
  assert.equal(kstTodayStart(NOW).toISOString(), "2026-11-19T15:00:00.000Z");
  const check = runPayCheck({ organizationId: ORG, month: MONTH, now: NOW, lessons: [
    lesson("past"), lesson("today", { startsAt: at("2026-11-20T00:30:00Z") }), lesson("personal", { clientIds: [] }),
    lesson("cancelled", { status: "cancelled" }), lesson("october", { startsAt: at("2026-10-30T01:00:00Z") }),
  ] });
  assert.deepEqual(kinds(check), [[CHECK_KIND.UNSETTLED_PAST, CHECK_SEVERITY.WARN]]);
  assert.equal(check.items[0].lessonId, "past");
  assert.equal(check.complete, true);
});

test("완료인데 차감 없음은 차단 · 듀엣 차감 부족 · 중복 차감은 확인", () => {
  const check = runPayCheck({ organizationId: ORG, month: MONTH, now: NOW,
    lessons: [lesson("done-ok", { status: "completed" }), lesson("done-none", { status: "completed" }), lesson("duet", { status: "completed", clientIds: ["c1", "c2"] })],
    monthLedger: [deduct("done-ok"), deduct("duet"), deduct("other-device", { lessonId: "other-device" })],
  });
  assert.deepEqual(kinds(check), [
    [CHECK_KIND.COMPLETED_NO_DEDUCT, CHECK_SEVERITY.BLOCK],
    [CHECK_KIND.DEDUCT_SHORT, CHECK_SEVERITY.WARN],
    [CHECK_KIND.DUPLICATE_DEDUCT, CHECK_SEVERITY.WARN],
  ].sort((a, b) => (a[1] === b[1] ? 0 : a[1] === "block" ? -1 : 1)));
  const duplicate = check.items.find((item) => item.kind === CHECK_KIND.DUPLICATE_DEDUCT);
  assert.deepEqual(duplicate.detail.lessonIds, ["done-ok", "duet", "other-device"]);
  assert.deepEqual(check.counts, { block: 1, warn: 2, byKind: { completed_no_deduct: 1, deduct_short: 1, duplicate_deduct: 1 } });
});

test("남은 횟수 불일치: 이 달에 쓴 회원권이면 차단, 아니면 확인", () => {
  const ledger = (passId, month, delta) => ({ passId, type: delta > 0 ? "issue" : "deduct", delta, occurredAt: at(`${month}-05T01:00:00Z`) });
  const check = runPayCheck({ organizationId: ORG, month: MONTH, now: NOW,
    passes: [{ id: "used", clientId: "c1", instructorId: "t1", remainingCount: 9 }, { id: "old", clientId: "c2", instructorId: "t2", remainingCount: 5 }, { id: "fine", remainingCount: 9 }],
    passLedger: [ledger("used", "2026-10", 10), ledger("used", "2026-11", -1), ledger("used", "2026-11", -1), ledger("old", "2026-09", 10), ledger("old", "2026-09", -1), ledger("fine", "2026-11", 10), ledger("fine", "2026-11", -1)],
  });
  assert.deepEqual(check.items.map((item) => [item.passId, item.severity, item.detail.difference]), [["used", "block", 1], ["old", "warn", -4]]);
});

test("확인함은 같은 key · 같은 내용일 때만 · 바뀌면 다시 뜬다 · 못 읽으면 점검 미완료 · 동기화 꺼진 강사는 범위에", () => {
  const first = runPayCheck({ organizationId: ORG, month: MONTH, now: NOW, lessons: [lesson("done-none", { status: "completed" })] });
  const key = first.items[0].key;
  const acks = [{ key, signature: first.items[0].signature, reason: "옛 앱에서 처리 -- 원장 확인함", ackedBy: "owner" }];
  assert.equal(withAcks(first, acks).openBlocks, 0);
  const changed = runPayCheck({ organizationId: ORG, month: MONTH, now: NOW, lessons: [lesson("done-none", { status: "completed", clientIds: ["c1", "c2"] })] });
  assert.equal(withAcks(changed, acks).openBlocks, 1, "회원 수가 바뀌면 다시 막는다");
  assert.equal(ackDocId(MONTH, "balance_mismatch:p/1"), "2026-11__balance_mismatch:p_1");
  const broken = runPayCheck({ organizationId: ORG, month: MONTH, now: NOW, failures: [{ source: "lessons", code: "unavailable" }],
    syncedInstructorIds: new Set(["t1"]), activeInstructorIds: ["t1", "t2", "t3-old"], canonicalInstructorId: (id) => (id === "t3-old" ? "t3" : id) });
  assert.equal(broken.complete, false);
  assert.deepEqual(broken.scope.syncOffInstructorIds, ["t2", "t3"]);
});
