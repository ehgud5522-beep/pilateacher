import assert from "node:assert/strict";
import test from "node:test";

import {
  correctedPoseSource,
  normalizeAssessmentSets,
  normalizePostureView,
  postureRetakeStatus,
  selectAutomaticComparison,
} from "../../src/features/posture/posture-model.js";

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
