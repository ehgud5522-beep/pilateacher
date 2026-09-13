import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { compareAssessmentMetrics, postureMilestoneTemplate } from "../../src/features/posture/posture-model.js";
import { createMemberBriefing, selectScheduleBriefing } from "../../src/features/member-memory/briefing.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

test("valid and invalid measurements never produce diagnosis or prescription text", async () => {
  const source = await readFile(resolve(root, "src/App.jsx"), "utf8");
  const analyzer = source.slice(source.indexOf("function analyzePose("), source.indexOf("function badge("));
  for (const phrase of ["교정 필요", "O다리 성향", "X다리 성향", "상부승모근", "중둔근 활성", "스쿼트 무릎 궤적 교정", "거북목(머리 전방 이동)"]) {
    assert.doesNotMatch(analyzer, new RegExp(phrase));
  }
  assert.doesNotMatch(analyzer, /\b(level|desc|tip)\s*:/);
  assert.match(analyzer, /label: "어깨선 각도"/);
  assert.match(analyzer, /value: Math\.abs\(r1\(sh\)\)/);
});

test("comparison preserves raw values without improvement or deterioration judgments", () => {
  const before = { poses: [{ view: "front", metrics: [{ key: "shoulder", label: "어깨선 각도", value: 4, unit: "°", validity: { valid: true } }] }] };
  const after = { poses: [{ view: "front", metrics: [{ key: "shoulder", label: "어깨선 각도", value: 1, unit: "°", validity: { valid: true } }] }] };
  const [change] = compareAssessmentMetrics(before, after);
  assert.deepEqual(change, { id: "front:shoulder", key: "shoulder", view: "front", label: "어깨선 각도", beforeValue: 4, afterValue: 1, difference: -3, unit: "°" });
  assert.deepEqual(postureMilestoneTemplate({ role: "after", beforeSet: before, afterSet: after }), { text: "애프터 촬영", details: [], metricIds: [] });
});

test("legacy AI interpretation and prescription fields are not read by posture result surfaces", async () => {
  const source = await readFile(resolve(root, "src/App.jsx"), "utf8");
  const workspace = source.slice(source.indexOf("function AssessmentWorkspace("), source.indexOf("function ReferenceAnalysisTab("));
  assert.doesNotMatch(workspace, /recommendedExercises|memberResultCard|teacherEditedOutput|AI 관찰 내용|추천 운동|주의할 점|좋은 점/);
  assert.match(workspace, /selectStoredPostureResultStates/);
  assert.match(workspace, /강사 메모/);
});

test("posture AI generation routes are disabled before provider execution", async () => {
  const gateway = await readFile(resolve(root, "functions/src/ai-gateway.js"), "utf8");
  const prompts = await readFile(resolve(root, "functions/src/prompts.js"), "utf8");
  assert.match(gateway, /DEFERRED_OPERATIONS = new Set\(\["recommendSequence", "analyzeBody"\]\)/);
  assert.match(gateway, /DEFERRED_REPORT_TYPES = new Set\(\["member_body_assessment_card"\]\)/);
  assert.doesNotMatch(prompts, /운동 제안은 강사 검수용으로 제시/);
  assert.match(prompts, /운동 처방을 생성하지 마세요/);
});

test("legacy posture interpretations do not enter member or schedule briefings", () => {
  const legacy = { id: "legacy-posture", type: "milestone", category: "posture", source: "posture_analysis", status: "active", text: "O다리 성향 · 중둔근 활성", lastSeenAt: "2026-09-01", seenCount: 1, sourceRefs: [{ type: "assessment", id: "a1", date: "2026-09-01" }] };
  const briefing = createMemberBriefing({ member: { notes: [], aiMemory: [legacy] } });
  assert.deepEqual(briefing.lines, []);
  assert.equal(selectScheduleBriefing(briefing), null);
});
