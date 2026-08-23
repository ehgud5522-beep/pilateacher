import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyLessonRecordFailure, lessonRecordFailureMessage, LESSON_RECORD_FAILURE } from "../../src/features/lesson-record/failure-diagnostics.js";

test("lesson record failures are classified without transcript or member data", () => {
  assert.equal(classifyLessonRecordFailure({ code: "network_error" }), LESSON_RECORD_FAILURE.NETWORK);
  assert.equal(classifyLessonRecordFailure({ code: "unauthenticated", status: 401 }), LESSON_RECORD_FAILURE.AUTH);
  assert.equal(classifyLessonRecordFailure({ code: "consent_required", status: 403 }), LESSON_RECORD_FAILURE.CONSENT);
  assert.equal(classifyLessonRecordFailure({ code: "backup/overwrite-blocked", contextStage: "member_authorization_backup" }), LESSON_RECORD_FAILURE.MEMBER_AUTHORIZATION);
  assert.equal(classifyLessonRecordFailure({ code: "invalid_output", status: 502 }), LESSON_RECORD_FAILURE.RESPONSE);
  assert.equal(classifyLessonRecordFailure({ code: "invalid_output", failureStage: "client_schema_validation" }), LESSON_RECORD_FAILURE.CLIENT_MAPPING);
  assert.equal(classifyLessonRecordFailure({ code: "not_connected" }), LESSON_RECORD_FAILURE.STALE_BUILD);
});

test("failure messages preserve the user's input and avoid developer contract terms", () => {
  for (const failureClass of Object.values(LESSON_RECORD_FAILURE)) {
    const message = lessonRecordFailureMessage(failureClass);
    assert.ok(message.length > 0);
    assert.doesNotMatch(message, /schema|normalization|structuredDraft|mapping|sourceRef/i);
  }
});

test("the app synchronizes the guarded owner backup before the exact Gateway request", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const syncStart = source.indexOf("const prepareAIGatewayContext = useCallback");
  const backupWrite = source.indexOf("await fbPushBackup(accountId, db", syncStart);
  const providerCall = source.indexOf("await lessonRecordLlm.structureLessonRecord", source.indexOf("const requestSummary"));
  const prepareCall = source.indexOf("await prepareAIGatewayContext({ memberId, lessonId })", source.indexOf("const requestSummary"));
  assert.ok(syncStart > 0 && backupWrite > syncStart);
  assert.ok(prepareCall > 0 && providerCall > prepareCall);
  assert.match(source, /restoreBlockedRef\.current/);
  assert.match(source, /data-ai-failure=\{summaryFailureClass/);
});
