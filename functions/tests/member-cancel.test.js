"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { grantMemberCancel, memberCancelLesson, memberCancelStatus } = require("../src/member-cancel");
const { membershipId } = require("../src/member-link");

/* 회원 앱 수업 취소 (2026-11-07, 5차 1단계). memberCancelLesson · grantMemberCancel 의
   본문을 그대로 지난다. index.js 는 이 함수들을 감싸 오류를 HttpsError 로 바꿀 뿐이다. */

const ORG = "bonita";
const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-10T03:00:00Z"); // 한국 시각 11월 10일 12:00
/* Date 를 지키는 깊은 복사 (Firestore 처럼 쓰고 읽은 값이 공유되지 않게). */
const clone = (value) => (value instanceof Date ? new Date(value) : Array.isArray(value) ? value.map(clone)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value);

/** 경로 문자열로 문서를 두는 Firestore. 트랜잭션은 차례로 돈다 -- 두 번 누르기를 재현한다. */
function memoryFirestore(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  let counter = 0;
  let chain = Promise.resolve();
  const snapshot = (path) => ({
    id: path.split("/").pop(),
    exists: docs.has(path),
    data: () => (docs.has(path) ? clone(docs.get(path)) : undefined),
  });
  const write = (path, value, options) => {
    docs.set(path, options?.merge ? { ...(docs.get(path) || {}), ...clone(value) } : clone(value));
  };
  const docRef = (path) => ({
    id: path.split("/").pop(),
    path,
    get: async () => snapshot(path),
    set: async (value, options) => write(path, value, options),
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  const collectionRef = (path) => {
    const query = (filters) => ({
      where: (field, op, value) => query([...filters, [field, op, value]]),
      get: async () => ({
        docs: [...docs.keys()]
          .filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
          .filter((key) => filters.every(([field, op, value]) => {
            const actual = docs.get(key)?.[field];
            if (op === "==") return actual === value;
            if (op === "array-contains") return Array.isArray(actual) && actual.includes(value);
            throw new Error(`unsupported ${op}`);
          }))
          .map(snapshot),
      }),
    });
    return {
      doc: (id) => docRef(`${path}/${id || `auto-${(counter += 1)}`}`),
      ...query([]),
    };
  };
  return {
    docs,
    collection: collectionRef,
    read: (path) => docs.get(path),
    runTransaction(callback) {
      const run = chain.then(async () => {
        const writes = [];
        const result = await callback({
          get: async (ref) => snapshot(ref.path),
          set: (ref, value, options) => writes.push([ref.path, value, options]),
        });
        for (const [path, value, options] of writes) write(path, value, options);
        return result;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}

const lessonPath = (id) => `organizations/${ORG}/lessons/${id}`;
const ledgerPath = (clientId) => `organizations/${ORG}/memberCancelLedger/${clientId}`;
const recordsOf = (db) => [...db.docs.entries()].filter(([key]) => key.startsWith(`organizations/${ORG}/memberCancellations/`)).map(([, value]) => value);
const grantsOf = (db) => [...db.docs.entries()].filter(([key]) => key.startsWith(`organizations/${ORG}/memberCancelGrants/`)).map(([, value]) => value);

const switchOn = (overrides = {}) => ({
  mode: "listed", userIds: ["uid-teacher"],
  memberCancel: { mode: "listed", userIds: ["uid-teacher"], limit: 3, period: "month", ...overrides },
});

function seed({ sync = switchOn(), lessons = {}, ledger = null } = {}) {
  const base = {
    "runtimeConfig/scheduleSync": sync,
    [`memberships/${membershipId(ORG, "uid-owner")}`]: { status: "active", role: "owner", displayName: "대표" },
    [`memberships/${membershipId(ORG, "uid-area")}`]: { status: "active", role: "area_manager", displayName: "총괄" },
    [`memberships/${membershipId(ORG, "uid-teacher")}`]: { status: "active", role: "instructor", displayName: "정예진" },
    [`memberships/${membershipId(ORG, "uid-other")}`]: { status: "active", role: "instructor", displayName: "다른강사" },
    [`memberships/${membershipId(ORG, "uid-fc")}`]: { status: "active", role: "manager", displayName: "FC" },
    [`organizations/${ORG}/clients/client-a`]: { organizationId: ORG, userId: "uid-member-a", instructorIds: ["uid-teacher"] },
    [`organizations/${ORG}/clients/client-b`]: { organizationId: ORG, userId: "uid-member-b", instructorIds: ["uid-teacher"] },
  };
  for (const [id, lesson] of Object.entries(lessons)) base[lessonPath(id)] = lesson;
  if (ledger) base[ledgerPath("client-a")] = ledger;
  return memoryFirestore(base);
}

const solo = (overrides = {}) => ({
  organizationId: ORG, lessonId: "L1", status: "scheduled", clientIds: ["client-a"], clientId: "client-a",
  instructorId: "uid-teacher", startsAt: new Date(NOW.getTime() + 48 * HOUR), revision: 4, ...overrides,
});

let ids = 0;
const deps = (now = NOW) => ({ membershipId, now: () => now, newId: () => `id-${(ids += 1)}` });
const cancel = (db, { uid = "uid-member-a", clientId = "client-a", lessonId = "L1", now } = {}) => memberCancelLesson(db, {
  callerUid: uid, organizationId: ORG, clientId, lessonId,
}, deps(now));
const status = (db, { uid = "uid-member-a", clientId = "client-a", lessonId = "L1", now } = {}) => memberCancelStatus(db, {
  callerUid: uid, organizationId: ORG, clientId, lessonId,
}, deps(now));
const grant = (db, uid, extra = {}) => grantMemberCancel(db, {
  callerUid: uid, organizationId: ORG, clientId: "client-a", amount: 1, reason: "병원 진료", ...extra,
}, deps());

const refusedWith = (reason) => (error) => {
  assert.equal(error.reason, reason);
  return true;
};

test("취소하면 수업은 취소 모양 · 번호 +1, 횟수 한 번, 기록에 누가 · 언제 · 어느 수업 · 남은 횟수", async () => {
  const db = seed({ lessons: { L1: solo() } });
  const result = await cancel(db);
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.remaining, 2);
  const lesson = db.read(lessonPath("L1"));
  assert.equal(lesson.status, "cancelled");
  assert.deepEqual(lesson.clientIds, ["client-a"], "취소된 수업에도 회원을 남긴다 -- 서버가 그 회원 화면을 다시 만든다");
  assert.equal(lesson.revision, 5);
  assert.equal(lesson.updatedDevice, "member_cancel");
  assert.equal(lesson.deletedAt, undefined, "지운 일정이 아니라 출석 취소다");
  assert.equal(lesson.memberCancellations["client-a"].by, "member");
  assert.deepEqual(db.read(ledgerPath("client-a")).buckets, { "m:2026-11": { used: 1, granted: 0 } });
  const [record] = recordsOf(db);
  assert.equal(record.cancelledByUid, "uid-member-a");
  assert.equal(record.lessonId, "L1");
  assert.equal(record.clientId, "client-a");
  assert.deepEqual(record.cancelledAt, NOW);
  assert.equal(record.remainingAfter, 2);
  assert.equal(record.limit, 3);
  assert.doesNotMatch(JSON.stringify(record), /정예진|김하나|010/);
});

test("두 번 눌러도(동시에) 한 번만 — 두 번째는 '이미 취소함' 성공, 횟수 · 기록 하나", async () => {
  const db = seed({ lessons: { L1: solo() } });
  const [first, second] = await Promise.all([cancel(db), cancel(db)]);
  assert.deepEqual([first.outcome, second.outcome].sort(), ["already_cancelled", "cancelled"]);
  assert.equal(second.remaining, 2);
  assert.deepEqual(db.read(ledgerPath("client-a")).buckets["m:2026-11"], { used: 1, granted: 0 });
  assert.equal(recordsOf(db).length, 1);
  assert.equal(db.read(lessonPath("L1")).revision, 5, "번호도 한 번만 오른다");
});

test("마감 직전(24시간 + 1분 전)은 된다, 직후(24시간 − 1분)는 막히고 횟수 · 수업 그대로", async () => {
  const startsAt = new Date(NOW.getTime() + 24 * HOUR);
  const before = seed({ lessons: { L1: solo({ startsAt }) } });
  const ok = await cancel(before, { now: new Date(NOW.getTime() - 60 * 1000) });
  assert.equal(ok.outcome, "cancelled");

  const after = seed({ lessons: { L1: solo({ startsAt }) } });
  await assert.rejects(cancel(after, { now: new Date(NOW.getTime() + 60 * 1000) }), refusedWith("deadline_passed"));
  assert.equal(after.read(ledgerPath("client-a")), undefined, "막힌 취소는 횟수를 쓰지 않는다");
  assert.equal(after.read(lessonPath("L1")).status, "scheduled");
  assert.equal(recordsOf(after).length, 0);

  const exactly = seed({ lessons: { L1: solo({ startsAt }) } });
  assert.equal((await cancel(exactly, { now: NOW })).outcome, "cancelled", "마감 시각 그 자체까지는 된다");
});

test("3회 다 쓰면 4번째는 no_remaining — 추가 부여 뒤 다시 된다", async () => {
  const lessons = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`L${n}`, solo({ lessonId: `L${n}` })]));
  const db = seed({ lessons });
  for (const n of [1, 2, 3]) assert.equal((await cancel(db, { lessonId: `L${n}` })).outcome, "cancelled");
  await assert.rejects(cancel(db, { lessonId: "L4" }), refusedWith("no_remaining"));
  assert.equal(db.read(lessonPath("L4")).status, "scheduled");
  assert.deepEqual(db.read(ledgerPath("client-a")).buckets["m:2026-11"], { used: 3, granted: 0 });
  const seen = await status(db, { lessonId: "L4" });
  assert.equal(seen.enabled, true);
  assert.equal(seen.canCancel, false);
  assert.equal(seen.reason, "no_remaining");
  assert.equal(seen.remaining, 0);
  assert.equal(seen.instructorName, "정예진", "문구의 {강사} 선생님 -- 전화번호는 돌려주지 않는다");

  const granted = await grant(db, "uid-teacher");
  assert.equal(granted.remaining, 1);
  assert.equal((await cancel(db, { lessonId: "L4" })).outcome, "cancelled");
  await assert.rejects(cancel(db, { lessonId: "L5" }), refusedWith("no_remaining"));
});

test("듀엣은 취소한 회원만 빠진다 — 상대 예약 · 수업은 그대로", async () => {
  const db = seed({ lessons: { D1: solo({ lessonId: "D1", clientIds: ["client-a", "client-b"], lessonType: "2:1", careGrades: { "client-a": "A" } }) } });
  const result = await cancel(db, { lessonId: "D1" });
  assert.equal(result.partnerKept, true);
  const lesson = db.read(lessonPath("D1"));
  assert.equal(lesson.status, "scheduled");
  assert.deepEqual(lesson.clientIds, ["client-b"]);
  assert.equal(lesson.clientId, "client-b");
  assert.deepEqual(lesson.careGrades, {});
  assert.equal(lesson.revision, 5);
  assert.ok(lesson.memberCancellations["client-a"]);
  assert.equal(recordsOf(db)[0].partnerKept, true);
  /* 두 번째 클릭 -- 이제 clientIds 에 없지만 "남의 수업" 이 아니라 "이미 취소함" 이다. */
  assert.equal((await cancel(db, { lessonId: "D1" })).outcome, "already_cancelled");
  /* 상대는 자기 몫을 따로 취소할 수 있다. 둘 다 빠지면 수업이 취소된다. */
  const partner = await cancel(db, { uid: "uid-member-b", clientId: "client-b", lessonId: "D1" });
  assert.equal(partner.partnerKept, false);
  assert.equal(db.read(lessonPath("D1")).status, "cancelled");
});

test("이미 확정된 수업 · 강사가 취소한 수업은 막힌다", async () => {
  const db = seed({ lessons: {
    C1: solo({ lessonId: "C1", status: "completed" }),
    X1: solo({ lessonId: "X1", status: "cancelled", deletedAt: NOW }),
  } });
  await assert.rejects(cancel(db, { lessonId: "C1" }), refusedWith("lesson_settled"));
  await assert.rejects(cancel(db, { lessonId: "X1" }), refusedWith("lesson_cancelled"));
  assert.equal(db.read(ledgerPath("client-a")), undefined);
});

test("다른 회원의 수업 · 남의 회원 문서로는 취소하지 못한다", async () => {
  const db = seed({ lessons: { B1: solo({ lessonId: "B1", clientIds: ["client-b"], clientId: "client-b" }) } });
  /* 내 회원 문서로 남의 수업을 */
  await assert.rejects(cancel(db, { lessonId: "B1" }), refusedWith("not_own_lesson"));
  /* 남의 회원 문서를 대신 골라서 */
  await assert.rejects(cancel(db, { clientId: "client-b", lessonId: "B1" }), refusedWith("not_own_lesson"));
  /* 없는 회원 문서도 같은 답 -- id 를 캐는 통로가 되지 않게 */
  await assert.rejects(cancel(db, { clientId: "client-zzz", lessonId: "B1" }), refusedWith("not_own_lesson"));
  assert.equal(db.read(lessonPath("B1")).status, "scheduled");
  assert.equal(recordsOf(db).length, 0);
});

test("스위치가 꺼지면 아무 일도 없다 — 상태는 enabled:false, 취소는 feature_off", async () => {
  const cases = [
    { name: "설정 없음", sync: { mode: "listed", userIds: ["uid-teacher"] } },
    { name: "꺼짐", sync: switchOn({ mode: "off" }) },
    { name: "시범 강사 밖", sync: switchOn({ userIds: ["uid-other"] }) },
    { name: "그 강사 동기화 꺼짐", sync: { ...switchOn(), mode: "listed", userIds: ["uid-other"] } },
    { name: "횟수 비어 있음", sync: switchOn({ limit: null }) },
    { name: "적용 기간 비어 있음", sync: switchOn({ period: "" }) },
  ];
  for (const item of cases) {
    const db = seed({ sync: item.sync, lessons: { L1: solo() } });
    assert.deepEqual(await status(db), { enabled: false, reason: "feature_off" }, item.name);
    await assert.rejects(cancel(db), refusedWith("feature_off"), item.name);
    assert.equal(db.read(lessonPath("L1")).status, "scheduled", item.name);
    assert.equal(db.read(lessonPath("L1")).revision, 4, item.name);
    assert.equal(db.read(ledgerPath("client-a")), undefined, item.name);
  }
});

test("횟수는 대표 설정값을 따른다 (코드에 숫자 없음) — 1로 두면 두 번째가 막힌다", async () => {
  const db = seed({ sync: switchOn({ limit: 1 }), lessons: { L1: solo(), L2: solo({ lessonId: "L2" }) } });
  assert.equal((await cancel(db)).remaining, 0);
  await assert.rejects(cancel(db, { lessonId: "L2" }), refusedWith("no_remaining"));
});

test("월 기준은 한국 시각의 달로 센다 — 11월에 다 써도 12월 1일 0시(한국)에는 다시", async () => {
  const lessons = { L1: solo({ startsAt: new Date("2026-12-05T03:00:00Z") }) };
  const db = seed({ sync: switchOn({ limit: 1 }), ledger: { buckets: { "m:2026-11": { used: 1, granted: 0 } } }, lessons });
  /* 11월 30일 23:30 (한국) = 14:30 UTC */
  await assert.rejects(cancel(db, { now: new Date("2026-11-30T14:30:00Z") }), refusedWith("no_remaining"));
  /* 12월 1일 00:30 (한국) = 11월 30일 15:30 UTC */
  assert.equal((await cancel(db, { now: new Date("2026-11-30T15:30:00Z") })).outcome, "cancelled");
  assert.deepEqual(db.read(ledgerPath("client-a")).buckets["m:2026-12"], { used: 1, granted: 0 });
});

test("회원권 기준은 지금 쓰는 회원권 칸으로 센다 — 쓸 회원권이 없으면 no_active_pass", async () => {
  const db = seed({ sync: switchOn({ period: "pass" }), lessons: { L1: solo(), L2: solo({ lessonId: "L2" }) } });
  db.docs.set(`organizations/${ORG}/passes/P-old`, { clientId: "client-a", status: "active", remainingCount: 0 });
  db.docs.set(`organizations/${ORG}/passes/P-now`, { clientIds: ["client-a", "client-b"], status: "active", remainingCount: 5, expiresAt: new Date("2027-01-01") });
  await cancel(db);
  assert.deepEqual(db.read(ledgerPath("client-a")).buckets, { "p:P-now": { used: 1, granted: 0 } });

  const empty = seed({ sync: switchOn({ period: "pass" }), lessons: { L1: solo() } });
  await assert.rejects(cancel(empty), refusedWith("no_active_pass"));
});

test("강사가 다시 일정에 넣어도 쓴 횟수는 돌아오지 않는다 — 다시 취소하면 한 번 더 쓴다", async () => {
  const db = seed({ lessons: { L1: solo() } });
  await cancel(db);
  /* 강사 기기가 다시 예약으로 (회원 표시는 남아 있다) */
  db.docs.set(lessonPath("L1"), { ...db.read(lessonPath("L1")), status: "scheduled", revision: 6 });
  assert.deepEqual(db.read(ledgerPath("client-a")).buckets["m:2026-11"], { used: 1, granted: 0 });
  const again = await cancel(db);
  assert.equal(again.outcome, "cancelled");
  assert.deepEqual(db.read(ledgerPath("client-a")).buckets["m:2026-11"], { used: 2, granted: 0 });
});

/* ── 추가 부여 ─────────────────────────────────────────────────────────── */

test("추가 부여: 담당 강사 · 대표 · 총괄은 된다, 담당 아닌 강사 · FC 는 거절 — 횟수 · 사유 · 누가가 남는다", async () => {
  const db = seed();
  const byTeacher = await grant(db, "uid-teacher", { amount: 1, reason: "출장" });
  assert.equal(byTeacher.remaining, 4);
  await grant(db, "uid-owner", { amount: 2 });
  /* 총괄매니저도 1회를 넘지 못한다 -- 그 이상은 대표님 권한. 다른 회원(아직 0회)에게는 된다. */
  await assert.rejects(grant(db, "uid-area"), refusedWith("grant_needs_admin"));
  await grant(db, "uid-area", { clientId: "client-b" });
  await assert.rejects(grant(db, "uid-other"), refusedWith("grant_not_assigned"));
  await assert.rejects(grant(db, "uid-fc"), refusedWith("grant_not_assigned"));
  await assert.rejects(grant(db, "uid-member-a"), refusedWith("not_staff"));
  const grants = grantsOf(db);
  assert.equal(grants.length, 3);
  assert.deepEqual(grants.map((row) => row.grantedBy), ["uid-teacher", "uid-owner", "uid-area"]);
  assert.equal(grants[0].amount, 1);
  assert.equal(grants[0].reason, "출장");
  assert.equal(grants[0].reasonCode, "other", "예전 화면(문장만)은 기타로");
  assert.equal(grants[0].month, "2026-11");
  assert.equal(grants[0].grantedByRole, "instructor");
  assert.deepEqual(db.read(ledgerPath("client-a")).buckets["m:2026-11"], { used: 0, granted: 3 });
});

test("추가 부여 입력: 횟수 1~10, 사유 필수 · 200자, 기능이 꺼져 있으면 거절", async () => {
  const db = seed();
  await assert.rejects(grant(db, "uid-teacher", { amount: 0 }), refusedWith("grant_amount_invalid"));
  await assert.rejects(grant(db, "uid-teacher", { amount: 11 }), refusedWith("grant_amount_invalid"));
  await assert.rejects(grant(db, "uid-teacher", { amount: 1.5 }), refusedWith("grant_amount_invalid"));
  await assert.rejects(grant(db, "uid-teacher", { reason: "  " }), refusedWith("grant_reason_required"));
  await assert.rejects(grant(db, "uid-teacher", { reason: "가".repeat(201) }), refusedWith("grant_reason_too_long"));
  const off = seed({ sync: switchOn({ mode: "off" }) });
  await assert.rejects(grant(off, "uid-teacher"), refusedWith("feature_off"));
  assert.equal(grantsOf(db).length + grantsOf(off).length, 0);
});

/* ── 대표 설정 (runtimeConfig/scheduleSync.memberCancel) ─────────────────── */

test("설정: 횟수 · 적용 기간은 반드시, scheduleSync 문서의 한 칸에 합쳐 쓴다 (동기화 스위치는 그대로)", async () => {
  const { writeRuntimeConfig } = require("../src/runtime-config-admin");
  const db = memoryFirestore({ "runtimeConfig/scheduleSync": { mode: "listed", userIds: ["uid-teacher"] } });
  await writeRuntimeConfig(db, { document: "memberCancel", value: { mode: "listed", userIds: ["uid-teacher"], limit: 3, period: "month" }, actorId: "uid-owner", now: () => NOW });
  const stored = db.read("runtimeConfig/scheduleSync");
  assert.equal(stored.mode, "listed", "동기화 스위치가 지워지지 않는다");
  assert.equal(stored.memberCancel.limit, 3);
  assert.equal(stored.memberCancel.period, "month");
  assert.equal(stored.memberCancel.updatedBy, "uid-owner");
  for (const bad of [{ limit: "" }, { limit: 21 }, { limit: -1 }, { limit: 2.5 }, { period: "week" }, { period: "" }]) {
    await assert.rejects(writeRuntimeConfig(db, {
      document: "memberCancel", value: { mode: "off", userIds: [], limit: 3, period: "pass", ...bad }, actorId: "uid-owner",
    }), /member_cancel_(limit|period)_invalid/, JSON.stringify(bad));
  }
});

/* ── 후속 보강 (2026-11-07) ─────────────────────────────────────────────── */

test("추가 부여: 같은 요청 ID 는 한 번만 — 동시에 두 번 · 다시 시도해도 기록 하나, 두 번째는 기존 결과", async () => {
  const db = seed();
  const requestId = "req-abcdef12";
  const [first, second] = await Promise.all([
    grant(db, "uid-owner", { amount: 2, requestId }),
    grant(db, "uid-owner", { amount: 2, requestId }),
  ]);
  const retry = await grant(db, "uid-owner", { amount: 2, requestId });
  assert.equal(grantsOf(db).length, 1);
  assert.deepEqual(db.read(ledgerPath("client-a")).buckets["m:2026-11"], { used: 0, granted: 2 });
  assert.deepEqual([first.duplicate, second.duplicate].sort(), [false, true]);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.remaining, 5);
  assert.equal(retry.grantId, first.grantId);
  /* 다른 계정의 같은 ID 는 따로다 · 요청 ID 없는 예전 호출은 전처럼 매번 */
  await grant(db, "uid-area", { requestId, clientId: "client-b" });
  await grant(db, "uid-owner");
  await grant(db, "uid-owner");
  assert.equal(grantsOf(db).length, 4);
  await assert.rejects(grant(db, "uid-teacher", { requestId: "bad id!" }), refusedWith("grant_request_id_invalid"));
  await assert.rejects(grant(db, "uid-other"), (error) => error.reason === "grant_not_assigned" && error.role === "instructor");
});

test("설정 변경 기록: 저장마다 한 건 — 누가(계정 · 역할) · 언제 · 바꾸기 전 · 바꾼 값", async () => {
  const { handleRuntimeConfigRequest } = require("../src/runtime-config-admin");
  const db = memoryFirestore({
    [`memberships/${membershipId(ORG, "uid-owner")}`]: { status: "active", role: "owner" },
    "runtimeConfig/scheduleSync": { mode: "listed", userIds: ["uid-teacher"], rosterRealtime: { mode: "off", userIds: [] } },
  });
  const save = (value) => handleRuntimeConfigRequest(db, {
    callerUid: "uid-owner", organizationId: ORG, document: "memberCancel", value, now: () => NOW,
  }, { membershipId, isActiveOwner: (row) => row?.role === "owner" && row?.status === "active", newId: () => `chg-${(ids += 1)}` });
  await save({ mode: "listed", userIds: ["uid-teacher"], limit: 3, period: "month" });
  await save({ mode: "listed", userIds: ["uid-teacher"], limit: 5, period: "pass" });
  const changes = [...db.docs.entries()].filter(([key]) => key.startsWith("runtimeConfigChanges/")).map(([, value]) => value);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].before, null, "처음에는 전 값이 없다");
  assert.deepEqual(changes[0].after, { mode: "listed", userIds: ["uid-teacher"], limit: 3, period: "month" });
  assert.deepEqual(changes[1].before, { mode: "listed", userIds: ["uid-teacher"], limit: 3, period: "month" }, "시각 · 작성자는 빼고 값만");
  assert.deepEqual(changes[1].after, { mode: "listed", userIds: ["uid-teacher"], limit: 5, period: "pass" });
  for (const change of changes) {
    assert.equal(change.actorUid, "uid-owner");
    assert.equal(change.actorRole, "owner");
    assert.equal(change.document, "memberCancel");
    assert.equal(change.organizationId, ORG);
    assert.deepEqual(change.at, NOW);
  }
  /* 동기화 스위치를 저장해도 기록이 남고, 같은 문서에 얹힌 칸(취소 · 명단)은 전 값에 섞이지 않는다 */
  await handleRuntimeConfigRequest(db, {
    callerUid: "uid-owner", organizationId: ORG, document: "scheduleSync", value: { mode: "off", userIds: [] }, now: () => NOW,
  }, { membershipId, isActiveOwner: (row) => row?.role === "owner", newId: () => "chg-sync" });
  assert.deepEqual(db.read("runtimeConfigChanges/chg-sync").before, { mode: "listed", userIds: ["uid-teacher"] });
});

/* ── 추가 부여 경고 · 재량 (2026-11-07 대표 시안) ─────────────────────────── */

test("대표가 아니면 한 칸에 추가 1회까지 — 넘으면 grant_needs_admin, 대표만 제한 없음", async () => {
  const db = seed();
  await assert.rejects(grant(db, "uid-teacher", { amount: 2 }), refusedWith("grant_needs_admin"), "한 번에 2회도 막힌다");
  assert.equal(grantsOf(db).length, 0, "막히면 아무것도 쓰지 않는다");
  await grant(db, "uid-teacher");
  await assert.rejects(grant(db, "uid-teacher"), refusedWith("grant_needs_admin"), "두 번째 1회는 대표에게");
  await grant(db, "uid-owner", { amount: 3 });
  await assert.rejects(grant(db, "uid-area"), refusedWith("grant_needs_admin"), "총괄매니저도 대표님에게 요청");
  await grant(db, "uid-owner");
  assert.deepEqual(db.read(ledgerPath("client-a")).buckets["m:2026-11"], { used: 0, granted: 5 });
});

test("대표가 먼저 줬으면 강사는 더 줄 수 없다 — 재량은 칸의 합계로 센다", async () => {
  const db = seed();
  await grant(db, "uid-owner");
  await assert.rejects(grant(db, "uid-teacher"), refusedWith("grant_needs_admin"));
});

test("다음 달(새 칸)에는 강사 재량이 다시 1회", async () => {
  const db = seed();
  await grant(db, "uid-teacher");
  const next = await grantMemberCancel(db, {
    callerUid: "uid-teacher", organizationId: ORG, clientId: "client-a", amount: 1, reasonCode: "health",
  }, { membershipId, now: () => new Date("2026-12-02T03:00:00Z"), newId: () => `id-${(ids += 1)}` });
  assert.equal(next.duplicate, false);
});

test("부여 기록에 전 · 후와 반복 표시가 남는다", async () => {
  const db = seed({ ledger: { buckets: { "m:2026-11": { used: 3, granted: 0 } } } });
  await grant(db, "uid-teacher", { reasonCode: "health", reason: "" });
  await grant(db, "uid-owner", { reasonCode: "centre_schedule", reason: "강사 휴가로 일정 변경" });
  const [first, second] = grantsOf(db);
  assert.deepEqual([first.usedBefore, first.grantedBefore, first.remainingBefore, first.remainingAfter], [3, 0, 0, 1]);
  assert.equal(first.repeat, false);
  assert.equal(first.reasonCode, "health");
  assert.equal(first.reason, "건강 및 부상 등 불가피한 사유", "문장을 안 적으면 고른 사유 이름이 남는다");
  assert.deepEqual([second.grantedBefore, second.remainingBefore, second.remainingAfter], [1, 1, 2]);
  assert.equal(second.repeat, true, "같은 칸 두 번째는 반복");
  assert.equal(second.reason, "강사 휴가로 일정 변경");
});

test("사유: 셋 중 하나, 기타는 내용 필수, 모르는 코드는 거절", async () => {
  const db = seed();
  await assert.rejects(grant(db, "uid-owner", { reasonCode: "other", reason: " " }), refusedWith("grant_reason_required"));
  await assert.rejects(grant(db, "uid-owner", { reasonCode: "vip", reason: "x" }), refusedWith("grant_reason_code_invalid"));
  const ok = await grant(db, "uid-owner", { reasonCode: "centre_schedule", reason: "" });
  assert.equal(ok.reasonCode, "centre_schedule");
});
