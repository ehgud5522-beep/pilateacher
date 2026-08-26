import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  describeLessonRecordFailure,
  LESSON_RECORD_DEBUG_CODES,
  LESSON_RECORD_FAILURE_CATEGORY,
  setLessonRecordDebugFailure,
  takeLessonRecordDebugFailure,
} from "../../src/features/lesson-record/failure-diagnostics.js";

const cases = [
  ["stt_no_speech", "INPUT", true],
  ["mic_permission_denied", "INPUT", false],
  ["recognizer_busy", "TEMPORARY", true],
  ["recognizer_unavailable", "SERVICE", false],
  ["stt_provider_error", "TEMPORARY", true],
  ["network_offline", "TEMPORARY", true],
  ["timeout", "TEMPORARY", true],
  ["auth_expired", "TEMPORARY", true],
  ["auth_refresh_failed", "SERVICE", false],
  ["consent_missing", "INPUT", false],
  ["member_session_unresolved", "SERVICE", false],
  ["provider_quota_exhausted", "TEMPORARY", true],
  ["provider_rate_limited", "TEMPORARY", true],
  ["provider_5xx", "TEMPORARY", true],
  ["client_internal", "SERVICE", false],
  ["schema_invalid", "SERVICE", false],
  ["provider_configuration", "TEMPORARY", true],
];

test("all pipeline failure codes map to three user categories and meaningful retry behavior", () => {
  for (const [code, category, retry] of cases) {
    const result = describeLessonRecordFailure({ code });
    assert.equal(result.category, category, code);
    assert.equal(result.retry, retry, code);
    assert.match(result.userCode, /^E-/);
    assert.ok(result.title.length > 0);
    assert.doesNotMatch(`${result.title} ${result.description}`, /schema|normalization|structuredDraft|mapping|sourceRef|백업 상태/i);
  }
  assert.equal(describeLessonRecordFailure({ code: "unauthenticated", status: 401 }).internalCode, "auth_expired");
  assert.equal(describeLessonRecordFailure({ code: "rate_limited", status: 429 }).internalCode, "provider_rate_limited");
  assert.equal(describeLessonRecordFailure({ code: "invalid_output", failureStage: "client_schema_validation" }).internalCode, "schema_invalid");
  assert.equal(describeLessonRecordFailure({ code: "client_invocation_error", failureStage: "fetch_internal", transportCode: "E-INTERNAL" }).internalCode, "client_internal");
  assert.equal(LESSON_RECORD_FAILURE_CATEGORY.SERVICE, "SERVICE");
});

test("debug hook can force every documented internal failure once", () => {
  const target = {};
  for (const code of LESSON_RECORD_DEBUG_CODES) {
    setLessonRecordDebugFailure(code, target);
    assert.equal(takeLessonRecordDebugFailure(target), code);
    assert.equal(takeLessonRecordDebugFailure(target), "");
  }
});

test("raw persistence precedes Gateway work and cloud reconcile runs only after confirmed local save", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const requestStart = source.indexOf("const requestSummary = async");
  const rawSave = source.indexOf("persistRawDraft(transcript", requestStart);
  const providerCall = source.indexOf("await lessonRecordLlm.structureLessonRecord", requestStart);
  assert.ok(rawSave > requestStart && providerCall > rawSave);
  assert.equal(source.indexOf("prepareAIGatewayContext"), -1);
  const saveStart = source.indexOf("const saveScheduleComment");
  const localSave = source.indexOf("const stored = await saveDb(nextDb)", saveStart);
  const reconcile = source.indexOf("reconcileLessonRecordContext", localSave);
  assert.ok(localSave > saveStart && reconcile > localSave);
  const voiceSource = source.slice(source.indexOf("function VoiceNote"), source.indexOf("function NoteForm"));
  assert.equal(voiceSource.includes("removePendingLessonRecord"), false, "VoiceNote must never delete a raw draft");
  const cancelStart = voiceSource.indexOf("const cancelRecording = () =>");
  const cancelEnd = voiceSource.indexOf("useEffect(() => {", cancelStart);
  const cancelSource = voiceSource.slice(cancelStart, cancelEnd);
  assert.match(cancelSource, /persistRawDraft\(preservedText\)/, "cancelling after STT text exists must preserve that text");
  assert.doesNotMatch(cancelSource, /setText\(previousText\)/, "cancel must not roll back and discard newly recognized text");
  assert.doesNotMatch(voiceSource, /회원·수업 정보를 클라우드와 확인하지 못했어요|백업 상태를 확인한 뒤/);
  assert.match(voiceSource, /정리 실패 · 자동 재시도/);
  assert.match(voiceSource, /onDraftChange/);
  assert.match(voiceSource, /AI 정리 잠시 점검 중/);
  assert.match(voiceSource, /ai_structure_requested/);
  assert.match(voiceSource, /transportCode/);
  assert.match(source, /Gateway:/);
});
