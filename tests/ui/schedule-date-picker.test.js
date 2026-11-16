import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

test("the schedule date field uses the device date picker", async () => {
  const source = await appSource();
  assert.match(source, /<input type="date" aria-label="날짜" value=\{f\.date\}/);
});

test("the hand-rolled ±7 day list is gone", async () => {
  const source = await appSource();
  /* The list could only offer fifteen days, so a lesson further out than a
     week simply could not be entered. */
  assert.doesNotMatch(source, /picker\?\.type === "date"/);
  assert.doesNotMatch(source, /setPicker\(\{ type: "date" \}\)/);
  assert.doesNotMatch(source, /Array\.from\(\{ length: 15 \}, \(_, index\) => shift\(f\.date, index - 7\)\)/);
});

test("the other pickers are untouched", async () => {
  const source = await appSource();
  // Only the date sheet was replaced; hour, minute, duration and member stay.
  for (const type of ["hour", "minute", "duration", "member"]) {
    assert.match(source, new RegExp(`picker\\?\\.type === "${type}"`), `${type} sheet must remain`);
  }
});

test("the field still reads as the same control", async () => {
  const source = await appSource();
  /* 2026-11-17 개편: 날짜 · 시간 · 길이가 한 줄. 날짜 칸은 그 줄의 첫 칸이고, 기기 달력을 그대로 연다. */
  const start = source.indexOf("data-register-when");
  const field = source.slice(start, start + 1600);
  assert.match(field, /<CalendarDays size=\{15\}/);
  assert.match(field, /\{f\.date\?\.slice\(5\)\.replace\("-", "\."\)\} \(\{dow\(f\.date\)\}\)/);
  // The native input covers the cell, and the label gives it a frame to sit in.
  assert.match(field, /<label className="lm-chip relative flex min-h-12/);
  assert.match(field, /<input type="date" aria-label="날짜"/);
  assert.match(field, /className="absolute inset-0 h-full w-full opacity-0"/);
});

test("an empty date is never written back", async () => {
  const source = await appSource();
  /* Clearing a native date input fires change with "". Writing that through
     would leave the schedule with no date at all. */
  assert.match(source, /const date = event\.target\.value; if \(date\) setF\(\(current\) => \(\{ \.\.\.current, date \}\)\);/);
});
