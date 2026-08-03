import { POSTURE_VIEW_KEYS, normalizePostureView } from "./posture-model.js";

export const POSTURE_WORKFLOW_EVENTS = Object.freeze({
  START_NEW_ASSESSMENT: "START_NEW_ASSESSMENT",
  RESUME_DRAFT: "RESUME_DRAFT",
  OPEN_COMPLETED_ASSESSMENT: "OPEN_COMPLETED_ASSESSMENT",
});

export const POSTURE_WORKFLOW_STATES = Object.freeze({
  ENTRY: "ENTRY",
  PURPOSE: "PURPOSE",
  CAPTURE: "CAPTURE",
  ANALYSIS: "ANALYSIS",
  RESULT: "RESULT",
});

export class PostureWorkflowTransitionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PostureWorkflowTransitionError";
    this.code = code;
  }
}

const emptyRecord = () => ({});
const defaultViews = () => [...POSTURE_VIEW_KEYS];

function requiredId(value, code) {
  const id = String(value || "").trim();
  if (!id) throw new PostureWorkflowTransitionError(code, "assessmentId is required");
  return id;
}

function draftIdOf(draft) {
  return String(draft?.assessmentId || draft?.id || "").trim();
}

function completedIdOf(assessment) {
  return String(assessment?.assessmentId || assessment?.id || "").trim();
}

function normalizedViews(views) {
  const source = Array.isArray(views) ? views : [];
  const normalized = [...new Set(source.map(normalizePostureView).filter((view) => view === "custom" || POSTURE_VIEW_KEYS.includes(view)))];
  return normalized.length ? normalized : defaultViews();
}

function copiedRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : emptyRecord();
}

export function createPostureWorkflowState(overrides = {}) {
  return {
    activeAssessmentId: null,
    resumeAssessmentId: null,
    selectedHistoryAssessmentId: null,
    comparisonBeforeId: null,
    comparisonAfterId: null,
    photosByView: emptyRecord(),
    posesByView: emptyRecord(),
    annotationsByView: emptyRecord(),
    selectedViews: defaultViews(),
    purpose: null,
    scope: null,
    assessmentRole: null,
    analysisMethod: null,
    activeView: null,
    captureIndex: 0,
    workflowState: POSTURE_WORKFLOW_STATES.ENTRY,
    ...overrides,
  };
}

export function startNewAssessmentEvent(createAssessmentId) {
  if (typeof createAssessmentId !== "function") {
    throw new PostureWorkflowTransitionError("id_factory_required", "assessment ID factory is required");
  }
  return {
    type: POSTURE_WORKFLOW_EVENTS.START_NEW_ASSESSMENT,
    assessmentId: requiredId(createAssessmentId(), "new_assessment_id_required"),
  };
}

export function transitionPostureWorkflow(currentState, event) {
  const state = createPostureWorkflowState(currentState);
  if (!event || typeof event !== "object") {
    throw new PostureWorkflowTransitionError("event_required", "workflow event is required");
  }

  switch (event.type) {
    case POSTURE_WORKFLOW_EVENTS.START_NEW_ASSESSMENT: {
      const assessmentId = requiredId(event.assessmentId, "new_assessment_id_required");
      return {
        ...state,
        activeAssessmentId: assessmentId,
        resumeAssessmentId: null,
        selectedHistoryAssessmentId: null,
        comparisonBeforeId: null,
        comparisonAfterId: null,
        photosByView: emptyRecord(),
        posesByView: emptyRecord(),
        annotationsByView: emptyRecord(),
        selectedViews: defaultViews(),
        purpose: null,
        scope: null,
        assessmentRole: null,
        analysisMethod: null,
        activeView: null,
        captureIndex: 0,
        workflowState: POSTURE_WORKFLOW_STATES.PURPOSE,
      };
    }

    case POSTURE_WORKFLOW_EVENTS.RESUME_DRAFT: {
      const assessmentId = requiredId(event.assessmentId, "resume_assessment_id_required");
      const draft = event.draft;
      if (!draft || typeof draft !== "object") {
        throw new PostureWorkflowTransitionError("draft_required", "an exact draft is required");
      }
      if (draftIdOf(draft) !== assessmentId) {
        throw new PostureWorkflowTransitionError("draft_id_mismatch", "draft assessmentId does not match the requested assessmentId");
      }
      if (!["draft", "analyzing"].includes(draft.status)) {
        throw new PostureWorkflowTransitionError("draft_not_resumable", "only draft or analyzing assessments can be resumed");
      }
      const selectedViews = normalizedViews(draft.selectedViews);
      const activeView = selectedViews.includes(normalizePostureView(draft.activeView))
        ? normalizePostureView(draft.activeView)
        : selectedViews[0];
      return {
        ...state,
        activeAssessmentId: assessmentId,
        resumeAssessmentId: assessmentId,
        selectedHistoryAssessmentId: null,
        comparisonBeforeId: null,
        comparisonAfterId: null,
        photosByView: copiedRecord(draft.photosByView || draft.photos),
        posesByView: copiedRecord(draft.posesByView),
        annotationsByView: copiedRecord(draft.annotationsByView),
        selectedViews,
        purpose: draft.purpose ?? null,
        scope: draft.scope ?? null,
        assessmentRole: draft.assessmentRole ?? draft.role ?? null,
        analysisMethod: draft.analysisMethod ?? draft.method ?? null,
        activeView,
        captureIndex: Number.isInteger(draft.captureIndex) && draft.captureIndex >= 0 ? draft.captureIndex : 0,
        workflowState: [POSTURE_WORKFLOW_STATES.CAPTURE, POSTURE_WORKFLOW_STATES.ANALYSIS].includes(draft.workflowState)
          ? draft.workflowState
          : POSTURE_WORKFLOW_STATES.CAPTURE,
      };
    }

    case POSTURE_WORKFLOW_EVENTS.OPEN_COMPLETED_ASSESSMENT: {
      const assessmentId = requiredId(event.assessmentId, "completed_assessment_id_required");
      const assessment = event.assessment;
      if (!assessment || typeof assessment !== "object") {
        throw new PostureWorkflowTransitionError("completed_assessment_required", "an exact completed assessment is required");
      }
      if (completedIdOf(assessment) !== assessmentId) {
        throw new PostureWorkflowTransitionError("completed_assessment_id_mismatch", "completed assessmentId does not match the requested assessmentId");
      }
      if (assessment.status !== "completed") {
        throw new PostureWorkflowTransitionError("assessment_not_completed", "only completed assessments can be opened as a result");
      }
      return {
        ...state,
        activeAssessmentId: null,
        resumeAssessmentId: null,
        selectedHistoryAssessmentId: assessmentId,
        comparisonBeforeId: null,
        comparisonAfterId: null,
        photosByView: emptyRecord(),
        posesByView: emptyRecord(),
        annotationsByView: emptyRecord(),
        activeView: null,
        captureIndex: 0,
        workflowState: POSTURE_WORKFLOW_STATES.RESULT,
      };
    }

    default:
      throw new PostureWorkflowTransitionError("unknown_event", `unsupported workflow event: ${String(event.type || "")}`);
  }
}
