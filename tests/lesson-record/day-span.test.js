import test from "node:test";
import assert from "node:assert/strict";
import { daySpanLabel } from "../../functions/shared/day-span.mjs";

/* 2026-11-24 대표: "몇 일이 아니라 몇 달 · 일주일 · 이주일 이렇게". 브리핑 · 재등록 레이더가 같은 말로 센다. */
test("날 수를 사람이 세는 말로", () => {
  assert.equal(daySpanLabel(0), "오늘");
  assert.equal(daySpanLabel(3), "3일");
  assert.equal(daySpanLabel(7), "일주일");
  assert.equal(daySpanLabel(9), "약 일주일");
  assert.equal(daySpanLabel(14), "2주");
  assert.equal(daySpanLabel(19), "약 3주", "지난 수업 뒤 19일");
  assert.equal(daySpanLabel(30), "약 한 달");
  assert.equal(daySpanLabel(45), "약 한 달 반");
  assert.equal(daySpanLabel(60), "약 2달");
  assert.equal(daySpanLabel(135), "약 4달 반", "만료 135일 전");
  assert.equal(daySpanLabel(365), "약 1년");
  assert.equal(daySpanLabel(455), "약 1년 3달");
  assert.equal(daySpanLabel(-14), "2주", "음수는 절댓값");
  assert.equal(daySpanLabel("x"), "");
});
