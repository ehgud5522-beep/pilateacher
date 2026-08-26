import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const firebaseSource = await readFile(new URL("../../src/lib/firebase.js", import.meta.url), "utf8");
const rulesSource = await readFile(new URL("../../firestore.foundation.rules", import.meta.url), "utf8");

test("hidden diagnostics sends the bounded privacy-safe report to the signed-in owner path", () => {
  assert.match(appSource, /aria-label="진단 보내기"/);
  assert.match(appSource, /buildRemoteDiagnosticReport\(\{/);
  assert.match(appSource, /fbSendDiagnosticReport\(account\.id, report\)/);
  assert.match(firebaseSource, /doc\(fs, "diagnostics", safeUid, "reports", reportId\)/);
  assert.match(rulesSource, /match \/diagnostics\/\{userId\}\/reports\/\{reportId\}/);
  assert.match(rulesSource, /request\.resource\.data\.logs\.size\(\) <= 50/);
});

test("pilot metric transport contains aggregates and no lesson content fields", () => {
  const metricFunction = firebaseSource.slice(firebaseSource.indexOf("export async function fbWritePilotMetricAttempt"), firebaseSource.indexOf("export async function fbListPhotoBackups"));
  assert.match(metricFunction, /result,/);
  assert.match(metricFunction, /flags,/);
  assert.match(metricFunction, /confirmed:/);
  assert.match(metricFunction, /latencyMs:/);
  assert.doesNotMatch(metricFunction, /transcript|audioBlob|memberName|phone/);
});
