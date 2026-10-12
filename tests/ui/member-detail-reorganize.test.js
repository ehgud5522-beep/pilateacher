import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatMemberLessonHeader,
  formatMemberLessonDate,
  isMeaningfulLessonSession,
  lessonSessionRepresentative,
  meaningfulToday,
  parseLegacyLessonRecordBody,
  pendingLessonState,
  selectLessonSheetBriefing,
  selectMemberDetailStatus,
  selectMemberHistoryRows,
  selectMemberLessonCounts,
  selectMemberLessonSessions,
  selectPendingLessonSessions,
  selectUnresolvedLessonRows,
  stripLessonRecordTags,
} from "../../src/features/lesson-record/member-detail-selectors.js";

const confirmed = (overrides = {}) => ({
  stage: "confirmed_record",
  confirmationStatus: "confirmed",
  confirmedAt: "2026-09-01T11:00:00.000Z",
  confirmedRecord: { didToday: ["브릿지"], observations: ["흉추 회전 개선"], responses: ["편안함"], nextFocus: ["캐딜락 수업 진행"] },
  ...overrides,
});
const pending = (overrides = {}) => ({
  stage: "structured_draft",
  confirmationStatus: "pending",
  structuredDraft: { didToday: ["견갑 안정화"], observations: ["정렬 확인"], responses: ["동작 수월"], nextFocus: ["호흡 패턴 확인"] },
  ...overrides,
});
const note = (id, sid, date, lessonRecord = confirmed(), extra = {}) => ({ id, sid, date, type: "개인레슨", body: "", lessonRecord, ...extra });

test("A/B/C: records render as zero, one, and thirty session rows", () => {
  assert.equal(selectMemberLessonSessions({ member: { id: "m", notes: [] } }).length, 0);
  assert.equal(selectMemberLessonSessions({ member: { id: "m", notes: [note("n1", "s1", "2026-09-01")] } }).length, 1);
  const notes = Array.from({ length: 30 }, (_, index) => note(`n${index}`, `s${index}`, `2026-08-${String(index + 1).padStart(2, "0")}`));
  assert.equal(selectMemberLessonSessions({ member: { id: "m", notes } }).length, 30);
});

test("D-1: same member and date with different start times remain two sessions", () => {
  const member = { id: "m", notes: [note("n1", "s1", "2026-09-01"), note("n2", "s2", "2026-09-01")] };
  const schedule = [
    { id: "s1", date: "2026-09-01", start: "09:00", type: "개인레슨", attendees: [{ memberId: "m", status: "done" }] },
    { id: "s2", date: "2026-09-01", start: "18:00", type: "개인레슨", attendees: [{ memberId: "m", status: "done" }] },
  ];
  assert.deepEqual(selectMemberLessonSessions({ member, schedule }).map((session) => session.startTime).sort(), ["09:00", "18:00"]);
});

test("sid records never use fallback and legacy records use date, startTime, and type", () => {
  const sidSession = selectMemberLessonSessions({ member: { id: "m", notes: [note("n1", "stable-sid", "2026-09-01", confirmed(), { startTime: "07:00" })] } })[0];
  const legacySession = selectMemberLessonSessions({ member: { id: "m", notes: [{ id: "n2", date: "2026-09-01", startTime: "18:00", type: "그룹", body: "브릿지" }] } })[0];
  assert.equal(sidSession.key, "stable-sid");
  assert.equal(legacySession.key, "m|2026-09-01|18:00|그룹");
});

test("D-2: legacy records without time merge conservatively and show a warning", () => {
  const member = { id: "m", notes: [
    { id: "n1", date: "2026-09-01", type: "개인레슨", body: "수업: 브릿지" },
    { id: "n2", date: "2026-09-01", type: "개인레슨", body: "다음: 캐딜락" },
  ] };
  const sessions = selectMemberLessonSessions({ member });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].mergedWithoutTime, true);
  assert.equal(sessions[0].warning, "시간 정보 없음 · 합쳐진 기록일 수 있음");
});

test("E: legacy prefixes, origin tags, and date tags become structured render values", () => {
  const parsed = parseLegacyLessonRecordBody("[AI] [8/26] 오늘 수업: 브릿지 변화: 흉추 회전 개선 회원 반응: 편안함 다음 확인: 캐딜락");
  assert.deepEqual(parsed, { today: "브릿지", change: "흉추 회전 개선", reaction: "편안함", next: "캐딜락", dateHint: "08.26" });
  assert.deepEqual(stripLessonRecordTags("[STT] [8/26] 호흡 패턴 확인"), { text: "호흡 패턴 확인", dateHint: "08.26" });
});

test("F: confirmation is aggregated per record and partial sessions stay pending", () => {
  const member = { id: "m", notes: [note("n1", "s1", "2026-09-01"), note("n2", "s1", "2026-09-01", pending())] };
  const [session] = selectMemberLessonSessions({ member });
  assert.equal(session.confirmationState, "partial");
  assert.equal(session.confirmedCount, 1);
  assert.equal(session.confirmableCount, 2);
  assert.equal(selectPendingLessonSessions({ members: [member], now: new Date("2026-09-02T00:00:00") }).count, 1);
});

test("record confirmation aggregates 3/3, 2/3, and 0/3 without multiplying pending sessions", () => {
  const records = (states) => states.map((state, index) => note(`n${index}`, "s1", "2026-09-01", state));
  const all = selectMemberLessonSessions({ member: { id: "m", notes: records([confirmed(), confirmed(), confirmed()]) } })[0];
  const partialMember = { id: "m", notes: records([confirmed(), confirmed(), pending()]) };
  const partial = selectMemberLessonSessions({ member: partialMember })[0];
  const noneMember = { id: "m", notes: records([pending(), pending({ stage: "raw_transcript" }), pending()]) };
  const none = selectMemberLessonSessions({ member: noneMember })[0];
  assert.equal(all.confirmationState, "confirmed");
  assert.deepEqual([partial.confirmationState, partial.confirmedCount, partial.confirmableCount], ["partial", 2, 3]);
  assert.deepEqual([none.confirmationState, none.confirmedCount, none.confirmableCount], ["pending", 0, 3]);
  assert.equal(selectPendingLessonSessions({ members: [partialMember] }).count, 1);
  assert.equal(selectPendingLessonSessions({ members: [noneMember] }).count, 1);
});

test("legacy pending mismatch becomes one shared pending session", () => {
  const member = { id: "m", notes: [note("n1", "s1", "2026-09-01", pending()), note("n2", "s1", "2026-09-01", pending()), note("n3", "s1", "2026-09-01", pending())] };
  const schedule = [{ id: "s1", date: "2026-09-01", start: "09:00", end: "09:50", type: "개인레슨", attendees: [{ memberId: "m", status: "done" }] }];
  const oldScheduleMissingOnly = 0;
  const oldMemberRecordCount = 3;
  const shared = selectPendingLessonSessions({ members: [member], schedule, now: new Date("2026-09-02T00:00:00") });
  assert.deepEqual([oldScheduleMissingOnly, oldMemberRecordCount], [0, 3]);
  assert.deepEqual([shared.count, shared.countForMember("m")], [1, 1]);
});

test("a completed lesson with no note is one pending session", () => {
  const members = [{ id: "m", notes: [] }];
  const schedule = [{ id: "s1", date: "2026-09-01", start: "09:00", end: "09:50", type: "개인레슨", attendees: [{ memberId: "m", status: "done" }] }];
  assert.equal(selectPendingLessonSessions({ members, schedule, now: new Date("2026-09-02T00:00:00") }).count, 1);
});

test("09.01 16:30 past booked attendance is one unresolved session, while future booked and settled statuses are not", () => {
  const members = [{ id: "m", notes: [] }];
  const lesson = (id, date, status, start = "09:00", end = "09:50") => ({ id, date, start, end, type: "개인레슨", attendees: [{ memberId: "m", status }] });
  const summary = selectPendingLessonSessions({
    members,
    schedule: [lesson("past-booked", "2026-09-01", "booked", "16:30", "17:20"), lesson("future-booked", "2026-09-10", "booked"), lesson("noshow", "2026-09-01", "noshow"), lesson("cancel", "2026-09-01", "cancel")],
    now: new Date("2026-09-05T12:00:00"),
  });
  assert.equal(summary.count, 1);
  assert.deepEqual(summary.sessions[0].reasons, ["attendance"]);
  assert.equal(pendingLessonState(summary.sessions[0]).action, "출석 처리");
});

test("attendance is the visible priority when the same session also has an unconfirmed record", () => {
  const member = { id: "m", notes: [note("n1", "s1", "2026-09-01", pending())] };
  const schedule = [{ id: "s1", date: "2026-09-01", start: "09:00", end: "09:50", type: "개인레슨", attendees: [{ memberId: "m", status: "booked" }] }];
  const summary = selectPendingLessonSessions({ members: [member], schedule, now: new Date("2026-09-05T12:00:00") });
  assert.equal(summary.count, 1);
  assert.deepEqual(summary.sessions[0].reasons.sort(), ["attendance", "confirmation"]);
  assert.deepEqual(pendingLessonState(summary.sessions[0]), { key: "attendance", label: "출석 미처리", action: "출석 처리" });
});

test("schedule banner and member detail share the same pending-session count", () => {
  const members = [
    { id: "m1", notes: [note("n1", "s-pending", "2026-09-01", pending())] },
    { id: "m2", notes: [] },
  ];
  const schedule = [
    { id: "s-pending", date: "2026-09-01", start: "09:00", end: "09:50", type: "개인레슨", attendees: [{ memberId: "m1", status: "done" }] },
    { id: "s-missing", date: "2026-09-01", start: "11:00", end: "11:50", type: "개인레슨", attendees: [{ memberId: "m2", status: "done" }] },
  ];
  const summary = selectPendingLessonSessions({ members, schedule, now: new Date("2026-09-02T00:00:00") });
  const memberDetailTotal = members.reduce((sum, member) => sum + summary.countForMember(member.id), 0);
  const oldMissingRecordOnlyCount = 1;
  assert.equal(oldMissingRecordOnlyCount, 1);
  assert.equal(summary.count, 2);
  assert.equal(memberDetailTotal, summary.count);
});

test("a local pending draft is included once in the same session count", () => {
  const members = [{ id: "m", notes: [] }];
  const schedule = [{ id: "s1", date: "2026-09-01", start: "09:00", end: "09:50", type: "개인레슨", attendees: [{ memberId: "m", status: "done" }] }];
  const pendingDrafts = [{ memberId: "m", lessonId: "s1", rawTranscript: "브릿지" }];
  const summary = selectPendingLessonSessions({ members, schedule, pendingDrafts, now: new Date("2026-09-02T00:00:00") });
  assert.equal(summary.count, 1);
  assert.deepEqual(summary.sessions[0].reasons.sort(), ["local_draft", "record"]);
});

test("G/H/I: status distinguishes warning from critical membership states", () => {
  const now = new Date("2026-09-05T12:00:00");
  assert.equal(selectMemberDetailStatus({ member: { id: "m", regular: 10, contractEnd: "2026-12-31" }, now }).risk, "warning");
  assert.equal(selectMemberDetailStatus({ member: { id: "m", regular: 0, contractEnd: "2026-12-31" }, now }).risk, "critical");
  assert.equal(selectMemberDetailStatus({ member: { id: "m", regular: 5, contractEnd: "2026-09-01" }, now }).risk, "critical");
});

/* ── 맨 위 한 줄은 센터 회원권을 본다 ───────────────────────────────────────
   잔여와 만료는 기기에도 있다 (regular · service · contractEnd). 미소속 개인
   강사에게는 그것이 유일한 답이지만, **센터 소속에서는 참이 아니다** -- 회차는
   센터 원장에서 빠지고 이 기기는 다른 기기의 차감을 모른다.

   2026-10-12 에 그 차이가 드러났다. 수업 확정이 규칙에 막혀 원장에 아무것도
   안 들어갔는데(permission-denied), 화면은 기기 값으로 "잔여 0회 · 만료" 를
   말하고 있었다 -- 두 숫자가 서로 다른 것을 세고 있으면 틀린 쪽을 가려낼
   방법이 없다. */

const pass = (overrides = {}) => ({
  id: "p1", clientId: "c1", status: "active", remainingCount: 8,
  expiresAt: new Date(2027, 0, 1), ...overrides,
});
const NOW = new Date("2026-09-05T12:00:00");

test("centre passes outrank the stale numbers kept on this phone", () => {
  const member = { id: "m", regular: 0, service: 0, contractEnd: "2026-01-01" };
  const found = selectMemberDetailStatus({
    member, now: NOW,
    passes: [pass({ remainingCount: 8 }), pass({ id: "p2", remainingCount: 3 })],
  });
  assert.equal(found.remaining, 11, "쓸 수 있는 회원권의 합이다");
  assert.equal(found.expiry, "2027-01-01");
  /* 기기 값(잔여 0 · 2026-01-01 만료)이었다면 critical 이다. 여기서 warning
     인 것은 예약이 없어서이고(schedule 을 주지 않았다), 회원권 때문이 아니다. */
  assert.equal(found.risk, "warning");
  assert.deepEqual(found.reasons, ["다음 예약 없음"]);
});

test("without centre passes the phone's own numbers still answer", () => {
  /* 미소속 개인 강사에게는 원장이 없다. 기기 값이 유일한 답이고, 그 화면은
     지금까지와 똑같이 돌아야 한다. */
  const member = { id: "m", regular: 4, service: 1, contractEnd: "2026-12-31" };
  const found = selectMemberDetailStatus({ member, now: NOW });
  assert.equal(found.remaining, 5);
  assert.equal(found.expiry, "2026-12-31");
});

test("read the centre and find nothing usable is not the same as not reading it", () => {
  /* 빈 배열은 "쓸 수 있는 것이 없다" 는 참이다. null 은 "모른다" 라 기기
     값으로 돌아간다 -- 둘을 같게 다루면 맞물리지 않은 회원의 잔여가 전부
     0 으로 보인다. */
  const member = { id: "m", regular: 7, service: 0, contractEnd: "2026-12-31" };
  assert.equal(selectMemberDetailStatus({ member, passes: [], now: NOW }).remaining, 0);
  assert.equal(selectMemberDetailStatus({ member, passes: null, now: NOW }).remaining, 7);
});

test("a pass that cannot be used is not remaining", () => {
  /* 숫자가 들어 있어도 그 회원권으로 수업할 수 없다. 더하면 화면이 실제보다
     많이 남았다고 말하고, 분쟁 때 그 숫자가 곧 근거가 된다. */
  const member = { id: "m" };
  const found = selectMemberDetailStatus({
    member, now: NOW,
    passes: [
      pass({ id: "ok", remainingCount: 5 }),
      pass({ id: "expired", remainingCount: 9, expiresAt: new Date(2026, 7, 31) }),
      pass({ id: "cancelled", remainingCount: 9, status: "cancelled" }),
    ],
  });
  assert.equal(found.remaining, 5);
});

test("the expiry shown is the soonest door to close", () => {
  /* 가장 늦은 것을 보여주면 그 사이에 쓸 수 없게 된 회차를 아무도 모른다. */
  const found = selectMemberDetailStatus({
    member: { id: "m" }, now: NOW,
    passes: [
      pass({ id: "late", expiresAt: new Date(2027, 5, 1) }),
      pass({ id: "soon", expiresAt: new Date(2026, 8, 20) }),
    ],
  });
  assert.equal(found.expiry, "2026-09-20");
  assert.equal(found.risk, "warning", "30일 안이면 만료 임박이다");
});

test("expiry is a calendar day, so a pass is usable through its last one", () => {
  /* 절대 순간으로 비교하면 UTC 기기에서 하루 어긋나고, 오늘 만료인 회원권이
     어제 사라진다 -- 회원은 그 회차를 쓸 수 있다. */
  const today = selectMemberDetailStatus({
    member: { id: "m" }, now: NOW,
    passes: [pass({ remainingCount: 4, expiresAt: new Date(2026, 8, 5, 0, 0) })],
  });
  assert.equal(today.remaining, 4, "만료 당일은 아직 쓸 수 있다");
});

test("a pass with no expiry date is not treated as expired", () => {
  // 이 칸이 생기기 전에 발급된 회원권이 있다. 하루아침에 못 쓰게 할 수 없다.
  const found = selectMemberDetailStatus({
    member: { id: "m" }, now: NOW, passes: [pass({ remainingCount: 6, expiresAt: null })],
  });
  assert.equal(found.remaining, 6);
  assert.equal(found.expiry, "", "만료일이 없으면 없다고 말한다");
});

test("J/K: long names and duplicate names do not affect member-keyed sessions", () => {
  const long = { id: "long-id", name: "매우 긴 이름을 가진 회원 테스트 사용자", notes: [note("n1", "s1", "2026-09-01")] };
  const twin = { id: "other-id", name: long.name, notes: [note("n2", "s2", "2026-09-01")] };
  assert.equal(selectMemberLessonSessions({ member: long })[0].key, "s1");
  assert.equal(selectMemberLessonSessions({ member: twin })[0].key, "s2");
});

test("meaningful today keeps real exercise names and suppresses only empty boilerplate", () => {
  ["브릿지", "흉추 회전", "견갑 안정화", "호흡 패턴 확인"].forEach((value) => assert.equal(meaningfulToday(value), value));
  ["", "운동", "수업", "진행", "함", "했음"].forEach((value) => assert.equal(meaningfulToday(value), "기록 없음"));
});

test("date format uses MM.DD this year and YY.MM.DD outside it", () => {
  const now = new Date("2026-09-05T12:00:00");
  assert.equal(formatMemberLessonDate("2026-09-05", { now }), "09.05");
  assert.equal(formatMemberLessonDate("2025-09-05", { now }), "25.09.05");
  assert.equal(formatMemberLessonDate("2026-09-05", { now, weekday: true }), "09.05 (토)");
});

test("exact duplicate change and reaction renders once without fuzzy deletion", () => {
  const member = { id: "m", notes: [note("n1", "s1", "2026-09-01", confirmed({ confirmedRecord: { didToday: ["브릿지"], observations: ["허리 편안함"], responses: ["허리 편안함"], nextFocus: [] } }))] };
  const [session] = selectMemberLessonSessions({ member });
  assert.equal(session.change, "허리 편안함");
  assert.equal(session.reaction, "");
});

test("fixture 도형 09.01 converts three records into one session row", () => {
  const member = { id: "shape", name: "도형", notes: [note("a", "lesson-0901", "2026-09-01"), note("b", "lesson-0901", "2026-09-01"), note("c", "lesson-0901", "2026-09-01")] };
  assert.equal(member.notes.length, 3);
  assert.equal(selectMemberLessonSessions({ member }).length, 1);
});

test("lesson sheet prefers a real lesson record over posture memory and keeps posture as fallback", () => {
  const session = selectMemberLessonSessions({ member: { id: "m", notes: [note("n1", "s1", "2026-09-01")] } })[0];
  const briefing = { lines: [{ kind: "milestone", text: "[8/26] [AI] 체형분석: 비포 촬영", sourceRefs: [{ type: "assessment", id: "a1", date: "2026-08-26" }] }] };
  const preferred = selectLessonSheetBriefing({ sessions: [session], briefing });
  const fallback = selectLessonSheetBriefing({ sessions: [], briefing });
  assert.equal(preferred.source, "lesson_record");
  assert.equal(preferred.text, "브릿지");
  assert.equal(fallback.source, "posture_fallback");
  assert.equal(fallback.text, "체형분석: 비포 촬영");
  assert.equal(fallback.date, "2026-08-26");
});

test("lesson representative falls back to reaction and same-date history headers include time", () => {
  const reactionOnly = { date: "2026-08-27", startTime: "09:00", type: "개인", today: "기록 없음", change: "", reaction: "허리가 편했다고 함", next: "" };
  const later = { ...reactionOnly, key: "later", startTime: "18:00", reaction: "" };
  const middle = { ...reactionOnly, key: "middle", startTime: "14:00", reaction: "" };
  assert.deepEqual(lessonSessionRepresentative(reactionOnly), { field: "reaction", label: "회원 반응", text: "허리가 편했다고 함", display: "회원 반응 · 허리가 편했다고 함" });
  assert.equal(formatMemberLessonHeader(reactionOnly, [reactionOnly, middle, later], { now: new Date("2026-09-05") }), "08.27 (목) 09:00 · 개인");
});

test("existing structured fields remain visible and a wholly empty session has one representative placeholder", () => {
  const fields = [
    ["didToday", "today", "브릿지"],
    ["observations", "change", "흉추 회전 개선"],
    ["responses", "reaction", "허리가 편했다고 함"],
    ["nextFocus", "next", "캐딜락 확인"],
  ];
  fields.forEach(([storedField, viewField, value], index) => {
    const structured = { didToday: [], observations: [], responses: [], nextFocus: [], [storedField]: [value] };
    const session = selectMemberLessonSessions({ member: { id: "m", notes: [note(`field-${index}`, `s-${index}`, "2026-08-27", confirmed({ confirmedRecord: structured }))] } })[0];
    assert.equal(session[viewField], value);
    assert.notEqual(lessonSessionRepresentative(session).field, "empty");
  });
  const empty = selectMemberLessonSessions({ member: { id: "m", notes: [note("empty", "empty-session", "2026-08-27", confirmed({ confirmedRecord: { didToday: [], observations: [], responses: [], nextFocus: [] } }))] } })[0];
  assert.deepEqual(lessonSessionRepresentative(empty), { field: "empty", label: "", text: "기록 없음", display: "기록 없음" });
});

test("lesson counts distinguish completed, reserved, and unresolved attendance", () => {
  const member = { id: "m" };
  const schedule = [
    ...Array.from({ length: 4 }, (_, index) => ({ id: `done-${index}`, date: `2026-09-0${index + 1}`, start: "09:00", end: "09:50", attendees: [{ memberId: "m", status: "done" }] })),
    { id: "past-booked", date: "2026-09-01", start: "18:00", end: "18:50", attendees: [{ memberId: "m", status: "booked" }] },
    { id: "future-booked", date: "2026-09-10", start: "18:00", end: "18:50", attendees: [{ memberId: "m", status: "booked" }] },
  ];
  assert.deepEqual(selectMemberLessonCounts({ member, schedule, now: new Date("2026-09-05T12:00:00") }), { completed: 4, reserved: 1, unresolved: 1 });
});

test("history uses lesson datetime descending even when confirmation metadata is newer", () => {
  const member = { id: "m", notes: [
    note("older", "older", "2026-08-01", confirmed({ confirmedAt: "2026-09-30T23:00:00.000Z" })),
    note("newer", "newer", "2026-09-01", confirmed({ confirmedAt: "2026-09-01T10:00:00.000Z" })),
    note("same-day-early", "same-day-early", "2026-09-01", pending({ recordedAt: "2026-10-01T10:00:00.000Z" })),
  ] };
  const schedule = [
    { id: "older", date: "2026-08-01", start: "09:00" },
    { id: "newer", date: "2026-09-01", start: "18:00" },
    { id: "same-day-early", date: "2026-09-01", start: "08:00" },
  ];
  assert.deepEqual(selectMemberLessonSessions({ member, schedule }).map((session) => session.key), ["newer", "same-day-early", "older"]);
});

test("meaningful history includes raw, structured, manual, and content-bearing drafts only", () => {
  const sessions = [
    { key: "raw", today: "기록 없음", records: [{ lessonRecord: { stage: "structured_draft", rawTranscript: "오늘 브릿지 진행" } }] },
    { key: "structured", today: "브릿지", records: [{ lessonRecord: { structuredDraft: { didToday: ["브릿지"] } } }] },
    { key: "manual", today: "기록 없음", records: [{ body: "강사 직접 메모" }] },
    { key: "placeholder", today: "기록 없음", records: [{ body: "기록 없음" }] },
    { key: "booking-only", today: "기록 없음", records: [] },
  ];
  assert.deepEqual(sessions.map(isMeaningfulLessonSession), [true, true, true, false, false]);
  assert.deepEqual(selectMemberHistoryRows({ sessions }).rows.map((session) => session.key), ["raw", "structured", "manual"]);
});

test("collapsed history keeps five recent meaningful sessions and no duplicates", () => {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    key: `session-${index}`,
    lesson: { id: `session-${index}` },
    confirmationState: index < 3 ? "pending" : "confirmed",
    today: `수업 기록 ${index}`,
    records: [{ body: `수업 기록 ${index}` }],
  }));
  const collapsed = selectMemberHistoryRows({ sessions: [...sessions, sessions[0]] });
  assert.equal(collapsed.total, 12);
  assert.equal(collapsed.rows.length, 5);
  assert.deepEqual(collapsed.rows.map((row) => row.key), ["session-0", "session-1", "session-2", "session-3", "session-4"]);
  assert.equal(new Set(collapsed.rows.map((row) => row.key)).size, 5);
  assert.equal(collapsed.hidden, 7);
  const expanded = selectMemberHistoryRows({ sessions: [...sessions, sessions[0]], expanded: true });
  assert.equal(expanded.rows.length, 12);
  assert.equal(new Set(expanded.rows.map((row) => row.key)).size, 12);
});

test("recordless and empty unresolved lessons are separated while a meaningful draft stays in history", () => {
  const meaningfulDraft = { key: "draft", date: "2026-09-03", today: "브릿지", records: [{ lessonRecord: { stage: "structured_draft", structuredDraft: { didToday: ["브릿지"] } } }] };
  const emptyDraft = { key: "empty", date: "2026-09-02", today: "기록 없음", records: [{ lessonRecord: { stage: "structured_draft", structuredDraft: { didToday: [], observations: [], responses: [], nextFocus: [] } } }] };
  const recordless = { lessonId: "recordless", lesson: { id: "recordless", date: "2026-09-01", start: "10:00", type: "개인" }, reasons: ["record"] };
  const unresolved = selectUnresolvedLessonRows({ pendingSessions: [
    { lessonId: "draft", session: meaningfulDraft, reasons: ["confirmation"] },
    { lessonId: "empty", session: emptyDraft, reasons: ["confirmation"] },
    recordless,
    recordless,
  ] });
  assert.deepEqual(unresolved.map((session) => session.key), ["empty", "recordless"]);
  assert.deepEqual(selectMemberHistoryRows({ sessions: [meaningfulDraft, emptyDraft] }).rows.map((session) => session.key), ["draft"]);
});

test("member and lesson-sheet source use one card, past labels, and exact lesson navigation", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const scheduleForm = source.slice(source.indexOf("function ScheduleForm"), source.indexOf("function ScheduleQueueSheet"));
  assert.match(scheduleForm, /\+ 목표 추가/);
  assert.doesNotMatch(scheduleForm, /목표 미입력/);
  assert.equal((scheduleForm.match(/\{m\?\.name \|\| "삭제된 회원"\}/g) || []).length, 1);
  assert.match(source, /pastLesson && key === "today" \? "수업 내용" : label/);
  assert.match(source, /selectUnresolvedLessonRows\(\{ pendingSessions: pendingLessonSummary\.sessions \}\)/);
  assert.match(source, /onOpenSheet=\{\(item\) => onOpenLesson\?\.\(item\.lesson\?\.id \|\| item\.key\)\}/);
  assert.match(source, /수업 \{historySessions\.length\}건/);
  assert.match(source, /확인 필요 \$\{pendingSessionCount\}/);
  assert.match(source, /미처리 수업 \{unresolvedLessonRows\.length\}건/);
  assert.match(source, /이전 기록 더보기 · \$\{historyVisibility\.hidden\}건/);
  const statusCard = source.slice(source.indexOf('data-member-section="status"'), source.indexOf('data-member-section="next-preparation"'));
  assert.doesNotMatch(statusCard, /Avatar|detailStatus\.reasons|>상태</);
});

test("L: member detail and lesson sheet declare bounded vertical-only scroll containers", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /data-member-detail-scroll[^>]*overflow-y-auto[^>]*overflow-x-hidden/);
  assert.match(source, /data-schedule-sheet-scroll[^>]*overflow-y-auto[^>]*overflow-x-hidden/);
  assert.match(source, /data-member-detail-content[^>]*min-w-0[^>]*max-w-full/);
});

test("dark-mode critical and warning status colors meet 4.5:1 contrast", async () => {
  const colors = await readFile(new URL("../../src/design-system/tokens/colors.js", import.meta.url), "utf8");
  const value = (name) => colors.match(new RegExp(`${name}: \"(#[0-9A-Fa-f]{6})\"`, "g"))?.map((entry) => entry.match(/#[0-9A-Fa-f]{6}/)[0]);
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const [, badDark] = value("bad");
  const [, badSDark] = value("badS");
  const [, warnDark] = value("warn");
  const [, warnSDark] = value("warnS");
  assert.ok(contrast(badDark, badSDark) >= 4.5);
  assert.ok(contrast(warnDark, warnSDark) >= 4.5);
});
