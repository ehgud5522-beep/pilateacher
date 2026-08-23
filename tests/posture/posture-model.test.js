import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compareAssessmentMetrics,
  completeAssessmentRecords,
  correctedPoseSource,
  normalizeAssessmentSets,
  normalizePostureView,
  postureAlignmentTransform,
  postureReferenceLines,
  postureRetakeStatus,
  removeAssessmentDraftRecords,
  selectAutomaticComparison,
  selectResumableAssessment,
} from "../../src/features/posture/posture-model.js";
import {
  POSTURE_WORKFLOW_EVENTS,
  createPostureWorkflowState,
  startNewAssessmentEvent,
  transitionPostureWorkflow,
} from "../../src/features/posture/posture-workflow.js";

const appPath = new URL("../../src/App.jsx", import.meta.url);

async function assessmentWorkspaceSource() {
  const source = await readFile(appPath, "utf8");
  const start = source.indexOf("function AssessmentWorkspace(");
  const end = source.indexOf("function ReferenceAnalysisTab(", start);
  assert.ok(start >= 0 && end > start, "active AssessmentWorkspace source must exist");
  return { source, workspace: source.slice(start, end) };
}

test("legacy side remains readable as leftSide without inventing rightSide", () => {
  const sets = normalizeAssessmentSets({
    front: [{ id: "f", assessmentId: "a1", view: "front", date: "2026-01-01" }],
    side: [{ id: "s", assessmentId: "a1", view: "side", date: "2026-01-01" }],
    back: [{ id: "b", assessmentId: "a1", view: "back", date: "2026-01-01" }],
    poses: [{ id: "p", assessmentId: "a1", view: "side", date: "2026-01-01", assessmentComplete: true }],
  });
  assert.equal(normalizePostureView("side"), "leftSide");
  assert.ok(sets[0].photos.leftSide);
  assert.equal(sets[0].photos.rightSide, undefined);
  assert.equal(sets[0].status, "completed");
  assert.deepEqual(sets[0].missingPhotos, []);
});

test("a deleted photo remains visible as missing even when its pose record survives", () => {
  const sets = normalizeAssessmentSets({
    front: [{ assessmentId: "a1", view: "front", selectedViews: ["front", "back"], date: "2026-01-01" }],
    poses: [
      { id: "front-pose", assessmentId: "a1", view: "front", selectedViews: ["front", "back"], date: "2026-01-01" },
      { id: "back-pose", assessmentId: "a1", view: "back", selectedViews: ["front", "back"], date: "2026-01-01", assessmentComplete: true },
    ],
  });
  assert.deepEqual(sets[0].missingPhotos, ["back"]);
  assert.notEqual(sets[0].status, "completed");
});

test("member isolation excludes records that belong to another member", () => {
  const sets = normalizeAssessmentSets({
    front: [
      { assessmentId: "mine", memberId: "m1", view: "front", date: "2026-01-01" },
      { assessmentId: "other", memberId: "m2", view: "front", date: "2026-01-02" },
    ],
  }, { memberId: "m1" });
  assert.deepEqual(sets.map((set) => set.id), ["mine"]);
});

test("automatic comparison picks oldest and newest completed set in the same scope", () => {
  const sets = [
    { id: "middle", status: "completed", scope: "full_body", at: "2026-02-01" },
    { id: "new", status: "completed", scope: "full_body", at: "2026-03-01" },
    { id: "old", status: "completed", scope: "full_body", at: "2026-01-01" },
    { id: "partial", status: "completed", scope: "partial", at: "2025-01-01" },
  ];
  const selected = selectAutomaticComparison(sets);
  assert.equal(selected.before.id, "old");
  assert.equal(selected.after.id, "new");
});

test("assessment favorite is aggregated from its device-only photo and pose records", () => {
  const sets = normalizeAssessmentSets({
    front: [{ id: "photo-1", assessmentId: "assessment-1", memberId: "m1", view: "front", favorite: true, selectedViews: ["front"], assessmentStatus: "completed" }],
    poses: [{ id: "pose-1", assessmentId: "assessment-1", memberId: "m1", view: "front", assessmentComplete: true }],
  }, { memberId: "m1" });
  assert.equal(sets[0].favorite, true);
});

test("automatic comparison orders real instants across timezones and keeps invalid dates deterministic", () => {
  const completed = [
    { id: "invalid", status: "completed", scope: "full_body", at: "unknown" },
    { id: "after", status: "completed", scope: "full_body", completedAt: "2026-08-20T18:00:00Z" },
    { id: "before", status: "completed", scope: "full_body", completedAt: "2026-08-21T01:00:00+09:00" },
    { id: "middle", status: "completed", scope: "full_body", completedAt: "2026-08-20T17:00:00Z" },
  ];
  const selected = selectAutomaticComparison(completed);
  assert.equal(selected.before.id, "before");
  assert.equal(selected.after.id, "after");
});

test("reference lines are derived from saved normalized pose points without mutating them", () => {
  const pose = {
    view: "front",
    pts: {
      nose: { x: 0.5, y: 0.1 },
      earL: { x: 0.42, y: 0.13 }, earR: { x: 0.58, y: 0.13 },
      shL: { x: 0.38, y: 0.25 }, shR: { x: 0.62, y: 0.27 },
      hipL: { x: 0.43, y: 0.52 }, hipR: { x: 0.57, y: 0.51 },
      kneeL: { x: 0.44, y: 0.72 }, kneeR: { x: 0.56, y: 0.73 },
      ankL: { x: 0.45, y: 0.92 }, ankR: { x: 0.55, y: 0.92 },
    },
  };
  const before = structuredClone(pose);
  const lines = postureReferenceLines(pose);
  assert.deepEqual(lines.map((line) => line.key), ["head", "shoulder", "pelvis", "knee", "ankle", "center"]);
  assert.deepEqual(lines.find((line) => line.key === "shoulder").points, [{ x: 0.38, y: 0.25 }, { x: 0.62, y: 0.27 }]);
  assert.equal(lines.find((line) => line.key === "center").points.length, 4);
  assert.deepEqual(pose, before);

  const side = postureReferenceLines({ view: "leftSide", pts: { earL: { x: 0.5, y: 0.1, score: 0.9 }, shL: { x: 0.48, y: 0.3 }, hipL: { x: 0.51, y: 0.55 } } });
  assert.equal(side[0].key, "center");
  assert.equal(side[0].points.length, 3);
  assert.deepEqual(postureReferenceLines({ view: "front", pts: { nose: { x: Number.NaN, y: 0.1 } } }), []);
});

test("comparison metrics match the same view and metric and show neutral before-to-after values", () => {
  const beforeSet = { poses: [
    { view: "front", metrics: [{ key: "shoulder", label: "어깨 기울기", value: 4, unit: "°" }, { key: "align", label: "정렬", value: 2, unit: "°" }] },
    { view: "back", metrics: [{ key: "shoulder", label: "어깨 기울기", value: -3, unit: "°" }] },
  ] };
  const afterSet = { poses: [
    { view: "front", metrics: [{ key: "shoulder", label: "어깨 기울기", value: 1.5, unit: "°" }, { key: "new", label: "신규", value: 9, unit: "°" }] },
    { view: "back", metrics: [{ key: "shoulder", label: "어깨 기울기", value: -4, unit: "°" }] },
  ] };
  const before = structuredClone({ beforeSet, afterSet });
  const front = compareAssessmentMetrics(beforeSet, afterSet, { view: "front" });
  assert.equal(front.length, 1);
  assert.deepEqual(front[0], {
    id: "front:shoulder", key: "shoulder", view: "front", label: "어깨 기울기",
    beforeValue: 4, afterValue: 1.5, difference: -2.5, unit: "°", summary: "0° 기준에 가까워짐",
  });
  assert.deepEqual({ beforeSet, afterSet }, before);
});

test("pose alignment matches body height and center without rotating or mutating landmarks", () => {
  const makePose = (x, headY, floorY) => ({
    view: "front",
    pts: {
      nose: { x, y: headY },
      shL: { x: x - 0.1, y: headY + 0.2 }, shR: { x: x + 0.1, y: headY + 0.2 },
      hipL: { x: x - 0.07, y: headY + 0.45 }, hipR: { x: x + 0.07, y: headY + 0.45 },
      ankL: { x: x - 0.04, y: floorY }, ankR: { x: x + 0.04, y: floorY },
    },
  });
  const beforePose = makePose(0.5, 0.1, 0.9);
  const afterPose = makePose(0.6, 0.2, 0.8);
  const snapshot = structuredClone({ beforePose, afterPose });
  const alignment = postureAlignmentTransform(beforePose, afterPose);
  assert.equal(alignment.available, true);
  assert.equal(alignment.scale, 1.3333);
  assert.equal(alignment.offsetX, -0.1333);
  assert.equal(alignment.offsetY, 0);
  assert.equal(alignment.confidence, "high");
  assert.equal("rotation" in alignment, false);
  assert.deepEqual({ beforePose, afterPose }, snapshot);

  assert.deepEqual(postureAlignmentTransform({ view: "front", pts: { nose: { x: 0.5, y: 0.1 } } }, afterPose), { available: false, reason: "insufficient_landmarks" });
  assert.equal(postureAlignmentTransform(makePose(0.5, 0.1, 0.9), makePose(0.5, 0.45, 0.65)).reason, "unsafe_scale");
});

test("active Before After screen exposes four comparison modes and shared helpers", async () => {
  const source = await readFile(appPath, "utf8");
  const start = source.indexOf("function AssessmentComparisonViewer(");
  const end = source.indexOf("function LegacyAssessmentWorkspace(", start);
  const viewer = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  ["슬라이더", "겹치기", "자동 기준선", "나란히"].forEach((label) => assert.match(viewer, new RegExp(label)));
  assert.match(viewer, /postureReferenceLines\(beforePose\)/);
  assert.match(viewer, /postureAlignmentTransform\(beforePose, afterPose/);
  assert.match(viewer, /compareAssessmentMetrics\(beforeSet, afterSet/);
  assert.match(viewer, /신체 자동 정렬/);
  assert.match(viewer, /alignment\.offsetX \* 100/);
  assert.match(source, /<AssessmentComparisonViewer beforeSet=\{beforeSet\} afterSet=\{afterSet\}/);
  assert.doesNotMatch(source, /comparePercent/);
});

test("a completed one-direction partial drawing is a completed assessment", () => {
  const sets = normalizeAssessmentSets({
    custom: [{
      id: "partial-1_custom", memberId: "m1", assessmentId: "partial-1", view: "custom",
      scope: "partial", selectedViews: ["custom"], assessmentStatus: "draft", captureStatus: "draft",
      analysisMethod: "draw", createdAt: "2026-08-22T10:00:00.000Z",
    }],
    poses: [{
      id: "partial-1_custom_draw", memberId: "m1", assessmentId: "partial-1", view: "custom",
      scope: "partial", selectedViews: ["custom"], analysisSource: "draw",
      assessmentStatus: "completed", assessmentComplete: true, completedAt: "2026-08-22T10:01:00.000Z",
    }],
  }, { memberId: "m1" });
  assert.equal(sets[0].scope, "partial");
  assert.deepEqual(sets[0].selectedViews, ["custom"]);
  assert.equal(sets[0].status, "completed");
  assert.deepEqual(sets[0].missingPhotos, []);
});

test("finalizing a local assessment upgrades its photo and pose records so it is never resumable", () => {
  const source = {
    custom: [{
      id: "partial-1_custom", memberId: "m1", assessmentId: "partial-1", view: "custom",
      scope: "partial", selectedViews: ["custom"], assessmentStatus: "draft", captureStatus: "draft",
      analysisMethod: "draw", blobId: "device-only-blob", createdAt: "2026-08-22T10:00:00.000Z",
    }],
    poses: [{
      id: "partial-1_custom_draw", memberId: "m1", assessmentId: "partial-1", view: "custom",
      scope: "partial", selectedViews: ["custom"], analysisSource: "draw",
      assessmentStatus: "completed", assessmentComplete: true, completedAt: "2026-08-22T10:01:00.000Z",
    }],
  };
  const snapshot = structuredClone(source);
  const completion = completeAssessmentRecords(source, {
    memberId: "m1", assessmentId: "partial-1", role: "after", completedAt: "2026-08-22T10:02:00.000Z",
  });

  assert.equal(completion.blockedReason, null);
  assert.equal(completion.updatedRecords.length, 2);
  assert.deepEqual(source, snapshot);
  assert.equal(completion.memberPhotos.custom[0].captureStatus, "completed");
  assert.equal(completion.memberPhotos.custom[0].assessmentStatus, "completed");
  assert.equal(completion.memberPhotos.custom[0].assessmentRole, "after");
  assert.equal(completion.memberPhotos.custom[0].blobId, "device-only-blob");
  assert.equal(completion.memberPhotos.poses[0].assessmentComplete, true);
  const sets = normalizeAssessmentSets(completion.memberPhotos, { memberId: "m1" });
  assert.equal(sets[0].status, "completed");
  assert.equal(selectResumableAssessment(sets, { memberId: "m1" }), null);
});

test("finalizing blocks an assessment that has no completion evidence", () => {
  const source = {
    front: [{ id: "draft_front", memberId: "m1", assessmentId: "draft", view: "front", selectedViews: ["front"], captureStatus: "draft" }],
  };
  const snapshot = structuredClone(source);
  const completion = completeAssessmentRecords(source, { memberId: "m1", assessmentId: "draft", role: "before" });
  assert.equal(completion.blockedReason, "incomplete");
  assert.deepEqual(completion.memberPhotos, snapshot);
  assert.deepEqual(source, snapshot);
});

test("direct drawing completion upgrades an existing draft and partial sets remain comparable", async () => {
  const source = await readFile(appPath, "utf8");
  const analyzerStart = source.indexOf("function PoseAnalyzer(");
  const analyzerEnd = source.indexOf("function LegacyAssessmentWorkspace(", analyzerStart);
  const analyzer = source.slice(analyzerStart, analyzerEnd);
  const workspaceStart = source.indexOf("function AssessmentWorkspace(");
  const workspaceEnd = source.indexOf("function ReferenceAnalysisTab(", workspaceStart);
  const workspace = source.slice(workspaceStart, workspaceEnd);

  assert.match(analyzer, /const existingDraw = [\s\S]*analysisSource === "draw"/);
  assert.match(analyzer, /const poseStored = await onSavePose\?\.\(\{ \.\.\.existingDraw/);
  assert.match(analyzer, /assessmentStatus: willComplete \? "completed" : "analyzing"/);
  assert.doesNotMatch(analyzer, /if \(!\(photos\?\.poses \|\| \[\]\)\.some\([\s\S]*analysisSource === "draw"/);
  assert.match(analyzer, /completedPoseViews[\s\S]*pose\.assessmentComplete \|\| pose\.assessmentStatus === "completed" \|\| pose\.completedAt/);

  assert.ok(workspace.includes('sets.filter((set) => set.status === "completed")'));
  assert.match(workspace, /\["custom", \.\.\.POSTURE_VIEW_KEYS\]/);
  assert.match(workspace, /const completedInScope = completeSets\.filter\(\(set\) => set\.scope === nextScope\)/);
  assert.match(workspace, /같은 유형과 촬영 방향의 완료 분석이 2개 이상 필요합니다/);
  assert.match(workspace, /comparableViewsFor\(beforeSet, afterSet\)\.map/);
  assert.match(source, /const photosRef = useRef\(\{\}\)/);
  assert.match(source, /const prev = photosRef\.current;[\s\S]*photosRef\.current = next;[\s\S]*setPhotos\(next\)/);
  assert.match(source, /const savePose = async[\s\S]*const currentPhotos = photosRef\.current;[\s\S]*savePhotos\(\{ \.\.\.currentPhotos/);
  assert.match(source, /const saveMarks = async[\s\S]*const currentPhotos = photosRef\.current;[\s\S]*savePhotos\(\{ \.\.\.currentPhotos/);
  assert.match(source, /const saveAssessmentRole = async[\s\S]*const currentPhotos = photosRef\.current;[\s\S]*savePhotos\(\{ \.\.\.currentPhotos/);
  assert.match(source, /const completeAssessment = async[\s\S]*completeAssessmentRecords\(cur,[\s\S]*storage: "device"/);
  assert.match(workspace, /onCompleteAssessment\?\.\(assessmentId, nextRole\)/);
  assert.match(workspace, /completeSets\.length \? "after" : "before"/);
  assert.match(workspace, /이 기기에만 저장됨/);
});

test("retake thresholds use real calendar days", () => {
  const now = new Date("2026-08-03T12:00:00+09:00");
  assert.equal(postureRetakeStatus("2026-07-10", now).tone, "recent");
  assert.equal(postureRetakeStatus("2026-06-24", now).tone, "upcoming");
  assert.equal(postureRetakeStatus("2026-06-01", now).tone, "recommended");
});

test("edited AI points retain a distinct source", () => {
  assert.equal(correctedPoseSource("ai", true), "ai_manual_corrected");
  assert.equal(correctedPoseSource("manual", true), "manual");
  assert.equal(correctedPoseSource("ai", false), "ai");
});

test("CASE 1: no draft starts one new assessment with exactly one ID", async () => {
  assert.equal(selectResumableAssessment([], { memberId: "m1" }), null);
  let idCalls = 0;
  const next = transitionPostureWorkflow(
    createPostureWorkflowState(),
    startNewAssessmentEvent(() => {
      idCalls += 1;
      return "assessment-new";
    }),
  );
  assert.equal(idCalls, 1);
  assert.equal(next.activeAssessmentId, "assessment-new");

  const { workspace } = await assessmentWorkspaceSource();
  assert.equal((workspace.match(/newAssessmentId/g) || []).length, 1);
  assert.match(workspace, /const startNew = \(\) => \{[\s\S]*startNewAssessmentEvent\(newAssessmentId\)/);
  assert.match(workspace, /const startNew = \(\) => \{\s*if \(assessmentAction\.current\) return;\s*assessmentAction\.current = "start"/);
});

test("CASE 2: one draft opens the resume choice without creating an ID", async () => {
  const draft = { id: "draft-1", memberId: "m1", status: "draft", at: "2026-08-20T09:00:00.000Z" };
  assert.equal(selectResumableAssessment([draft], { memberId: "m1" }), draft);

  const { workspace } = await assessmentWorkspaceSource();
  const guardStart = workspace.indexOf("const requestStartNew = () => {");
  const guardEnd = workspace.indexOf("const confirmDiscardAndStartNew", guardStart);
  const guard = workspace.slice(guardStart, guardEnd);
  assert.match(workspace, /const resumableAssessment = useMemo\(\(\) => selectResumableAssessment/);
  assert.ok(guard.indexOf("if (resumableAssessment)") < guard.indexOf("startNew();"));
  assert.match(guard, /setDraftGuard\(\{ step: "choice", assessment: resumableAssessment \}\);[\s\S]*return;/);
  assert.doesNotMatch(guard.slice(0, guard.indexOf("startNew();")), /newAssessmentId/);
  assert.match(workspace, /진행 중인 체형분석이 있습니다/);
  assert.match(workspace, /이전에 저장하던 체형분석을 이어서 진행할 수 있습니다\./);
  assert.match(workspace, />이어하기</);
  assert.match(workspace, />새로 시작</);
});

test("CASE 3: resume keeps the exact assessment ID and saved records", () => {
  const savedPhoto = {
    id: "draft-1_front",
    memberId: "m1",
    assessmentId: "draft-1",
    view: "front",
    selectedViews: ["front"],
    createdAt: "2026-08-20T09:00:00.000Z",
    marks: [{ id: "mark-1", tool: "line", pts: [{ x: 0.2, y: 0.3 }] }],
  };
  const savedPose = {
    id: "draft-1_front_pose",
    memberId: "m1",
    assessmentId: "draft-1",
    view: "front",
    selectedViews: ["front"],
    updatedAt: "2026-08-20T10:00:00.000Z",
    pts: { nose: { x: 0.5, y: 0.2 } },
  };
  const draft = selectResumableAssessment(normalizeAssessmentSets({ front: [savedPhoto], poses: [savedPose] }, { memberId: "m1" }), { memberId: "m1" });
  const resumed = transitionPostureWorkflow(createPostureWorkflowState(), {
    type: POSTURE_WORKFLOW_EVENTS.RESUME_DRAFT,
    assessmentId: draft.id,
    draft,
  });

  assert.equal(resumed.activeAssessmentId, "draft-1");
  assert.equal(resumed.resumeAssessmentId, "draft-1");
  assert.deepEqual(draft.photos.front.marks, savedPhoto.marks);
  assert.deepEqual(draft.poses[0].pts, savedPose.pts);
  assert.deepEqual(resumed.photosByView.front.marks, savedPhoto.marks);
});

test("CASE 4: cancelling start-over preserves the draft and creates no ID", async () => {
  const original = [{ id: "draft-1", memberId: "m1", status: "draft", at: "2026-08-20" }];
  const before = structuredClone(original);
  assert.ok(selectResumableAssessment(original, { memberId: "m1" }));
  assert.deepEqual(original, before);

  const { workspace } = await assessmentWorkspaceSource();
  const confirmStart = workspace.indexOf("진행 중인 체형분석을 삭제하고 새로 시작할까요?");
  const confirmEnd = workspace.indexOf("{roleSheet", confirmStart);
  const confirmUi = workspace.slice(confirmStart, confirmEnd);
  assert.match(confirmUi, /onClick=\{\(\) => setDraftGuard\(null\)\}[\s\S]*>취소<\/button>/);
  assert.doesNotMatch(confirmUi, /newAssessmentId/);
});

test("CASE 5: confirmed start-over removes exact draft records before one new ID", async () => {
  const memberPhotos = {
    front: [
      { id: "active-front", memberId: "m1", assessmentId: "active", blobId: "photo-blob", marks: [{ id: "annotation" }] },
      { id: "older-front", memberId: "m1", assessmentId: "older", blobId: "older-blob", marks: [{ id: "keep" }] },
    ],
    poses: [
      { id: "active-pose", memberId: "m1", assessmentId: "active", blobId: "pose-blob", cleanBlobId: "clean-blob" },
      { id: "older-pose", memberId: "m1", assessmentId: "older", blobId: "older-pose-blob" },
    ],
  };
  const memberPhotosBefore = structuredClone(memberPhotos);
  const removal = removeAssessmentDraftRecords(memberPhotos, { memberId: "m1", assessmentId: "active" });
  assert.deepEqual(removal.removedRecords.map((record) => record.id), ["active-front", "active-pose"]);
  assert.equal(removal.removedRecords[0].marks[0].id, "annotation");
  assert.deepEqual(removal.memberPhotos.front.map((record) => record.id), ["older-front"]);
  assert.deepEqual(removal.memberPhotos.poses.map((record) => record.id), ["older-pose"]);
  assert.deepEqual(memberPhotos, memberPhotosBefore);

  let idCalls = 0;
  const createAfterCleanup = (cleaned) => cleaned
    ? startNewAssessmentEvent(() => { idCalls += 1; return "assessment-new"; })
    : null;
  assert.equal(createAfterCleanup(false), null);
  assert.equal(idCalls, 0);
  assert.equal(createAfterCleanup(true).assessmentId, "assessment-new");
  assert.equal(idCalls, 1);

  const { source, workspace } = await assessmentWorkspaceSource();
  const confirmStart = workspace.indexOf("const confirmDiscardAndStartNew");
  const confirmEnd = workspace.indexOf("const startCapture", confirmStart);
  const confirm = workspace.slice(confirmStart, confirmEnd);
  assert.ok(confirm.indexOf("await onDiscardAssessmentDraft?.(assessment)") < confirm.indexOf("startNew();"));
  assert.match(confirm, /if \(discarded !== true\) \{[\s\S]*return;/);
  assert.doesNotMatch(confirm.slice(0, confirm.indexOf("startNew();")), /newAssessmentId/);

  const cleanupStart = source.indexOf("const discardAssessmentDraft = async");
  const cleanupEnd = source.indexOf("const removePhoto =", cleanupStart);
  const cleanup = source.slice(cleanupStart, cleanupEnd);
  assert.ok(cleanup.indexOf("removeAssessmentDraftRecords") < cleanup.indexOf("await savePhotos(nextPhotos)"));
  assert.ok(cleanup.indexOf("await savePhotos(nextPhotos)") < cleanup.indexOf("Promise.allSettled(discardedBlobIds"));
  assert.match(cleanup, /if \(failedBlobDeletes\.length\) \{[\s\S]*await savePhotos\(currentPhotos\)[\s\S]*return false;/);
  assert.match(cleanup, /failedBlobRestores\.length === 0 \? await savePhotos\(currentPhotos\) : false/);
});

test("CASE 6: another member's draft never affects the selected member", () => {
  const sets = [
    { id: "a-draft", memberId: "member-a", status: "draft", at: "2026-08-20T10:00:00.000Z" },
    { id: "b-draft", memberId: "member-b", status: "analyzing", at: "2026-08-21T10:00:00.000Z" },
  ];
  assert.equal(selectResumableAssessment(sets, { memberId: "member-a" }).id, "a-draft");
  assert.equal(selectResumableAssessment(sets, { memberId: "member-b" }).id, "b-draft");
  assert.equal(selectResumableAssessment(sets, { memberId: "member-c" }), null);

  const mixedBucket = {
    front: [
      { id: "a-record", memberId: "member-a", assessmentId: "shared-id" },
      { id: "b-record", memberId: "member-b", assessmentId: "shared-id" },
    ],
  };
  const removal = removeAssessmentDraftRecords(mixedBucket, { memberId: "member-a", assessmentId: "shared-id" });
  assert.deepEqual(removal.removedRecords.map((record) => record.id), ["a-record"]);
  assert.deepEqual(removal.memberPhotos.front.map((record) => record.id), ["b-record"]);
});

test("CASE 7: completed-only history stays unchanged and permits one new ID", () => {
  const completed = [{ id: "done", memberId: "m1", status: "completed", at: "2026-08-21T10:00:00.000Z" }];
  const before = structuredClone(completed);
  assert.equal(selectResumableAssessment(completed, { memberId: "m1" }), null);
  let idCalls = 0;
  const event = startNewAssessmentEvent(() => { idCalls += 1; return "assessment-new"; });
  assert.equal(event.assessmentId, "assessment-new");
  assert.equal(idCalls, 1);
  assert.deepEqual(completed, before);

  const incompleteCompletedRecords = {
    front: [{ id: "done-front", memberId: "m1", assessmentId: "done-partial", view: "front", selectedViews: ["front", "back"], createdAt: "2026-08-20T09:00:00.000Z" }],
    poses: [{ id: "done-back-pose", memberId: "m1", assessmentId: "done-partial", view: "back", selectedViews: ["front", "back"], assessmentComplete: true, assessmentStatus: "completed", completedAt: "2026-08-20T10:00:00.000Z" }],
  };
  const incompleteCompletedBefore = structuredClone(incompleteCompletedRecords);
  const downgraded = normalizeAssessmentSets(incompleteCompletedRecords, { memberId: "m1" })[0];
  assert.equal(downgraded.status, "analyzing");
  assert.equal(selectResumableAssessment([downgraded], { memberId: "m1" }), null);
  const blockedRemoval = removeAssessmentDraftRecords(incompleteCompletedRecords, { memberId: "m1", assessmentId: "done-partial" });
  assert.equal(blockedRemoval.blockedReason, "completed");
  assert.deepEqual(blockedRemoval.removedRecords, []);
  assert.deepEqual(incompleteCompletedRecords, incompleteCompletedBefore);
});

test("CASE 8: legacy duplicates are not mutated and only the deterministic latest draft is resumable", async () => {
  const candidates = [
    { id: "draft-a", memberId: "m1", status: "draft", at: "2026-08-20T09:00:00.000Z" },
    { id: "draft-y", memberId: "m1", status: "analyzing", createdAt: "2026-08-21T09:00:00.000Z" },
    { id: "draft-z", memberId: "m1", status: "draft", createdAt: "2026-08-21T09:00:00.000Z" },
  ];
  const permutations = [candidates, [...candidates].reverse(), [candidates[1], candidates[0], candidates[2]]];
  permutations.forEach((sets) => {
    const before = structuredClone(sets);
    assert.equal(selectResumableAssessment(sets, { memberId: "m1" }).id, "draft-z");
    assert.deepEqual(sets, before);
    assert.equal(sets.length, 3);
  });

  const sameInstant = [
    { id: "draft-z", memberId: "m1", status: "draft", at: "2026-08-21T00:00:00.000Z" },
    { id: "draft-a", memberId: "m1", status: "draft", at: "2026-08-21T09:00:00.000+09:00" },
  ];
  assert.equal(selectResumableAssessment(sameInstant, { memberId: "m1" }).id, "draft-z");

  const timezoneRecords = {
    front: [
      { id: "draft-a-front-old", memberId: "m1", assessmentId: "draft-a", view: "front", selectedViews: ["front"], createdAt: "2026-08-21T01:00:00+09:00" },
      { id: "draft-a-front-new", memberId: "m1", assessmentId: "draft-a", view: "front", selectedViews: ["front"], updatedAt: "2026-08-20T18:00:00Z" },
      { id: "draft-b-front", memberId: "m1", assessmentId: "draft-b", view: "front", selectedViews: ["front"], createdAt: "2026-08-20T17:00:00Z" },
    ],
  };
  const timezoneSets = normalizeAssessmentSets(timezoneRecords, { memberId: "m1" });
  const normalizedA = timezoneSets.find((set) => set.id === "draft-a");
  const normalizedB = timezoneSets.find((set) => set.id === "draft-b");
  assert.ok(Date.parse(normalizedA.at) < Date.parse(normalizedB.at), "normalizer's legacy string stamp hides draft-a's later photo update");
  assert.equal(normalizedA.photos.front.id, "draft-a-front-new");
  assert.equal(selectResumableAssessment(timezoneSets, { memberId: "m1" }).id, "draft-a");

  const syntheticLegacyRecords = {
    poses: [{ id: "legacy-pose", memberId: "m1", view: "front", date: "2026-08-22", pts: { nose: { x: 0.5, y: 0.2 } } }],
  };
  const syntheticLegacyBefore = structuredClone(syntheticLegacyRecords);
  const syntheticLegacy = normalizeAssessmentSets(syntheticLegacyRecords, { memberId: "m1" })[0];
  assert.equal(syntheticLegacy.id, "legacy_2026-08-22");
  assert.equal(syntheticLegacy.status, "analyzing");
  assert.equal(selectResumableAssessment([syntheticLegacy], { memberId: "m1" }), null);
  assert.deepEqual(syntheticLegacyRecords, syntheticLegacyBefore);

  const { workspace } = await assessmentWorkspaceSource();
  assert.match(workspace, /const resumable = set\.id === resumableAssessment\?\.id/);
  assert.match(workspace, /disabled=\{!completed && !resumable\}/);
  assert.match(workspace, /resumable \? "초안 이어하기" : "이전 중복 초안"/);
});

test("all active new-analysis entry points use the common guard", async () => {
  const { source, workspace } = await assessmentWorkspaceSource();
  assert.equal((workspace.match(/onClick=\{requestStartNew\}/g) || []).length, 4);
  assert.doesNotMatch(workspace, /onClick=\{startNew\}/);
  assert.match(workspace, /if \(initialMode !== "new"\) return;[\s\S]*requestStartNew\(\);/);
  assert.match(source, /onAssess\?\.\(\{ mode: "new" \}\)/);
  assert.match(source, /resumable \? \{ mode: "resume", assessmentId: assessment\.id \} : \{ mode: "history" \}/);
  assert.match(workspace, /const closeDraftGuard = \(\) => \{[\s\S]*assessmentAction\.current !== "discard"/);
  assert.match(workspace, /ScheduleBottomSheet title="진행 중인 체형분석을 삭제하고 새로 시작할까요\?"[^>]*onClose=\{closeDraftGuard\}[^>]*dismissible=\{draftGuard\.step !== "discarding"\}/);
  assert.match(source, /window\.addEventListener\("popstate", \(event\) => \{\s*if \(backSwallow <= 0\) return;\s*backSwallow -= 1;\s*swallowedBackEvents\.add\(event\);\s*\}, true\);/);
  assert.match(source, /function useBackClose\(open, close, locked = false\)[\s\S]*const restoreEntry = \(\) => \{[\s\S]*if \(mine\) return;[\s\S]*window\.history\.pushState\(\{ ptk: token \}/);
  assert.match(source, /if \(backStack\[backStack\.length - 1\] !== entry\) return;[\s\S]*if \(swallowedBackEvents\.has\(event\)\) \{ restoreEntry\(\); return; \}[\s\S]*if \(lockedRef\.current\) \{\s*restoreEntry\(\);[\s\S]*Date\.now\(\) - bornAt < 400\) \{ restoreEntry\(\); return; \}/);
  assert.match(source, /if \(!items\.length\) \{ e\.preventDefault\(\); panelRef\.current\?\.focus\(\); return; \}/);
  assert.match(source, /if \(!items\.includes\(document\.activeElement\)\) \{ e\.preventDefault\(\); \(e\.shiftKey \? b : a\)\.focus\(\); \}/);

  const captureStart = workspace.indexOf("const startCapture =");
  const captureEnd = workspace.indexOf("const openSet =", captureStart);
  assert.doesNotMatch(workspace.slice(captureStart, captureEnd), /newAssessmentId|START_NEW_ASSESSMENT/);
});
