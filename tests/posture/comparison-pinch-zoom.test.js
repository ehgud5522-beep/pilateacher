import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const comparison = async () => {
  const source = await appSource();
  const start = source.indexOf("const onPointerDown = (event) => {");
  return source.slice(start, source.indexOf("const frameStyle =", start));
};

const MAX = 5;

/* The zoom the pinch settles on, lifted from App.jsx: the starting zoom scaled
   by how much the fingers spread, clamped to [1, MAX]. */
const pinchZoom = (z0, d0, distance) => Math.min(MAX, Math.max(1, z0 * (Math.max(1, distance) / d0)));

test("spreading the fingers magnifies by the same ratio", () => {
  assert.equal(pinchZoom(1, 100, 200), 2);
  assert.equal(pinchZoom(1, 100, 150), 1.5);
  assert.equal(pinchZoom(2, 100, 150), 3, "and it builds on the zoom already applied");
});

test("pinching in never goes below life size", () => {
  /* Below 1x the photo would float inside its frame with nothing to see. */
  assert.equal(pinchZoom(1, 200, 50), 1);
  assert.equal(pinchZoom(2, 200, 20), 1);
});

test("magnification is bounded", () => {
  assert.equal(pinchZoom(1, 10, 100000), MAX);
  assert.equal(pinchZoom(MAX, 100, 400), MAX);
});

test("a degenerate pinch cannot divide by zero", () => {
  // Two fingers landing on the same pixel give d0 = 1, not 0.
  assert.ok(Number.isFinite(pinchZoom(1, 1, 1)));
  assert.equal(pinchZoom(1, 1, 0), 1, "an impossible distance is floored, not NaN");
});

/* ------------------------------ the wiring ------------------------------ */

test("two fingers on the overlay drive the zoom", async () => {
  const body = await comparison();
  /* Before this there was no zoom gesture at all -- only three buttons. */
  assert.match(body, /if \(pointers\.current\.size === 2\) \{/);
  assert.match(body, /d0: Math\.max\(1, Math\.hypot\(b\.x - a\.x, b\.y - a\.y\)\),/);
  assert.match(body, /setZoom\(Math\.min\(COMPARISON_MAX_ZOOM, Math\.max\(1, start\.z0 \* \(distance \/ start\.d0\)\)\)\);/);
  assert.match(await appSource(), /const COMPARISON_MAX_ZOOM = 5;/);
});

test("both photos move together", async () => {
  const source = await appSource();
  /* One zoom and one pan feed both layers, and the After layer appends only
     its alignment offset -- so magnifying cannot pull the two apart. */
  assert.match(source, /const commonTransform = `translate\(\$\{pan\.x\}px, \$\{pan\.y\}px\) scale\(\$\{zoom\}\)`;/);
  assert.match(source, /const afterTransform = alignEnabled && alignment\.available\s*\r?\n\s*\? `\$\{commonTransform\} translate\(/);
  assert.match(source, /<AssessmentComparisonLayer photo=\{beforePhoto\}[^>]*transform=\{commonTransform\}/);
  assert.match(source, /<AssessmentComparisonLayer photo=\{afterPhoto\}[^>]*transform=\{afterTransform\}/);
});

test("a pinch cancels a drag already in progress", async () => {
  const body = await comparison();
  // Otherwise the photo would follow one of the two fingers as well as scale.
  assert.match(body, /drag\.current = null;\s*\r?\n\s*pinch\.current = \{/);
});

test("dragging still pans, and only once magnified", async () => {
  const body = await comparison();
  assert.match(body, /if \(zoom <= 1\) return;\s*\r?\n\s*drag\.current = \{ id: event\.pointerId/);
  assert.match(body, /setPan\(\{ x: drag\.current\.px \+ event\.clientX - drag\.current\.x, y: drag\.current\.py \+ event\.clientY - drag\.current\.y \}\);/);
});

test("a double tap returns to life size", async () => {
  const body = await comparison();
  /* Asked for as the only remaining button-free way back; without it a
     magnified photo has no exit. */
  assert.match(body, /if \(now - lastTap\.current < COMPARISON_DOUBLE_TAP_MS\) \{ lastTap\.current = 0; resetView\(\); return; \}/);
  assert.match(await appSource(), /const COMPARISON_DOUBLE_TAP_MS = 280;/);
  // resetView clears the pan as well as the zoom.
  assert.match(await appSource(), /const resetView = \(\) => \{ setZoom\(1\); setPan\(\{ x: 0, y: 0 \}\); \};/);
});

test("releasing at life size puts the photo back in its frame", async () => {
  const body = await comparison();
  // Pinching back down to 1x leaves the pan behind otherwise.
  assert.match(body, /if \(zoom <= 1\.02 && \(pan\.x !== 0 \|\| pan\.y !== 0\)\) setPan\(\{ x: 0, y: 0 \}\);/);
});

test("every pointer is released", async () => {
  const body = await comparison();
  /* A pointer left in the map keeps size >= 2 forever and the frame stops
     responding to single touches. */
  assert.match(body, /const stopPointer = \(event\) => \{\s*\r?\n\s*if \(event\?\.pointerId != null\) pointers\.current\.delete\(event\.pointerId\);/);
  assert.match(body, /if \(pointers\.current\.size < 2\) pinch\.current = null;/);
  const source = await appSource();
  assert.match(source, /onPointerUp=\{stopPointer\} onPointerCancel=\{stopPointer\}/);
});

test("the frame keeps the gesture instead of scrolling the page", async () => {
  const source = await appSource();
  // Same treatment the analysis photo already gets.
  assert.match(source, /className="relative overflow-hidden" style=\{\{ \.\.\.frameStyle, touchAction: "none" \}\}>/);
});

test("the three magnification buttons are gone", async () => {
  const source = await appSource();
  assert.doesNotMatch(source, /동시 확대/);
  assert.doesNotMatch(source, /\[1, 1\.5, 2\]\.map/);
  // Replaced by a line that says what to do, and what the zoom currently is.
  assert.match(source, /두 손가락으로 확대·이동할 수 있습니다/);
  assert.match(source, /두 번 두드리면 원래 크기/);
});

test("side-by-side mode takes no gestures", async () => {
  const body = await comparison();
  /* Two separate photos with no shared transform; a pinch there would mean
     nothing. */
  assert.match(body, /if \(mode === "side"\) return;/);
});

test("switching sets or view resets the magnification", async () => {
  const source = await appSource();
  // A zoom left over from another photo lands somewhere arbitrary on the next.
  assert.match(source, /useEffect\(\(\) => \{ setOpacity\(50\); resetView\(\); \}, \[beforeSet\?\.id, afterSet\?\.id, normalizedView, mode\]\);/);
});
