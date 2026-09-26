/**
 * 내 만료 회원 현황.
 *
 * 강사 화면과 대표 화면이 같은 함수를 쓴다. 갈라지면 강사는 자기 화면을 믿고
 * 대표는 자기 화면을 믿는데, 둘이 다르면 대화가 안 된다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPIRY_PERIOD,
  expiryReport,
  expiryReportMessage,
  outcomeLabel,
  periodRange,
} from "../../src/features/members/expiry-report.js";

const NOW = new Date(2026, 8, 27, 12, 0, 0);
const at = (year, month, day) => new Date(year, month, day, 10, 0, 0);

const pass = (overrides = {}) => ({
  id: "p", status: "active", remainingCount: 4,
  expiresAt: at(2027, 0, 1), instructorId: "instructor_a", createdAt: at(2026, 0, 1),
  ...overrides,
});

test("이번 달과 지난달의 경계는 센터 시계로 자른다", () => {
  /* UTC 로 자르면 한국 시각 말일 밤에 끝난 회원권이 다음 달로 넘어간다. */
  const thisMonth = periodRange(EXPIRY_PERIOD.THIS_MONTH, NOW);
  assert.equal(thisMonth.start.getTime(), new Date(2026, 8, 1).getTime());
  assert.equal(thisMonth.end.getTime(), new Date(2026, 9, 1).getTime());

  const lastMonth = periodRange(EXPIRY_PERIOD.LAST_MONTH, NOW);
  assert.equal(lastMonth.start.getTime(), new Date(2026, 7, 1).getTime());
  assert.equal(lastMonth.end.getTime(), new Date(2026, 8, 1).getTime());
});

test("전체는 기간을 주지 않는다", () => {
  assert.equal(periodRange(EXPIRY_PERIOD.ALL, NOW), undefined);
});

test("연말 경계에서 지난달은 작년 12월이다", () => {
  const range = periodRange(EXPIRY_PERIOD.LAST_MONTH, new Date(2027, 0, 5));
  assert.equal(range.start.getFullYear(), 2026);
  assert.equal(range.start.getMonth(), 11);
});

test("이번 달 만료만 센다", () => {
  const rows = [
    { clientId: "c1", name: "이번달", passes: [pass({ id: "a", expiresAt: at(2026, 8, 10) })] },
    { clientId: "c2", name: "지난달", passes: [pass({ id: "b", expiresAt: at(2026, 7, 10) })] },
  ];
  const report = expiryReport(rows, { now: NOW, period: EXPIRY_PERIOD.THIS_MONTH, instructorId: "instructor_a" });
  assert.deepEqual(report.members.map((m) => m.name), ["이번달"]);

  const last = expiryReport(rows, { now: NOW, period: EXPIRY_PERIOD.LAST_MONTH, instructorId: "instructor_a" });
  assert.deepEqual(last.members.map((m) => m.name), ["지난달"]);
});

test("전체는 두 달을 다 센다 — 회원마다 마지막 만료 하나씩", () => {
  const rows = [
    { clientId: "c1", passes: [pass({ id: "a", expiresAt: at(2026, 8, 10) })] },
    { clientId: "c2", passes: [pass({ id: "b", expiresAt: at(2026, 7, 10) })] },
  ];
  assert.equal(expiryReport(rows, { now: NOW, period: EXPIRY_PERIOD.ALL, instructorId: "instructor_a" }).expired, 2);
});

test("재등록률에서 아직 기다리는 건은 분모에서 빠진다", () => {
  /* 만료한 지 사흘 된 회원을 "안 돌아옴" 으로 세면 이번 달 재등록률이 늘
     낮게 나온다 -- 달이 끝나야 참값이 되는 숫자를 달 중간에 보고 판단하게
     된다. */
  const rows = [
    { clientId: "gone", passes: [pass({ id: "g", expiresAt: at(2026, 8, 1) })] },
    { clientId: "back", passes: [
      pass({ id: "b1", expiresAt: at(2026, 8, 2) }),
      pass({ id: "b2", createdAt: at(2026, 8, 10), expiresAt: at(2027, 5, 1) }),
    ] },
    { clientId: "fresh", passes: [pass({ id: "f", expiresAt: at(2026, 8, 25) })] },
  ];
  const report = expiryReport(rows, { now: NOW, period: EXPIRY_PERIOD.THIS_MONTH, instructorId: "instructor_a" });
  assert.equal(report.expired, 3);
  assert.equal(report.reenrolled, 1);
  /* **이번 달은 거의 다 기다리는 중이다.** 9월 1일 만료도 27일 기준으로는
     26일밖에 안 지났다. 이 성질을 화면이 말하지 않으면 대표는 매달 초에
     "재등록률이 떨어졌다" 고 읽는다. */
  assert.equal(report.pending, 2);
  assert.equal(report.rate, 1, "정해진 것은 하나뿐이고 그것은 돌아왔다");
  assert.match(expiryReportMessage(report), /3명 중 1명이 다시 등록했습니다 \(100%\)/);
  assert.match(expiryReportMessage(report), /2명은 아직 30일이 안 지나/);
});

test("지난달은 대부분 정해져 있다", () => {
  /* 30일이 지났으므로 돌아올 사람은 이미 돌아왔다. 이번 달과 지난달을 함께
     두는 이유가 이것이다 -- 이번 달은 진행 중이고 지난달이 참값에 가깝다. */
  const rows = [
    { clientId: "gone", passes: [pass({ id: "g", expiresAt: at(2026, 7, 5) })] },
    { clientId: "back", passes: [
      pass({ id: "b1", expiresAt: at(2026, 7, 6) }),
      pass({ id: "b2", createdAt: at(2026, 7, 20), expiresAt: at(2027, 5, 1) }),
    ] },
  ];
  const report = expiryReport(rows, { now: NOW, period: EXPIRY_PERIOD.LAST_MONTH, instructorId: "instructor_a" });
  assert.equal(report.expired, 2);
  assert.equal(report.reenrolled, 1);
  assert.equal(report.pending, 0);
  assert.equal(report.rate, 0.5);
  assert.doesNotMatch(expiryReportMessage(report), /아직 30일/);
});

test("만료가 없으면 비율을 말하지 않는다", () => {
  assert.equal(expiryReportMessage({ expired: 0 }), "만료된 회원이 없습니다.");
});

test("기다리는 건이 없으면 그 문장을 붙이지 않는다", () => {
  const message = expiryReportMessage({ expired: 2, reenrolled: 1, pending: 0, rate: 0.5 });
  assert.match(message, /2명 중 1명/);
  assert.doesNotMatch(message, /아직 30일/);
});

test("다른 강사의 회원은 세지 않는다", () => {
  const rows = [
    { clientId: "mine", passes: [pass({ id: "a", expiresAt: at(2026, 8, 10) })] },
    { clientId: "theirs", passes: [pass({ id: "b", instructorId: "instructor_b", expiresAt: at(2026, 8, 10) })] },
  ];
  assert.equal(expiryReport(rows, { now: NOW, instructorId: "instructor_a" }).expired, 1);
  assert.equal(expiryReport(rows, { now: NOW, instructorId: "instructor_b" }).expired, 1);
  // 강사를 안 주면 센터 전체다 (대표 화면).
  assert.equal(expiryReport(rows, { now: NOW }).expired, 2);
});

test("강사 화면과 대표 화면은 같은 답을 낸다", () => {
  const rows = [{ clientId: "c1", passes: [pass({ id: "a", expiresAt: at(2026, 8, 10) })] }];
  const instructorScreen = expiryReport(rows, { now: NOW, instructorId: "instructor_a" });
  const ownerRow = expiryReport(rows, { now: NOW, instructorId: "instructor_a" });
  assert.deepEqual(ownerRow, instructorScreen);
});

test("결과마다 다른 말이 붙는다", () => {
  assert.equal(outcomeLabel("returned"), "재등록");
  assert.equal(outcomeLabel("pending"), "기다리는 중");
  assert.equal(outcomeLabel("gone"), "", "안 돌아온 것은 따로 말하지 않는다");
});
