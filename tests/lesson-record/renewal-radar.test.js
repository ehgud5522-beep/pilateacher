/**
 * 재등록 레이더 (2026-11-21). 대상 · 급함 · 신호 · 담당 · 재등록률 · 기록률 → 문구 → 코드.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RADAR_SIGNAL, RATE_MIN_SAMPLE, memberSignals, radarPassLabel, radarSignalLabel, radarSummary, radarTarget,
  recordRateLabel, renewalRadar, renewalRateLabel, instructorRenewalRate,
} from "../../src/features/records/renewal-radar.js";

const NOW = Date.parse("2026-11-21T03:00:00.000Z");
const DAY = 86400000;
const ago = (days) => new Date(NOW - days * DAY).toISOString();
const ahead = (days) => new Date(NOW + days * DAY).toISOString();
const pass = (id, clientId, extra = {}) => ({
  id, clientId, status: "active", remainingCount: 10, totalSessions: 30, createdAt: ago(200), expiresAt: ahead(120), instructorId: "a", ...extra,
});
const deduct = (passId, clientId, days, extra = {}) => ({ id: `${passId}_${days}`, type: "deduct", passId, clientId, occurredAt: ago(days), ...extra });

test("대상: 잔여 3회 이하 · 만료 14일 안 · 다 못 씀 / 급함: 잔여 1 이하 · 만료 7일 안", () => {
  assert.deepEqual(radarTarget(null), { target: false, urgent: false });
  assert.deepEqual(radarTarget({ remaining: 3, daysToExpiry: 100, alert: "normal" }), { target: true, urgent: false });
  assert.deepEqual(radarTarget({ remaining: 4, daysToExpiry: 100, alert: "normal" }), { target: false, urgent: false });
  assert.deepEqual(radarTarget({ remaining: 20, daysToExpiry: 14, alert: "expiry_soon" }), { target: true, urgent: false });
  assert.deepEqual(radarTarget({ remaining: 20, daysToExpiry: 7, alert: "expiry_soon" }), { target: true, urgent: true });
  assert.deepEqual(radarTarget({ remaining: 1, daysToExpiry: null, alert: "low_remaining" }), { target: true, urgent: true });
  assert.deepEqual(radarTarget({ remaining: 20, daysToExpiry: 40, alert: "cannot_use_up" }), { target: true, urgent: false });
});

test("신호: 출석 줄어듦 · 출석 없음 · 비포애프터 · 보낸 말", () => {
  const codes = (input) => memberSignals({ notes: [], share: null, shareKnown: false, now: NOW, ...input }).map((item) => item.code);
  /* 그 전 4주 4회 → 최근 4주 1회 = 줄어듦. 마지막 출석 3일 전이라 출석 없음은 아님 */
  const drop = [3, 30, 37, 44, 51].map((days) => NOW - days * DAY);
  assert.deepEqual(codes({ attendance: drop, notes: [NOW - 2 * DAY] }), [RADAR_SIGNAL.PACE_DROP]);
  /* 그 전 4주 1회는 비교하지 않는다 */
  assert.deepEqual(codes({ attendance: [NOW - 3 * DAY, NOW - 40 * DAY], notes: [NOW - DAY] }), []);
  /* 20일째 안 옴 */
  assert.deepEqual(codes({ attendance: [NOW - 20 * DAY, NOW - 25 * DAY], notes: [NOW - 20 * DAY] }), [RADAR_SIGNAL.ABSENT]);
  assert.deepEqual(codes({ attendance: [] }), [RADAR_SIGNAL.NEVER_ATTENDED]);
  /* 최근 출석했는데 보낸 말 없음 */
  assert.deepEqual(codes({ attendance: [NOW - 2 * DAY, NOW - 9 * DAY] }), [RADAR_SIGNAL.NO_MEMBER_NOTE]);
  /* 비포애프터: 앱 연결된 회원만, 못 읽었으면 신호 없음 */
  const base = { attendance: [NOW - 2 * DAY], notes: [NOW - DAY] };
  assert.deepEqual(codes({ ...base, shareKnown: true, share: { linked: true, lastSentAt: 0 } }), [RADAR_SIGNAL.BEFORE_AFTER_NEVER]);
  assert.deepEqual(codes({ ...base, shareKnown: true, share: { linked: true, lastSentAt: NOW - 70 * DAY } }), [RADAR_SIGNAL.BEFORE_AFTER_STALE]);
  assert.deepEqual(codes({ ...base, shareKnown: true, share: { linked: true, lastSentAt: NOW - 10 * DAY } }), []);
  assert.deepEqual(codes({ ...base, shareKnown: true, share: { linked: false, lastSentAt: 0 } }), []);
  assert.deepEqual(codes({ ...base, shareKnown: false, share: { linked: true, lastSentAt: 0 } }), []);
});

test("신호 문구에는 숫자가 들어가고 모르는 코드는 코드 그대로", () => {
  assert.equal(radarSignalLabel({ code: RADAR_SIGNAL.PACE_DROP, before: 4, recent: 1 }), "출석 줄어듦 (4주 4회 → 1회)");
  assert.equal(radarSignalLabel({ code: RADAR_SIGNAL.ABSENT, days: 20 }), "20일째 출석 없음");
  assert.equal(radarSignalLabel({ code: "mystery" }), "mystery");
});

test("회원권 문구", () => {
  assert.equal(radarPassLabel({ remaining: 2, daysToExpiry: 5, alert: "expiry_soon", unusable: 0 }), "잔여 2회 · 만료 5일 전");
  assert.equal(radarPassLabel({ remaining: 9, daysToExpiry: 0, alert: "cannot_use_up", unusable: 4 }), "잔여 9회 · 오늘 만료 · 이 속도면 4회 남김");
  assert.equal(radarPassLabel({ remaining: 3, daysToExpiry: null, alert: "pace_unknown", unusable: 0 }), "잔여 3회");
});

test("재등록률: 최근 90일 결정만 · 표본 적으면 퍼센트 대신 명수", () => {
  const rows = [
    { status: "renewed", decidedAt: ago(10) },
    { status: "lapsed", decidedAt: ago(20) },
    { status: "renewed", decidedAt: ago(200) },
    { status: "pending" },
  ];
  const rate = instructorRenewalRate(rows, NOW);
  assert.deepEqual(rate, { renewed: 1, decided: 2, pending: 1, rate: 0.5 });
  assert.deepEqual(renewalRateLabel(rate), { label: "재등록 2명 중 1명", code: "renewal_rate_small" });
  const many = Array.from({ length: RATE_MIN_SAMPLE }, (_, index) => ({ status: index < 4 ? "renewed" : "lapsed", decidedAt: ago(5) }));
  assert.deepEqual(renewalRateLabel(instructorRenewalRate(many, NOW)), { label: "재등록 80% (5명 중 4명)", code: "renewal_rate" });
  assert.deepEqual(renewalRateLabel(instructorRenewalRate([], NOW)), { label: "재등록 결과 아직 없음", code: "renewal_rate_none" });
});

test("기록률 문구: 보고 없음 · 수업 없음 · 비율", () => {
  assert.equal(recordRateLabel(null).code, "no_device_report");
  assert.equal(recordRateLabel({ attended: 0, recorded: 0 }).code, "no_attended_lessons");
  assert.deepEqual(recordRateLabel({ attended: 20, recorded: 18 }), { label: "기록 90% (18/20)", code: "record_rate", rate: 0.9 });
});

test("레이더: 대상만 · 담당은 마지막 회원권 강사 · 계정 바꾼 강사 합침 · 보관 · 심사용 제외 · 급한 순", () => {
  const clients = [
    { id: "c1", name: "가회원", userId: "u1", instructorIds: ["a"] },
    { id: "c2", name: "나회원", userId: "", instructorIds: ["a"] },
    { id: "c3", name: "여유", userId: "u3", instructorIds: ["a"] },
    { id: "c4", name: "보관", archived: true, instructorIds: ["a"] },
    { id: "c5", name: "옛계정", instructorIds: ["b-old"] },
    { id: "demo", name: "심사", instructorIds: ["a"] },
    { id: "c6", name: "짝", instructorIds: ["a"] },
  ];
  const passes = [
    pass("p1", "c1", { remainingCount: 1 }),
    pass("p2", "c2", { remainingCount: 8, expiresAt: ahead(10), instructorId: "a" }),
    pass("p3", "c3"),
    pass("p4", "c4", { remainingCount: 1 }),
    pass("p5", "c5", { remainingCount: 2, instructorId: "b-old" }),
    pass("p6", "demo", { remainingCount: 1 }),
    pass("p7", "c2", { remainingCount: 2, clientIds: ["c2", "c6"], expiresAt: ahead(10), instructorId: "a" }),
  ];
  const ledger = [deduct("p1", "c1", 2), deduct("p2", "c2", 3), deduct("p5", "c5", 4)];
  const rows = renewalRadar({
    clients, passes, ledger, lessonNotes: [{ clientId: "c1", memberNote: "좋았어요", createdAt: ago(1) }],
    shares: [], activities: [{ userId: "b", month: "2026-11", attended: 10, recorded: 9, checkedAt: ago(1) }], activityMonth: "2026-11",
    candidates: [{ instructorId: "b-old", status: "renewed", decidedAt: ago(3) }],
    instructors: [{ userId: "a", displayName: "에이" }, { userId: "b", displayName: "비" }],
    canonicalInstructorId: (id) => (id === "b-old" ? "b" : String(id ?? "")),
    excludedClientIds: new Set(["demo"]),
    now: NOW,
  });
  assert.deepEqual(rows.map((row) => row.instructorId), ["a", "b"]);
  const a = rows[0];
  /* 같은 신호 수 · 같은 만료면 잔여가 적은 짝(c6, 2회)이 나회원(c2, 10회)보다 위 */
  assert.deepEqual(a.members.map((item) => item.clientId), ["c1", "c6", "c2"]);
  assert.equal(a.name, "에이");
  assert.equal(a.urgent, 1);
  /* 가회원: 앱 연결 · 비포애프터 받은 적 없음 / 짝: 출석 없음 / 나회원: 앱 미연결이라 비포애프터 신호 없음 · 보낸 말 없음 */
  assert.deepEqual(a.members[0].signals.map((item) => item.code), [RADAR_SIGNAL.BEFORE_AFTER_NEVER]);
  assert.deepEqual(a.members[1].signals.map((item) => item.code), [RADAR_SIGNAL.NEVER_ATTENDED]);
  assert.deepEqual(a.members[2].signals.map((item) => item.code), [RADAR_SIGNAL.NO_MEMBER_NOTE]);
  assert.equal(a.members[1].duet, true);
  assert.equal(a.members[0].duet, false);
  assert.equal(a.record.code, "no_device_report");
  const b = rows[1];
  assert.deepEqual(b.members.map((item) => item.clientId), ["c5"]);
  assert.equal(b.record.code, "record_rate");
  assert.deepEqual(b.renewal, { renewed: 1, decided: 1, pending: 0, rate: 1 });
  assert.deepEqual(radarSummary(rows), { total: 4, urgent: 1, atRisk: 4 });
});

test("레이더: 되돌린 차감은 출석으로 안 셈 · 후보를 못 읽으면 재등록률 칸은 null", () => {
  const rows = renewalRadar({
    clients: [{ id: "c1", name: "가", instructorIds: ["a"] }],
    passes: [pass("p1", "c1", { remainingCount: 2 })],
    ledger: [deduct("p1", "c1", 3), { id: "fix", type: "correction", passId: "p1", correctsEntryId: "p1_3", occurredAt: ago(2) }],
    lessonNotes: [], shares: null, activities: [], candidates: null, now: NOW,
  });
  assert.equal(rows[0].renewal, null);
  assert.deepEqual(rows[0].members[0].signals.map((item) => item.code), [RADAR_SIGNAL.NEVER_ATTENDED]);
});

test("화면 배선: 메뉴 항목 · 대표 · 총괄 조건 · 코드 표시", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  /* 실패 때 App.jsx 전체를 찍지 않게 includes 로 본다 */
  for (const needle of ['key: "renewal-radar", title: "재등록 레이더"', 'view === "renewal-radar" && showAudit', "function RenewalRadarScreen(", "data-radar-signal={signal.code}"]) {
    assert.ok(app.includes(needle), `App.jsx 에 ${needle} 없음`);
  }
});
