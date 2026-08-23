import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const start = source.indexOf("function ScheduleBottomSheet(");
const end = source.indexOf("\nfunction ChoiceBottomSheet(", start);
const sheet = source.slice(start, end);

test("bottom sheet continues to consume live theme tokens in dark mode", () => {
  assert.match(source, /const themeMode = themePref === "dark"/);
  assert.match(source, /paintThemeVars\(themeMode\)/);
  assert.match(sheet, /backgroundColor: CARD/);
  assert.match(sheet, /border: `1px solid \$\{LINE\}`/);
  assert.match(sheet, /color: INK/);
  assert.match(sheet, /color: SUB/);
});
