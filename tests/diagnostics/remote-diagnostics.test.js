import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildRemoteDiagnosticReport, REMOTE_DIAGNOSTIC_LIMIT } from "../../src/features/diagnostics/remote-diagnostics.js";

/* ===================== what may leave the device ========================

   The report is uploaded. Redacting known-bad patterns is a losing game --
   the wording that leaks is by definition the wording nobody listed. So the
   rule is inverted here: every value in the report has to be an enumerated
   code, a boolean, a number, or a hash, and a string may only use this
   charset. No spaces, so a sentence someone typed cannot survive as one.

   These two tests are the fence. The first walks a report built from
   hostile input; the second reads the builder itself, so a field added
   later has to be written in one of the approved forms to get past. */

/* An identifier may start with a digit -- a version, a timestamp, a native
   error code, a hash. Everything else is an enumerated code and must start
   with a letter, which is what keeps a phone number or an account number
   out of a field meant to hold a name from the source. */
const IDENTIFIERS = new Set([
  "at", "createdAt", "requestId", "correlationId", "errorCode", "invalidField",
  "appBuild", "osVersion", "deviceModel", "id", "name", "version", "build", "userAgent",
  "blobIdHash", "recordIdHash", "assessmentIdHash", "recordMemberIdHash",
  "accountIdHash", "memberIdHash", "selectedMemberIdHash",
  "photosBucketMemberIdHash", "latestAssessmentIdHash",
]);
const CHARSET = /^[A-Za-z0-9._:/-]*$/;
const CODE = /^([A-Za-z][A-Za-z0-9._:/-]*)?$/;

const walk = (value, path, name, seen) => {
  if (value === null || value === undefined) return;
  if (typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    seen.push(path);
    assert.match(value, CHARSET, `${path} is outside the charset: ${JSON.stringify(value)}`);
    if (!IDENTIFIERS.has(name)) {
      assert.match(value, CODE, `${path} is not an enumerated code: ${JSON.stringify(value)}`);
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${path}[${index}]`, name, seen)); return; }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assert.match(key, CODE, `${path} has a key that is not a code: ${JSON.stringify(key)}`);
      walk(item, `${path}.${key}`, key, seen);
    }
    return;
  }
  assert.fail(`${path} is a ${typeof value}, which is not a shape the report allows`);
};

/* Korean, a phone number, an email, a bearer token, a file path, a URL, a
   sentence with spaces -- pushed into every field the builder reads. */
const NASTY = "김회원 010-1234-5678 a@b.com Bearer zzz /data/user/0/x.jpg https://h/p?q=1 원문 그대로";
const nastyEvent = (extra) => ({
  at: NASTY, event: NASTY, source: NASTY, stage: NASTY, code: NASTY, category: NASTY, model: NASTY,
  message: NASTY, causeMessage: NASTY, causeName: NASTY, pluginError: NASTY, reason: NASTY,
  failureReason: NASTY, errorName: NASTY, validationReason: NASTY, invalidField: NASTY, operation: NASTY,
  phase: NASTY, state: NASTY, platform: NASTY, lifecycleState: NASTY, transportCode: NASTY,
  requestId: NASTY, blobIdHash: NASTY, permissionState: NASTY, audioSessionCategory: NASTY,
  audioSessionMode: NASTY, feature: NASTY, outcome: NASTY, provider: NASTY, errorDomain: NASTY,
  errorCode: NASTY, correlationId: NASTY, appBuild: NASTY, osVersion: NASTY, deviceModel: NASTY,
  assessmentStatus: NASTY, idbOpen: NASTY, view: NASTY,
  flags: [NASTY, NASTY], views: [NASTY], selectedViews: [NASTY], rejectReasons: [NASTY], failureReasons: [NASTY],
  excludedByReason: { [NASTY]: 3 },
  recordDiagnostics: [{ recordType: NASTY, recordIdHash: NASTY, view: NASTY, assessmentStatus: NASTY }],
  transcript: NASTY, audio: NASTY, memberName: NASTY, notes: NASTY,
  ...extra,
});

test("nothing leaves the device that is not an enumerated code, a boolean, a number, or a hash", () => {
  const stamped = { at: "2026-08-26T00:00:00.000Z" };
  const report = buildRemoteDiagnosticReport({
    pipelineEvents: [nastyEvent(stamped)],
    voiceEvents: [nastyEvent(stamped)],
    authEvents: [nastyEvent(stamped)],
    postureEvents: [nastyEvent(stamped)],
    appInfo: { id: NASTY, name: NASTY, version: NASTY, build: NASTY },
    deviceInfo: { platform: NASTY, userAgent: NASTY, language: NASTY },
  });
  const seen = [];
  walk(report, "report", "report", seen);
  assert.ok(seen.length > 40, "the walk actually reached the fields");
  assert.equal(report.logs.length, 4, "and all four kinds were built");
});

test("a number that could be a person is refused by a field meant to hold a code", () => {
  /* Digits and hyphens are legal in a code, so a charset alone lets a phone
     number through. A code always starts with a letter; a phone number,
     an account number and a date of birth do not. */
  const report = buildRemoteDiagnosticReport({
    voiceEvents: [{ at: "2026-08-26T00:00:00.000Z", event: "010-1234-5678", code: "880101-1234567", stage: "no_speech" }],
  });
  assert.equal(report.logs[0].event, "", "not a code, so not sent");
  assert.equal(report.logs[0].code, "");
  assert.equal(report.logs[0].stage, "no_speech", "a real code is untouched");
});

test("the codes and identifiers that have to keep working still do", () => {
  /* CLAUDE.md wants the original layer code and the correlation id kept, and
     a native error code can be a bare negative number. Tightening the codes
     must not quietly delete those. */
  const report = buildRemoteDiagnosticReport({
    pipelineEvents: [{ at: "2026-08-25T23:59:59.000Z", code: "gateway", stage: "provider_http", transportCode: "E-HTTP-500", httpStatus: 500 }],
    voiceEvents: [{ at: "2026-08-26T00:00:00.000Z", event: "structured", source: "server_audio", requestId: "req-1a2b3c", httpStatus: 500 }],
    authEvents: [{ at: "2026-08-26T00:00:01.000Z", feature: "apple_sign_in", errorDomain: "firebase_auth", errorCode: "-7003", correlationId: "c-99", appBuild: "1.1.24" }],
    appInfo: { id: "com.pilateacher.app", name: "PilaTeacher", version: "1.1.24", build: "52" },
    deviceInfo: { platform: "android", userAgent: "Mozilla/5.0 (Linux; Android 16; SM-S938N)" },
  });
  const pipeline = report.logs.find((entry) => entry.kind === "pipeline");
  const voice = report.logs.find((entry) => entry.kind === "voice");
  const auth = report.logs.find((entry) => entry.kind === "auth");
  assert.equal(pipeline.transportCode, "E-HTTP-500");
  assert.equal(voice.requestId, "req-1a2b3c");
  assert.equal(voice.httpStatus, 500);
  assert.equal(auth.errorDomain, "firebase_auth");
  assert.equal(auth.errorCode, "-7003", "a native code is a number, and it is kept");
  assert.equal(auth.correlationId, "c-99", "so the server log can still be joined to this");
  assert.equal(report.app.version, "1.1.24");
  assert.equal(report.app.build, "52");
  assert.equal(report.device.platform, "android");
  assert.ok(report.device.userAgent.includes("Android_16"), "the webview build is still readable");
  assert.ok(report.device.userAgent.includes("SM-S938N"));
});

test("a sentence someone typed cannot survive the trip as a sentence", () => {
  const report = buildRemoteDiagnosticReport({
    voiceEvents: [nastyEvent({ at: "2026-08-26T00:00:00.000Z" })],
    authEvents: [nastyEvent({ at: "2026-08-26T00:00:01.000Z" })],
  });
  const serialized = JSON.stringify(report);
  for (const fragment of ["김회원", "a@b.com", "Bearer", "원문", "그대로"]) {
    assert.equal(serialized.includes(fragment), false, `${fragment} left the device`);
  }
  assert.equal(/[가-힣]/.test(serialized), false, "no Korean at all");
  assert.equal(/"[^"]* [^"]*"/.test(serialized), false, "and no value with a space in it");
  assert.equal(serialized.includes("@"), false, "and nothing shaped like an address");
});

test("a credential is struck out wherever it turns up, not only in the wordy fields", () => {
  /* A token is alphanumeric, so the shape rule cannot see it. This is the
     one thing still handled by naming the pattern -- and now it covers every
     field, where before it covered six. */
  const report = buildRemoteDiagnosticReport({
    voiceEvents: [{
      at: "2026-08-26T00:00:00.000Z", event: "failed",
      requestId: "Bearer eyJabcdefghijklmnop.0123456789abcd.zzzzzzzzzzzz",
      blobIdHash: "sk-livekeyabcdef1234", correlationId: "ya29.averylongoauthtoken",
    }],
  });
  const serialized = JSON.stringify(report);
  for (const secret of ["eyJabcdefghijklmnop", "livekeyabcdef1234", "averylongoauthtoken"]) {
    assert.equal(serialized.includes(secret), false, `${secret} left the device`);
  }
});

test("the wording is gone but its shape is kept, so an unmapped failure is still noticed", () => {
  /* Without this the screen would say nothing at all about a failure whose
     code is already known but whose wording was new. The shape says there
     was one and roughly what it looked like; the on-device screen, which
     never leaves the phone, still has the words. */
  const report = buildRemoteDiagnosticReport({
    voiceEvents: [{ at: "2026-08-26T00:00:00.000Z", event: "failed", message: "Failed to fetch", causeMessage: "blob:http://x/y is gone", pluginError: "" }],
  });
  const entry = report.logs[0];
  assert.equal(Object.hasOwn(entry, "message"), false, "the wording is not sent");
  assert.equal(Object.hasOwn(entry, "causeMessage"), false);
  assert.equal(Object.hasOwn(entry, "pluginError"), false);
  assert.equal(entry.messageShape, "len15_ascii", "but that there was one, and how long");
  assert.equal(entry.causeShape, "len23_ascii_url_path", "and roughly what kind");
  assert.equal(entry.pluginErrorShape, "", "nothing said, nothing described");
});

test("a field added later has to be written in one of the approved forms", async () => {
  /* The runtime walk above only sees fields whose input the fixture happens
     to set. This one reads the builder, so a new line copying an error
     message straight through fails here even if no test feeds it. */
  const source = await readFile(new URL("../../src/features/diagnostics/remote-diagnostics.js", import.meta.url), "utf8");
  assert.equal(source.includes("safeDeviceText"), false, "the old redact-what-we-know-about helper is gone");
  const approved = [
    /^safeCode\(/, /^safeToken\(/, /^textShape\(/, /^finite\(/, /^postureReasonCounts\(/,
    /^"[A-Za-z0-9._:/-]*"$/,
    /^typeof (event|record|deviceInfo)\?\.[A-Za-z]+ === "boolean" \? /,
    /^Array\.isArray\(.*\.map\(\(\w+\) => safe(Code|Token)\(/,
    /^Array\.isArray\(.*\.map\(postureRecord\)/,
    /^finite\(.*\) \|\| 0$/,
    /^deviceInfo\?\.online !== false$/,
    /^now\.toISOString\(\)$/,
    /^\d+$/,
    /^logs\.length$/,
  ];
  const fields = source.split("\n")
    .map((line) => /^\s{2,}([A-Za-z][A-Za-z0-9]*): (.+),$/.exec(line.trim().startsWith("//") ? "" : line))
    .filter(Boolean);
  assert.ok(fields.length > 90, `expected to inspect the whole builder, saw ${fields.length}`);
  for (const [, name, expression] of fields) {
    assert.ok(approved.some((form) => form.test(expression)),
      `${name} is built as \`${expression}\` -- that is not one of the approved forms, and free text must not be sent`);
  }
});

/* ======================== the rest of the report ======================== */

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

test("remote diagnostics retain camera platform and lifecycle stage", () => {
  const report = buildRemoteDiagnosticReport({
    voiceEvents: [{
      at: "2026-09-06T03:00:00.000Z",
      event: "camera_photo_output_ready",
      source: "native_preview",
      platform: "android",
      lifecycleState: "ready",
    }],
  });
  assert.equal(report.logs[0].platform, "android");
  assert.equal(report.logs[0].lifecycleState, "ready");
});
