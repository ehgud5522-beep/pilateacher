import test from "node:test";
import assert from "node:assert/strict";
import { buildRemoteDiagnosticReport, REMOTE_DIAGNOSTIC_LIMIT } from "../../src/features/diagnostics/remote-diagnostics.js";

test("remote diagnostic report keeps the newest 50 allowlisted events", () => {
  const voiceEvents = Array.from({ length: 35 }, (_, index) => ({
    at: new Date(Date.UTC(2026, 7, 26, 0, 0, index)).toISOString(),
    event: index % 2 ? "failed" : "structured",
    source: "server_audio",
    code: index % 2 ? "no_speech" : "ok",
    requestId: `safe-${index}`,
    durationMs: index * 10,
    transcript: "전송되면 안 되는 음성 원문",
  }));
  const pipelineEvents = Array.from({ length: 25 }, (_, index) => ({
    at: new Date(Date.UTC(2026, 7, 25, 23, 59, index)).toISOString(),
    code: "gateway",
    stage: "provider_http",
    category: "SERVICE",
    causeName: "TypeError",
    causeMessage: "회원 원문과 sk-secret은 제외",
  }));
  const report = buildRemoteDiagnosticReport({
    voiceEvents,
    pipelineEvents,
    appInfo: { id: "com.pilateacher.app", name: "PilaTeacher", version: "1.1.22", build: "37" },
    deviceInfo: { platform: "android", userAgent: "Android WebView", language: "ko-KR", screenWidth: 1080, screenHeight: 2400, pixelRatio: 3, online: true },
    now: new Date("2026-08-26T01:00:00.000Z"),
  });
  assert.equal(report.logCount, REMOTE_DIAGNOSTIC_LIMIT);
  assert.equal(report.logs[0].requestId, "safe-34");
  assert.equal(report.logs.some((event) => Object.hasOwn(event, "transcript") || Object.hasOwn(event, "causeMessage")), false);
});

test("remote diagnostic serialization contains no audio, transcript, member, or contact content", () => {
  const forbidden = "010-1234-5678 김회원 브릿지 원문";
  const report = buildRemoteDiagnosticReport({
    pipelineEvents: [{ at: "2026-08-26T00:00:00.000Z", code: "failed", causeMessage: forbidden, transcript: forbidden, audio: forbidden }],
    voiceEvents: [{ at: "2026-08-26T00:00:01.000Z", event: "failed", source: "server_audio", transcript: forbidden, memberName: forbidden, audio: forbidden }],
  });
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(forbidden), false);
  assert.equal(serialized.includes('"transcript":'), false);
  assert.equal(serialized.includes('"audio":'), false);
  assert.equal(serialized.includes('"memberName":'), false);
});

test("remote diagnostics retain only allowlisted validation coordinates", () => {
  const report = buildRemoteDiagnosticReport({
    pipelineEvents: [{ at: "2026-08-26T00:00:00.000Z", code: "request_rejected", validationReason: "invalid_value", invalidField: "input.clipId", operation: "lesson_record_from_audio", transcript: "private" }],
  });
  assert.equal(report.logs[0].validationReason, "invalid_value");
  assert.equal(report.logs[0].invalidField, "input.clipId");
  assert.equal(report.logs[0].operation, "lesson_record_from_audio");
  assert.equal(Object.hasOwn(report.logs[0], "transcript"), false);
});

test("remote diagnostics include allowlisted posture counts without private posture content", () => {
  const forbidden = "김회원 data:image/jpeg;base64,private transcript secret-token";
  const report = buildRemoteDiagnosticReport({
    postureEvents: [{
      at: "2026-09-06T02:00:00.000Z",
      event: "POSTURE_STORAGE_RESTORED",
      accountIdHash: "acct_safehash",
      memberIdHash: "member_safehash",
      selectedMemberIdHash: "member_selectedhash",
      recordMemberIdHash: "member_recordhash",
      assessmentIdHash: "asmt_safehash",
      rawPhotoCount: 2,
      poseCount: 2,
      normalizedAssessmentCount: 1,
      memberIdMatches: true,
      views: ["front", "leftSide"],
      excludedRecordCount: 1,
      excludedByReason: { missing_assessment_id: 1 },
      metadataWriteSucceeded: true,
      completionPromoted: true,
      memoryPatchSucceeded: false,
      recordDiagnostics: [{
        recordType: "photo",
        recordIdHash: "record_safehash",
        assessmentIdHash: "asmt_safehash",
        recordMemberIdHash: "member_recordhash",
        blobIdHash: "blob_safehash",
        view: "front",
        assessmentStatus: "completed",
        captureStatus: "completed",
        blobIdPresent: true,
        idbLookupAttempted: true,
        idbLookupFound: false,
        idbLookupMissing: true,
        idbLookupFailed: false,
        blobId: "blob-private",
      }],
      selectedMemberName: "김회원",
      resolvedMemberName: "기",
      memberId: "member-private",
      assessmentId: "assessment-private",
      transcript: forbidden,
      memberName: forbidden,
      photo: forbidden,
      token: forbidden,
    }],
  });
  assert.equal(report.logs[0].kind, "posture");
  assert.equal(report.logs[0].rawPhotoCount, 2);
  assert.equal(report.logs[0].normalizedAssessmentCount, 1);
  assert.deepEqual(report.logs[0].views, ["front", "leftSide"]);
  assert.equal(report.logs[0].excludedRecordCount, 1);
  assert.deepEqual(report.logs[0].excludedByReason, { missing_assessment_id: 1 });
  assert.equal(report.logs[0].recordDiagnostics[0].idbLookupMissing, true);
  assert.equal(report.logs[0].recordDiagnostics[0].blobIdHash, "blob_safehash");
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(forbidden), false);
  assert.equal(serialized.includes("memberName"), false);
  assert.equal(serialized.includes("transcript"), false);
  ["member-private", "assessment-private", "blob-private", "김회원", "기"].forEach((value) => assert.equal(serialized.includes(value), false, value));
  assert.equal(Object.hasOwn(report.logs[0], "selectedMemberName"), false);
  assert.equal(Object.hasOwn(report.logs[0], "resolvedMemberName"), false);
});
