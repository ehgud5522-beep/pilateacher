"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGatewayRequest } = require("../src/request-contracts");
const { createM4aFixture } = require("./audio-fixtures");

const envelope = (operation, input, requestId = `ai_openai_${operation}_12345678`) => ({
  method: "POST",
  body: { schemaVersion: 1, requestId, provider: "openai", operation, input },
  headers: { "x-idempotency-key": requestId },
  get(name) { return this.headers[String(name).toLowerCase()] || ""; },
});

const bodyInput = () => ({
  schemaVersion: 1,
  memberId: "member-1",
  goals: ["정렬"],
  precautions: [],
  teacherNote: "통증 없음",
  views: [{
    view: "front",
    assessmentId: "assessment-1",
    pose: { nose: { x: 0.5, y: 0.2, score: 0.9, source: "ai" } },
    measurements: [{ key: "shoulder", value: 2.1, unit: "deg", direction: "right" }],
    confidence: { threshold: 0.4, lowJoints: [], missingJoints: [] },
    analysisSource: "ai",
    editedJoints: [],
  }],
});

test("single execute contract accepts each allowlisted operation", () => {
  const inputs = {
    analyzeBody: bodyInput(),
    summarizeVoice: { schemaVersion: 1, memberId: "member-1", lessonId: "lesson-1", transcript: "브리지를 진행했다.", language: "ko-KR" },
    lesson_record_from_audio: {
      schemaVersion: 1,
      memberId: "member-1",
      lessonId: "lesson-1",
      audio: createM4aFixture(20).toString("base64"),
      memberName: "김지민",
      language: "ko",
      clipId: "clip-lesson-1",
      audioMetrics: { intervalMs: 100, amplitudes: Array(30).fill(0.2) },
    },
    recommendSequence: {
      schemaVersion: 1, memberId: "member-1", goals: ["코어"], precautions: [], bodyAssessment: null,
      recentLessons: [{ lessonId: "lesson-1", date: "2026-08-23", type: "개인", status: "done" }],
      recentNotes: [{ lessonId: "lesson-1", date: "2026-08-23", body: "호흡", teacherSummary: "" }],
    },
    generateReport: { schemaVersion: 1, reportType: "renewal_consultation", memberId: "member-1", source: { goal: "코어", remainingLessons: 3 } },
  };
  for (const [operation, input] of Object.entries(inputs)) {
    const parsed = parseGatewayRequest(envelope(operation, input));
    assert.equal(parsed.operation, operation);
    assert.equal(parsed.input.memberId, "member-1");
  }
});

test("audio lesson request enforces the 2MB and 90 second media contract", () => {
  const valid = {
    schemaVersion: 1,
    memberId: "member-1",
    lessonId: "lesson-1",
    audio: createM4aFixture(89).toString("base64"),
    memberName: "김지민",
    language: "ko",
    clipId: "clip-lesson-1",
    audioMetrics: { intervalMs: 100, amplitudes: Array(30).fill(0.2), trimmedMs: 3200, captureLatencyMs: 88 },
  };
  assert.equal(parseGatewayRequest(envelope("lesson_record_from_audio", valid)).input.language, "ko");
  assert.equal(parseGatewayRequest(envelope("lesson_record_from_audio", valid)).input.audioMetrics.amplitudes.length, 30);
  assert.equal(parseGatewayRequest(envelope("lesson_record_from_audio", valid)).input.audioMetrics.trimmedMs, 3200);
  assert.equal(parseGatewayRequest(envelope("lesson_record_from_audio", valid)).input.audioMetrics.captureLatencyMs, 88);
  assert.throws(
    () => parseGatewayRequest(envelope("lesson_record_from_audio", { ...valid, audio: createM4aFixture(91).toString("base64") })),
    (error) => error.code === "invalid_request",
  );
});

test("voice summary accepts a member-owned note before a lesson id exists", () => {
  const parsed = parseGatewayRequest(envelope("summarizeVoice", {
    schemaVersion: 1,
    memberId: "member-1",
    lessonId: "",
    transcript: "회원 상세에서 바로 남긴 수업 기록",
    language: "ko-KR",
  }));
  assert.equal(parsed.input.lessonId, "");
});

test("request allowlist rejects media, secrets, unknown fields and oversized transcript", () => {
  const cases = [
    envelope("analyzeBody", { ...bodyInput(), photo: "data:image/jpeg;base64,AAAA" }),
    envelope("summarizeVoice", { schemaVersion: 1, memberId: "member-1", lessonId: "lesson-1", transcript: "sk-secretvalue123456", language: "ko-KR" }),
    envelope("summarizeVoice", { schemaVersion: 1, memberId: "member-1", lessonId: "lesson-1", transcript: "x".repeat(12001), language: "ko-KR" }),
    envelope("generateReport", { schemaVersion: 1, reportType: "renewal_consultation", memberId: "member-1", source: { photo: "unsafe" } }),
  ];
  for (const request of cases) assert.throws(() => parseGatewayRequest(request), (error) => error.code === "invalid_request");
});

test("idempotency header must exactly match the body and provider is server allowlisted", () => {
  const wrongHeader = envelope("analyzeBody", bodyInput());
  wrongHeader.headers["x-idempotency-key"] = "different-request-1234";
  assert.throws(() => parseGatewayRequest(wrongHeader), (error) => error.code === "invalid_request");
  const wrongProvider = envelope("analyzeBody", bodyInput());
  wrongProvider.body.provider = "gemini";
  assert.throws(() => parseGatewayRequest(wrongProvider), (error) => error.code === "invalid_request");
});

test("confirmed body analysis fields are strict when reused by sequence or result cards", () => {
  const validBody = {
    bodyCharacteristics: ["정렬 차이 경향"], asymmetries: [], pelvis: "", thorax: "", scapula: "", head: "", knees: "", feet: "", recommendedExercises: [], precautions: [],
  };
  const sequence = {
    schemaVersion: 1, memberId: "member-1", goals: [], precautions: [], bodyAssessment: validBody, recentLessons: [], recentNotes: [],
  };
  assert.deepEqual(parseGatewayRequest(envelope("recommendSequence", sequence)).input.bodyAssessment, validBody);
  const report = {
    schemaVersion: 1, reportType: "member_body_assessment_card", memberId: "member-1", source: { bodyAnalysis: validBody, teacherNote: "확인" },
  };
  assert.deepEqual(parseGatewayRequest(envelope("generateReport", report)).input.source.bodyAnalysis, validBody);
  assert.throws(
    () => parseGatewayRequest(envelope("recommendSequence", { ...sequence, bodyAssessment: { ...validBody, diagnosis: "추측" } })),
    (error) => error.code === "invalid_request",
  );
});
