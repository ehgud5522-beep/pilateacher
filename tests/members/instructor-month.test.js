import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPIRY_SOON_DAYS, LOW_REMAINING, QUIET_DAYS, WATCH_REASON,
  attendanceMix, clientsTaught, clientsToWatch, deductionsIn, exhaustedThisMonth,
  instructorMonthReport, previousMonthOf, recordRate, sessionTrend,
} from "../../src/features/members/instructor-month.js";

/**
 * 이번 달 내 수업 활동.
 *
 * ── 이 파일이 지키는 것 ──
 *
 * 하나. **수업 수는 급여와 같은 식으로 센다** (`-delta`). 두 화면이 다른 건수를
 * 말하면 월말에 누구 말이 맞는지 가릴 방법이 없다.
 *
 * 둘. **모르는 것을 0으로 보여주지 않는다.** 지난달을 못 읽었으면 증감을 내지
 * 않고, 회원권을 못 읽었으면 "종료" 로 세지 않는다.
 *
 * 셋. **끝난 것은 챙길 것이 아니다.** 잔여 0과 만료 지난 회원권이 "챙길 회원"
 * 목록을 채우면 그때부터 그 목록은 안 읽힌다.
 */

const MONTH = "2026-10";
const LAST = "2026-09";
const NOW = new Date(2026, 9, 11, 9, 0);
const at = (day, hour = 10) => new Date(2026, 9, day, hour, 0);
const lastMonthAt = (day) => new Date(2026, 8, day, 10, 0);

const entry = (overrides = {}) => ({
  id: "e1", passId: "p1", clientId: "c1", type: "deduct", delta: -1,
  category: "pt_1_1_new", unitPrice: 25000, instructorId: "u-me", occurredAt: at(5),
  ...overrides,
});

const pass = (overrides = {}) => ({
  id: "p1", clientId: "c1", instructorId: "u-me", status: "active",
  remainingCount: 8, createdAt: new Date(2026, 5, 1), expiresAt: new Date(2027, 0, 1),
  ...overrides,
});

const lesson = (overrides = {}) => ({
  id: "l1", date: "2026-10-05",
  attendees: [{ memberId: "m1", status: "done" }], ...overrides,
});

/* ── 수업 수와 증감 ──────────────────────────────────────────────────────── */

test("sessions are counted exactly as payroll counts them", () => {
  /* 급여는 `-delta` 로 센다. 절댓값을 쓰면 되돌린 회차가 한 번 더 세어지고,
     그 순간 이 화면과 급여 화면이 갈라진다. */
  const found = sessionTrend({
    entries: [entry(), entry({ id: "e2", occurredAt: at(6) }), entry({ id: "e3", type: "correction", delta: 1, occurredAt: at(7) })],
    previousEntries: [], month: MONTH, previousMonth: LAST,
  });
  assert.equal(found.sessions, 1, "두 건 차감에서 한 건 보정을 뺀다");
});

test("issuing and handing over a pass are not lessons", () => {
  const found = deductionsIn([
    entry(),
    entry({ id: "issue", type: "issue", delta: 10 }),
    entry({ id: "transfer", type: "transfer", delta: 0 }),
  ], MONTH);
  assert.deepEqual(found.map((item) => item.id), ["e1"]);
});

test("a month boundary is a calendar boundary, not a UTC one", () => {
  /* 월말 밤 11시 수업이 UTC 로는 다음 달이다. 그 한 건이 매달 넘어가면 두 달
     모두 틀리고, 틀린 쪽을 가려낼 방법이 없다. */
  const found = deductionsIn([
    entry({ id: "late", occurredAt: new Date(2026, 9, 31, 23, 30) }),
    entry({ id: "early", occurredAt: new Date(2026, 9, 1, 0, 10) }),
    entry({ id: "before", occurredAt: new Date(2026, 8, 30, 23, 30) }),
  ], MONTH);
  assert.deepEqual(found.map((item) => item.id), ["late", "early"]);
});

test("last month unread is not last month empty", () => {
  /* 0건으로 두면 이번 달 전부가 "증가" 로 보인다. 그것은 거짓이고, 강사는
     자기가 두 배로 일했다고 읽는다. */
  const unread = sessionTrend({ entries: [entry()], previousEntries: null, month: MONTH, previousMonth: LAST });
  assert.equal(unread.previous, null);
  assert.equal(unread.delta, null, "모르면 증감을 말하지 않는다");

  const empty = sessionTrend({ entries: [entry()], previousEntries: [], month: MONTH, previousMonth: LAST });
  assert.equal(empty.previous, 0);
  assert.equal(empty.delta, 1);
});

test("the delta is a count, never a percentage", () => {
  /* 지난달이 0이면 "+∞%" 가 된다. 건수 차이는 언제나 말할 수 있다. */
  const found = sessionTrend({
    entries: [entry(), entry({ id: "e2", occurredAt: at(6) })],
    previousEntries: [entry({ id: "p", occurredAt: lastMonthAt(5) })],
    month: MONTH, previousMonth: LAST,
  });
  assert.equal(found.delta, 1);
  assert.equal(found.previous, 1);
});

test("january looks back to december of the year before", () => {
  assert.equal(previousMonthOf("2026-01"), "2025-12");
  assert.equal(previousMonthOf("2026-10"), "2026-09");
  assert.equal(previousMonthOf(""), "", "모르는 달의 앞 달은 없다");
});

/* ── 출석 · 노쇼 · 취소 (기기) ───────────────────────────────────────────── */

test("the attendance rate counts only what has been marked", () => {
  /* 아직 예약인 수업을 분모에 넣으면 달 초의 출석률이 언제나 바닥이다. 그것은
     사실이 아니라 아직 안 온 날이다. */
  const found = attendanceMix({
    schedule: [
      lesson(),
      lesson({ id: "l2", attendees: [{ memberId: "m2", status: "noshow" }] }),
      lesson({ id: "l3", attendees: [{ memberId: "m3", status: "cancel" }] }),
      lesson({ id: "l4", attendees: [{ memberId: "m4", status: "booked" }] }),
    ],
    month: MONTH,
  });
  assert.deepEqual(
    { done: found.done, noshow: found.noshow, cancel: found.cancel, booked: found.booked },
    { done: 1, noshow: 1, cancel: 1, booked: 1 },
  );
  assert.equal(found.settled, 3);
  assert.equal(found.rate, 33);
});

test("nothing marked yet is not a zero percent month", () => {
  const found = attendanceMix({ schedule: [lesson({ attendees: [{ memberId: "m1", status: "booked" }] })], month: MONTH });
  assert.equal(found.rate, null, "0% 는 '한 명도 안 왔다' 로 읽힌다");
});

test("a group lesson is one mark, not a seat each", () => {
  /* 기구 그룹은 참석자가 없고 수업 단위로 찍는다. 좌석으로 세려 들면 0 이 되어
     그 수업이 통째로 사라진다. */
  const found = attendanceMix({
    schedule: [
      lesson({ id: "g1", attendees: [], groupDone: true }),
      lesson({ id: "g2", attendees: [], groupCancelled: true }),
      lesson({ id: "g3", attendees: [] }),
    ],
    month: MONTH,
  });
  assert.deepEqual({ done: found.done, cancel: found.cancel, booked: found.booked }, { done: 1, cancel: 1, booked: 1 });
});

test("an old single-member lesson still counts", () => {
  // attendees 가 생기기 전의 일정이다. 빈 것으로 읽으면 그 달이 비어 보인다.
  const found = attendanceMix({
    schedule: [{ id: "old", date: "2026-10-03", memberId: "m1", status: "done" }],
    month: MONTH,
  });
  assert.equal(found.done, 1);
});

test("personal time, samples and other months are not this month's lessons", () => {
  const found = attendanceMix({
    schedule: [
      lesson({ id: "off", personal: true }),
      lesson({ id: "sample", isSample: true }),
      lesson({ id: "next", date: "2026-11-01" }),
    ],
    month: MONTH,
  });
  assert.equal(found.settled, 0);
});

/* ── 기록과 사진 (기기) ──────────────────────────────────────────────────── */

test("the record rate is measured against lessons that actually happened", () => {
  /* 취소한 수업에 기록이 없는 것은 정상이다. 분모에 넣으면 아무리 부지런해도
     100% 가 되지 않고, 그 숫자는 곧 안 읽힌다. */
  const found = recordRate({
    schedule: [
      lesson({ id: "l1" }),
      lesson({ id: "l2" }),
      lesson({ id: "l3", attendees: [{ memberId: "m3", status: "cancel" }] }),
    ],
    members: [{ id: "m1", notes: [{ id: "n1", sid: "l1" }] }],
    month: MONTH,
  });
  assert.equal(found.done, 2);
  assert.equal(found.recorded, 1);
  assert.equal(found.rate, 50);
});

test("a note counts for the lesson it points at, not the day it was written", () => {
  /* 같은 날 두 수업이 있으면 날짜로는 어느 쪽인지 알 수 없다. 메모는 sid 로
     수업을 가리킨다. */
  const found = recordRate({
    schedule: [lesson({ id: "morning" }), lesson({ id: "evening" })],
    members: [{ id: "m1", notes: [{ id: "n1", sid: "evening" }, { id: "n2" }] }],
    month: MONTH,
  });
  assert.equal(found.recorded, 1);
});

test("no lesson yet means no rate, not zero percent", () => {
  const found = recordRate({ schedule: [], members: [], month: MONTH });
  assert.equal(found.rate, null);
});

test("body photos are counted once even when one shot sits in two lists", () => {
  const found = recordRate({
    schedule: [], members: [], month: MONTH,
    photos: {
      m1: {
        front: [{ id: "ph1", date: "2026-10-02" }],
        poses: [{ id: "ph1", date: "2026-10-02" }, { id: "ph2", date: "2026-10-02" }],
        back: [{ id: "ph-old", date: "2026-09-30" }],
      },
    },
  });
  assert.equal(found.photos, 2);
});

test("a photo with only a timestamp still lands in its month", () => {
  const found = recordRate({
    schedule: [], members: [], month: MONTH,
    photos: { m1: { front: [{ id: "ph1", createdAt: "2026-10-02T01:00:00.000Z" }] } },
  });
  assert.equal(found.photos, 1);
});

/* ── 새로 맡은 회원 ──────────────────────────────────────────────────────── */

test("a member taught this month is counted from the ledger", () => {
  const found = clientsTaught({
    entries: [entry(), entry({ id: "e2", clientId: "c2", passId: "p2", occurredAt: at(6) })],
    passes: [], month: MONTH, instructorId: "u-me",
  });
  assert.deepEqual(found.taught.sort(), ["c1", "c2"]);
});

test("newly assigned means a pass issued to me this month", () => {
  const found = clientsTaught({
    entries: [], month: MONTH, instructorId: "u-me",
    passes: [
      pass({ id: "new", clientId: "c9", createdAt: at(2) }),
      pass({ id: "old", clientId: "c1", createdAt: new Date(2026, 5, 1) }),
      pass({ id: "theirs", clientId: "c8", instructorId: "u-other", createdAt: at(3) }),
    ],
  });
  assert.deepEqual(found.fresh, ["c9"], "남의 담당으로 나간 회원권은 내 회원이 아니다");
});

test("both halves of a duet are my members", () => {
  /* 회원권 하나에 둘이 붙는다. 대표만 세면 짝은 어느 강사의 회원도 아니게
     된다. */
  const found = clientsTaught({
    entries: [], month: MONTH, instructorId: "u-me",
    passes: [pass({ id: "duet", clientId: "c1", clientIds: ["c1", "c2"], createdAt: at(2) })],
  });
  assert.deepEqual(found.fresh.sort(), ["c1", "c2"]);
});

/* ── 챙길 회원 ───────────────────────────────────────────────────────────── */

test("each reason to follow up says what to do about it", () => {
  const found = clientsToWatch({
    instructorId: "u-me", now: NOW, entries: [],
    passes: [
      pass({ id: "p-low", clientId: "c-low", remainingCount: LOW_REMAINING }),
      pass({ id: "p-exp", clientId: "c-exp", remainingCount: 9, expiresAt: new Date(2026, 9, 11 + EXPIRY_SOON_DAYS) }),
      pass({ id: "p-ok", clientId: "c-ok", remainingCount: 9 }),
    ],
  });
  const byClient = new Map(found.map((item) => [item.clientId, item.reasons]));
  assert.deepEqual(byClient.get("c-low"), [WATCH_REASON.LOW]);
  assert.deepEqual(byClient.get("c-exp"), [WATCH_REASON.EXPIRING]);
  assert.equal(byClient.has("c-ok"), false);
});

test("one member with three reasons is one line, not three", () => {
  /* 같은 사람이 세 번 서면 목록이 길어 보이고, 정작 몇 명인지는 세어 봐야
     안다. 이유가 많은 사람이 맨 위다. */
  const found = clientsToWatch({
    instructorId: "u-me", now: NOW,
    passes: [
      pass({ id: "p-both", clientId: "c-both", remainingCount: 2, expiresAt: new Date(2026, 9, 15) }),
      pass({ id: "p-one", clientId: "c-one", remainingCount: 2 }),
    ],
    entries: [entry({ clientId: "c-both", occurredAt: new Date(2026, 8, 1) })],
  });
  assert.equal(found.length, 2);
  assert.equal(found[0].clientId, "c-both");
  assert.deepEqual(found[0].reasons, [WATCH_REASON.EXPIRING, WATCH_REASON.LOW, WATCH_REASON.QUIET]);
});

test("a finished or expired pass is not something to follow up", () => {
  /* 끝난 사람으로 목록이 차면 그때부터 아무도 그 목록을 안 읽는다. 종료는
     아래의 '종료시킨 회원' 이 센다. */
  const found = clientsToWatch({
    instructorId: "u-me", now: NOW, entries: [],
    passes: [
      pass({ id: "p-done", clientId: "c-done", remainingCount: 0 }),
      pass({ id: "p-over", clientId: "c-over", remainingCount: 3, expiresAt: new Date(2026, 9, 1) }),
      pass({ id: "p-cancelled", clientId: "c-cancelled", remainingCount: 3, status: "cancelled" }),
    ],
  });
  assert.deepEqual(found, []);
});

test("a quiet member is one of mine who has stopped coming", () => {
  /* 남의 회원이 조용한 것은 내가 챙길 일이 아니고, 한 번도 안 가르친 회원이
     "21일 넘게 수업 없음" 으로 서면 그 목록은 곧 안 읽힌다. */
  const found = clientsToWatch({
    instructorId: "u-me", now: NOW,
    passes: [
      pass({ id: "p-quiet", clientId: "c-quiet", remainingCount: 9 }),
      pass({ id: "p-new", clientId: "c-new", remainingCount: 9 }),
      pass({ id: "p-recent", clientId: "c-recent", remainingCount: 9 }),
    ],
    entries: [
      entry({ clientId: "c-quiet", occurredAt: new Date(2026, 9, 11 - QUIET_DAYS, 10, 0) }),
      entry({ clientId: "c-recent", occurredAt: new Date(2026, 9, 9) }),
      // 남의 회원. 내 회원권이 없으므로 내 목록에 서지 않는다.
      entry({ clientId: "c-theirs", occurredAt: new Date(2026, 7, 1) }),
    ],
  });
  const ids = found.map((item) => item.clientId);
  assert.deepEqual(ids, ["c-quiet"]);
});

test("someone who stopped coming before the window still shows up", () => {
  /* 화면은 두 달치 원장만 읽는다. 가장 오래 안 온 회원은 그 안에 항목이 하나도
     없어서, 항목으로만 세면 **가장 챙겨야 할 사람이 목록에서 빠진다.** */
  const found = clientsToWatch({
    instructorId: "u-me", now: NOW, entries: [], entriesSince: new Date(2026, 8, 1),
    passes: [pass({ id: "p-gone", clientId: "c-gone", remainingCount: 9, createdAt: new Date(2026, 3, 1) })],
  });
  assert.deepEqual(found.map((item) => item.clientId), ["c-gone"]);
});

test("a member assigned to me days ago has not stopped coming", () => {
  /* 아직 시작하지 않은 것이지 끊긴 것이 아니다. 어제 맡은 회원이 "21일 넘게
     수업 없음" 으로 서면 그 목록은 곧 안 읽힌다. */
  const found = clientsToWatch({
    instructorId: "u-me", now: NOW, entries: [], entriesSince: new Date(2026, 8, 1),
    passes: [pass({ id: "p-new", clientId: "c-new", remainingCount: 9, createdAt: new Date(2026, 9, 8) })],
  });
  assert.deepEqual(found, []);
});

test("without a long enough lookback we say only what we know", () => {
  /* 읽어 온 범위가 21일을 못 덮으면 "항목이 없다" 는 "안 왔다" 가 아니다.
     모르는 것을 안 왔다고 적으면 멀쩡히 다니는 회원이 목록에 선다. */
  const found = clientsToWatch({
    instructorId: "u-me", now: NOW, entries: [], entriesSince: new Date(2026, 9, 1),
    passes: [pass({ id: "p-gone", clientId: "c-gone", remainingCount: 9, createdAt: new Date(2026, 3, 1) })],
  });
  assert.deepEqual(found, []);
});

/* ── 종료시킨 회원과 재등록 ──────────────────────────────────────────────── */

test("a pass I emptied this month is counted with the member's name attached", () => {
  const found = exhaustedThisMonth({
    entries: [entry({ passId: "p-done" }), entry({ id: "e2", passId: "p-left", clientId: "c2", occurredAt: at(6) })],
    passes: [
      pass({ id: "p-done", clientId: "c1", remainingCount: 0 }),
      pass({ id: "p-left", clientId: "c2", remainingCount: 3 }),
    ],
    month: MONTH,
  });
  assert.equal(found.passes, 1);
  assert.deepEqual(found.clientIds, ["c1"]);
});

test("a pass that ran out in another month is not this month's", () => {
  const found = exhaustedThisMonth({
    entries: [entry({ passId: "p-done", occurredAt: lastMonthAt(10) })],
    passes: [pass({ id: "p-done", clientId: "c1", remainingCount: 0 })],
    month: MONTH,
  });
  assert.equal(found.passes, 0);
});

test("a pass we could not read is not reported as finished", () => {
  /* 끝난 것으로 세면 없는 이름이 목록에 선다. 안 센 것은 다음 달에 드러난다 --
     뒤가 덜 틀리다. */
  const found = exhaustedThisMonth({
    entries: [entry({ passId: "p-missing" })], passes: [], month: MONTH,
  });
  assert.equal(found.passes, 0);
  assert.deepEqual(found.clientIds, []);
});

test("re-registration is the same member's new pass, whoever now teaches them", () => {
  /* 회원이 센터에 남은 것이 먼저다. 담당이 누구로 갔는지는 다른 질문이고,
     담당만 세면 인계한 강사의 재등록이 통째로 사라진다. */
  const found = exhaustedThisMonth({
    entries: [entry({ passId: "p-done" }), entry({ id: "e2", passId: "q-done", clientId: "c2", occurredAt: at(6) })],
    passes: [
      pass({ id: "p-done", clientId: "c1", remainingCount: 0 }),
      pass({ id: "p-again", clientId: "c1", instructorId: "u-other", remainingCount: 20, createdAt: at(9) }),
      pass({ id: "q-done", clientId: "c2", remainingCount: 0 }),
    ],
    month: MONTH,
  });
  assert.equal(found.passes, 2);
  assert.deepEqual(found.renewedClientIds, ["c1"], "c2 는 아직 다시 끊지 않았다");
});

test("a pass bought before this month is not a re-registration for it", () => {
  const found = exhaustedThisMonth({
    entries: [entry({ passId: "p-done" })],
    passes: [
      pass({ id: "p-done", clientId: "c1", remainingCount: 0 }),
      pass({ id: "p-older", clientId: "c1", remainingCount: 4, createdAt: lastMonthAt(2) }),
    ],
    month: MONTH,
  });
  assert.deepEqual(found.renewedClientIds, []);
});

/* ── 한 화면이 쓰는 묶음 ─────────────────────────────────────────────────── */

test("the report answers every question the screen asks, from one call", () => {
  const found = instructorMonthReport({
    month: MONTH, instructorId: "u-me", now: NOW,
    entries: [entry({ passId: "p-done" }), entry({ id: "e2", passId: "p-low", clientId: "c2", occurredAt: at(6) })],
    previousEntries: [entry({ id: "e0", occurredAt: lastMonthAt(4) })],
    passes: [
      pass({ id: "p-done", clientId: "c1", remainingCount: 0 }),
      pass({ id: "p-low", clientId: "c2", remainingCount: 2 }),
      pass({ id: "p-again", clientId: "c1", remainingCount: 20, createdAt: at(9) }),
    ],
    schedule: [lesson(), lesson({ id: "l2", attendees: [{ memberId: "m2", status: "noshow" }] })],
    members: [{ id: "m1", notes: [{ id: "n1", sid: "l1" }] }],
    photos: { m1: { front: [{ id: "ph1", date: "2026-10-02" }] } },
  });

  assert.equal(found.month, MONTH);
  assert.equal(found.trend.sessions, 2);
  assert.equal(found.trend.delta, 1);
  assert.equal(found.attendance.rate, 50);
  assert.deepEqual(found.clients.taught.sort(), ["c1", "c2"]);
  assert.deepEqual(found.clients.fresh, ["c1"]);
  assert.deepEqual(found.watch.map((item) => item.clientId), ["c2"]);
  assert.equal(found.exhausted.passes, 1);
  assert.deepEqual(found.exhausted.renewedClientIds, ["c1"]);
  assert.equal(found.records.rate, 100);
  assert.equal(found.records.photos, 1);
});

test("an empty month does not throw and does not invent numbers", () => {
  const found = instructorMonthReport({ month: MONTH, instructorId: "u-me", now: NOW });
  assert.equal(found.trend.sessions, 0);
  assert.equal(found.trend.delta, null, "지난달을 안 받았으면 증감은 없다");
  assert.equal(found.attendance.rate, null);
  assert.equal(found.records.rate, null);
  assert.deepEqual(found.watch, []);
  assert.deepEqual(found.exhausted.clientIds, []);
});
