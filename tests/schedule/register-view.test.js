/**
 * 일정 등록 개편 (2026-11-17): 최근 회원 · 지난 수업 시간 · 회원권으로 유형 채우기 · 버튼 아래 한 줄.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lastLessonTimeOf, recentMembers, registerSummaryLine, suggestLessonKind } from "../../src/features/schedule/register-view.js";
import { AI_SUMMARY_STATE, memberAiSummaryView } from "../../src/features/lesson-record/member-ai-summary-view.js";

const members = [
  { id: "a", name: "김하나" }, { id: "b", name: "박서연", duetWith: "c" }, { id: "c", name: "이도윤", duetWith: "b" },
  { id: "d", name: "최유진" }, { id: "x", name: "그만둔 회원", status: "ended" },
];
const schedule = [
  { id: "1", date: "2026-11-10", start: "10:00", attendees: [{ memberId: "a" }] },
  { id: "2", date: "2026-11-16", start: "9:00", dur: 50, attendees: [{ memberId: "b" }, { memberId: "c" }] },
  { id: "3", date: "2026-11-16", start: "15:00", dur: 30, attendees: [{ memberId: "d" }] },
  { id: "4", date: "2026-11-15", start: "11:00", attendees: [{ memberId: "x" }] },
  { id: "5", date: "2026-11-17", start: "08:00", personal: true, title: "휴무" },
  { id: "6", date: "2026-11-16", start: "18:00", type: "그룹" },
  { id: "7", date: "2026-11-30", start: "10:00", attendees: [{ memberId: "a" }] },
];

test("최근 회원: 오늘까지의 수업을 최근부터, 겹치지 않게, 그만둔 회원 · 개인 일정 · 그룹은 빼고 3명", () => {
  const picked = recentMembers(schedule, members, { today: "2026-11-17", isActive: (m) => m.status !== "ended" });
  assert.deepEqual(picked.map((m) => m.id), ["d", "b", "c"]);
  assert.deepEqual(recentMembers(schedule, members, { today: "2026-11-17", limit: 5, isActive: (m) => m.status !== "ended" }).map((m) => m.id), ["d", "b", "c", "a"]);
  assert.deepEqual(recentMembers([], members), []);
});

test("지난 수업 시간: 오늘 이전 가장 최근 수업 (시각은 두 자리로)", () => {
  assert.deepEqual(lastLessonTimeOf(schedule, "b", "2026-11-17"), { start: "09:00", dur: 50, date: "2026-11-16" });
  assert.deepEqual(lastLessonTimeOf(schedule, "a", "2026-11-17"), { start: "10:00", dur: 0, date: "2026-11-10" });
  assert.equal(lastLessonTimeOf(schedule, "zz", "2026-11-17"), null);
  assert.equal(lastLessonTimeOf(schedule, "", "2026-11-17"), null);
});

test("회원권으로 유형 채우기: 2:1 은 듀엣 + 짝, 관리권만이면 그 관리, 그 밖은 개인", () => {
  assert.deepEqual(suggestLessonKind({ member: members[1], members }), { formKind: "duet", partnerId: "c", source: "duet_pass" });
  // 짝이 목록에 없으면 짐작하지 않는다.
  assert.deepEqual(suggestLessonKind({ member: { id: "q", duetWith: "nobody" }, members }), { formKind: "solo", partnerId: "", source: "solo" });
  assert.deepEqual(suggestLessonKind({ member: members[3], members, careOnly: { careOnly: true, grade: "b" }, careKeyOfGrade: (g) => (g === "b" ? "care_b" : "") }),
    { formKind: "care_b", partnerId: "", source: "care_pass" });
  assert.deepEqual(suggestLessonKind({ member: members[0], members }), { formKind: "solo", partnerId: "", source: "solo" });
});

test("버튼 아래 한 줄", () => {
  const dow = () => "수";
  assert.equal(registerSummaryLine({ date: "2026-11-18", start: "15:00", end: "15:50", dayOfWeek: dow, names: ["김하나"], needsMember: true }), "11.18(수) 15:00~15:50 · 김하나");
  assert.equal(registerSummaryLine({ date: "2026-11-18", start: "15:00", end: "15:50", dayOfWeek: dow, names: [""], needsMember: true }), "회원을 먼저 골라 주세요");
  assert.equal(registerSummaryLine({ date: "2026-11-18", start: "09:00", end: "10:00", dayOfWeek: dow, title: "휴무" }), "11.18(수) 09:00~10:00 · 휴무");
  assert.equal(registerSummaryLine({ date: "2026-11-18", start: "15:00", end: "15:50", dayOfWeek: dow, names: ["박서연", "이도윤"], needsMember: true }), "11.18(수) 15:00~15:50 · 박서연 · 이도윤");
});

test("AI 요약 카드: 세 칸, 주의사항 먼저, 같은 문장 한 번, 근거 건수 · 날짜", () => {
  const row = {
    status: "ready", sourceRecordIds: ["r1", "r2", "r3"], generatedAt: { seconds: Date.parse("2026-11-16T05:00:00Z") / 1000 },
    summary: {
      mustRemember: [{ text: "오른쪽 무릎 통증", sources: [] }, { text: "골반 정렬 확인 중", sources: [{ recordId: "r1", date: "2026-11-11" }] }],
      recentTrend: [{ text: "골반 정렬 확인 중", sources: [] }, { text: "코어 버티는 시간이 늘어남", sources: [{ recordId: "r2", date: "2026-11-11" }] }],
      openQuestions: [],
    },
  };
  const view = memberAiSummaryView({ row, loaded: true, focus: ["오른쪽 무릎 통증"] });
  assert.equal(view.state, AI_SUMMARY_STATE.READY);
  assert.deepEqual(view.blocks.map((b) => b.title), ["꼭 기억할 것", "최근 흐름"], "빈 칸은 그리지 않는다");
  assert.deepEqual(view.blocks[0].items.map((i) => [i.text, i.origin || ""]), [["오른쪽 무릎 통증", "caution"], ["골반 정렬 확인 중", ""]]);
  assert.deepEqual(view.blocks[1].items.map((i) => i.text), ["코어 버티는 시간이 늘어남"], "칸을 건너서도 같은 문장은 한 번");
  assert.equal(view.meta, "강사 기록 3건으로 만듦 · 11.16 업데이트");
});

test("AI 요약 카드 상태: 읽는 중 · 없음 · 이전 요약 · 못 읽음(코드)", () => {
  assert.equal(memberAiSummaryView({ row: null, loaded: false }).state, AI_SUMMARY_STATE.LOADING);
  assert.equal(memberAiSummaryView({ row: null, loaded: true }).state, AI_SUMMARY_STATE.EMPTY);
  assert.equal(memberAiSummaryView({ row: { status: "empty", statusCode: "no_records" }, loaded: true }).state, AI_SUMMARY_STATE.EMPTY);
  const stale = memberAiSummaryView({ row: { status: "failed", statusCode: "provider_timeout", summary: { mustRemember: [{ text: "a" }] } }, loaded: true });
  assert.equal(stale.state, AI_SUMMARY_STATE.STALE);
  assert.equal(stale.statusCode, "provider_timeout");
  const failed = memberAiSummaryView({ row: null, loaded: true, readError: "permission-denied" });
  assert.deepEqual([failed.state, failed.statusCode], [AI_SUMMARY_STATE.ERROR, "permission-denied"]);
});

test("배선: 동의 카드는 AI 요약 카드 안에 한 번, 상담 소재 버튼도 한 곳", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const detail = app.slice(app.indexOf("function ReferenceMemberDetail("));
  assert.doesNotMatch(detail.slice(0, detail.indexOf("\nfunction ")), /<MemberDataConsentCard member=\{member\} sectionStyle/);
  assert.match(app, /<MemberAiSummaryCard member=\{member\} sessions=\{lessonSessions\} onConsult=/);
  assert.match(app, /<MemberDataConsentCard member=\{member\} embedded \/>/);
  assert.match(app, /consultClientId && !consultContext\.consentOn \? <button type="button" data-consult-points-open/);
  // 화면 이름에 "AI" 는 회원 상세 카드에만. 수업 관리 브리핑에는 없다.
  const briefing = readFileSync(new URL("../../src/features/schedule/LessonBriefing.jsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(briefing, /AI/);
});

test("배선: 일정 등록은 회원 → 날짜 · 시간 → 유형 순, 등록 버튼은 아래 고정, 시 → 분을 이어 고른다", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const form = app.slice(app.indexOf("data-register-form"), app.indexOf("data-register-bar"));
  const order = ["data-register-member", "data-register-when", "data-register-type", "data-register-equipment"].map((name) => form.indexOf(name));
  assert.ok(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1])), JSON.stringify(order));
  assert.match(app, /onSelect=\{\(id\) => selectMember\(picker\.slot, id\)\}/);
  assert.match(app, /setPicker\(next \? \{ type: "minute" \} : null\)/);
  assert.match(app, /data-register-bar className=\{sticky \? "sticky bottom-0/);
});
