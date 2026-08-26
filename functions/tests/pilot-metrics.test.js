"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { argumentsOf } = require("../scripts/pilot-daily-metrics");
const { median, pilotMetricsMarkdown, summarizePilotMetrics } = require("../src/pilot-metrics");

test("pilot metrics aggregate privacy-safe daily ratios and median per instructor", () => {
  const attempts = [
    { uid: "teacher-a", date: "2026-08-26", result: "ok", flags: [], confirmed: true, latencyMs: 2000 },
    { uid: "teacher-a", date: "2026-08-26", result: "ok", flags: ["tail_dropped"], confirmed: false, latencyMs: 4000 },
    { uid: "teacher-a", date: "2026-08-26", result: "no_speech", flags: ["no_speech"], confirmed: false, latencyMs: 0 },
    { uid: "teacher-a", date: "2026-08-26", result: "low_confidence", flags: ["low_confidence"], confirmed: false, latencyMs: 3000 },
    { uid: "teacher-b", date: "2026-08-26", result: "ok", flags: [], confirmed: true, latencyMs: 1500 },
    { uid: "teacher-a", date: "2026-08-25", result: "ok", flags: [], confirmed: true, latencyMs: 9999 },
  ];
  const rows = summarizePilotMetrics(attempts, "2026-08-26");
  assert.deepEqual(rows[0], {
    date: "2026-08-26", instructorId: "teacher-a", recordCount: 2, attemptCount: 4,
    noSpeechRatio: 25, lowConfidenceRatio: 25, tailDroppedRatio: 25,
    aiConfirmationRatio: 50, medianCompletionToResultMs: 3000,
  });
  assert.equal(rows[1].recordCount, 1);
  assert.match(pilotMetricsMarkdown(rows), /teacher-a.*2.*4.*25%.*50%.*3000ms/);
});

test("pilot metrics helpers reject unsafe CLI dates and calculate even medians", () => {
  assert.equal(median([1000, 3000]), 2000);
  assert.equal(argumentsOf(["--project", "pilateacher", "--date", "2026-08-26"]).date, "2026-08-26");
  assert.throws(() => argumentsOf(["--date", "26-08-2026"]), /YYYY-MM-DD/);
});
