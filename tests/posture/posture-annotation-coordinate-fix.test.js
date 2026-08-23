import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hexToHsl,
  hitTestAnnotation,
  hslToHex,
  rememberAnnotationColor,
  screenPointToImagePoint,
} from "../../src/features/posture/posture-annotations.js";

const frame = { left: 100, top: 200, width: 300, height: 400 };
const screenFor = (imagePoint, { zoom = 1, panX = 0, panY = 0 } = {}) => ({
  clientX: frame.left + frame.width / 2 + panX + (imagePoint.x * frame.width - frame.width / 2) * zoom,
  clientY: frame.top + frame.height / 2 + panY + (imagePoint.y * frame.height - frame.height / 2) * zoom,
});

const closePoint = (actual, expected) => {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `x ${actual.x} !== ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `y ${actual.y} !== ${expected.y}`);
};

test("A: marks created at 1x stay in normalized image space", () => {
  const expected = { x: 0.25, y: 0.62 };
  closePoint(screenPointToImagePoint(screenFor(expected), frame), expected);
});

test("B: marks created at 2.4x map to the same 1x image position", () => {
  const expected = { x: 0.74, y: 0.31 };
  const transform = { zoom: 2.4 };
  closePoint(screenPointToImagePoint(screenFor(expected, transform), frame, transform), expected);
});

test("C: zoom plus pan is inverted before saving or moving annotations", () => {
  const expected = { x: 0.41, y: 0.77 };
  const transform = { zoom: 2.4, panX: 38, panY: -27 };
  closePoint(screenPointToImagePoint(screenFor(expected, transform), frame, transform), expected);
});

test("D: normalized legacy marks round-trip unchanged after reopen", () => {
  const marks = [{ id: "legacy", tool: "arrow", width: 4, pts: [{ x: 0.13, y: 0.22 }, { x: 0.81, y: 0.68 }] }];
  assert.deepEqual(JSON.parse(JSON.stringify(marks)), marks);
});

test("arrow handles keep a 44px hit target while the visual handle is compact", async () => {
  const mark = { id: "arrow", tool: "arrow", width: 2, pts: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }] };
  const hit = hitTestAnnotation(mark, { x: 0.2 + 21 / 720, y: 0.2 }, { width: 720, height: 960 }, { handleRadius: 22 });
  assert.equal(hit?.part, "start");
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /ctx\.arc\(value\.x, value\.y, 6,/);
  assert.match(source, /handleRadius: 22/);
  assert.match(source, /mark\.tool === "arrow" \? 0\.78 : 1/);
  assert.match(source, /\(7 \+ \(Number\(mark\.width\) \|\| 3\) \* 1\.4\)/);
});

test("compact custom picker converts color live and persists the applied color", () => {
  const original = "#35B8FF";
  const hsl = hexToHsl(original);
  const roundTrip = hslToHex(hsl.h, hsl.s, hsl.l);
  assert.match(roundTrip, /^#[0-9A-F]{6}$/);
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(rememberAnnotationColor(storage, roundTrip), [roundTrip]);
  assert.match(values.values().next().value, new RegExp(roundTrip));
});
