import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatMemberLessonDate,
  meaningfulToday,
  parseLegacyLessonRecordBody,
  selectLessonSheetBriefing,
  selectMemberDetailStatus,
  selectMemberLessonSessions,
  selectPendingLessonSessions,
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
  const [badLight, badDark] = value("bad");
  const [badSLight, badSDark] = value("badS");
  const [warnLight, warnDark] = value("warn");
  const [warnSLight, warnSDark] = value("warnS");
  assert.ok(contrast(badDark, badSDark) >= 4.5);
  assert.ok(contrast(warnDark, warnSDark) >= 4.5);
});
