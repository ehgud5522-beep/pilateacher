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
