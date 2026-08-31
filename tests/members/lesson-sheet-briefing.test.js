import test from "node:test";
import assert from "node:assert/strict";
import {
  LESSON_SHEET_BRIEFING_KIND, postureMetricRows, selectLessonSheetBriefing,
} from "../../src/features/member-memory/lesson-sheet-briefing.js";

const sessionRef = (id, date) => ({ type: "session", id, date });
const assessmentRef = (id, date) => ({ type: "assessment", id, date, field: "posture_milestone" });

const postureMilestone = (text, { id = "posture_milestone_a", date = "2026-08-27" } = {}) => ({
  id,
  type: "milestone",
  category: "posture",
  source: "posture_analysis",
  status: "active",
  text,
  lastSeenAt: date,
  sourceRefs: [assessmentRef("assessment-1", date)],
});

test("음성 기록이 있으면 직전 1회만 보여주고 날짜 배지를 붙인다", () => {
  const view = selectLessonSheetBriefing({
    sessions: [{ id: "s1", date: "2026-08-13" }, { id: "s2", date: "2026-08-27" }],
    memories: [],
    lines: [
      { kind: "observation", text: "[8/27] 오른쪽 어깨 올라감", sourceRefs: [sessionRef("s2", "2026-08-27")] },
      { kind: "response", text: "[8/13] 브릿지에서 편안함", sourceRefs: [sessionRef("s1", "2026-08-13")] },
    ],
  });
  assert.equal(view.kind, LESSON_SHEET_BRIEFING_KIND.VOICE);
  assert.equal(view.title, "지난 수업 이어서 보기");
  assert.equal(view.dateBadge, "8/27 수업");
  assert.deepEqual(view.lines.map((line) => line.text), ["오른쪽 어깨 올라감"]);
});

test("여러 회차를 묶은 줄과 이용권 줄은 직전 1회 요약에서 뺀다", () => {
  const view = selectLessonSheetBriefing({
    sessions: [{ id: "s1", date: "2026-08-13" }, { id: "s2", date: "2026-08-27" }],
    memories: [],
    lines: [
      { kind: "observation", text: "[8/27] 오른쪽 어깨 올라감", sourceRefs: [sessionRef("s2", "2026-08-27")] },
      { kind: "pattern", text: "[8/13·8/27] 어깨 관련 기록 2회", sourceRefs: [sessionRef("s1", "2026-08-13"), sessionRef("s2", "2026-08-27")] },
      { kind: "membership", text: "[이용권] 잔여 2회", sourceRefs: [] },
    ],
  });
  assert.deepEqual(view.lines.map((line) => line.text), ["오른쪽 어깨 올라감"]);
});

test("next_focus 는 본문에서 빠지고 '오늘 이어서' 한 줄로 고정된다", () => {
  const view = selectLessonSheetBriefing({
    sessions: [{ id: "s2", date: "2026-08-27" }],
    memories: [],
    lines: [
      { kind: "next_focus", text: "[8/27] 선생님 메모: 흉추 회전 확인", sourceRefs: [sessionRef("s2", "2026-08-27")] },
      { kind: "observation", text: "[8/27] 오른쪽 어깨 올라감", sourceRefs: [sessionRef("s2", "2026-08-27")] },
    ],
  });
  assert.deepEqual(view.lines.map((line) => line.kind), ["observation"]);
  assert.equal(view.nextFocus, "흉추 회전 확인");
});

test("음성 기록이 있어도 체형분석 줄은 섞이지 않는다", () => {
  const view = selectLessonSheetBriefing({
    sessions: [{ id: "s2", date: "2026-08-27" }],
    memories: [],
    lines: [
      { kind: "milestone", text: "[8/27] [AI] 체형분석: 비포 촬영", sourceRefs: [assessmentRef("assessment-1", "2026-08-27")] },
      { kind: "posture_reminder", text: "[8/27] 애프터 촬영 추천 시점", sourceRefs: [assessmentRef("assessment-1", "2026-08-27")] },
      { kind: "observation", text: "[8/27] 오른쪽 어깨 올라감", sourceRefs: [sessionRef("s2", "2026-08-27")] },
    ],
  });
  assert.deepEqual(view.lines.map((line) => line.text), ["오른쪽 어깨 올라감"]);
});

test("음성 기록이 없으면 체형분석 각도 변화만 보여준다", () => {
  const view = selectLessonSheetBriefing({
    sessions: [],
    lines: [{ kind: "milestone", text: "[8/27] [AI] 체형분석: 애프터 촬영 · 전면 어깨 틀어짐: 3.3° → 0.9° (0° 기준에 가까워짐)", sourceRefs: [] }],
    memories: [postureMilestone("애프터 촬영 · 전면 어깨 틀어짐: 3.3° → 0.9° (0° 기준에 가까워짐) · 전면 골반 비대칭: 0.1° → 0.3° (변화 폭 작음)")],
  });
  assert.equal(view.kind, LESSON_SHEET_BRIEFING_KIND.POSTURE);
  assert.equal(view.title, "지난 체형분석 변화");
  assert.equal(view.nextFocus, "");
  assert.deepEqual(view.metrics, [
    { label: "전면 어깨 틀어짐", before: "3.3°", after: "0.9°", summary: "0° 기준에 가까워짐" },
    { label: "전면 골반 비대칭", before: "0.1°", after: "0.3°", summary: "변화 폭 작음" },
  ]);
});

test("촬영 이벤트만 있는 체형분석은 아무것도 그리지 않는다", () => {
  assert.equal(selectLessonSheetBriefing({ sessions: [], lines: [], memories: [postureMilestone("비포 촬영")] }), null);
  assert.equal(selectLessonSheetBriefing({ sessions: [], lines: [], memories: [postureMilestone("체형 촬영")] }), null);
  assert.equal(selectLessonSheetBriefing({ sessions: [], lines: [], memories: [postureMilestone("애프터 촬영")] }), null);
});

test("거부·해소된 체형분석 기억은 쓰지 않는다", () => {
  const rejected = { ...postureMilestone("애프터 촬영 · 전면 어깨 틀어짐: 3.3° → 0.9° (0° 기준에 가까워짐)"), status: "rejected" };
  assert.equal(selectLessonSheetBriefing({ sessions: [], lines: [], memories: [rejected] }), null);
});

test("둘 다 없으면 null 이라 섹션 자체가 사라진다", () => {
  assert.equal(selectLessonSheetBriefing({ sessions: [], lines: [{ kind: "first_lesson", text: "첫 수업", sourceRefs: [] }], memories: [] }), null);
  assert.equal(selectLessonSheetBriefing(null), null);
});

test("각도 파싱은 수치 문장만 떼어낸다", () => {
  assert.deepEqual(postureMetricRows("비포 촬영"), []);
  assert.deepEqual(postureMetricRows(""), []);
  assert.deepEqual(postureMetricRows("애프터 촬영 · 좌측면 거북목: 12.4° → 9.8° (0° 기준에 가까워짐)"), [
    { label: "좌측면 거북목", before: "12.4°", after: "9.8°", summary: "0° 기준에 가까워짐" },
  ]);
});
