import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const start = source.indexOf("const saveAttendanceOnce =");
const end = source.indexOf("\n  const setGroupDone =", start);
const attendance = source.slice(start, end);

test("attendance writes are lesson-scoped single-flight operations", () => {
  assert.match(attendance, /attendanceMutationsInFlight\.current\.has\(lessonId\)/);
  assert.match(attendance, /attendanceMutationsInFlight\.current\.add\(lessonId\)/);
  assert.match(attendance, /finally\(\(\) => attendanceMutationsInFlight\.current\.delete\(lessonId\)\)/);
});

test("rollback persists booked attendance without touching lesson notes", () => {
  assert.match(attendance, /booked: "booked", done: "attended", noshow: "noshow", cancel: "cancelled"/);
  assert.match(attendance, /transitionAttendance/);
  assert.doesNotMatch(attendance, /\.notes|filter\([^\n]*note|delete[^\n]*note/i);
});
