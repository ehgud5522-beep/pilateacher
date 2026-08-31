import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

test("phone keeps its existing width while iPad receives bounded tablet layouts", () => {
  assert.match(source, /\.pt-app-shell, \.pt-header-inner \{ width: 100%; max-width: 420px; \}/);
  assert.match(source, /@media \(min-width: 768px\)/);
  assert.match(source, /max-width: min\(1180px, 100vw\)/);
  assert.match(source, /\.pt-schedule-sheet \{ max-width: min\(560px, calc\(100vw - 32px\)\); \}/);
  assert.match(source, /@media \(min-width: 1024px\)/);
  assert.match(source, /max-width: min\(1280px, 100vw\)/);
});

test("tablet weekly schedule improves legibility without global scaling", () => {
  assert.match(source, /\.pt-week-grid \{ --pt-week-axis: 46px; \}/);
  assert.match(source, /\.pt-week-day \{ font-size: 13px; \}/);
  assert.match(source, /\.pt-week-date \{ font-size: 16px; \}/);
  assert.match(source, /\.pt-week-time \{ font-size: 11px; \}/);
  assert.doesNotMatch(source, /\.pt-app-shell[^}]*transform:\s*scale\(/);
});

test("tablet member and posture cards use 2/3 columns and both detail screens are split", () => {
  assert.match(source, /\.pt-member-card-grid, \.pt-analysis-card-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(source, /\.pt-member-card-grid, \.pt-analysis-card-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(source, /\.pt-member-detail-active \{ display: grid; grid-template-columns: minmax\(270px, 34%\) minmax\(0, 1fr\)/);
  assert.match(source, /\.pt-member-back \{ display: none !important; \}/);
  assert.match(source, /\.pt-analysis-detail-active \{ display: grid; grid-template-columns: minmax\(270px, 34%\) minmax\(0, 1fr\)/);
  assert.match(source, /\.pt-analysis-detail-active \.pt-analysis-list-pane, \.pt-analysis-detail-active \.pt-analysis-detail-pane \{ display: block/);
  assert.match(source, /\.pt-analysis-back \{ display: none !important; \}/);
  assert.match(source, /\.pt-analysis-detail-active \{ grid-template-columns: minmax\(320px, 31%\) minmax\(0, 1fr\)/);
});

test("posture capture remains a full viewport portal and comparison stays side by side", () => {
  assert.match(source, /className="fixed inset-0 z-\[200\] flex flex-col overflow-hidden" style=\{\{ height: "100dvh"/);
  assert.match(source, /createPortal\(screen, document\.body\)/);
  assert.match(source, /screen === "compare"[\s\S]*grid grid-cols-2 gap-2/);
});

test("event cells keep a second equipment line on phone and enlarge it on tablet", () => {
  assert.match(source, /\.pt-week-equip \{ display: block; margin-top: 1px; font-size: 8\.5px;/);
  assert.match(source, /\.pt-week-equip \{ margin-top: 2px; font-size: 10px; \}/);
  assert.match(source, /\.pt-week-type \{ font-size: 7\.5px;/);
  assert.match(source, /\.pt-week-type \{ font-size: 9px; \}/);
  assert.match(source, /className="pt-week-equip flex w-full min-w-0 items-center"[\s\S]{0,400}\{b\.equipText\}/);
});

test("app, header, sheets, and weekly grid use responsive classes", () => {
  for (const marker of ["pt-app-shell", "pt-header-inner", "pt-generic-sheet", "pt-schedule-sheet", "pt-week-grid"]) {
    assert.match(source, new RegExp(marker));
  }
});

test("example and restore modals use live theme tokens and stay phone-sized on tablets", () => {
  const exampleStart = source.indexOf("function LessonRecordExamplesModal");
  const exampleEnd = source.indexOf("function ChoiceBottomSheet", exampleStart);
  const exampleModal = source.slice(exampleStart, exampleEnd);
  assert.match(exampleModal, /max-w-\[560px\]/);
  assert.match(exampleModal, /backgroundColor: CARD/);
  assert.match(exampleModal, /border: `1px solid \$\{LINE\}`/);
  assert.doesNotMatch(exampleModal, /bg-white|backgroundColor:\s*["']#(?:fff|ffffff)["']/i);

  const restoreStart = source.indexOf("{restoreOffer &&");
  const restoreEnd = source.indexOf("{toast &&", restoreStart);
  const restoreModal = source.slice(restoreStart, restoreEnd);
  assert.match(restoreModal, /max-w-\[520px\]/);
  assert.match(restoreModal, /backgroundColor: PAGE/);
  assert.match(restoreModal, /backgroundColor: CARD/);
});
