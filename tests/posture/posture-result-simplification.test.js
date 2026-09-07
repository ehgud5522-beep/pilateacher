import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  POSTURE_RESULT_STATUSES,
  selectPostureResultStates,
  selectStoredPostureResultStates,
} from "../../src/features/posture/result-presentation.js";

const appPath = new URL("../../src/App.jsx", import.meta.url);
const frontPoints = {
  shL: { x: 0.3, y: 0.31, score: 1 }, shR: { x: 0.7, y: 0.34, score: 1 },
  hipL: { x: 0.36, y: 0.58, score: 1 }, hipR: { x: 0.64, y: 0.57, score: 1 },
  kneeL: { x: 0.37, y: 0.75, score: 1 }, kneeR: { x: 0.63, y: 0.75, score: 1 },
  ankL: { x: 0.38, y: 0.94, score: 1 }, ankR: { x: 0.62, y: 0.94, score: 1 },
  earL: { x: 0.43, y: 0.18, score: 1 }, earR: { x: 0.57, y: 0.2, score: 1 },
};
const coreMetrics = [
  { key: "shoulder", value: 3, validity: { valid: true, reason: null } },
  { key: "pelvis", value: 1, validity: { valid: true, reason: null } },
  { key: "knee", value: 4, validity: { valid: true, reason: null } },
  { key: "head", value: 3, validity: { valid: true, reason: null } },
];

async function activeSources() {
  const source = await readFile(appPath, "utf8");
  const analyzerStart = source.indexOf("function PoseAnalyzer(");
  const workspaceStart = source.indexOf("function AssessmentWorkspace(", analyzerStart);
  const workspaceEnd = source.indexOf("function ReferenceAnalysisTab(", workspaceStart);
  assert.ok(analyzerStart >= 0 && workspaceStart > analyzerStart && workspaceEnd > workspaceStart);
  return { analyzer: source.slice(analyzerStart, workspaceStart), workspace: source.slice(workspaceStart, workspaceEnd) };
}

test("automatic detection reaches the result state without opening correction first", async () => {
  const { analyzer } = await activeSources();
  const detect = analyzer.slice(analyzer.indexOf("const detect = async"), analyzer.indexOf("const startManual ="));
  assert.match(detect, /setPts\(next\)/);
  assert.doesNotMatch(detect, /setCorrectionPicker\(true\)/);
  assert.match(analyzer, /selectPostureResultStates/);
});

test("the result photo is full-width content before status cards", async () => {
  const { analyzer } = await activeSources();
  assert.ok(analyzer.indexOf('aria-label="변화 기록 결과 사진"') < analyzer.indexOf('aria-label="핵심 상태"'));
  assert.match(analyzer, /res \? "-mx-3"/);
});

test("the result selector returns at most four core states", () => {
  const result = selectPostureResultStates({ metrics: [...coreMetrics, { key: "twist", value: 7 }], points: frontPoints });
  assert.equal(result.length, 4);
  assert.deepEqual(result.map((entry) => entry.label), ["어깨", "골반", "무릎", "머리"]);
});

test("every generated status belongs to the fixed product vocabulary", () => {
  const result = selectPostureResultStates({ metrics: coreMetrics, points: frontPoints });
  result.forEach((entry) => assert.ok(POSTURE_RESULT_STATUSES.includes(entry.status)));
  assert.deepEqual(result.map((entry) => entry.status), ["왼쪽 약간 높음", "좌우 비슷함", "좌우 정렬 차이 있음", "왼쪽 기울어짐"]);
});

test("invalid and legacy measurements are revalidated as measurement recheck", () => {
  const current = selectPostureResultStates({ metrics: coreMetrics, invalidMeasurements: [{ key: "head", reason: "LOW_CONFIDENCE" }], points: frontPoints });
  assert.equal(current.find((entry) => entry.key === "head")?.status, "측정 재확인");
  const stored = selectStoredPostureResultStates({ metrics: [{ key: "head", value: 3 }], pts: { ...frontPoints, earL: { x: 0.5, y: 0.2, score: 0.1 } }, measurementTransform: { coordinateSpace: "normalized", width: 100, height: 200 } });
  assert.deepEqual(stored, [{ key: "head", label: "머리", status: "측정 재확인" }]);
});

test("the main result contains no raw angles, long interpretation, AI, prescription, or diagnosis", async () => {
  const { analyzer, workspace } = await activeSources();
  const resultStart = analyzer.indexOf('{res && (res.items.length > 0');
  const resultEnd = analyzer.indexOf("{!embedded && saved.length", resultStart);
  const mainResult = analyzer.slice(resultStart, resultEnd);
  assert.doesNotMatch(mainResult, /i\.value|i\.unit|res\.notes|AI 해석|추천 운동|주의|교정 필요|정상|비정상|개선|악화/);
  assert.doesNotMatch(workspace, /결과 리포트 카드|회원 결과카드 확정|screen === "report"/);
});

test("correction is opt-in and returns to the same calculated result", async () => {
  const { analyzer } = await activeSources();
  assert.match(analyzer, /if \(!correctionMode && !manual\) return/);
  assert.match(analyzer, /setCorrectionMode\(true\)/);
  assert.match(analyzer, /correctionMode \? "수정 완료" : "수정하기"/);
  assert.match(analyzer, /setCorrectionMode\(false\); setManual\(null\)/);
});

test("result save completes the assessment and exits without the result-card draft route", async () => {
  const { analyzer, workspace } = await activeSources();
  const save = analyzer.slice(analyzer.indexOf("const save = async"), analyzer.indexOf("const copy = async"));
  assert.match(save, /await onSaved\?\.\(analysisRole\.current, assessmentId\.current\)/);
  assert.match(workspace, /setScreen\("history"\)/);
  assert.doesNotMatch(workspace, /openReportForSet|setScreen\("report"\)|<ResultCardMaker/);
});
