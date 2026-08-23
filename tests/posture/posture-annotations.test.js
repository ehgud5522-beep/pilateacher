import assert from "node:assert/strict";
import test from "node:test";

import {
  addRecentAnnotationColor,
  annotationTextBounds,
  annotationTextLines,
  applyAnnotationDrag,
  arrowHeadPoints,
  hitTestAnnotation,
  hitTestAnnotations,
  normalizeAnnotationColor,
  readRecentAnnotationColors,
  rememberAnnotationColor,
  translateAnnotationPoints,
} from "../../src/features/posture/posture-annotations.js";

const viewport = { width: 300, height: 400 };
const arrow = {
  id: "arrow-1",
  tool: "arrow",
  width: 4,
  pts: [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 }],
};

test("arrow hit testing distinguishes both handles and the body", () => {
  assert.equal(hitTestAnnotation(arrow, { x: 0.2, y: 0.3 }, viewport)?.part, "start");
  assert.equal(hitTestAnnotation(arrow, { x: 0.8, y: 0.7 }, viewport)?.part, "end");
  assert.equal(hitTestAnnotation(arrow, { x: 0.5, y: 0.5 }, viewport)?.part, "body");
  assert.equal(hitTestAnnotation(arrow, { x: 0.05, y: 0.9 }, viewport), null);
});

test("topmost editable annotation wins hit testing", () => {
  const second = { ...arrow, id: "arrow-2" };
  const hit = hitTestAnnotations([arrow, second], { x: 0.5, y: 0.5 }, viewport, { tools: ["arrow"] });
  assert.equal(hit.markId, "arrow-2");
  assert.equal(hit.index, 1);
});

test("dragging arrow handles changes only the requested endpoint", () => {
  const start = applyAnnotationDrag(arrow, { kind: "arrow-start", originalPoints: arrow.pts }, { x: 0.1, y: 0.2 }, viewport);
  assert.deepEqual(start.pts, [{ x: 0.1, y: 0.2 }, arrow.pts[1]]);

  const end = applyAnnotationDrag(arrow, { kind: "arrow-end", originalPoints: arrow.pts }, { x: 0.9, y: 0.95 }, viewport);
  assert.deepEqual(end.pts, [arrow.pts[0], { x: 0.9, y: 0.95 }]);
});

test("dragging an arrow body preserves its vector and clamps the whole mark", () => {
  const moved = applyAnnotationDrag(arrow, { kind: "move-arrow", origin: { x: 0.5, y: 0.5 }, originalPoints: arrow.pts }, { x: 0.8, y: 0.9 }, viewport);
  assert.ok(Math.abs(moved.pts[0].x - 0.4) < 1e-9);
  assert.ok(Math.abs(moved.pts[0].y - 0.6) < 1e-9);
  assert.deepEqual(moved.pts[1], { x: 1, y: 1 });
  assert.ok(Math.abs((moved.pts[1].x - moved.pts[0].x) - 0.6) < 1e-9);
  assert.ok(Math.abs((moved.pts[1].y - moved.pts[0].y) - 0.4) < 1e-9);
  assert.deepEqual(translateAnnotationPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }], -2, 2), [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
});

test("handwriting notes support multiline bounds, hit testing, and bounded dragging", () => {
  const note = { id: "note-1", tool: "text", fontStyle: "handwriting", width: 3, label: "첫 줄\n둘째 줄", pts: [{ x: 0.2, y: 0.2 }] };
  assert.deepEqual(annotationTextLines(note), ["첫 줄", "둘째 줄"]);
  const bounds = annotationTextBounds(note, viewport, (line) => line.length * 20);
  assert.ok(bounds.height > bounds.lineHeight);
  assert.equal(hitTestAnnotation(note, { x: 0.25, y: 0.23 }, viewport, { measureText: (line) => line.length * 20 })?.part, "body");

  const moved = applyAnnotationDrag(note, {
    kind: "move-text",
    originalPoints: note.pts,
    grabOffset: { x: 0.02, y: 0.01 },
  }, { x: 0.99, y: 0.99 }, viewport, { measureText: (line) => line.length * 20 });
  const movedBounds = annotationTextBounds(moved, viewport, (line) => line.length * 20);
  assert.ok(movedBounds.right <= viewport.width + 1e-9);
  assert.ok(movedBounds.bottom <= viewport.height + 1e-9);
});

test("arrow head geometry is symmetric around its endpoint", () => {
  const [upper, lower] = arrowHeadPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
  assert.equal(Number(upper.x.toFixed(6)), Number(lower.x.toFixed(6)));
  assert.equal(Number(upper.y.toFixed(6)), -Number(lower.y.toFixed(6)));
});

test("custom colors normalize, deduplicate, persist, and tolerate broken storage", () => {
  assert.equal(normalizeAnnotationColor("#abc"), "#AABBCC");
  assert.deepEqual(addRecentAnnotationColor(["#FF0000", "#00FF00"], "#ff0000"), ["#FF0000", "#00FF00"]);

  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  rememberAnnotationColor(storage, "#123456");
  rememberAnnotationColor(storage, "#ABCDEF");
  assert.deepEqual(readRecentAnnotationColors(storage), ["#ABCDEF", "#123456"]);
  assert.deepEqual(readRecentAnnotationColors({ getItem: () => "{" }), []);
});
