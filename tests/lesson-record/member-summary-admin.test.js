/** 설계 문서 2단계 · AI 회원 요약 -- 앱 쪽은 읽기 · 점검만. AI 를 부르지 않고, 쓰기는 서버만. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
const repo = readFileSync(new URL("../../src/data/repositories/member-summary-repository.js", import.meta.url), "utf8");

test("요약 저장소는 읽기만 한다 -- 쓰기는 서버(Functions)뿐", () => {
  assert.doesNotMatch(repo, /setDoc|updateDoc|addDoc|deleteDoc|writeBatch/);
});

test("운영 스위치에 AI 회원 요약 카드와 점검 카드가 있다", () => {
  assert.match(app, /document="memberSummary" title="AI 회원 요약"/);
  assert.match(app, /<MemberSummaryAdmin organization=\{organization\} \/>/);
});

test("갱신 실패는 코드와 함께 보인다 (CLAUDE.md §4)", () => {
  assert.match(app, /label: `갱신 실패 \(코드 \$\{row\.statusCode \|\| "unknown"\}\)`/);
  assert.match(app, /다시 만들지 못했어요 \(코드 /);
});
