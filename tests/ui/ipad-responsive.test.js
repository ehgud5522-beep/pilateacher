import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

test("phone keeps its existing width while iPad receives bounded tablet layouts", () => {
  assert.match(source, /\.pt-app-shell, \.pt-header-inner \{ width: 100%; max-width: 420px; \}/);
  assert.match(source, /@media \(min-width: 768px\)/);
  assert.match(source, /max-width: min\(900px, 100vw\)/);
  assert.match(source, /\.pt-generic-sheet, \.pt-schedule-sheet \{ max-width: min\(760px, calc\(100vw - 32px\)\); \}/);
  assert.match(source, /@media \(min-width: 1024px\) and \(orientation: landscape\)/);
  assert.match(source, /max-width: min\(960px, 100vw\)/);
});

test("tablet weekly schedule improves legibility without global scaling", () => {
  assert.match(source, /\.pt-week-grid \{ --pt-week-axis: 40px; \}/);
  assert.match(source, /\.pt-week-day \{ font-size: 13px; \}/);
  assert.match(source, /\.pt-week-date \{ font-size: 16px; \}/);
  assert.match(source, /\.pt-week-time \{ font-size: 11px; \}/);
  assert.doesNotMatch(source, /\.pt-app-shell[^}]*transform:\s*scale\(/);
});

test("app, header, sheets, and weekly grid use responsive classes", () => {
  for (const marker of ["pt-app-shell", "pt-header-inner", "pt-generic-sheet", "pt-schedule-sheet", "pt-week-grid"]) {
    assert.match(source, new RegExp(marker));
  }
});
