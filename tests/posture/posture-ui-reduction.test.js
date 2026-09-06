import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appPath = new URL("../../src/App.jsx", import.meta.url);

async function postureSources() {
  const source = await readFile(appPath, "utf8");
  const makerStart = source.indexOf("function ResultCardMaker(");
  const makerEnd = source.indexOf("\nconst aiMetaFrom", makerStart);
  const viewerStart = source.indexOf("function AssessmentComparisonViewer(");
  const viewerEnd = source.indexOf("function LegacyAssessmentWorkspace(", viewerStart);
  const workspaceStart = source.indexOf("function AssessmentWorkspace(");
  const workspaceEnd = source.indexOf("function ReferenceAnalysisTab(", workspaceStart);
  assert.ok(makerStart >= 0 && makerEnd > makerStart);
  assert.ok(viewerStart >= 0 && viewerEnd > viewerStart);
  assert.ok(workspaceStart >= 0 && workspaceEnd > workspaceStart);
  return {
    source,
    maker: source.slice(makerStart, makerEnd),
    viewer: source.slice(viewerStart, viewerEnd),
    workspace: source.slice(workspaceStart, workspaceEnd),
  };
}

test("posture workspace removes progress, favorite, and primary manual-pair controls without changing selectors", async () => {
  const { source, maker, workspace } = await postureSources();

  assert.match(workspace, /normalizeAssessmentSets\(photos, \{ memberId: member\?\.id \}\)/);
  assert.match(workspace, /selectAutomaticComparison\(sets, \{ scope: latestCompletedScope \}\)/);
  assert.doesNotMatch(workspace, /number: 1[\s\S]*label: "촬영"[\s\S]*label: "분석"[\s\S]*label: "결과"/);
  assert.doesNotMatch(workspace, /비교할 Before \/ After 직접 선택/);
  assert.match(workspace, /비교 사진 바꾸기/);
  assert.match(workspace, /setSetPicker\("before"\)/);
  assert.match(workspace, /setSetPicker\("after"\)/);
  assert.doesNotMatch(workspace, /즐겨찾기/);
  assert.match(source, /favorite: Boolean\(favorite\)/, "legacy favorite data remains intact");
  assert.match(maker, /showPairPicker/);
  assert.match(maker, /비교 사진 바꾸기/);
});

test("member-facing result UI uses integer degree presentation and fixed design-token colors", async () => {
  const { source, maker, viewer, workspace } = await postureSources();

  assert.match(source, /const memberMetricValue = \(value, unit\) => unit === "°"[\s\S]*Math\.round/);
  assert.match(viewer, /memberMetricValue\(metric\.beforeValue, metric\.unit\)/);
  assert.match(viewer, /memberMetricValue\(metric\.afterValue, metric\.unit\)/);
  assert.match(workspace, /memberMetricValue\(metric\.value, metric\.unit\)/);
  assert.match(workspace, /memberMetricValue\(change\.beforeValue, change\.unit\)/);
  assert.match(workspace, /memberMetricValue\(change\.afterValue, change\.unit\)/);
  assert.doesNotMatch(workspace, /\{metric\.value\}\{metric\.unit\}/);
  assert.doesNotMatch(workspace, /\{change\.beforeValue\}\{change\.unit\}/);
  assert.doesNotMatch(maker, /개선되었습니다|정렬 개선/);
  assert.doesNotMatch(maker, /CARD_COLORS|BEFORE 표시 색|AFTER 표시 색|글자 색/);
  assert.match(maker, /const cb = INK2/);
  assert.match(maker, /const ca = BRAND/);
  assert.match(maker, /const textColor = INK/);
});

test("empty result rows stay hidden and comparison content precedes secondary controls", async () => {
  const { viewer, workspace } = await postureSources();

  ["저장된 AI 해석 없음", "저장된 강사 메모가 없습니다", "정상 범위로 저장된 측정값 없음", "기록된 주의 결과 없음", "비교 가능한 실제 측정값이 아직 없습니다"].forEach((copy) => {
    assert.doesNotMatch(workspace, new RegExp(copy));
  });
  assert.ok(viewer.indexOf('mode === "side"') < viewer.indexOf("modes.map"), "comparison photos must render before mode settings");
  assert.ok(workspace.indexOf("<AssessmentComparisonViewer") < workspace.indexOf("비교 사진 바꾸기"), "comparison image must precede pair controls");
  assert.doesNotMatch(workspace, /overflow-x-auto/);
});

test("change comparison keeps photos primary and reports neutral values without AI interpretation", async () => {
  const { source, viewer, workspace } = await postureSources();
  assert.match(viewer, /Before \{memberMetricValue\(metric\.beforeValue, metric\.unit\)\}/);
  assert.match(viewer, /After \{memberMetricValue\(metric\.afterValue, metric\.unit\)\}/);
  assert.match(viewer, /차이 \{metric\.difference > 0 \? "\+" : ""\}/);
  assert.doesNotMatch(viewer, /metric\.summary/);
  assert.doesNotMatch(workspace, /After AI 관찰/);
  assert.match(workspace, /공통 촬영 방향이 없습니다/);
  assert.match(source, /label: "변화 기록"/);
  assert.match(workspace, />변화 비교<\/button>/);
});

test("drawing keeps the photo primary and hides advanced color controls by default", async () => {
  const { source } = await postureSources();
  const start = source.indexOf("function PostureCanvas(");
  const end = source.indexOf("function AppInfo", start);
  const canvas = source.slice(start, end);

  assert.doesNotMatch(canvas, /사진이 등록됐습니다/);
  assert.match(canvas, /grid grid-cols-6 gap-1/);
  assert.match(canvas, /<details className="mt-1 border-t pt-1"/);
  assert.match(canvas, /색상·굵기/);
  ["기준선", "자", "펜", "화살표", "손메모", "삭제"].forEach((label) => assert.match(canvas, new RegExp(`l: "${label}"`)));
});

test("completed capture returns to history and comparison actions only render for valid pairs", async () => {
  const { workspace } = await postureSources();
  const savedHandler = workspace.slice(workspace.indexOf("onSaved={async"), workspace.indexOf("screen === \"history\""));

  assert.match(savedHandler, /setScreen\("history"\)/);
  assert.doesNotMatch(savedHandler, /setScreen\("result"\)/);
  assert.doesNotMatch(workspace, /에프터 촬영 시작<\/button>/);
  assert.match(workspace, /completed && comparablePair\.after && <button/);
  assert.match(workspace, /comparisonPairFor\(selected\)\.after && <button/);
  assert.doesNotMatch(workspace, /disabled=\{!completed \|\| !comparablePair\.after\}/);
});
