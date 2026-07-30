import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compareStructures, markdownReport } from "../../tools/validation/compare.js";

const legacy = JSON.parse(await readFile(new URL("../fixtures/legacy-backup.json", import.meta.url), "utf8"));
const current = JSON.parse(await readFile(new URL("../fixtures/new-structure.json", import.meta.url), "utf8"));

test("fixture comparison covers required counts and checksums", () => {
  const report = compareStructures(legacy, current);
  assert.equal(report.match, true);
  assert.equal(report.legacy.clients, 2);
  assert.equal(report.legacy.lessons, 2);
  assert.deepEqual(report.legacy.lessonsByDate, { "2026-01-03": 1, "2026-01-04": 1 });
  assert.equal(report.legacy.attended, 1);
  assert.equal(report.legacy.noshow, 1);
  assert.equal(report.legacy.cancelled, 1);
  assert.equal(report.legacy.missingNotes, 1);
  assert.equal(report.legacy.assessments, 1);
  assert.equal(report.legacy.photoMetadata, 2);
  assert.equal(report.legacy.remainingRegular, 6);
  assert.equal(report.legacy.remainingService, 1);
  assert.match(report.comparisonChecksum, /^[a-f0-9]{64}$/);
});

test("comparison reports missing and duplicate IDs", () => {
  const changed = structuredClone(current);
  changed.collections.clients.pop();
  changed.collections.lessons.push({ ...changed.collections.lessons[0] });
  const report = compareStructures(legacy, changed);
  assert.equal(report.match, false);
  assert.deepEqual(report.missingDocuments, ["client-fixture-2"]);
  assert.ok(report.duplicateDocuments.includes("lessons/lesson-fixture-1"));
  assert.ok(report.sampleMismatchIds.length > 0);
});

test("markdown formatter emits a reviewable report", () => {
  const output = markdownReport(compareStructures(legacy, current));
  assert.match(output, /Result: MATCH/);
  assert.match(output, /Missing documents: 0/);
});
