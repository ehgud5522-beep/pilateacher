import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeFirestorePayload } from "../../src/features/backup/cloud-backup.js";
import { describeLessonRecordFailure, failureCauseDetail } from "../../src/features/lesson-record/failure-diagnostics.js";
import { isQueuedLessonRecord } from "../../src/features/lesson-record/draft-queue.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

test("the backup payload loses undefined keys and keeps every meaningful value", () => {
  const when = new Date("2026-08-27T09:00:00.000Z");
  const source = {
    members: [{
      id: "m1",
      notes: [{
        id: "n1",
        sid: undefined,
        transcript: undefined,
        body: "",
        important: false,
        count: 0,
        tags: [],
        deductFrom: null,
        recordedAt: when,
        lessonRecord: { audioBlobId: undefined, confirmedAt: undefined, structuredDraft: { didToday: ["롤업"] } },
      }],
    }],
    settings: { cloudPhotoBackupEnabled: false },
  };
  const result = sanitizeFirestorePayload(source);
  const note = result.members[0].notes[0];

  assert.equal(Object.prototype.hasOwnProperty.call(note, "sid"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(note, "transcript"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(note.lessonRecord, "audioBlobId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(note.lessonRecord, "confirmedAt"), false);
  assert.equal(note.body, "");
  assert.equal(note.important, false);
  assert.equal(note.count, 0);
  assert.deepEqual(note.tags, []);
  assert.equal(note.deductFrom, null);
  assert.equal(note.recordedAt, when, "a Date must reach Firestore unchanged, not as a JSON string");
  assert.deepEqual(note.lessonRecord.structuredDraft.didToday, ["롤업"]);
  assert.equal(result.settings.cloudPhotoBackupEnabled, false);
  assert.deepEqual(sanitizeFirestorePayload([1, undefined, "", 0, false, null]), [1, "", 0, false, null]);
  assert.equal(JSON.stringify(result).includes("undefined"), false);
});

test("sanitizing survives a self-referencing database instead of hanging", () => {
  const cyclic = { members: [] };
  cyclic.self = cyclic;
  assert.deepEqual(sanitizeFirestorePayload(cyclic), { members: [], self: {} });
});

test("the cloud backup write is the boundary that sanitizes", async () => {
  const firebaseSource = await readFile(new URL("../../src/lib/firebase.js", import.meta.url), "utf8");
  const push = firebaseSource.slice(firebaseSource.indexOf("export async function fbPushBackup"), firebaseSource.indexOf("export async function fbPullBackup"));
  assert.match(push, /const payload = sanitizeFirestorePayload\(data\)/);
  assert.match(push, /data: payload/);
  assert.doesNotMatch(push, /^\s+data,$/m, "the raw in-memory database must never be written directly");
});

test("a saved lesson note omits absent keys rather than setting them to undefined", async () => {
  const source = await appSource();
  const save = source.slice(source.indexOf("const saveScheduleComment"), source.indexOf("const nextNotes ="));
  for (const field of ["audioBlobId", "confirmedAt", "sid", "transcript"]) {
    assert.doesNotMatch(save, new RegExp(`${field}: undefined`), `${field} must not be written as undefined`);
  }
  assert.match(save, /\.\.\.\(resolvedSid \? \{ sid: resolvedSid \} : \{\}\)/);
  assert.match(save, /\.\.\.\(transcriptText \? \{ transcript: transcriptText \} : \{\}\)/);
  assert.match(save, /\.\.\.confirmedAtField/);
  assert.match(save, /audioBlobId: _releasedAudioBlobId, \.\.\.confirmedLessonRecordBase/);
});

test("a failed cloud backup is reported on its own and never cancels the upload", async () => {
  const source = await appSource();
  const prepare = source.slice(source.indexOf("const prepareLessonRecordContext"), source.indexOf("const reconcileLessonRecordContext"));
  assert.match(prepare, /try \{[\s\S]*await fbPushBackup\([\s\S]*\} catch \(error\) \{/, "the backup push must be guarded");
  assert.match(prepare, /code: "cloud_backup_failed"/);
  assert.match(prepare, /return \{ \.\.\.link, backupSynced: false, backupError: cause \}/);

  const voice = source.slice(source.indexOf("function VoiceNote"), source.indexOf("function NoteForm"));
  const upload = voice.slice(voice.indexOf("const uploadServerAudio ="), voice.indexOf("const discardConsentAudio ="));
  assert.match(upload, /link\?\.state === "link_review_required"/, "only an unresolved link may stop the upload");
  assert.doesNotMatch(upload, /backupSynced|backupError/, "a stale backup must not stop the upload");
});

test("deterministic rejection, temporary failure and link review each get their own screen", () => {
  const rejected = describeLessonRecordFailure({ code: "invalid-argument" });
  assert.equal(rejected.internalCode, "request_rejected");
  assert.equal(rejected.category, "SERVICE");
  assert.equal(rejected.retry, false);
  assert.equal(rejected.manualRetry, true);
  assert.equal(rejected.title, "기록 처리 중 문제가 발생했어요");
  assert.equal(rejected.description, "녹음 내용은 보관했습니다.");
  assert.equal(rejected.linkReview, undefined);

  assert.equal(describeLessonRecordFailure({ code: "invalid_request", status: 400 }).internalCode, "request_rejected");
  assert.equal(describeLessonRecordFailure({ code: "gateway_error", status: 400 }).internalCode, "request_rejected");

  const link = describeLessonRecordFailure({ code: "invalid_request", status: 403 });
  assert.equal(link.internalCode, "member_session_unresolved");
  assert.equal(link.title, "회원·수업 연결을 확인해 주세요");
  assert.equal(link.linkReview, true);
  assert.equal(link.retry, false);

  for (const code of ["unavailable", "aborted", "resource-exhausted", "deadline-exceeded", "network_error"]) {
    const temporary = describeLessonRecordFailure({ code });
    assert.equal(temporary.category, "TEMPORARY", code);
    assert.equal(temporary.retry, true, code);
  }
});

test("a rejected request never re-enters the automatic retry queue", () => {
  const draft = { memberId: "m1", lessonId: "s1", rawTranscript: "오늘 롤업", retry: { state: "waiting", attempts: 0, nextRetryAt: 0 } };
  assert.equal(isQueuedLessonRecord({ ...draft, failure: { code: "request_rejected", category: "SERVICE" } }), false);
  assert.equal(isQueuedLessonRecord({ ...draft, failure: { code: "invalid-argument", category: "SERVICE" } }), false);
  assert.equal(isQueuedLessonRecord({ ...draft, failure: { code: "network_offline", category: "TEMPORARY" } }), true);
});

test("the rejecting layer's own wording reaches the diagnostics verbatim", () => {
  const firestoreError = Object.assign(new Error('Function Transaction.set() called with invalid data. Unsupported field value: undefined (found in field data.members.0.notes.0.lessonRecord.audioBlobId)'), { code: "invalid-argument" });
  firestoreError.name = "FirebaseError";
  const cause = failureCauseDetail(firestoreError);
  assert.equal(cause.causeName, "FirebaseError");
  assert.equal(cause.rawCode, "invalid-argument");
  assert.match(cause.causeMessage, /data\.members\.0\.notes\.0\.lessonRecord\.audioBlobId/);

  const gatewayError = { name: "AIProviderError", code: "invalid_request", status: 400, serverMessage: "input.clipId is invalid", message: "AI Gateway request failed (400)" };
  const gatewayCause = failureCauseDetail(gatewayError);
  assert.match(gatewayCause.causeMessage, /input\.clipId is invalid/);
  assert.match(gatewayCause.causeMessage, /AI Gateway request failed \(400\)/);
  assert.equal(gatewayCause.rawCode, "invalid_request");

  const redacted = failureCauseDetail({ message: "Bearer abcdefghijklmnop rejected" });
  assert.equal(redacted.causeMessage, "Bearer abcdefghijklmnop rejected", "redaction happens at the diagnostics store, not here");
});

test("the Gateway error message and the raw code survive into the stored diagnostics", async () => {
  const provider = await readFile(new URL("../../src/ai/gateway-provider.js", import.meta.url), "utf8");
  assert.match(provider, /if \(typeof errorPayload\?\.error\?\.message === "string"\) serverMessage = safeNetworkText\(errorPayload\.error\.message, 400\)/);
  assert.match(provider, /this\.serverMessage = options\.serverMessage/);

  const pipeline = await readFile(new URL("../../src/features/lesson-record/pipeline-diagnostics.js", import.meta.url), "utf8");
  assert.match(pipeline, /causeMessage: event\?\.causeMessage \? safeText\(event\.causeMessage, 400\) : ""/);
  assert.match(pipeline, /rawCode: event\?\.rawCode/);

  const voiceSession = await readFile(new URL("../../src/features/voice/voice-session.js", import.meta.url), "utf8");
  assert.match(voiceSession, /causeMessage: safeDiagnosticMessage\(details\.causeMessage, 400\)/);

  const source = await appSource();
  assert.match(source, /voiceDiagnostic\("failed", \{ source: "server_audio", \.\.\.failureCauseDetail\(error\), code: error\?\.code \|\| "audio_upload_failed"/);
  const record = source.slice(source.indexOf("const recordPipelineFailure ="), source.indexOf("const requestSummary"));
  assert.match(record, /\.\.\.failureCauseDetail\(context\)/);
});

test("a deterministic failure offers a retry of the same clip and keeps the recording", async () => {
  const source = await appSource();
  const voice = source.slice(source.indexOf("function VoiceNote"), source.indexOf("function NoteForm"));
  const retry = voice.slice(voice.indexOf("const retryServerAudioUpload ="), voice.indexOf("const finishServerRecording ="));
  assert.match(retry, /loadPendingLessonRecord\(memberId, lessonId\)/);
  assert.match(retry, /audioClips \|\| \[\]\)\.find\(\(item\) => item\?\.blobId && item\.state !== "uploaded"\)/);
  assert.match(retry, /await uploadServerAudio\(clip, currentDraft\)/);
  assert.doesNotMatch(retry, /removePendingLessonRecord|forgetBlobs/, "retrying must not discard the stored recording");
  assert.match(voice, /\{summaryFailure\.manualRetry && <button type="button" onClick=\{retryServerAudioUpload\}/);
  assert.match(voice, /\{summaryFailure\.linkReview && linkReview && lessonId &&/);
});
