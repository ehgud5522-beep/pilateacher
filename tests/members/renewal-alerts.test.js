/** 설계 문서 4단계 · 재등록 알림. 앱은 서버와 같은 계산(shared/renewal-forecast.mjs)을 쓰고, 화면에 AI 라는 말이 없다. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
const shared = readFileSync(new URL("../../functions/shared/renewal-forecast.mjs", import.meta.url), "utf8");
const repo = readFileSync(new URL("../../src/data/repositories/renewal-repository.js", import.meta.url), "utf8");

test("앱과 서버가 같은 계산 모듈을 쓴다", () => {
  assert.match(app, /from "\.\.\/functions\/shared\/renewal-forecast\.mjs"/);
  const server = readFileSync(new URL("../../functions/src/renewal-triggers.js", import.meta.url), "utf8");
  assert.match(server, /import\("\.\.\/shared\/renewal-forecast\.mjs"\)/);
});

test("스위치 renewalAlerts 로만 켠다 -- 꺼지면 한 줄 · 묶음 · 표 모두 없음", () => {
  assert.match(app, /scheduleSyncEnabledFor\(scheduleSyncConfig\?\.renewalAlerts, account\?\.id\)/);
  assert.match(app, /const renewalClientId = briefingContext\.renewalOn && activeMember/);
  assert.match(app, /\{renewalOn && renewal\.entries \? \(\s*<section style=\{sectionStyle\} data-cannot-use-up>/);
});

test("화면 문구에 AI 를 쓰지 않는다 (규칙 계산)", () => {
  const strings = [...shared.matchAll(/`[^`]*`|"[^"]*"/g)].map((match) => match[0]).filter((value) => /[가-힣]/.test(value));
  assert.ok(strings.length > 3);
  for (const value of strings) assert.doesNotMatch(value, /AI/, value);
  const block = app.slice(app.indexOf("data-cannot-use-up"), app.indexOf("data-renewal-rates") + 2000);
  assert.doesNotMatch(block, /AI/);
});

test("후보 줄은 읽기만 한다 -- 쓰기는 서버뿐, 실패는 코드와 함께", () => {
  assert.doesNotMatch(repo, /setDoc|updateDoc|addDoc|deleteDoc|writeBatch/);
  assert.match(app, /재등록 알림 자료를 읽지 못했어요 \(코드 \{renewal\.error\}\)/);
  assert.match(app, /채우지 못했어요 \(코드 /);
});
