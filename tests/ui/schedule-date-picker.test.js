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
  const start = source.indexOf("<p className=\"mb-1.5 text-xs font-bold\" style={{ color: SUB }}>날짜</p>");
  const field = source.slice(start, start + 1200);
  // Same icon, same date-and-weekday text, same chevron: only the sheet behind
  // it changed.
  assert.match(field, /<CalendarDays size=\{15\}/);
  assert.match(field, /\{ymd\(f\.date\)\} · \{dow\(f\.date\)\}요일/);
  assert.match(field, /<ChevronDown size=\{14\}/);
  // The native input covers the row, and the label gives it a frame to sit in.
  assert.match(field, /<label className="relative flex h-11 w-full/);
  assert.match(field, /className="absolute h-11 w-full opacity-0"/);
});

test("an empty date is never written back", async () => {
  const source = await appSource();
  /* Clearing a native date input fires change with "". Writing that through
     would leave the schedule with no date at all. */
  assert.match(source, /const date = event\.target\.value; if \(date\) setF\(\(current\) => \(\{ \.\.\.current, date \}\)\);/);
});
