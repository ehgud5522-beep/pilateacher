/** 설계 문서 5단계 · 상담 소재 초안 -- 누를 때만, 스위치 · 센터 회원만, 초안 표시, 결과는 상담 메모로 옮겨 강사가 고친다. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");

test("스위치 consultPoints · 센터 회원일 때만 버튼, 자동 호출 없음", () => {
  assert.match(app, /scheduleSyncEnabledFor\(scheduleSyncConfig\?\.consultPoints, account\?\.id\)/);
  assert.match(app, /\{consultClientId \? <button type="button" data-consult-points-open onClick=\{runConsultPoints\}/);
  const calls = app.match(/fbConsultTalkingPoints\(/g) || [];
  assert.equal(calls.length, 1, "부르는 곳은 버튼 하나뿐");
});

test("초안이라고 말하고, 상담 메모로 옮겨 고친다", () => {
  assert.match(app, /title="상담 때 꺼낼 이야기 · 초안"/);
  assert.match(app, /상담 메모로 옮겨 고치기/);
  assert.match(app, /"\[상담 소재 초안\]"/);
});

test("실패는 이유별 문구, 모르는 것은 코드와 함께", () => {
  assert.match(app, /consent_missing: "이 회원의 수업기록 서버 보관 · AI 처리 동의가 없어요/);
  assert.match(app, /만들지 못했어요\. 잠시 뒤 다시 눌러 주세요 \(코드 \$\{reason\}\)/);
});
