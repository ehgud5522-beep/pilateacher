"use strict";

/* 설계 문서 4단계 · 재등록 알림 (규칙 계산). 속도 · 소진 · 알림 · 문구 · 재등록률. */
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../shared/renewal-forecast.mjs");
const DAY = 86400000;
const NOW = Date.parse("2026-11-16T03:00:00Z"); // 한국 12시
const daysAgo = (n) => new Date(NOW - n * DAY);
const daysLater = (n) => new Date(NOW + n * DAY);
const pass = (id, extra = {}) => ({ id, clientId: "c1", clientIds: ["c1"], status: "active", totalSessions: 20, serviceSessions: 0, remainingCount: 12, createdAt: daysAgo(60), expiresAt: daysLater(90), instructorId: "t1", ...extra });
const deducts = (passId, days) => days.map((n, i) => ({ id: `L${passId}${i}_deduct`, passId, type: "deduct", delta: -1, occurredAt: daysAgo(n) }));

test("속도: 최근 4주 차감 ÷ 4, 되돌린 차감은 뺀다", async () => {
  const { weeklyPace } = await load();
  const entries = [...deducts("p1", [1, 4, 8, 11, 15, 18, 22, 25, 40]), { id: "x", passId: "p1", type: "correction", correctsEntryId: "Lp10_deduct", occurredAt: daysAgo(1) }];
  const { pace, deductions } = weeklyPace({ passes: [pass("p1")], entries, now: NOW });
  assert.equal(deductions, 7, "28일 밖(40일 전) · 되돌린 것 빼고 7");
  assert.equal(pace, 7 / 4);
});

test("새 회원권은 발급일부터, 차감 2번 미만 · 7일 미만이면 속도 모름", async () => {
  const { weeklyPace } = await load();
  const fresh = pass("p1", { createdAt: daysAgo(14) });
  assert.equal(weeklyPace({ passes: [fresh], entries: deducts("p1", [2, 9]), now: NOW }).pace, 1);
  assert.equal(weeklyPace({ passes: [fresh], entries: deducts("p1", [2]), now: NOW }).pace, null);
  assert.equal(weeklyPace({ passes: [pass("p1", { createdAt: daysAgo(5) })], entries: deducts("p1", [1, 3]), now: NOW }).pace, null);
});

test("홀딩 중간: 쉬는 기간은 속도에서 뺀다", async () => {
  const { weeklyPace } = await load();
  const held = pass("p1", { holdFrom: daysAgo(14), holdUntil: daysAgo(0) });
  const { pace, days } = weeklyPace({ passes: [held], entries: deducts("p1", [16, 20, 24, 27]), now: NOW });
  assert.equal(days, 14);
  assert.equal(pace, 2);
});

test("듀엣 공유 회원권: 두 사람 차감을 함께 센다 (원장 한 장)", async () => {
  const { renewalForecast } = await load();
  const duet = pass("p1", { clientIds: ["c1", "c2"], remainingCount: 8 });
  const entries = deducts("p1", [1, 2, 8, 9, 15, 16, 22, 23]);
  assert.equal(renewalForecast({ clientId: "c2", passes: [duet], entries, now: NOW }).pace, 2);
});

test("회원권 여러 장: 발급 순서대로 쓰고, 앞 장 만료 전에 못 쓰는 회차가 있으면 다 못 씀", async () => {
  const { renewalForecast, RENEWAL_ALERT, renewalLine } = await load();
  const first = pass("p1", { remainingCount: 10, expiresAt: daysLater(21), createdAt: daysAgo(60) });
  const second = pass("p2", { remainingCount: 10, totalSessions: 10, expiresAt: daysLater(200), createdAt: daysAgo(30) });
  const entries = deducts("p1", [1, 8, 15, 22]); // 주 1회
  const forecast = renewalForecast({ clientId: "c1", passes: [second, first], entries, now: NOW });
  assert.equal(forecast.remaining, 20);
  assert.equal(forecast.alert, RENEWAL_ALERT.CANNOT_USE_UP);
  assert.equal(forecast.unusable, 7, "3주에 3회만 씀 -> 7회 남음");
  assert.match(renewalLine(forecast, NOW), /^잔여 20회 · 만료까지 약 6달 반 · 이 속도면 약 7회 남음$/);
});

test("서비스 회차도 잔여에 포함, 30% 이하면 재등록 상담 시기", async () => {
  const { renewalForecast, RENEWAL_ALERT, renewalLine } = await load();
  const low = pass("p1", { totalSessions: 18, serviceSessions: 2, remainingCount: 6, expiresAt: daysLater(120) });
  const forecast = renewalForecast({ clientId: "c1", passes: [low], entries: deducts("p1", [1, 4, 8, 11, 15, 18, 22, 25]), now: NOW });
  assert.equal(forecast.alert, RENEWAL_ALERT.LOW_REMAINING);
  assert.equal(renewalLine(forecast, NOW), "잔여 6회 (30%) · 약 3주 뒤 소진 · 재등록 상담 시기");
});

test("만료 30 · 14 · 7일 전 알림, 만료일 없으면 만료 알림 없음", async () => {
  const { renewalForecast, RENEWAL_ALERT, renewalLine } = await load();
  const soon = pass("p1", { remainingCount: 4, expiresAt: daysLater(14) });
  const forecast = renewalForecast({ clientId: "c1", passes: [soon], entries: deducts("p1", [1, 4, 8, 11, 15, 18, 22, 25]), now: NOW });
  assert.equal(forecast.alert, RENEWAL_ALERT.EXPIRY_SOON);
  assert.equal(forecast.expiryThreshold, 14);
  assert.equal(renewalLine(forecast, NOW), "잔여 4회 · 만료까지 2주");
  const open = renewalForecast({ clientId: "c1", passes: [pass("p1", { expiresAt: null })], entries: deducts("p1", [1, 8, 15, 22]), now: NOW });
  assert.equal(open.daysToExpiry, null);
  assert.equal(open.alert, RENEWAL_ALERT.NORMAL);
});

test("속도 모름: 예상 없이 잔여 · 만료일만", async () => {
  const { renewalForecast, RENEWAL_ALERT, renewalLine } = await load();
  const forecast = renewalForecast({ clientId: "c1", passes: [pass("p1", { remainingCount: 18, expiresAt: new Date("2026-11-29T15:30:00Z") })], entries: [], now: NOW });
  assert.equal(forecast.alert, RENEWAL_ALERT.EXPIRY_SOON);
  const unknown = renewalForecast({ clientId: "c1", passes: [pass("p1", { remainingCount: 18, expiresAt: daysLater(90) })], entries: [], now: NOW });
  assert.equal(unknown.alert, RENEWAL_ALERT.PACE_UNKNOWN);
  assert.match(renewalLine(unknown, NOW), /^잔여 18회 · 만료 2\.14$/);
});

test("한국 시간 자정 경계: 11.29 23:30 KST 만료는 11.29 로 센다", async () => {
  const { kstDay, kstDaysBetween } = await load();
  const expiry = Date.parse("2026-11-29T14:30:00Z"); // 11.29 23:30 KST
  assert.equal(kstDay(expiry), "2026-11-29");
  assert.equal(kstDaysBetween(Date.parse("2026-11-28T15:10:00Z"), expiry), 0, "11.29 00:10 KST 에서 같은 날");
});

test("끝난 회원권 · 취소된 회원권은 예상에 넣지 않는다", async () => {
  const { renewalForecast } = await load();
  assert.equal(renewalForecast({ clientId: "c1", passes: [pass("p1", { remainingCount: 0 }), pass("p2", { status: "cancelled" }), pass("p3", { expiresAt: daysAgo(1) })], entries: [], now: NOW }), null);
});

test("재등록 후보 → 재등록 · 끊김 · 대기, 다른 강사에게 재등록해도 재등록", async () => {
  const { candidateOutcome, renewalRates, CANDIDATE_STATUS } = await load();
  const candidate = { passId: "p1", clientId: "c1", clientIds: ["c1"], enteredAt: daysAgo(20), endedAt: daysAgo(5) };
  assert.equal(candidateOutcome(candidate, [pass("p1"), pass("p9", { createdAt: daysAgo(3), instructorId: "t2" })], NOW).status, CANDIDATE_STATUS.RENEWED);
  assert.equal(candidateOutcome(candidate, [pass("p1")], NOW).status, CANDIDATE_STATUS.PENDING);
  assert.equal(candidateOutcome({ ...candidate, endedAt: daysAgo(31) }, [pass("p1")], NOW).status, CANDIDATE_STATUS.LAPSED);
  const rows = [
    { instructorId: "t1", status: "renewed", decidedAt: daysAgo(2) },
    { instructorId: "t1", status: "lapsed", decidedAt: daysAgo(3) },
    { instructorId: "t1", status: "pending" },
  ];
  const [nov] = renewalRates(rows, (row) => row.instructorId).filter((row) => row.month === "2026-11");
  assert.deepEqual({ renewed: nov.renewed, lapsed: nov.lapsed, rate: nov.rate }, { renewed: 1, lapsed: 1, rate: 0.5 });
});

/* ── 서버: 후보 줄 남기기 ── */
const { createRenewalService } = require("../src/renewal-triggers");
function fakeStore(seed) {
  const docs = new Map(Object.entries(seed));
  const t = (v) => (v instanceof Date ? v.getTime() : v);
  const match = (data, [field, op, value]) => {
    const got = data?.[field];
    if (op === "==") return got === value;
    if (op === "in") return value.includes(got);
    if (op === ">=") return t(got) >= t(value);
    if (op === "array-contains-any") return Array.isArray(got) && got.some((x) => value.includes(x));
    throw new Error(op);
  };
  const snap = (path) => ({ id: path.split("/").pop(), exists: docs.has(path), data: () => docs.get(path), ref: { set: async (v, o) => set(path, v, o) } });
  const set = (path, value, options) => docs.set(path, options?.merge ? { ...(docs.get(path) || {}), ...value } : value);
  const query = (pick) => {
    const build = (filters) => ({ where: (f, op, v) => build([...filters, [f, op, v]]), get: async () => ({ docs: [...docs.keys()].filter(pick).map(snap).filter((s) => filters.every((f) => match(s.data(), f))) }) });
    return build([]);
  };
  return {
    docs,
    doc: (path) => ({ path }),
    collection: (path) => query((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1),
    collectionGroup: (name) => query((key) => key.split("/").at(-2) === name),
    batch: () => { const ops = []; return { set: (ref, v, o) => ops.push([ref.path, v, o]), commit: async () => ops.forEach(([p, v, o]) => set(p, v, o)) }; },
  };
}
const ORG = "o1";
const seedPass = (id, extra) => [`organizations/${ORG}/passes/${id}`, pass(id, { organizationId: ORG, locationId: "L", ...extra })];
const seedEntries = (passId, days) => deducts(passId, days).map((entry) => [`organizations/${ORG}/passes/${passId}/ledger/${entry.id}`, { ...entry, organizationId: ORG }]);

test("밤 정리: 알림 구간에 든 회원권에 후보 줄 하나, 두 번 돌아도 하나", async () => {
  const store = fakeStore(Object.fromEntries([
    seedPass("p1", { remainingCount: 4, expiresAt: daysLater(14) }),
    seedPass("p2", { clientId: "c2", clientIds: ["c2"], remainingCount: 15, expiresAt: daysLater(200) }),
    ...seedEntries("p1", [1, 8, 15, 22]), ...seedEntries("p2", [1, 8, 15, 22]),
  ]));
  const service = createRenewalService({ firestore: store, now: () => new Date(NOW) });
  assert.equal((await service.sweepOrganization(ORG)).created, 1);
  assert.equal((await service.sweepOrganization(ORG)).created, 0);
  const row = store.docs.get(`organizations/${ORG}/renewalCandidates/p1`);
  assert.equal(row.status, "pending");
  assert.equal(row.alert, "cannot_use_up", "주 1회 · 2주 남음 · 4회 -> 다 못 씀");
  assert.equal(row.instructorId, "t1");
  assert.equal(store.docs.has(`organizations/${ORG}/renewalCandidates/p2`), false);
});

test("새 회원권이 나가면 대기 줄이 재등록으로", async () => {
  const store = fakeStore(Object.fromEntries([
    [`organizations/${ORG}/renewalCandidates/p1`, { passId: "p1", clientId: "c1", clientIds: ["c1"], status: "pending", enteredAt: daysAgo(5), instructorId: "t1" }],
  ]));
  const service = createRenewalService({ firestore: store, now: () => new Date(NOW) });
  assert.equal(await service.onPassCreated(ORG, pass("p9", { createdAt: new Date(NOW), instructorId: "t2" })), 1);
  const row = store.docs.get(`organizations/${ORG}/renewalCandidates/p1`);
  assert.equal(row.status, "renewed");
  assert.equal(row.renewedInstructorId, "t2");
});

test("다시 채우기: 지난 회원권을 만료 회원 화면과 같은 기준으로", async () => {
  const store = fakeStore(Object.fromEntries([
    seedPass("old1", { remainingCount: 0, createdAt: daysAgo(120), expiresAt: daysLater(30) }),
    ...seedEntries("old1", [60]),
    seedPass("new1", { createdAt: daysAgo(50) }),
    seedPass("old2", { clientId: "c3", clientIds: ["c3"], remainingCount: 3, createdAt: daysAgo(150), expiresAt: daysAgo(40) }),
  ]));
  const service = createRenewalService({ firestore: store, now: () => new Date(NOW) });
  const result = await service.backfill(ORG, { months: 6 });
  assert.deepEqual(result.counts, { renewed: 1, lapsed: 1 });
  assert.equal(store.docs.get(`organizations/${ORG}/renewalCandidates/old1`).renewedPassId, "new1");
});
