import assert from "node:assert/strict";
import test from "node:test";
import { PAY_STATUS, myPayModel, myPayWeeks, shiftMonth } from "../../src/features/schedule/my-pay.js";
import { summarizeInstructorPay } from "../../src/data/repositories/payroll-repository.js";

/* 내 급여 화면 (2026-11-08). 계산은 바꾸지 않는다 -- 묶음의 합이 원장 합계와 같은지, 확정 · 대기가 겹치지
   않는지, 정정 상세가 원래 수업을 가리키는지 고정한다. */

const at = (d, h = 10) => new Date(2026, 9, d, h);
const deduct = (id, d, category, unitPrice, extra = {}) => ({ id, type: "deduct", delta: -1, unitPrice, category, occurredAt: at(d), clientId: `c-${id}`, passId: `p-${id}`, ...extra });
const correction = (id, d, corrects, unitPrice, reason, extra = {}) => ({ id, type: "correction", delta: 1, unitPrice, category: "pt_1_1_repurchase_normal", occurredAt: at(d, 18), correctsEntryId: corrects, reason, clientId: "c-a", passId: "p-a", ...extra });

const entries = [
  deduct("a", 6, "pt_1_1_repurchase_normal", 25000),
  deduct("b", 13, "pt_1_1_repurchase_normal", 25000),
  deduct("c", 27, "pt_1_1_repurchase_normal", 25000),
  deduct("d", 31, "pt_1_1_new", 25000),
  correction("x", 20, "a", 25000, "출석 잘못 누름"),
  correction("y", 28, "old-sep", 25000, "지난달 중복 확정"),
];
const pay = summarizeInstructorPay(entries);
const pending = { rows: [{ id: "L9|m1", lessonId: "L9", date: "2026-10-30", start: "19:00", memberId: "m1", unitPrice: 25000, care: false, isDuet: false }] };
const names = { "c-a": "김하나", "c-b": "박둘", "c-c": "이셋", "c-d": "최넷" };
const model = myPayModel({ pay, pending, clientNameOf: (id) => names[id] || "", memberNameOf: () => "정다섯",
  originals: new Map([["old-sep", { occurredAt: new Date(2026, 8, 29, 11) }]]) });

test("맨 위 세 숫자: 예상 = 확정 + 대기, 확정은 원장 합계 그대로", () => {
  assert.equal(model.headline.confirmed, 50000);
  assert.equal(model.headline.pending, 25000);
  assert.equal(model.headline.expected, 75000);
  assert.equal(model.headline.pendingLessons, 1);
  assert.equal(model.check.rows, model.check.ledger, "줄의 합 = 원장 합계");
});

test("단가별 요약은 (구분 · 단가) 로, 정정은 따로 — 합치면 확정 수업료", () => {
  assert.deepEqual(model.unitRows.map((row) => [row.label, row.sessions, row.amount]), [["1:1 재등록(정상)", 3, 75000], ["1:1 신규", 1, 25000]]);
  assert.equal(model.correctionTotal, -50000);
  assert.equal(model.unitRows.reduce((sum, row) => sum + row.amount, 0) + model.correctionTotal, model.headline.confirmed);
  assert.deepEqual(model.unitRows[0].rows.map((row) => row.title).sort(), ["김하나", "박둘", "이셋"], "누르면 어떤 수업인지");
});

test("수업 정정 내역: 원래 수업 날짜 · 회원 · 원래 금액 · 정정 금액 · 사유 · 처리 날짜", () => {
  const [prior, same] = model.corrections;
  assert.equal(same.title, "김하나");
  assert.equal(same.reason, "출석 잘못 누름");
  assert.equal(same.unitPrice, 25000);
  assert.equal(same.amount, -25000);
  assert.equal(same.lessonAt.getDate(), 6, "원래 수업은 10월 6일");
  assert.equal(same.at.getDate(), 20, "처리는 10월 20일");
  assert.equal(same.priorMonth, false);
  assert.equal(prior.priorMonth, true, "지난달 수업의 정정");
  assert.equal(prior.lessonAt.getMonth(), 8, "원래 수업은 9월");
});

test("확정 · 대기는 겹치지 않는다 — 줄 id 가 하나씩, 상태별 합이 각각의 숫자", () => {
  const ids = model.rows.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
  const sum = (status) => model.rows.filter((row) => row.status === status).reduce((s, row) => s + row.amount, 0);
  assert.equal(sum(PAY_STATUS.CONFIRMED) + sum(PAY_STATUS.CORRECTION), model.headline.confirmed);
  assert.equal(sum(PAY_STATUS.PENDING), model.headline.pending);
});

test("주 묶음: 최신 주가 위, 주 합계는 보이는 줄의 순액, 주들의 합 = 월 합계, 필터", () => {
  const weeks = myPayWeeks(model.rows);
  assert.equal(weeks[0].label, "10월 26일 ~ 11월 1일");
  assert.equal(weeks.reduce((sum, week) => sum + week.net, 0), model.headline.expected);
  const lastWeek = weeks[0];
  assert.equal(lastWeek.net, 25000 + 25000 + 25000 - 25000, "27 · 30(대기) · 31 · 28(정정)");
  const onlyCorrections = myPayWeeks(model.rows, "correction");
  assert.equal(onlyCorrections.reduce((sum, week) => sum + week.net, 0), -50000);
  assert.ok(myPayWeeks(model.rows, "pending").every((week) => week.rows.every((row) => row.status === "pending")));
});

test("달 이동", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});
