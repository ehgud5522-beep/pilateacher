/**
 * 정산 점검 (2026-11-22, 외부 검토 2회 반영): 지난 수업 미처리 · 완료인데 차감 없음 · 듀엣 차감 부족 · 남은 횟수 불일치 · 검산 불가 · 중복 차감,
 * 차단/확인 구분, 차단은 전체 기준(자르기 전), 확인함은 판단에 쓴 값이 모두 같을 때만, 못 읽으면 점검 미완료, 서버 일정 없는 강사는 범위에, 자료 지문.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECK_KIND, CHECK_SEVERITY, PAY_CHECK_WARN_LIMIT, ackDocId, signatureOf, kstTodayStart, runPayCheck, sameFingerprint, sourceFingerprint, storedCheck, withAcks,
} from "../../functions/shared/pay-check.mjs";

const ORG = "o1";
const MONTH = "2026-11";
const NOW = new Date("2026-11-20T01:00:00Z"); // 한국 11월 20일 10시
const at = (iso) => new Date(iso);
const lesson = (id, extra = {}) => ({ id, lessonId: id, instructorId: "t1", locationId: "bansong", clientIds: ["c1"], status: "scheduled", startsAt: at("2026-11-18T01:00:00Z"), ...extra });
const deduct = (id, extra = {}) => ({ id: `e-${id}`, organizationId: ORG, type: "deduct", delta: -1, unitPrice: 30000, instructorId: "t1", clientId: "c1", passId: "p1", lessonId: id, locationId: "bansong", occurredAt: at("2026-11-18T01:00:00Z"), ...extra });
const run = (input) => runPayCheck({ organizationId: ORG, month: MONTH, now: NOW, ...input });

test("지난 수업 미처리는 어제까지만 · 회원 없는 개인 일정 · 취소 · 다른 달은 뺀다", () => {
  assert.equal(kstTodayStart(NOW).toISOString(), "2026-11-19T15:00:00.000Z");
  const check = run({ lessons: [
    lesson("past"), lesson("today", { startsAt: at("2026-11-20T00:30:00Z") }), lesson("personal", { clientIds: [] }),
    lesson("cancelled", { status: "cancelled" }), lesson("october", { startsAt: at("2026-10-30T01:00:00Z") }),
  ] });
  assert.deepEqual(check.items.map((item) => [item.kind, item.lessonId]), [[CHECK_KIND.UNSETTLED_PAST, "past"]]);
  assert.equal(check.complete, true);
});

test("완료인데 차감 없음은 차단 · 듀엣 차감 부족 · 중복 차감은 확인", () => {
  const check = withAcks(run({
    lessons: [lesson("done-ok", { status: "completed" }), lesson("done-none", { status: "completed" }), lesson("duet", { status: "completed", clientIds: ["c1", "c2"] })],
    monthLedger: [deduct("done-ok"), deduct("duet"), deduct("other-device")],
  }));
  assert.deepEqual(check.counts, { block: 1, warn: 2, byKind: { completed_no_deduct: 1, deduct_short: 1, duplicate_deduct: 1 } });
  assert.equal(check.items[0].severity, CHECK_SEVERITY.BLOCK);
  assert.deepEqual(check.items.find((item) => item.kind === CHECK_KIND.DUPLICATE_DEDUCT).detail.lessonIds, ["done-ok", "duet", "other-device"]);
});

test("남은 횟수: 불일치 · 검산 불가(원장 없음 · 숫자 못 읽음)를 정상으로 치지 않는다 -- 이 달에 쓴 회원권이면 차단", () => {
  const ledger = (passId, month, delta, id) => ({ id, passId, type: delta > 0 ? "issue" : "deduct", delta, occurredAt: at(`${month}-05T01:00:00Z`) });
  const check = run({
    passes: [
      { id: "used", clientId: "c1", instructorId: "t1", remainingCount: 9 },
      { id: "old", clientId: "c2", instructorId: "t2", remainingCount: 5 },
      { id: "no-ledger", clientId: "c3", instructorId: "t1", remainingCount: 10 },
      { id: "broken", clientId: "c4", instructorId: "t1", remainingCount: "열" },
      { id: "fine", remainingCount: 9 },
    ],
    passLedger: [
      ledger("used", "2026-10", 10, "u1"), ledger("used", "2026-11", -1, "u2"), ledger("used", "2026-11", -1, "u3"),
      ledger("old", "2026-09", 10, "o1"), ledger("old", "2026-09", -1, "o2"),
      ledger("broken", "2026-11", 10, "b1"), ledger("broken", "2026-11", -1, "b2"),
      ledger("fine", "2026-11", 10, "f1"), ledger("fine", "2026-11", -1, "f2"),
    ],
  });
  assert.deepEqual(check.items.map((item) => [item.passId, item.kind, item.severity]), [
    ["used", CHECK_KIND.BALANCE_MISMATCH, "block"],
    ["broken", CHECK_KIND.BALANCE_UNKNOWN, "block"],
    ["old", CHECK_KIND.BALANCE_MISMATCH, "warn"],
  ]);
  /* 원장이 하나도 없는 옛 회원권은 한 줄씩 보이지 않고 개수만 (이 달에 쓴 적이 없어 급여와 상관없다). */
  assert.equal(check.scope.noLedgerPasses, 1);
});

/* 2026-11-22 실제 점검: 원장 읽기가 색인 없음(코드 9)으로 실패해 회원권 1,340개가 전부 "검산 불가" 1,853건으로 쏟아졌다. */
test("회원권 원장을 못 읽으면 남은 횟수 검산을 건너뛴다 -- 못 읽은 원장을 원장 없음으로 치지 않는다", () => {
  const check = run({ failures: [{ source: "ledger_all", code: "9" }],
    passes: [{ id: "a", clientId: "c1", remainingCount: 10 }, { id: "b", clientId: "c2", remainingCount: 3 }], passLedger: [] });
  assert.equal(check.complete, false);
  assert.equal(check.items.length, 0, "검산 불가가 쏟아지지 않는다");
  assert.equal(check.scope.balanceSkipped, true);
  assert.equal(check.scope.noLedgerPasses, 0);
});

test("차단은 자르기 전 전체로 센다 -- 차단 301건 중 앞 300건만 확인해도 1건이 남아 막는다, 문서엔 차단을 전부 담는다", () => {
  const lessons = Array.from({ length: 301 }, (_, index) => lesson(`L${String(index).padStart(3, "0")}`, { status: "completed" }));
  const warnLessons = Array.from({ length: PAY_CHECK_WARN_LIMIT + 5 }, (_, index) => lesson(`W${index}`));
  const full = run({ lessons: [...lessons, ...warnLessons] });
  const blocks = full.items.filter((item) => item.severity === CHECK_SEVERITY.BLOCK);
  const acks = blocks.slice(0, 300).map((item) => ({ key: item.key, signature: item.signature, reason: "확인" }));
  assert.equal(withAcks(full, acks).openBlocks, 1);
  const stored = storedCheck(full, acks);
  assert.equal(stored.items.filter((item) => item.severity === CHECK_SEVERITY.BLOCK).length, 301, "차단은 전부 담긴다");
  assert.equal(stored.hiddenWarns, 5);
  assert.equal(withAcks(stored, acks).openBlocks, 1, "문서로 다시 세도 1건이 남는다");
  assert.equal(stored.countsTotal.warn, PAY_CHECK_WARN_LIMIT + 5);
  assert.equal(stored.complete, true);
});

test("확인함은 판단에 쓴 값이 모두 같을 때만 -- 회원을 A 에서 B 로 바꾸면(인원 같아도) 다시 막는다", () => {
  const before = run({ lessons: [lesson("done-none", { status: "completed", clientIds: ["A"] })] });
  const acks = [{ key: before.items[0].key, signature: before.items[0].signature, reason: "옛 앱에서 처리" }];
  assert.equal(withAcks(before, acks).openBlocks, 0);
  assert.equal(withAcks(run({ lessons: [lesson("done-none", { status: "completed", clientIds: ["B"] })] }), acks).openBlocks, 1, "회원이 바뀜");
  assert.equal(withAcks(run({ lessons: [lesson("done-none", { status: "completed", clientIds: ["A"], instructorId: "t9" })] }), acks).openBlocks, 1, "강사가 바뀜");
  assert.equal(ackDocId(MONTH, "balance_mismatch:p/1"), "2026-11__balance_mismatch:p_1");
});

test("못 읽으면 점검 미완료 · 명부에 있는데 이 달 서버 일정이 하나도 없는 강사는 범위에 (차감 기록이 없어도)", () => {
  const check = run({ lessons: [lesson("past")], failures: [{ source: "lessons", code: "unavailable" }],
    rosterInstructorIds: ["t1", "t2", "t3-old"], canonicalInstructorId: (id) => (id === "t3-old" ? "t3" : id) });
  assert.equal(check.complete, false);
  assert.deepEqual(check.scope.noScheduleInstructorIds, ["t2", "t3"]);
});

test("자료 지문: 차감 · 보정이 하나 붙거나 수업 상태 · 그룹 급여가 바뀌면 달라진다", () => {
  const base = { monthLedger: [deduct("a")], lessons: [lesson("a", { status: "completed" })], groupRows: [{ locationId: "b", instructorId: "t1", fullCount: 2, fullRate: 20000, emptyCount: 0 }] };
  const same = sourceFingerprint(base);
  assert.equal(sameFingerprint(same, sourceFingerprint({ ...base, monthLedger: [...base.monthLedger] })), true);
  assert.equal(sameFingerprint(same, sourceFingerprint({ ...base, monthLedger: [...base.monthLedger, deduct("b")] })), false);
  assert.equal(sameFingerprint(same, sourceFingerprint({ ...base, lessons: [lesson("a", { status: "scheduled" })] })), false);
  assert.equal(sameFingerprint(same, sourceFingerprint({ ...base, groupRows: [{ ...base.groupRows[0], fullCount: 3 }] })), false);
});

/* 2026-11-22 외부 검토 3회차: 확정 순간 검증에 회원권 잔여 · 전체 원장 · 수업 강사/시간/정산 회원권 · 확인함 기준값 길이 */
test("자료 지문은 회원권 잔여 · 회원권 원장 · 수업 강사 · 시각 · 정산 회원권이 바뀌어도 달라진다", () => {
  const base = { lessons: [lesson("a", { status: "completed", settledPassId: "p1" })], passes: [{ id: "p1", clientId: "c1", instructorId: "t1", remainingCount: 8 }],
    passLedger: [{ id: "i1", passId: "p1", type: "issue", delta: 10 }, { id: "d1", passId: "p1", type: "deduct", delta: -1 }, { id: "d2", passId: "p1", type: "deduct", delta: -1 }] };
  const same = sourceFingerprint(base);
  assert.equal(sameFingerprint(same, sourceFingerprint({ ...base, passes: [{ ...base.passes[0], remainingCount: 7 }] })), false, "잔여 8 → 7");
  assert.equal(sameFingerprint(same, sourceFingerprint({ ...base, passLedger: [...base.passLedger, { id: "d3", passId: "p1", type: "deduct", delta: -1 }] })), false, "다른 달 원장도");
  assert.equal(sameFingerprint(same, sourceFingerprint({ ...base, lessons: [lesson("a", { status: "completed", settledPassId: "p1", instructorId: "t9" })] })), false, "강사");
  assert.equal(sameFingerprint(same, sourceFingerprint({ ...base, lessons: [lesson("a", { status: "completed", settledPassId: "p1", startsAt: at("2026-11-18T02:00:00Z") })] })), false, "시각");
  assert.equal(sameFingerprint(same, sourceFingerprint({ ...base, lessons: [lesson("a", { status: "completed", settledPassId: "p2" })] })), false, "정산 회원권");
});

test("확인함 기준값은 기록이 많아도 고정 길이 -- 원장 110건(20자 id)이어도 규칙 한도 안, 한 건만 바뀌어도 달라진다", () => {
  const entries = Array.from({ length: 110 }, (_, index) => ({ id: `entry-${String(index).padStart(14, "0")}`, passId: "big", type: index ? "deduct" : "issue", delta: index ? -1 : 200, occurredAt: at("2026-11-05T01:00:00Z") }));
  const check = run({ passes: [{ id: "big", clientId: "c1", instructorId: "t1", remainingCount: 100 }], passLedger: entries });
  const signature = check.items[0].signature;
  assert.ok(signature.length <= 30, `${signature.length}자`);
  const changed = run({ passes: [{ id: "big", clientId: "c1", instructorId: "t1", remainingCount: 100 }], passLedger: [...entries.slice(0, 109), { ...entries[109], id: "entry-other-00000000" }] });
  assert.notEqual(changed.items[0].signature, signature);
  assert.equal(signatureOf("a").length, signatureOf("a".repeat(5000)).length - 2, "길이 표시만 다르고 나머지는 고정");
});

/* 2026-11-22 대표: "차감이 회원 수보다 적음" 119건이 대부분 회원권 하나를 같이 쓰는 듀엣이었다 -- 정상으로 알아본다. */
test("듀엣: 회원권 하나를 둘이 같이 쓰면 차감 1건이 정상 · 각자 회원권인데 한쪽만 빠지면 남는다 · 회원권을 못 읽으면 예전처럼 확인", () => {
  const duet = (id) => lesson(id, { status: "completed", clientIds: ["c1", "c2"] });
  const passes = [{ id: "shared", clientId: "c1", clientIds: ["c1", "c2"], remainingCount: 9 }, { id: "own1", clientId: "c1", remainingCount: 9 }, { id: "own2", clientId: "c2", remainingCount: 9 }];
  const check = run({
    lessons: [duet("shared-ok"), duet("own-missing"), duet("own-ok")],
    monthLedger: [
      deduct("shared-ok", { passId: "shared", occurredAt: at("2026-11-11T01:00:00Z") }),
      deduct("own-missing", { passId: "own1", occurredAt: at("2026-11-12T01:00:00Z") }),
      deduct("own-ok", { id: "e-own-ok-1", passId: "own1", occurredAt: at("2026-11-13T01:00:00Z") }),
      deduct("own-ok", { id: "e-own-ok-2", passId: "own2", clientId: "c2", occurredAt: at("2026-11-13T01:00:00Z") }),
    ],
    passes,
  });
  assert.deepEqual(check.items.filter((item) => item.kind === CHECK_KIND.DEDUCT_SHORT).map((item) => item.lessonId), ["own-missing"]);
  const unknownPasses = run({ lessons: [duet("shared-ok")], monthLedger: [deduct("shared-ok", { passId: "shared" })], failures: [{ source: "passes", code: "unavailable" }] });
  assert.deepEqual(unknownPasses.items.map((item) => item.kind), [CHECK_KIND.DEDUCT_SHORT], "회원권을 못 읽으면 덮는지 모른다");
});
