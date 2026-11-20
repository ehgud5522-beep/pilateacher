/**
 * 강사 기록 현황 (2026-11-21). 기기가 세는 법 · 대표 표가 맞추는 법 · 판정 → 문구 → 코드 (CLAUDE.md 8).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RECORD_TONE, countDeviceRecordActivity, instructorRecordBoard, previousRecordMonth,
  recordActivityDocument, recordActivityId, recordBoardSummary, recordRowView,
} from "../../src/features/records/record-activity.js";

const NOW = new Date(2026, 10, 21, 12, 0);
const lesson = (id, date, attendees, extra = {}) => ({ id, date, start: "10:00", end: "10:50", attendees, ...extra });
const done = (memberId) => ({ memberId, status: "done" });

test("기기: 출석(done) 회원 한 명이 한 건, 확정 기록 · 초안 · 없음을 가른다", () => {
  const members = [
    { id: "m1", notes: [{ id: "n1", sid: "L1", body: "롤업 3세트, 허리 통증 없음" }] },
    { id: "m2", notes: [{ id: "n2", sid: "L1", body: "AI 초안", lessonRecord: { confirmationStatus: "draft", stage: "draft" } }] },
    { id: "m3", notes: [{ id: "n3", sid: "L2", body: "특이사항 없음" }] },
    { id: "m4", notes: [{ id: "n4", sid: "L3", body: "음성 기록", transcript: "…", lessonRecord: { confirmationStatus: "confirmed" } }] },
    { id: "m5", notes: [{ id: "n5", sid: "L4", body: "상담", type: "상담" }] },
    { id: "sample", isSample: true, notes: [] },
  ];
  const schedule = [
    lesson("L1", "2026-11-03", [done("m1"), done("m2")]), // 듀엣: 1 기록 + 1 초안
    lesson("L2", "2026-11-04", [done("m3")]),             // 특이사항 없음 = 기록
    lesson("L3", "2026-11-05", [done("m4")]),             // 음성
    lesson("L4", "2026-11-06", [done("m5")]),             // 상담 메모는 기록 아님
    lesson("L5", "2026-11-07", [{ memberId: "m1", status: "noshow" }]),
    lesson("L6", "2026-11-07", [done("sample")]),
    lesson("L7", "2026-11-25", [done("m1")]),             // 아직 안 끝남
    lesson("L8", "2026-10-30", [done("m1")]),             // 다른 달
    lesson("L9", "2026-11-08", [], { personal: true }),
    { id: "L10", date: "2026-11-09", start: "09:00", memberId: "m1", status: "done" }, // 옛 모양(한 명)
  ];
  const counts = countDeviceRecordActivity({ members, schedule, month: "2026-11", now: NOW });
  assert.deepEqual(counts, { attended: 6, recorded: 3, draft: 1, voice: 1, manual: 1, noComment: 1 });
  assert.equal(countDeviceRecordActivity({ members, schedule, month: "11월", now: NOW }).attended, 0);
});

test("올리는 문서: 숫자 · 달 · 빌드만, 이상한 숫자는 0", () => {
  const document = recordActivityDocument({ organizationId: "org", uid: "u1", month: "2026-11", counts: { attended: 4, recorded: -2, draft: 1.5, voice: "3" }, appBuild: "1.1.57 (80)" });
  assert.deepEqual(Object.keys(document).sort(), ["appBuild", "attended", "draft", "manual", "month", "noComment", "organizationId", "recorded", "userId", "voice"].sort());
  assert.equal(document.recorded, 0);
  assert.equal(document.draft, 0);
  assert.equal(document.voice, 3);
  assert.equal(recordActivityId("u1", "2026-11"), "u1_2026-11");
  assert.equal(previousRecordMonth("2026-01"), "2025-12");
});

test("대표 표: 차감 - 되돌린 차감, 회원에게 보낸 말은 수업 · 회원으로 맞춘다, 옛 계정은 합친다", () => {
  const ledger = [
    { id: "L1_deduct", passId: "p1", type: "deduct", lessonId: "L1", clientId: "c1", instructorId: "a" },
    { id: "L1_deduct", passId: "p2", type: "deduct", lessonId: "L1", clientId: "c2", instructorId: "a" }, // 듀엣 두 번째
    { id: "L2_deduct", passId: "p1", type: "deduct", lessonId: "L2", clientId: "c1", instructorId: "a-old" },
    { id: "L3_deduct", passId: "p3", type: "deduct", lessonId: "L3", clientId: "c3", instructorId: "a" },
    { id: "L3_deduct_correction", passId: "p3", type: "correction", correctsEntryId: "L3_deduct", instructorId: "a" },
    { id: "L4_deduct", passId: "p4", type: "deduct", lessonId: "L4", clientId: "demo", instructorId: "a" },
    { id: "L5_deduct", passId: "p5", type: "deduct", lessonId: "L5", clientId: "c5", instructorId: "b" },
  ];
  const lessonNotes = [
    { lessonId: "L1", clientId: "c1", memberNote: "오늘 잘하셨어요" },
    { lessonId: "L2", clientId: "c9", memberNote: "다른 회원" },
    { lessonId: "L5", clientId: "c5", memberNote: "" },
  ];
  const instructors = [
    { userId: "a", displayName: "김보현", role: "instructor", status: "active", previousUids: ["a-old"] },
    { userId: "b", displayName: "안혜원", role: "instructor", status: "active" },
    { userId: "c", displayName: "이예진", role: "instructor", status: "active" },
    { userId: "s", displayName: "데스크", role: "staff", status: "active" },
    { userId: "gone", displayName: "퇴사", role: "instructor", status: "ended" },
  ];
  const canonical = (id) => (id === "a-old" ? "a" : String(id || ""));
  const activities = [
    { userId: "a", attended: 10, recorded: 9, draft: 0, checkedAt: { seconds: 100 } },
    { userId: "a-old", attended: 3, recorded: 0, draft: 0, checkedAt: { seconds: 50 } }, // 옛 폰, 더 오래됨
    { userId: "b", attended: 10, recorded: 4, draft: 1, checkedAt: { seconds: 100 } },
  ];
  const rows = instructorRecordBoard({ ledger, lessonNotes, activities, instructors, canonicalInstructorId: canonical, excludedClientIds: new Set(["demo"]) });
  const byId = Object.fromEntries(rows.map((row) => [row.instructorId, row]));
  assert.deepEqual(rows.map((row) => row.instructorId), ["b", "a", "c"], "기록률 낮은 순 → 보고 없음");
  assert.equal(byId.a.confirmed, 3);
  assert.equal(byId.a.withNote, 1);
  assert.equal(byId.a.attended, 10);
  assert.equal(byId.a.rate, 0.9);
  assert.equal(byId.a.name, "김보현");
  assert.equal(byId.b.withNote, 0, "빈 말은 보낸 것이 아니다");
  assert.equal(byId.c.confirmed, 0);
  assert.equal(byId.c.activity, null);
  assert.ok(!byId.s && !byId.gone, "직원 · 나간 사람은 수업이 없으면 줄을 세우지 않는다");
});

test("판정 → 문구 → 코드가 한 줄로", () => {
  const view = (extra) => recordRowView({ confirmed: 10, activity: {}, attended: 10, recorded: 10, rate: 1, ...extra });
  assert.deepEqual(view({}), { tone: RECORD_TONE.GOOD, label: "기록 100%", detail: "빠짐 없음", code: "record_good" });
  assert.equal(view({ recorded: 7, rate: 0.7 }).code, "record_partial");
  assert.equal(view({ recorded: 7, rate: 0.7 }).detail, "빠짐 3건");
  assert.equal(view({ recorded: 2, rate: 0.2 }).tone, RECORD_TONE.BAD);
  assert.equal(view({ activity: null, attended: null, recorded: null, rate: null }).code, "no_device_report");
  assert.equal(view({ attended: 0, recorded: 0, rate: null }).code, "no_attended_lessons");
  const summary = recordBoardSummary([
    { confirmed: 1, activity: {}, attended: 10, recorded: 10, rate: 1 },
    { confirmed: 1, activity: {}, attended: 10, recorded: 2, rate: 0.2 },
    { confirmed: 1, activity: null, attended: null, recorded: null, rate: null },
  ]);
  assert.deepEqual(summary, { good: 1, partial: 0, low: 1, unknown: 1 });
});

test("배선: 폰 앱에서만 올리고, 대표 메뉴에 기록 현황이 있다", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /recordActivityReportOn = Boolean\(organizationRoster\) && Capacitor\.isNativePlatform\(\)/);
  assert.match(app, /key: "record-board", title: "강사 기록 현황"/);
  assert.match(app, /view === "record-board" && showAudit && <InstructorRecordBoard/);
});
