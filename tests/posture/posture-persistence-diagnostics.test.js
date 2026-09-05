import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  POSTURE_PERSISTENCE_DIAGNOSTIC_KEY,
  POSTURE_PERSISTENCE_EVENTS,
  appendPosturePersistenceDiagnostic,
  buildPosturePersistenceSnapshot,
  buildPostureRecordDiagnostic,
  buildPostureRestoreDiagnostic,
  buildPostureSaveDiagnostic,
  postureRecordNormalizationEligibility,
} from "../../src/features/posture/persistence-diagnostics.js";
import { normalizeAssessmentSets } from "../../src/features/posture/posture-model.js";

const memberId = "member-private-a";
const accountId = "account-private-a";
const assessmentId = "assessment-private-a";

const completedRecord = (extra = {}) => ({
  id: `record-${extra.view || "front"}`,
  memberId,
  assessmentId,
  assessmentStatus: "completed",
  assessmentComplete: true,
  completedAt: "2026-09-06T01:00:00.000Z",
  selectedViews: ["front", "leftSide"],
  blobId: "blob-private",
  ...extra,
});

const completedPhotoMap = () => ({
  [memberId]: {
    front: [completedRecord({ view: "front" })],
    leftSide: [completedRecord({ id: "record-side", view: "leftSide" })],
    poses: [
      completedRecord({ id: "pose-front", view: "front", pts: { nose: { x: 1, y: 2 } }, cleanBlobId: "clean-private" }),
      completedRecord({ id: "pose-side", view: "leftSide", pts: { shoulder: { x: 3, y: 4 } } }),
    ],
  },
});

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

test("save snapshot records only count deltas for a completed assessment", () => {
  const diagnostic = buildPostureSaveDiagnostic({
    accountId,
    memberId,
    assessmentId,
    beforePhotoMap: {},
    afterPhotoMap: completedPhotoMap(),
  });
  assert.equal(diagnostic.beforeRawPhotoCount, 0);
  assert.equal(diagnostic.beforePoseCount, 0);
  assert.equal(diagnostic.beforeAssessmentCount, 0);
  assert.equal(diagnostic.afterRawPhotoCount, 2);
  assert.equal(diagnostic.afterPoseCount, 2);
  assert.equal(diagnostic.afterAssessmentCount, 1);
  assert.equal(diagnostic.rawPhotoCount, 2);
  assert.equal(diagnostic.poseCount, 2);
  assert.equal(diagnostic.normalizedAssessmentCount, 1);
  assert.equal(diagnostic.completedAssessmentCount, 1);
  assert.equal(diagnostic.photoRecords, 2);
  assert.equal(diagnostic.poseRecords, 2);
  assert.equal(diagnostic.blobIdPresent, true);
  assert.equal(diagnostic.cleanBlobIdPresent, true);
  assert.equal(diagnostic.ptsPresent, true);
});

test("save diagnostics retain the three persistence stage outcomes", () => {
  const diagnostic = buildPostureSaveDiagnostic({
    accountId,
    memberId,
    assessmentId,
    beforePhotoMap: {},
    afterPhotoMap: completedPhotoMap(),
    metadataWriteSucceeded: true,
    completionPromoted: true,
    memoryPatchSucceeded: false,
  });
  assert.equal(diagnostic.metadataWriteSucceeded, true);
  assert.equal(diagnostic.completionPromoted, true);
  assert.equal(diagnostic.memoryPatchSucceeded, false);
});

test("record diagnostics preserve hashed Blob lookup outcomes without raw ids", () => {
  const record = completedRecord({ id: "record-private", view: "front", blobId: "blob-private" });
  const lookup = buildPostureRecordDiagnostic({
    record,
    storageKey: "front",
    kind: "photo",
    lookup: { idbLookupAttempted: true, idbLookupFound: false, idbLookupMissing: true, idbLookupFailed: false },
  });
  const diagnostic = buildPosturePersistenceSnapshot({
    accountId,
    memberId,
    assessmentId,
    photoMap: { [memberId]: { front: [record] } },
    recordLookups: [lookup],
  });
  assert.equal(diagnostic.recordDiagnostics.length, 1);
  assert.equal(diagnostic.recordDiagnostics[0].idbLookupAttempted, true);
  assert.equal(diagnostic.recordDiagnostics[0].idbLookupFound, false);
  assert.equal(diagnostic.recordDiagnostics[0].idbLookupMissing, true);
  assert.notEqual(diagnostic.recordDiagnostics[0].blobIdHash, "");
  assert.equal(JSON.stringify(diagnostic).includes("record-private"), false);
  assert.equal(JSON.stringify(diagnostic).includes("blob-private"), false);
});

test("raw photo without assessmentId reports the same rejection used by normalization", () => {
  const photoMap = { [memberId]: { front: [{ id: "legacy", memberId, view: "front", blobId: "blob-private" }] } };
  const diagnostic = buildPosturePersistenceSnapshot({ accountId, memberId, photoMap });
  assert.equal(diagnostic.reason, "RAW_RECORDS_PRESENT_BUT_ZERO_SETS");
  assert.deepEqual(diagnostic.rejectReasons, ["missing_assessment_id"]);
  assert.equal(diagnostic.excludedRecordCount, 1);
  assert.deepEqual(diagnostic.excludedByReason, { missing_assessment_id: 1 });
  assert.equal(normalizeAssessmentSets(photoMap[memberId], { memberId }).length, 0);
  assert.deepEqual(postureRecordNormalizationEligibility(photoMap[memberId].front[0], { memberId, kind: "photo" }), {
    included: false,
    reason: "missing_assessment_id",
  });
});

test("member mismatch is visible without exposing either member id", () => {
  const photoMap = {
    "member-private-b": {
      front: [completedRecord({ view: "front" })],
    },
  };
  const diagnostic = buildPosturePersistenceSnapshot({
    accountId,
    memberId: "member-private-b",
    photosBucketMemberId: "member-private-b",
    photoMap,
  });
  assert.equal(diagnostic.reason, "MEMBER_ID_MISMATCH");
  assert.equal(diagnostic.memberIdMatches, false);
  assert.deepEqual(diagnostic.rejectReasons, ["member_id_mismatch"]);
  assert.equal(JSON.stringify(diagnostic).includes(memberId), false);
  assert.equal(JSON.stringify(diagnostic).includes("member-private-b"), false);
});

test("cold-start restore reports metadata, IndexedDB, and adopt counters while preserving sets", () => {
  const photoMap = completedPhotoMap();
  const diagnostic = buildPostureRestoreDiagnostic({
    photoMap,
    metadataPhotoMap: photoMap,
    accountId,
    memberId,
    metadataExists: true,
    metadataParsed: true,
    idbOpen: "success",
    blobKeyCount: 3,
    adoptAttempted: 4,
    adoptRestored: 4,
    adoptMissingBlob: 0,
    adoptFailed: 0,
  });
  assert.equal(diagnostic.metadataExists, true);
  assert.equal(diagnostic.metadataParsed, true);
  assert.equal(diagnostic.targetMemberBucketExists, true);
  assert.equal(diagnostic.idbOpen, "success");
  assert.equal(diagnostic.blobKeyCount, 3);
  assert.equal(diagnostic.adoptAttempted, 4);
  assert.equal(diagnostic.adoptRestored, 4);
  assert.equal(diagnostic.normalizedAssessmentCount, 1);
});

test("cold-start restore makes one missing Blob diagnosable", () => {
  const diagnostic = buildPostureRestoreDiagnostic({
    photoMap: completedPhotoMap(),
    accountId,
    memberId,
    metadataExists: true,
    metadataParsed: true,
    idbOpen: "success",
    blobKeyCount: 2,
    adoptAttempted: 4,
    adoptRestored: 3,
    adoptMissingBlob: 1,
    adoptFailed: 0,
    failureReasons: [],
  });
  assert.equal(diagnostic.adoptMissingBlob, 1);
  assert.equal(diagnostic.adoptRestored, 3);
});

test("persisted diagnostic payload keeps local names but excludes raw ids and sensitive content", () => {
  const storage = new MemoryStorage();
  const snapshot = buildPosturePersistenceSnapshot({ accountId, memberId, assessmentId, photoMap: completedPhotoMap() });
  appendPosturePersistenceDiagnostic(POSTURE_PERSISTENCE_EVENTS.SAVE_COMMITTED, {
    ...snapshot,
    accountId,
    memberId,
    assessmentId,
    selectedMemberName: "김회원",
    resolvedMemberName: "기",
    src: "data:image/jpeg;base64,private-photo",
    blob: { private: true },
    aiAnalysisText: "민감한 AI 해석",
    transcript: "민감한 음성 원문",
    token: "secret-token",
  }, storage, () => new Date("2026-09-06T02:00:00.000Z"));
  const serialized = storage.getItem(POSTURE_PERSISTENCE_DIAGNOSTIC_KEY);
  [accountId, memberId, assessmentId, "data:image", "private-photo", "민감한 AI 해석", "민감한 음성 원문", "secret-token"].forEach((value) => {
    assert.equal(serialized.includes(value), false, value);
  });
  assert.equal(serialized.includes("김회원"), true);
  assert.equal(serialized.includes("기"), true);
  ["memberName", "src", "blob", "aiAnalysisText", "transcript", "token"].forEach((key) => {
    assert.equal(serialized.includes(`\"${key}\"`), false, key);
  });
});

test("restore snapshot can keep the previous problem member and assessment hashes", () => {
  const diagnostic = buildPostureRestoreDiagnostic({
    photoMap: {},
    metadataPhotoMap: {},
    accountId,
    memberId: null,
    selectedMemberId: null,
    selectedMemberIdHashOverride: "member_previoushash",
    assessmentIdHashOverride: "asmt_previoushash",
    selectedMemberName: "기",
    metadataExists: true,
    metadataParsed: true,
    idbOpen: "success",
  });
  assert.equal(diagnostic.selectedMemberIdHash, "member_previoushash");
  assert.equal(diagnostic.assessmentIdHash, "asmt_previoushash");
  assert.equal(diagnostic.photosBucketExists, false);
});

test("App wires all three persistence events and persistent failure reason codes", () => {
  const source = fs.readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /POSTURE_PERSISTENCE_EVENTS\.SAVE_COMMITTED/);
  assert.match(source, /POSTURE_PERSISTENCE_EVENTS\.WORKSPACE_ENTER/);
  assert.match(source, /POSTURE_PERSISTENCE_EVENTS\.STORAGE_RESTORED/);
  assert.match(source, /previousPostureTarget/);
  assert.match(source, /probePostureRecordBlobs/);
  assert.match(source, /PHOTO_METADATA_LOAD_FAILED/);
  assert.match(source, /PHOTO_METADATA_PARSE_FAILED/);
  assert.match(source, /IDB_BLOB_READ_FAILED/);
  assert.match(source, /PHOTO_METADATA_SAVE_FAILED/);
  assert.match(source, /POSE_BLOB_SAVE_FAILED/);
  assert.match(source, /CLEAN_BLOB_SAVE_FAILED/);
  assert.match(source, /POSTURE_PERSISTENCE_EVENTS\.SAVE_COMMITTED[\s\S]{0,6000}기기 저장 완료/);
});
