import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  countPosturePhotoRecords,
  normalizeAssessmentSets,
  postureCalendarDays,
  selectMemberBodyPhotoSurface,
} from "../../src/features/posture/posture-model.js";
import { DARK_COLORS } from "../../src/design-system/tokens/colors.js";

const appPath = new URL("../../src/App.jsx", import.meta.url);
const photo = (id, view, date, assessmentId = `assessment-${id}`, extra = {}) => ({
  id, view, date, assessmentId, src: `blob:${id}`, memberId: "m1", selectedViews: [view],
  assessmentStatus: "completed", completedAt: `${date}T12:00:00.000Z`, ...extra,
});
const graph = (records) => records.reduce((result, record) => {
  const storageKey = record.view;
  result[storageKey] = [...(result[storageKey] || []), record];
  return result;
}, {});
const select = (photos) => {
  const sets = normalizeAssessmentSets(photos, { memberId: "m1" });
  return selectMemberBodyPhotoSurface(sets, {
    now: new Date(2026, 8, 5, 12, 0, 0),
    photoCount: countPosturePhotoRecords(photos),
  });
};
const luminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
};
const contrast = (first, second) => {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

test("no assessment exposes the first-photo state", () => {
  assert.deepEqual(select({}), {
    state: "empty", assessmentCount: 0, photoCount: 0, comparisonPairAvailable: false, sameDayOnly: false, view: null,
    before: null, latest: null, beforeDate: "", latestDate: "", comparisonElapsedDays: null, daysSinceLatest: null,
    latestAssessmentId: null, beforeAssessmentId: null, afterAssessmentId: null,
  });
});

test("member detail and analysis share two normalized assessments while raw photo count stays separate", () => {
  const photos = graph([
    photo("a-front", "front", "2026-06-12", "assessment-a", { selectedViews: ["front", "back"] }),
    photo("a-back", "back", "2026-06-12", "assessment-a", { selectedViews: ["front", "back"] }),
    photo("b-front", "front", "2026-09-04", "assessment-b", { selectedViews: ["front", "back"] }),
    photo("b-back", "back", "2026-09-04", "assessment-b", { selectedViews: ["front", "back"] }),
  ]);
  const assessments = normalizeAssessmentSets(photos, { memberId: "m1" });
  const result = selectMemberBodyPhotoSurface(assessments, { now: new Date(2026, 8, 5), photoCount: countPosturePhotoRecords(photos) });
  assert.equal(result.assessmentCount, assessments.length);
  assert.equal(result.assessmentCount, 2);
  assert.equal(result.photoCount, 4);
  assert.equal(result.latestAssessmentId, assessments[0].id);
  assert.equal(result.latestAssessmentId, "assessment-b");
});

test("two normalized front assessments form a same-view pair", () => {
  const before = photo("front-1", "front", "2026-06-12", "assessment-before");
  const latest = photo("front-2", "front", "2026-09-04", "assessment-after");
  const result = select(graph([latest, before]));
  assert.equal(result.state, "comparison");
  assert.equal(result.view, "front");
  assert.equal(result.before.id, before.id);
  assert.equal(result.latest.id, latest.id);
  assert.equal(result.comparisonElapsedDays, 84);
  assert.equal(result.daysSinceLatest, 1);
});

test("legacy side normalizes to leftSide", () => {
  const result = select(graph([
    photo("side-1", "side", "2026-06-12", "assessment-before"),
    photo("side-2", "side", "2026-09-04", "assessment-after"),
  ]));
  assert.equal(result.comparisonPairAvailable, true);
  assert.equal(result.view, "leftSide");
});

test("custom views are excluded from automatic comparison", () => {
  const result = select(graph([
    photo("custom-1", "custom", "2026-06-12", "assessment-before"),
    photo("custom-2", "custom", "2026-09-04", "assessment-after"),
  ]));
  assert.equal(result.assessmentCount, 2);
  assert.equal(result.comparisonPairAvailable, false);
});

test("same-day assessments preserve both counts but do not form an automatic comparison", () => {
  const result = select(graph([
    photo("front-1", "front", "2026-09-05", "assessment-before"),
    photo("front-2", "front", "2026-09-05", "assessment-after"),
  ]));
  assert.equal(result.assessmentCount, 2);
  assert.equal(result.photoCount, 2);
  assert.equal(result.comparisonPairAvailable, false);
  assert.equal(result.sameDayOnly, true);
});

test("different dates without a common canonical view do not form a pair", () => {
  const result = select(graph([
    photo("front-1", "front", "2026-09-01", "assessment-before"),
    photo("side-1", "side", "2026-09-05", "assessment-after"),
  ]));
  assert.equal(result.comparisonPairAvailable, false);
});

test("oldest and latest valid front records win when a newer set also has another view", () => {
  const result = select(graph([
    photo("front-1", "front", "2026-09-01", "assessment-before"),
    photo("side-1", "side", "2026-09-05", "assessment-after", { selectedViews: ["side", "front"] }),
    photo("front-2", "front", "2026-09-05", "assessment-after", { selectedViews: ["side", "front"] }),
  ]));
  assert.equal(result.comparisonPairAvailable, true);
  assert.equal(result.view, "front");
  assert.equal(result.before.id, "front-1");
  assert.equal(result.latest.id, "front-2");
});

test("an assessment can prevent the first-photo CTA even when raw photo count is zero", () => {
  const assessments = [{ id: "pose-only", memberId: "m1", status: "analyzing", scope: "full_body", at: "2026-09-05", photos: {}, poses: [{ id: "pose", view: "front", src: "blob:pose", at: "2026-09-05" }] }];
  const result = selectMemberBodyPhotoSurface(assessments, { photoCount: 0 });
  assert.equal(result.assessmentCount, 1);
  assert.equal(result.state, "single");
  assert.equal(result.latest.src, "blob:pose");
});

test("elapsed and since-latest dates remain separate calendar values", () => {
  assert.equal(postureCalendarDays("2026-06-12", "2026-09-04"), 84);
  assert.equal(postureCalendarDays("2026-09-04", "2026-09-05"), 1);
});

test("dark-mode comparison labels keep at least 4.5:1 contrast", () => {
  assert.ok(contrast(DARK_COLORS.ink, DARK_COLORS.card) >= 4.5);
  assert.ok(contrast(DARK_COLORS.primaryDark, DARK_COLORS.tint) >= 4.5);
});

test("member detail reuses normalized assessments, preserves 390px containment, and locks card IDs", async () => {
  const source = await readFile(appPath, "utf8");
  const start = source.indexOf("function ReferenceMemberDetail(");
  const end = source.indexOf("\nfunction ChangeSummary(", start);
  const detail = source.slice(start, end);
  const makerStart = source.indexOf("function ResultCardMaker(");
  const makerEnd = source.indexOf("\nconst aiMetaFrom", makerStart);
  const maker = source.slice(makerStart, makerEnd);

  assert.match(detail, /normalizeAssessmentSets\(photos, \{ memberId: member\.id \}\)/);
  assert.match(detail, /selectMemberBodyPhotoSurface\(assessmentSets, \{ photoCount: rawPhotoCount \}\)/);
  assert.match(detail, /bodyPhotoSurface\.assessmentCount > 0/);
  assert.match(detail, /체형기록 \{bodyPhotoSurface\.assessmentCount\}회/);
  assert.match(detail, /bodyPhotoSurface\.state === "empty"/);
  assert.match(detail, /첫 사진 촬영/);
  assert.match(detail, /비교 카드 만들어 보내기/);
  assert.match(detail, /data-body-photo-pair-view=\{bodyPhotoSurface\.view\}/);
  assert.match(detail, /grid-cols-2 gap-2 overflow-hidden/);
  assert.doesNotMatch(detail, /URL\.createObjectURL/);
  assert.match(detail, /beforeAssessmentId: bodyPhotoSurface\.beforeAssessmentId/);
  assert.match(detail, /afterAssessmentId: bodyPhotoSurface\.afterAssessmentId/);
  assert.match(maker, /const pairUnavailable = locked && !pairView/);
  assert.match(maker, /같은 방향의 사진이 두 장 있어야 비교할 수 있습니다/);
});

test("posture UI keeps tool labels in bounded grids and comparison semantics out of warning colors", async () => {
  const source = await readFile(appPath, "utf8");
  const canvas = source.slice(source.indexOf("function PostureCanvas("), source.indexOf("function MemberList("));
  const comparison = source.slice(source.indexOf("function AssessmentComparisonViewer("), source.indexOf("function LegacyAssessmentWorkspace("));
  const exportCard = source.slice(source.indexOf("async function composeBeforeAfter("), source.indexOf("async function shareBeforeAfter("));
  assert.match(canvas, /grid grid-cols-3 gap-1" data-posture-tool-grid/);
  assert.match(canvas, /flex flex-wrap items-center justify-center gap-0\.5" data-posture-color-grid/);
  assert.doesNotMatch(canvas, /data-posture-tool-grid[^>]*overflow-x-auto/);
  assert.doesNotMatch(comparison, /#356AE6|#F28C28|#4CC3FF|#2389B8/);
  assert.match(comparison, /label: "BEFORE", lineColor: INK2/);
  assert.match(comparison, /label: "AFTER", lineColor: BRAND/);
  assert.equal((comparison.match(/나란히 이미지 저장/g) || []).length, 1);
  assert.match(comparison, /mode === "side" && <button[\s\S]*나란히 이미지 저장/);
  assert.match(comparison, /sameDayComparison/);
  assert.match(comparison, /같은 날 촬영/);
  assert.doesNotMatch(exportCard, /#356AE6|#F28C28|#A594FF/);
  assert.match(exportCard, /formatMemberLessonDate\(before\.date\)/);
  assert.match(exportCard, /formatMemberLessonDate\(after\.date\)/);
  assert.match(exportCard, /, INK2\)/);
  assert.match(exportCard, /, BRAND\)/);
});

test("posture dates reuse the member date formatter and draft sheets stop above the shared tab bar inset", async () => {
  const source = await readFile(appPath, "utf8");
  const workspace = source.slice(source.indexOf("function AssessmentWorkspace("), source.indexOf("function ReferenceAnalysisTab("));
  const analysis = source.slice(source.indexOf("function ReferenceAnalysisTab("), source.indexOf("function MemberTrend("));
  const sheet = source.slice(source.indexOf("function ScheduleBottomSheet("), source.indexOf("function LessonRecordExamplesModal("));
  assert.match(workspace, /const ymd = \(value\) => formatMemberLessonDate\(value\)/);
  assert.match(analysis, /const ymd = \(value\) => formatMemberLessonDate\(value\)/);
  assert.match(source, /--pt-tabbar-height: 49px/);
  assert.match(sheet, /aboveTabBar \? "calc\(var\(--pt-tabbar-height\) \+ max\(env\(safe-area-inset-bottom, 0px\), 8px\)\)" : 0/);
  assert.match(workspace, /진행 중인 체형분석이 있습니다[^\n]*aboveTabBar/);
  assert.match(workspace, /진행 중인 체형분석을 삭제하고 새로 시작할까요\?[^\n]*aboveTabBar/);
});
