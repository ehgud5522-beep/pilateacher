import assert from "node:assert/strict";
import test from "node:test";

import {
  POSTURE_WORKFLOW_EVENTS,
  POSTURE_WORKFLOW_STATES,
  PostureWorkflowTransitionError,
  createPostureWorkflowState,
  startNewAssessmentEvent,
  transitionPostureWorkflow,
} from "../../src/features/posture/posture-workflow.js";

test("START_NEW_ASSESSMENT creates one new identity and clears all prior workflow state", () => {
  let calls = 0;
  const event = startNewAssessmentEvent(() => {
    calls += 1;
    return "assessment-new";
  });
  const previous = createPostureWorkflowState({
    activeAssessmentId: "assessment-draft",
    resumeAssessmentId: "assessment-draft",
    selectedHistoryAssessmentId: "assessment-completed",
    comparisonBeforeId: "before",
    comparisonAfterId: "after",
    photosByView: { front: { id: "photo" } },
    posesByView: { front: { id: "pose" } },
    annotationsByView: { front: [{ type: "line" }] },
    selectedViews: ["front"],
    purpose: "full_body",
    scope: "full_body",
    assessmentRole: "after",
    analysisMethod: "ai",
    activeView: "front",
    captureIndex: 3,
    workflowState: POSTURE_WORKFLOW_STATES.CAPTURE,
  });

  const next = transitionPostureWorkflow(previous, event);

  assert.equal(calls, 1);
  assert.equal(next.activeAssessmentId, "assessment-new");
  assert.equal(next.resumeAssessmentId, null);
  assert.equal(next.selectedHistoryAssessmentId, null);
  assert.equal(next.comparisonBeforeId, null);
  assert.equal(next.comparisonAfterId, null);
  assert.deepEqual(next.photosByView, {});
  assert.deepEqual(next.posesByView, {});
  assert.deepEqual(next.annotationsByView, {});
  assert.deepEqual(next.selectedViews, ["front", "leftSide", "back", "rightSide"]);
  assert.equal(next.purpose, null);
  assert.equal(next.scope, null);
  assert.equal(next.assessmentRole, null);
  assert.equal(next.analysisMethod, null);
  assert.equal(next.activeView, null);
  assert.equal(next.captureIndex, 0);
  assert.equal(next.workflowState, POSTURE_WORKFLOW_STATES.PURPOSE);
  assert.equal(previous.activeAssessmentId, "assessment-draft");
  assert.deepEqual(previous.photosByView, { front: { id: "photo" } });
});

test("START_NEW_ASSESSMENT never falls back to an existing draft", () => {
  const previous = createPostureWorkflowState({
    activeAssessmentId: "latest-draft",
    resumeAssessmentId: "latest-draft",
    photosByView: { front: { assessmentId: "latest-draft" } },
  });
  const next = transitionPostureWorkflow(previous, {
    type: POSTURE_WORKFLOW_EVENTS.START_NEW_ASSESSMENT,
    assessmentId: "brand-new",
  });

  assert.equal(next.activeAssessmentId, "brand-new");
  assert.equal(next.resumeAssessmentId, null);
  assert.deepEqual(next.photosByView, {});
});

test("RESUME_DRAFT restores only the exact requested assessmentId without generating another ID", () => {
  const draft = {
    id: "draft-2",
    status: "analyzing",
    selectedViews: ["front", "side", "back"],
    photos: { front: { id: "photo-front" } },
    posesByView: { front: { id: "pose-front" } },
    annotationsByView: { front: [{ type: "arrow" }] },
    purpose: "full_body",
    scope: "full_body",
    role: "after",
    method: "ai",
    activeView: "side",
    captureIndex: 1,
    workflowState: POSTURE_WORKFLOW_STATES.ANALYSIS,
  };
  const next = transitionPostureWorkflow(createPostureWorkflowState({ activeAssessmentId: "unrelated" }), {
    type: POSTURE_WORKFLOW_EVENTS.RESUME_DRAFT,
    assessmentId: "draft-2",
    draft,
  });

  assert.equal(next.activeAssessmentId, "draft-2");
  assert.equal(next.resumeAssessmentId, "draft-2");
  assert.equal(next.selectedHistoryAssessmentId, null);
  assert.deepEqual(next.selectedViews, ["front", "leftSide", "back"]);
  assert.equal(next.activeView, "leftSide");
  assert.equal(next.captureIndex, 1);
  assert.equal(next.workflowState, POSTURE_WORKFLOW_STATES.ANALYSIS);
  assert.deepEqual(next.photosByView, draft.photos);
  assert.notEqual(next.photosByView, draft.photos);
});

test("RESUME_DRAFT rejects missing, mismatched, and completed records instead of falling back", () => {
  const state = createPostureWorkflowState();
  const cases = [
    {
      event: { type: POSTURE_WORKFLOW_EVENTS.RESUME_DRAFT, assessmentId: "draft-a" },
      code: "draft_required",
    },
    {
      event: { type: POSTURE_WORKFLOW_EVENTS.RESUME_DRAFT, assessmentId: "draft-a", draft: { id: "draft-b", status: "draft" } },
      code: "draft_id_mismatch",
    },
    {
      event: { type: POSTURE_WORKFLOW_EVENTS.RESUME_DRAFT, assessmentId: "done", draft: { id: "done", status: "completed" } },
      code: "draft_not_resumable",
    },
  ];

  cases.forEach(({ event, code }) => {
    assert.throws(
      () => transitionPostureWorkflow(state, event),
      (error) => error instanceof PostureWorkflowTransitionError && error.code === code,
    );
  });
});

test("OPEN_COMPLETED_ASSESSMENT selects the exact completed ID and clears capture state", () => {
  const previous = createPostureWorkflowState({
    activeAssessmentId: "draft-a",
    resumeAssessmentId: "draft-a",
    photosByView: { front: { id: "photo" } },
    posesByView: { front: { id: "pose" } },
    annotationsByView: { front: [{ type: "text" }] },
  });
  const next = transitionPostureWorkflow(previous, {
    type: POSTURE_WORKFLOW_EVENTS.OPEN_COMPLETED_ASSESSMENT,
    assessmentId: "completed-b",
    assessment: { id: "completed-b", status: "completed" },
  });

  assert.equal(next.activeAssessmentId, null);
  assert.equal(next.resumeAssessmentId, null);
  assert.equal(next.selectedHistoryAssessmentId, "completed-b");
  assert.deepEqual(next.photosByView, {});
  assert.deepEqual(next.posesByView, {});
  assert.deepEqual(next.annotationsByView, {});
  assert.equal(next.workflowState, POSTURE_WORKFLOW_STATES.RESULT);
});

test("OPEN_COMPLETED_ASSESSMENT cannot open a different or unfinished record", () => {
  const state = createPostureWorkflowState();
  assert.throws(
    () => transitionPostureWorkflow(state, {
      type: POSTURE_WORKFLOW_EVENTS.OPEN_COMPLETED_ASSESSMENT,
      assessmentId: "completed-a",
      assessment: { id: "completed-b", status: "completed" },
    }),
    (error) => error instanceof PostureWorkflowTransitionError && error.code === "completed_assessment_id_mismatch",
  );
  assert.throws(
    () => transitionPostureWorkflow(state, {
      type: POSTURE_WORKFLOW_EVENTS.OPEN_COMPLETED_ASSESSMENT,
      assessmentId: "draft-a",
      assessment: { id: "draft-a", status: "draft" },
    }),
    (error) => error instanceof PostureWorkflowTransitionError && error.code === "assessment_not_completed",
  );
});
