import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { appendVoiceSessionDiagnostic } from "../../src/features/voice/voice-session.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

function memoryStorage() {
  const cells = new Map();
  return { getItem: (k) => (cells.has(k) ? cells.get(k) : null), setItem: (k, v) => cells.set(k, String(v)) };
}

/* One shoot saved as two sets. Sets are grouped by assessmentId, so the
   question is whether that id changes mid-shoot -- and if so, where. */

test("an id change reaches the on-device diagnostics with both ids", () => {
  /* Unregistered stages and unlisted fields are dropped silently, which is how
     an instrumented question gets no answer. */
  const entry = appendVoiceSessionDiagnostic("assessment_id_changed", {
    source: "assessment", reason: "resume_draft", state: "replaced",
    assessmentId: "asmt_b_2", previousAssessmentId: "asmt_a_1",
  }, memoryStorage());
  assert.ok(entry, "the stage is dropped before it reaches diagnostics");
  assert.equal(entry.event, "assessment_id_changed");
  assert.equal(entry.assessmentId, "asmt_b_2");
  assert.equal(entry.previousAssessmentId, "asmt_a_1", "without the old id the change says nothing");
  assert.equal(entry.reason, "resume_draft");
});

test("the first id is distinguishable from a replacement", () => {
  const first = appendVoiceSessionDiagnostic("assessment_id_changed", {
    source: "assessment", reason: "start", state: "first", assessmentId: "asmt_a_1",
  }, memoryStorage());
  assert.equal(first.state, "first");
  assert.ok(!("previousAssessmentId" in first), "there was no previous id to record");
});

test("a draft save that had to invent an id is recorded", () => {
  const entry = appendVoiceSessionDiagnostic("assessment_id_generated", {
    source: "save_capture_draft", state: "legacy_shape", assessmentId: "asmt_x",
  }, memoryStorage());
  assert.ok(entry);
  assert.equal(entry.state, "legacy_shape");
  assert.equal(entry.assessmentId, "asmt_x");
});

/* ------------------------------ the wiring ------------------------------ */

test("every write of the id goes through the recorded path", async () => {
  const source = await appSource();
  /* A direct assignment would change the id without leaving a trace, which is
     exactly the case being hunted. */
  assert.equal((source.match(/assessmentId\.current = /g) || []).length, 1,
    "the only assignment is the one inside adoptAssessmentId");
  const start = source.indexOf("const adoptAssessmentId = (next, reason)");
  const helper = source.slice(start, source.indexOf("const startAssessment", start));
  assert.match(helper, /assessmentId\.current = value;/, "and it lives there");
  assert.match(source, /adoptAssessmentId\(initialAssessmentId \|\| newAssessmentId\(\), "start"\)/);
  assert.match(source, /adoptAssessmentId\(resumeDraft\.id, "resume_draft"\)/);
});

test("an unchanged id is not logged as a change", async () => {
  const source = await appSource();
  // Otherwise the trail fills with noise and a real change is lost in it.
  assert.match(source, /if \(!value \|\| value === assessmentId\.current\) return;/);
});

test("the change is recorded before the value moves", async () => {
  const source = await appSource();
  const start = source.indexOf("const adoptAssessmentId = (next, reason)");
  const body = source.slice(start, source.indexOf("const startAssessment", start));
  assert.ok(body.indexOf("previousAssessmentId: assessmentId.current") < body.indexOf("assessmentId.current = value;"),
    "the previous id has to be read before it is overwritten");
});

test("the draft-save fallback reports itself rather than passing silently", async () => {
  const source = await appSource();
  const start = source.indexOf("const saveCaptureDraft = async (memberId, input)");
  const body = source.slice(start, start + 1600);
  assert.match(body, /if \(!input\.captures \|\| !input\.assessmentId\) \{/);
  assert.match(body, /appendVoiceSessionDiagnostic\("assessment_id_generated", \{/);
  assert.match(body, /state: input\.captures \? "missing_id" : "legacy_shape"/);
});

test("the capture screen still passes its own id to every save", async () => {
  const source = await appSource();
  /* This is what makes the fallback above a signal: if the screen always
     supplies the id, a generated one can only come from somewhere else. */
  assert.match(source, /onSaveCaptureDraft\(\{ assessmentId: assessmentId\.current, analysisMethod, scope, selectedViews: captureKeys, assessmentRole: analysisRole\.current, captures: pending \}\)/);
  assert.match(source, /onSaveCaptureDraft\(\{ assessmentId: assessmentId\.current, analysisMethod, scope, selectedViews: captureKeys, assessmentRole: analysisRole\.current, captures: \{ \[capturedView\]: blob \}/);
});

test("the id is carried on the saves that build a set", async () => {
  const source = await appSource();
  // Correlating these two with the change log is what identifies the split.
  assert.match(source, /deviceLog\("assessment_draft_saved", \{ memberId: analysisMemberId\.current, assessmentId: assessmentId\.current/);
  assert.match(source, /deviceLog\("pose_result_saved", \{ memberId: target\.id, assessmentId: out\.assessmentId/);
});
