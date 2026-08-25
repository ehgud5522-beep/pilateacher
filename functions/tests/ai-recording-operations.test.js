"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createAIRecordingOperations, operationalFailure } = require("../src/ai-recording-operations");

function fakeFirestore() {
  const writes = [];
  return {
    writes,
    doc(path) { return { async set(data, options) { writes.push({ kind: "config", path, data, options }); } }; },
    collection(path) { return { async add(data) { writes.push({ kind: "alert", path, data }); } }; },
  };
}

test("quota exhaustion atomically degrades recording and creates a privacy-safe operator alert", async () => {
  const firestore = fakeFirestore();
  const logs = [];
  const operations = createAIRecordingOperations({ firestore, logger: { error: (event, details) => logs.push({ event, details }) }, clock: () => new Date("2026-08-24T00:00:00.000Z") });
  const error = Object.assign(new Error("provider failure"), {
    code: "provider_unavailable",
    diagnostic: { stage: "provider_http", providerStatus: 429, providerCode: "insufficient_quota", providerType: "insufficient_quota" },
  });
  const result = await operations.handleFailure(error, { requestId: "safe-request", operation: "structureLessonRecord" });
  assert.equal(result.status, "degraded");
  assert.equal(firestore.writes[0].data.status, "degraded");
  assert.equal(firestore.writes[1].kind, "alert");
  assert.equal(logs[0].event, "ai_recording_operational_alert");
  assert.doesNotMatch(JSON.stringify(firestore.writes), /transcript|memberName|phone/i);
});

test("configuration failure turns AI recording off while temporary failures do not touch the flag", async () => {
  assert.deepEqual(operationalFailure({ diagnostic: { providerCode: "secret_missing", providerType: "configuration" } }), { code: "provider_configuration", status: "off" });
  assert.equal(operationalFailure({ code: "timeout", diagnostic: { providerStatus: 504 } }), null);
});
