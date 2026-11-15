/**
 * 2026-11-15 강사 제보 두 건.
 *  - "오늘 미처리 없음" 이면 큰 칸을 걷는다 (지난 · 숨긴 항목만 있으면 얇은 한 줄)
 *  - 확정된 수업은 시간표에서 회색 + 체크로 구분한다
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const strip = source.slice(source.indexOf("{/* ─── 하단 고정 업무 요약 ─── */}"), source.indexOf("{editing && <ScheduleForm"));
const grid = source.slice(source.indexOf("function WeekGrid("), source.indexOf("const LESSON_RECORD_VIEW_FIELDS"));

test("오늘 미처리가 없으면 큰 요약 칸이 없다", () => {
  assert.match(strip, /\{organizedQueue\.todayCount > 0 \? \(\s*<button data-queue-summary /, "큰 칸은 오늘 미처리가 있을 때만");
  assert.match(strip, /className="flex h-14 w-full/);
  assert.doesNotMatch(strip, /확인할 수업이 없습니다/, "빈 상태 문구 칸이 사라졌다");
  assert.doesNotMatch(strip, /disabled=\{!organizedQueue\.total/, "누를 수 없는 빈 칸을 세워 두지 않는다");
});

test("지난 · 숨긴 항목만 있으면 얇은 한 줄, 그것도 없으면 아무것도 없다", () => {
  assert.match(strip, /\) : \(organizedQueue\.total \|\| organizedQueue\.dismissedCount\) \? \(\s*<button data-queue-summary data-queue-summary-compact/);
  assert.match(strip, /className="flex h-9 w-full/);
  assert.match(strip, /\) : null\}/);
  assert.match(strip, /\(organizedQueue\.todayCount > 0 \|\| organizedQueue\.total > 0 \|\| organizedQueue\.dismissedCount > 0 \|\| \(memberCancelOn && memberCancelCount > 0\) \|\| \(inbox && \(inboxLabel \|\| inbox\.error\)\)\) && <div className="shrink-0"/, "띠 전체도 보여 줄 것이 있을 때만");
});

test("확정된 수업은 시간표에서 회색 카드 · 초록 체크 · 읽어 주는 이름에 '확정됨'", () => {
  assert.match(grid, /settled: !pv && isLockedBySettlement\(s\)/, "이 기기 확정과 다른 기기 확정을 함께 본다");
  assert.match(grid, /b\.settled \? "var\(--canvas\)"/);
  assert.match(grid, /b\.settled \? "var\(--faint\)"/);
  assert.match(grid, /b\.settled \? "확정됨" : ""/);
  assert.match(grid, /data-settled=\{b\.settled \? "" : undefined\}/);
  assert.match(grid, /b\.settled\s*\? <Check /);
  assert.match(grid, /b\.done && !b\.settled \? 0\.74 : 1/, "회색 카드를 또 흐리게 하지 않는다 -- 글자는 읽혀야 한다");
});
