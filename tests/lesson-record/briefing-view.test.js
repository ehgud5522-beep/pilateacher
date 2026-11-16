/** 설계 문서 3단계 · 수업 전 브리핑. 지난 수업은 연 수업보다 앞선 기록만, 같은 문장은 한 번만, 빈 칸은 "기록 없음". */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lessonProgress, previousSessionBefore, selectLessonBriefing } from "../../src/features/lesson-record/briefing-view.js";

const session = (key, date, extra = {}) => ({ key, date, startTime: "10:00", type: "개인레슨", today: `${date} 운동`, change: "", reaction: "", next: "", ...extra });
const lesson = { id: "L-open", date: "2026-11-10", start: "10:00" };
const member = { id: "m1", focus: ["왼쪽 무릎 통증"] };

test("지난 수업은 연 수업보다 앞선 기록 -- 더 나중 기록(미래 수업)을 고르지 않는다", () => {
  const sessions = [session("L-later", "2026-11-14"), session("L-open", "2026-11-10"), session("L-prev", "2026-11-07")];
  assert.equal(previousSessionBefore(sessions, lesson).key, "L-prev");
  const sameDayEarlier = [session("L-am", "2026-11-10", { startTime: "08:00" })];
  assert.equal(previousSessionBefore(sameDayEarlier, lesson).key, "L-am");
  assert.equal(previousSessionBefore([session("L-pm", "2026-11-10", { startTime: "18:00" })], lesson), null);
});

test("같은 문장 두 번 재현 사례: 반응 = 다음 확인 -> 한 번만, 다음 확인을 반응으로 채우지 않는다", () => {
  const sessions = [session("L-prev", "2026-11-07", { reaction: "브릿지 때 허리 편하다고 함", next: "브릿지 때 허리 편하다고 함" })];
  const view = selectLessonBriefing({ member, lesson, sessions });
  assert.deepEqual(view.lastLesson.rows.map((row) => row.key), ["today", "reaction"]);
  const noNext = selectLessonBriefing({ member, lesson, sessions: [session("L-prev", "2026-11-07", { reaction: "편하다고 함" })] });
  assert.equal(noNext.lastLesson.rows.find((row) => row.key === "next"), undefined);
});

test("요약과 기록에 같은 문장이 있으면 기록 쪽만", () => {
  const sessions = [session("L-prev", "2026-11-07", { reaction: "롤다운 때 호흡이 짧음" })];
  const summary = { status: "ready", summary: {
    mustRemember: [{ text: "왼쪽 무릎 통증", sources: [{ recordId: "r1", date: "2026-11-01" }] }],
    recentTrend: [{ text: "롤다운 때 호흡이 짧음.", sources: [{ recordId: "r2", date: "2026-11-07" }] }, { text: "리포머 풋워크를 이어 감", sources: [{ recordId: "r2", date: "2026-11-07" }] }],
    openQuestions: [{ text: "호흡 길이", sources: [{ recordId: "r2", date: "2026-11-07" }] }],
  } };
  const view = selectLessonBriefing({ member, lesson, sessions, summary });
  assert.deepEqual(view.mustRemember.items.map((item) => item.origin), ["caution"], "주의사항과 같은 요약 문장은 한 번만");
  assert.deepEqual(view.recentTrend.items.map((item) => item.text), ["리포머 풋워크를 이어 감"]);
  assert.equal(view.recentTrend.openQuestions.length, 1);
  assert.equal(view.summaryState, "ready");
});

test("빈 칸 · 요약 없음 · 첫 수업: 덩어리는 남고 내용이 비어 있다", () => {
  const view = selectLessonBriefing({ member: { id: "m1" }, lesson, sessions: [] });
  assert.equal(view.mustRemember.items.length, 0);
  assert.equal(view.lastLesson, null);
  assert.equal(view.recentTrend.items.length, 0);
  assert.equal(view.summaryState, "none");
  assert.equal(view.recentTrend.sessionNumber, 1);
  assert.equal(view.recentTrend.daysSinceLast, null);
});

test("요약 갱신 실패여도 앞 요약은 쓴다 (stale)", () => {
  const summary = { status: "failed", statusCode: "timeout", summary: { mustRemember: [{ text: "어깨 뻐근함", sources: [{ recordId: "r", date: "2026-11-01" }] }], recentTrend: [], openQuestions: [] } };
  const view = selectLessonBriefing({ member: { id: "m1" }, lesson, sessions: [], summary });
  assert.equal(view.summaryState, "stale");
  assert.equal(view.mustRemember.items[0].text, "어깨 뻐근함");
});

test("회차 · 경과일은 연 수업보다 앞선 출석만 센다", () => {
  const schedule = [
    { id: "a", date: "2026-11-01", start: "10:00", attendees: [{ memberId: "m1", status: "done" }] },
    { id: "b", date: "2026-11-05", start: "10:00", attendees: [{ memberId: "m1", status: "noshow" }] },
    { id: "c", date: "2026-11-07", start: "10:00", memberId: "m1", status: "done" },
    { id: "d", date: "2026-11-12", start: "10:00", attendees: [{ memberId: "m1", status: "done" }] },
    { id: "L-open", date: "2026-11-10", start: "10:00", attendees: [{ memberId: "m1", status: "booked" }] },
  ];
  assert.deepEqual(lessonProgress({ memberId: "m1", lesson, schedule }), { sessionNumber: 3, lastAttendedDate: "2026-11-07", daysSinceLast: 3 });
});

test("시트: 스위치가 켜졌을 때만 새 브리핑, 꺼지면 지금 브리핑 그대로", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /scheduleSyncEnabledFor\(scheduleSyncConfig\?\.lessonBriefingV2, account\?\.id\)/);
  assert.match(app, /\{lessonBriefingView \? <LessonBriefing view=\{lessonBriefingView\} sessions=\{activeLessonSessions\} footer=\{renewalLineView\} \/> : null\}/);
  assert.match(app, /\{!lessonBriefingView && activeMember && lessonSheetBriefing && \(/);
});

test("브리핑 화면 문구에 AI 를 쓰지 않는다, 빈 덩어리는 기록 없음", () => {
  const ui = readFileSync(new URL("../../src/features/schedule/LessonBriefing.jsx", import.meta.url), "utf8");
  const visible = ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(visible, /AI/);
  assert.match(visible, /기록 없음/);
});
