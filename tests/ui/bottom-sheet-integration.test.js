import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const start = source.indexOf("function ScheduleBottomSheet(");
const end = source.indexOf("\nfunction ChoiceBottomSheet(", start);
const sheet = source.slice(start, end);

test("bottom sheet separates its real drag handle, fixed header, and native scroll viewport", () => {
  assert.match(sheet, /aria-label="아래로 끌어 닫기"/);
  assert.match(sheet, /onPointerDown=\{startHandleDrag\}/);
  assert.match(sheet, /ref=\{scrollRef\}[\s\S]*overflow-y-auto/);
  assert.match(sheet, /touchAction: "pan-y"/);
  assert.doesNotMatch(sheet, /className="w-full overflow-y-auto"/);
});

test("bottom sheet keeps X immediate and backdrop dismissal target-safe", () => {
  assert.match(sheet, /if \(dismissible && e\.target === e\.currentTarget\) onClose\(\)/);
  assert.match(sheet, /<button onClick=\{onClose\} aria-label="닫기"/);
  assert.match(sheet, /addEventListener\("touchmove", touchMove, \{ passive: false \}\)/);
});
