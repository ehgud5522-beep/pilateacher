import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

test("center personal rate remains the live fallback for member settlement", () => {
  assert.match(source, /solo: Number\(st\?\.payRate\) > 0 \? Number\(st\.payRate\) : DEF_RATE/);
  assert.match(source, /return Number\(m\.payRate\) > 0 \? Number\(m\.payRate\) : base\.solo/);
  assert.match(source, /센터 기본/);
});

test("monthly schedule and report pay both consume the fallback rate", () => {
  const matches = source.match(/rateFor\(db\.members\.find\([^\n]+attendee\.memberId\)[^\n]+db\.settings\)/g) || [];
  assert.ok(matches.length >= 1, "monthly report must use member-or-center fallback");
  assert.match(source, /sum \+= rateFor\(db\.members\.find\(\(x\) => x\.id === a\.memberId\), s\.type, db\.settings\)/);
});

test("center settings hide the personal rate input without removing the stored fallback", () => {
  const legacyStart = source.indexOf("function SettingsTab(");
  const legacyEnd = source.indexOf("function ReferenceSettingsTab(", legacyStart);
  const referenceStart = legacyEnd;
  const referenceEnd = source.indexOf("function App(", referenceStart);
  assert.doesNotMatch(source.slice(legacyStart, legacyEnd), /<Field label="개인 1회당 원">/);
  assert.doesNotMatch(source.slice(referenceStart, referenceEnd), /<Field label="개인 1회당 원">/);
  assert.match(source, /st\?\.payRate/);
});
