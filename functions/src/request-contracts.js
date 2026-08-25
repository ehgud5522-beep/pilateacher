"use strict";

const { createHash } = require("node:crypto");
const { readHeader } = require("./auth");
const { decodeAudioBase64 } = require("./audio-contract");
const { GatewayError } = require("./errors");
const { OPERATIONS, validateOperationOutput } = require("./operation-contracts");

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const MAX_REQUEST_BYTES = 256000;
const MAX_AUDIO_REQUEST_BYTES = 3 * 1024 * 1024;
const BODY_VIEWS = new Set(["front", "leftSide", "back", "rightSide"]);
const REPORT_TYPES = new Set([
  "renewal_consultation",
  "member_progress_message",
  "instructor_coaching_note",
  "member_body_assessment_card",
]);
const REPORT_SOURCE_FIELDS = Object.freeze({
  renewal_consultation: new Set(["goal", "remainingLessons", "expiryDays", "attendance", "bodyComposition", "performance"]),
  member_progress_message: new Set(["목표", "비교구간", "체성분", "수행능력", "출석률", "운동페이스", "잔여횟수", "좋아진점", "관리필요"]),
  instructor_coaching_note: new Set(["목표", "비교구간", "체성분", "수행능력", "출석률", "운동페이스", "잔여횟수", "좋아진점", "관리필요"]),
  member_body_assessment_card: new Set(["bodyAnalysis", "teacherNote"]),
});
const FORBIDDEN_KEY = /(photo|image|blob|base64|dataurl|password|secret|token|authorization|api.?key|phone|email|name|전화|이메일|이름|성명|회원명|강사명|비밀번호|비밀)/i;
const SECRET_VALUE = /(data:image\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bsk-[A-Za-z0-9_-]{12,}|OPENAI_API_KEY)/i;

function invalid(message) {
  return new GatewayError("invalid_request", { internalMessage: message });
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${field} must be an object`);
  return value;
}

function requireExactKeys(value, allowed, field, required = allowed) {
  const source = requireObject(value, field);
  const allowedSet = new Set(allowed);
  if (Object.keys(source).some((key) => !allowedSet.has(key))) throw invalid(`${field} has unsupported fields`);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(source, key))) throw invalid(`${field} is missing fields`);
  return source;
}

function requireId(value, field) {
  const result = String(value || "").trim();
  if (!ID_PATTERN.test(result)) throw invalid(`${field} is invalid`);
  return result;
}

function requireString(value, field, maxLength, { allowEmpty = true } = {}) {
  if (typeof value !== "string") throw invalid(`${field} must be a string`);
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > maxLength) throw invalid(`${field} is invalid`);
  if (SECRET_VALUE.test(result)) throw invalid(`${field} contains forbidden material`);
  return result;
}

function requireStringList(value, field, maxItems = 20, maxLength = 500) {
  if (!Array.isArray(value) || value.length > maxItems) throw invalid(`${field} is invalid`);
  return value.map((item, index) => requireString(item, `${field}[${index}]`, maxLength)).filter(Boolean);
}

function safeJSON(value, field, depth = 0) {
  if (depth > 6) throw invalid(`${field} is too deeply nested`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1000000000) throw invalid(`${field} has an invalid number`);
    return value;
  }
  if (typeof value === "string") return requireString(value, field, 2000);
  if (Array.isArray(value)) {
    if (value.length > 40) throw invalid(`${field} has too many items`);
    return value.map((item, index) => safeJSON(item, `${field}[${index}]`, depth + 1));
  }
  const source = requireObject(value, field);
  const keys = Object.keys(source);
  if (keys.length > 40 || keys.some((key) => key.length > 80 || FORBIDDEN_KEY.test(key))) {
    throw invalid(`${field} has forbidden or excessive fields`);
  }
  return Object.fromEntries(keys.map((key) => [key, safeJSON(source[key], `${field}.${key}`, depth + 1)]));
}

function bodyAssessment(value, field) {
  try {
    return validateOperationOutput(OPERATIONS.ANALYZE_BODY, value);
  } catch (_error) {
    throw invalid(`${field} is not a confirmed body analysis`);
  }
}

function parseBodyInput(raw) {
  const input = requireExactKeys(raw, ["schemaVersion", "memberId", "goals", "precautions", "teacherNote", "views"], "input");
  if (input.schemaVersion !== 1) throw invalid("input.schemaVersion is invalid");
  if (!Array.isArray(input.views) || input.views.length < 1 || input.views.length > 4) throw invalid("input.views is invalid");
  const seen = new Set();
  let measurementCount = 0;
  const views = input.views.map((rawView, index) => {
    const field = `input.views[${index}]`;
    const view = requireExactKeys(rawView, ["view", "assessmentId", "pose", "measurements", "confidence", "analysisSource", "editedJoints"], field);
    const viewName = requireString(view.view, `${field}.view`, 20, { allowEmpty: false });
    if (!BODY_VIEWS.has(viewName) || seen.has(viewName)) throw invalid(`${field}.view is invalid`);
    seen.add(viewName);
    const poseSource = requireObject(view.pose, `${field}.pose`);
    const poseKeys = Object.keys(poseSource);
    if (poseKeys.length > 64) throw invalid(`${field}.pose has too many joints`);
    const pose = Object.fromEntries(poseKeys.map((key) => {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) throw invalid(`${field}.pose has an invalid joint`);
      const point = requireExactKeys(poseSource[key], ["x", "y", "score", "source"], `${field}.pose.${key}`, ["x", "y"]);
      const x = point.x;
      const y = point.y;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < -0.5 || x > 1.5 || y < -0.5 || y > 1.5) throw invalid(`${field}.pose.${key} is invalid`);
      const next = { x, y };
      if (point.score !== undefined) {
        const score = point.score;
        if (!Number.isFinite(score) || score < 0 || score > 1) throw invalid(`${field}.pose.${key}.score is invalid`);
        next.score = score;
      }
      if (point.source !== undefined) next.source = requireString(point.source, `${field}.pose.${key}.source`, 40);
      return [key, next];
    }));
    if (!Array.isArray(view.measurements) || view.measurements.length > 64) throw invalid(`${field}.measurements is invalid`);
    const measurements = view.measurements.map((rawMetric, metricIndex) => {
      const metricField = `${field}.measurements[${metricIndex}]`;
      const metric = requireExactKeys(rawMetric, ["key", "value", "unit", "direction"], metricField);
      const value = metric.value;
      if (!Number.isFinite(value) || Math.abs(value) > 1000000) throw invalid(`${metricField}.value is invalid`);
      return {
        key: requireString(metric.key, `${metricField}.key`, 100, { allowEmpty: false }),
        value,
        unit: requireString(metric.unit, `${metricField}.unit`, 20),
        direction: requireString(metric.direction, `${metricField}.direction`, 80),
      };
    });
    measurementCount += measurements.length;
    return {
      view: viewName,
      assessmentId: view.assessmentId ? requireId(view.assessmentId, `${field}.assessmentId`) : "",
      pose,
      measurements,
      confidence: safeJSON(view.confidence, `${field}.confidence`),
      analysisSource: requireString(view.analysisSource, `${field}.analysisSource`, 80),
      editedJoints: requireStringList(view.editedJoints, `${field}.editedJoints`, 100, 80),
    };
  });
  if (!measurementCount) throw invalid("input.views has no measurements");
  return {
    schemaVersion: 1,
    memberId: requireId(input.memberId, "input.memberId"),
    goals: requireStringList(input.goals, "input.goals"),
    precautions: requireStringList(input.precautions, "input.precautions"),
    teacherNote: requireString(input.teacherNote, "input.teacherNote", 4000),
    views,
  };
}

function parseVoiceInput(raw) {
  const input = requireExactKeys(raw, ["schemaVersion", "memberId", "lessonId", "transcript", "language"], "input");
  if (input.schemaVersion !== 1 || input.language !== "ko-KR") throw invalid("voice input version or language is invalid");
  return {
    schemaVersion: 1,
    memberId: requireId(input.memberId, "input.memberId"),
    // Member-detail notes can be transcribed before a lesson record exists.
    // If a lesson id is supplied, policy authorization also verifies it.
    lessonId: input.lessonId ? requireId(input.lessonId, "input.lessonId") : "",
    transcript: requireString(input.transcript, "input.transcript", 12000, { allowEmpty: false }),
    language: "ko-KR",
  };
}

function parseLessonRecordInput(raw) {
  const input = requireExactKeys(raw, ["schemaVersion", "memberId", "lessonId", "rawTranscript", "language", "termMap"], "input");
  if (input.schemaVersion !== 1 || input.language !== "ko-KR") throw invalid("lesson record input version or language is invalid");
  const termMap = requireExactKeys(input.termMap, ["version", "mapped", "uncertain"], "input.termMap");
  if (termMap.version !== 1 || !Array.isArray(termMap.mapped) || termMap.mapped.length > 80 || !Array.isArray(termMap.uncertain) || termMap.uncertain.length > 40) {
    throw invalid("input.termMap is invalid");
  }
  const parseMapped = (item, field, uncertain = false) => {
    const keys = uncertain ? ["raw", "candidate", "category", "bodyKey"] : ["raw", "canonical", "category", "bodyKey"];
    const source = requireExactKeys(item, keys, field);
    return Object.fromEntries(keys.map((key) => [key, requireString(source[key], `${field}.${key}`, key === "bodyKey" ? 120 : 100)]));
  };
  return {
    schemaVersion: 1,
    memberId: requireId(input.memberId, "input.memberId"),
    lessonId: input.lessonId ? requireId(input.lessonId, "input.lessonId") : "",
    rawTranscript: requireString(input.rawTranscript, "input.rawTranscript", 12000, { allowEmpty: false }),
    language: "ko-KR",
    termMap: {
      version: 1,
      mapped: termMap.mapped.map((item, index) => parseMapped(item, `input.termMap.mapped[${index}]`)),
      uncertain: termMap.uncertain.map((item, index) => parseMapped(item, `input.termMap.uncertain[${index}]`, true)),
    },
  };
}

function parseAudioLessonRecordInput(raw) {
  const input = requireExactKeys(
    raw,
    ["schemaVersion", "memberId", "lessonId", "audio", "memberName", "language"],
    "input",
  );
  if (input.schemaVersion !== 1 || input.language !== "ko") {
    throw invalid("audio lesson record input version or language is invalid");
  }
  const decoded = decodeAudioBase64(input.audio);
  decoded.buffer.fill(0);
  return {
    schemaVersion: 1,
    memberId: requireId(input.memberId, "input.memberId"),
    lessonId: input.lessonId ? requireId(input.lessonId, "input.lessonId") : "",
    audio: input.audio,
    memberName: requireString(input.memberName, "input.memberName", 160),
    language: "ko",
  };
}

function parseSequenceInput(raw) {
  const input = requireExactKeys(raw, ["schemaVersion", "memberId", "goals", "precautions", "bodyAssessment", "recentLessons", "recentNotes"], "input");
  if (input.schemaVersion !== 1) throw invalid("input.schemaVersion is invalid");
  if (!Array.isArray(input.recentLessons) || input.recentLessons.length > 10) throw invalid("input.recentLessons is invalid");
  if (!Array.isArray(input.recentNotes) || input.recentNotes.length > 10) throw invalid("input.recentNotes is invalid");
  return {
    schemaVersion: 1,
    memberId: requireId(input.memberId, "input.memberId"),
    goals: requireStringList(input.goals, "input.goals"),
    precautions: requireStringList(input.precautions, "input.precautions"),
    bodyAssessment: input.bodyAssessment === null ? null : bodyAssessment(input.bodyAssessment, "input.bodyAssessment"),
    recentLessons: input.recentLessons.map((rawLesson, index) => {
      const field = `input.recentLessons[${index}]`;
      const lesson = requireExactKeys(rawLesson, ["lessonId", "date", "type", "status"], field);
      return {
        lessonId: requireId(lesson.lessonId, `${field}.lessonId`),
        date: requireString(lesson.date, `${field}.date`, 20),
        type: requireString(lesson.type, `${field}.type`, 80),
        status: requireString(lesson.status, `${field}.status`, 80),
      };
    }),
    recentNotes: input.recentNotes.map((rawNote, index) => {
      const field = `input.recentNotes[${index}]`;
      const note = requireExactKeys(rawNote, ["lessonId", "date", "body", "teacherSummary"], field);
      return {
        lessonId: note.lessonId ? requireId(note.lessonId, `${field}.lessonId`) : "",
        date: requireString(note.date, `${field}.date`, 20),
        body: requireString(note.body, `${field}.body`, 2000),
        teacherSummary: requireString(note.teacherSummary, `${field}.teacherSummary`, 2000),
      };
    }),
  };
}

function parseReportInput(raw) {
  const input = requireExactKeys(raw, ["schemaVersion", "reportType", "memberId", "source"], "input");
  if (input.schemaVersion !== 1) throw invalid("input.schemaVersion is invalid");
  const reportType = requireString(input.reportType, "input.reportType", 80, { allowEmpty: false });
  if (!REPORT_TYPES.has(reportType)) throw invalid("input.reportType is unsupported");
  const source = requireObject(input.source, "input.source");
  const allowed = REPORT_SOURCE_FIELDS[reportType];
  const keys = Object.keys(source);
  if (!keys.length || keys.some((key) => !allowed.has(key))) throw invalid("input.source has unsupported fields");
  const safeSource = safeJSON(source, "input.source");
  if (reportType === "member_body_assessment_card") {
    if (!safeSource.bodyAnalysis) throw invalid("input.source.bodyAnalysis is required");
    safeSource.bodyAnalysis = bodyAssessment(safeSource.bodyAnalysis, "input.source.bodyAnalysis");
    if (safeSource.teacherNote !== undefined && typeof safeSource.teacherNote !== "string") throw invalid("input.source.teacherNote is invalid");
  }
  return {
    schemaVersion: 1,
    reportType,
    memberId: requireId(input.memberId, "input.memberId"),
    source: safeSource,
  };
}

function parseOperationInput(operation, raw) {
  if (operation === OPERATIONS.ANALYZE_BODY) return parseBodyInput(raw);
  if (operation === OPERATIONS.SUMMARIZE_VOICE) return parseVoiceInput(raw);
  if (operation === OPERATIONS.STRUCTURE_LESSON_RECORD) return parseLessonRecordInput(raw);
  if (operation === OPERATIONS.LESSON_RECORD_FROM_AUDIO) return parseAudioLessonRecordInput(raw);
  if (operation === OPERATIONS.RECOMMEND_SEQUENCE) return parseSequenceInput(raw);
  if (operation === OPERATIONS.GENERATE_REPORT) return parseReportInput(raw);
  throw invalid("operation is unsupported");
}

function parseGatewayRequest(req) {
  let bodySize;
  try {
    bodySize = Buffer.byteLength(JSON.stringify(req.body), "utf8");
  } catch (_error) {
    throw invalid("request body is not serializable");
  }
  const requestLimit = req?.body?.operation === OPERATIONS.LESSON_RECORD_FROM_AUDIO
    ? MAX_AUDIO_REQUEST_BYTES
    : MAX_REQUEST_BYTES;
  if (bodySize > requestLimit) throw invalid("request body is too large");
  const body = requireExactKeys(req.body, ["schemaVersion", "requestId", "provider", "operation", "input"], "request");
  if (body.schemaVersion !== 1 || body.provider !== "openai" || !Object.values(OPERATIONS).includes(body.operation)) {
    throw invalid("gateway envelope is invalid");
  }
  const requestId = String(body.requestId || "").trim();
  const headerKey = String(readHeader(req, "x-idempotency-key") || "").trim();
  if (!IDEMPOTENCY_PATTERN.test(requestId) || headerKey !== requestId) throw invalid("idempotency key is invalid");
  return {
    schemaVersion: 1,
    requestId,
    provider: "openai",
    operation: body.operation,
    input: parseOperationInput(body.operation, body.input),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function fingerprintRequest(uid, request) {
  return createHash("sha256")
    .update(JSON.stringify([String(uid || ""), stableValue(request)]))
    .digest("hex");
}

module.exports = {
  MAX_REQUEST_BYTES,
  MAX_AUDIO_REQUEST_BYTES,
  REPORT_SOURCE_FIELDS,
  REPORT_TYPES,
  fingerprintRequest,
  parseGatewayRequest,
  parseOperationInput,
};
