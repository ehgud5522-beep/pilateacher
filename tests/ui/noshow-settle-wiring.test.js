/**
 * 노쇼 확정 배선 (2026-11-06 대표).
 *
 * 화면은 렌더 테스트(screen-render-smoke)가 보고, 여기는 화면이 아닌 세 고리를 본다:
 *   - 확정으로 들어오는 모든 길이 한 곳에서 "안 고른 노쇼" 를 막는가
 *   - 소속 모드의 노쇼 선택이 차감하지 않고 선택 · 누가 · 언제만 남기는가
 *   - 오늘 카드가 확정 전에 "처리 완료" 로 내려가지 않는가
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const between = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

test("확정은 한 곳에서 안 고른 노쇼를 막고, 원본 코드와 함께 진단을 남긴다", () => {
  const settle = between("const settleLesson = async (lessonId) => {", "settlingRef.current.add(lessonId);");
  assert.match(settle, /settleBlockReason\(lesson\)/);
  assert.match(settle, /deviceLog\("lesson_settle_blocked", \{[\s\S]*errorCode: "noshow_choice_required"/);
  assert.match(settle, /\(코드 noshow_choice_required\)/);
});

test("소속 모드의 노쇼 선택은 차감하지 않고 선택 · 누가 · 언제만 남긴다", () => {
  const handler = between("const setNoshowFee = (id, charge, memberId) => {", "if (charge && !deductFrom)");
  assert.match(handler, /noshowFee: charge, noshowFeeBy: account\?\.id \|\| "", noshowFeeAt: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(handler, /deductOne/, "소속 모드는 기기 잔여를 건드리지 않는다");
  assert.match(handler, /\[수업 확정\]을 눌러야 회원권에 반영돼요/);
});

test("오늘 카드는 소속 모드에서 확정돼야 끝난다", () => {
  const isSettled = between("const isSettled = (r) => {", "const canPark");
  assert.match(isSettled, /if \(organizationMode\) return isSettledLesson\(r\.s\) \|\| !!r\.s\?\.settledElsewhereAt;/);
  // 개인 모드의 판정(노쇼는 차감 여부를 고르면 끝)은 그대로다.
  assert.match(isSettled, /if \(r\.status === "noshow"\) return r\.fee != null;/);
});

test("확정 버튼은 이유가 있으면 잠긴다", () => {
  const block = between("function SchedSettleBlock(", "확정하면 회원권이 차감되고");
  assert.match(block, /const blockReason = settleBlockReason\(s\);/);
  // 듀엣 출석 미표시(#137 blockedReason)와 함께 건다 -- 둘 중 하나라도 있으면 잠긴다.
  assert.match(block, /disabled=\{busy \|\| notStarted \|\| Boolean\(blockReason\) \|\| Boolean\(blockedReason\)\}/);
});
