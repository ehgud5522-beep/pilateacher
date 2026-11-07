/**
 * 강사 급여 카드와 급여 화면을 **실제로 그린다** (2026-11-04) — 큰 글씨 포함.
 *
 * 렌더 마크업으로는 픽셀을 잴 수 없다. 그래서 "큰 글씨에서 깨지는 원인" 을
 * 구조로 막는다: 글자가 든 상자에 고정 높이가 없고(minHeight 만), 줄은
 * 넘치면 접히며(flex-wrap), 누르는 곳은 44px 이상이다. 단계 변수를 두 배로
 * 둔 화면(폰 글씨 최대)도 같은 모양으로 그려지는지 본다.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
let vite = null;
let cases = null;
const markupOf = async (name) => {
  if (!cases) {
    vite = await createServer({
      root: projectRoot, configFile: false, plugins: [react()], appType: "custom",
      optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
      ssr: { noExternal: ["@capgo/camera-preview"] }, logLevel: "silent",
    });
    const loaded = await vite.ssrLoadModule("/src/App.jsx");
    cases = new Map(loaded.createAppScreenSmokeCases().map((item) => [item.name, item.element]));
  }
  const element = cases.get(name);
  assert.ok(element, `${name} 픽스처가 없습니다`);
  return renderToStaticMarkup(element);
};
test.after(async () => { if (vite) await vite.close(); });

/** style 속성에 고정 height 가 있는가 (min-height 는 괜찮다). */
const fixedHeights = (html) => [...html.matchAll(/style="([^"]*)"/g)]
  .map((m) => m[1]).filter((style) => /(^|;)height:/.test(style) && !/(^|;)height:4[4-9]px|(^|;)height:\d{3,}px/.test(style));
/** 누르는 곳의 높이 (min-height 또는 height). */
const tapHeights = (html) => [...html.matchAll(/<button[^>]*style="([^"]*)"/g)]
  .map((m) => Number((m[1].match(/(?:min-height|(?:^|;)height):(\d+)px/) || [])[1] || 0));

test("카드: 문구 · 확정 대기 · 자세히 보기, 카드 전체가 버튼", async () => {
  const html = await markupOf("예상 급여 카드 · 큰 글씨");
  assert.match(html, /^<div style="--t-caption:26px/, "폰 글씨 최대를 흉내 낸 화면이다");
  assert.match(html, /이번 달 급여/);
  assert.match(html, /₩130,000/);
  assert.match(html, /\(확정된 수업 기준\)/);
  assert.match(html, /확정 대기 1건 \(\+₩25,000\)/);
  assert.match(html, /이번 달 급여 자세히 보기/);
  // 버튼은 하나 -- 안에 버튼을 두지 않는다. "자세히 보기" 도 그 버튼 안이다.
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.match(html, /<button[^>]*data-pay-card[\s\S]*data-pay-more[\s\S]*<\/button>/);
  // 금액은 본문보다 크다.
  assert.match(html, /data-pay-amount="true" style="font-size:var\(--t-display\)/);
});

test("카드 · 큰 글씨: 고정 높이 없이 접히고, 누르는 곳은 44px 이상", async () => {
  const html = await markupOf("예상 급여 카드 · 큰 글씨");
  assert.deepEqual(fixedHeights(html), []);
  assert.match(html, /class="flex flex-wrap items-center/);
  assert.ok(tapHeights(html).every((height) => height >= 44), JSON.stringify(tapHeights(html)));
});

test("내 급여 (2026-11-08): 예상 · 확정 · 확정 대기가 맨 위, 계산 내역 · 정정 내역 · 주별 상세", async () => {
  const html = await markupOf("이달 예상 급여 · 확정 대기 · 보정");
  /* 130,000 + 서비스 수업 15,000 − 정정 30,000 = 115,000 (summarizeInstructorPay 가 낸 픽스처 합계), 대기 25,000. */
  const expectedAt = html.indexOf("data-pay-expected");
  const confirmedAt = html.indexOf("data-pay-confirmed");
  const pendingAt = html.indexOf("data-pay-pending");
  const summaryAt = html.indexOf("data-pay-unit-summary");
  const correctionsAt = html.indexOf("data-pay-corrections");
  const listAt = html.indexOf("수업별 상세 내역");
  assert.ok(expectedAt > 0 && expectedAt < confirmedAt && confirmedAt < pendingAt && pendingAt < summaryAt
    && summaryAt < correctionsAt && correctionsAt < listAt, "순서");
  assert.match(html, /이번 달 예상 수업료/);
  assert.match(html.slice(expectedAt, confirmedAt), /₩140,000/);
  assert.match(html.slice(confirmedAt, pendingAt), /₩115,000/);
  assert.match(html.slice(pendingAt - 200, summaryAt), /확정 대기 · 1건/);
  assert.match(html.slice(pendingAt, summaryAt), /₩25,000/);

  const summary = html.slice(summaryAt, correctionsAt);
  assert.match(summary, /1:1 재등록\(이벤트\) · 2건/);
  assert.match(summary, /건당 ₩30,000/);
  assert.match(summary, /\+₩60,000/);
  assert.match(summary, /서비스 수업 · 1건/);
  assert.doesNotMatch(summary, /센터 지원/, "\"센터 지원\" 은 타지점 지원과 헷갈린다 (2026-11-04 대표)");
  assert.match(summary, /수업 정정 · 1건/);
  assert.match(summary, /−₩30,000/);
  assert.match(summary, /확정 수업료<\/span><span[^>]*>₩115,000/);
  assert.doesNotMatch(summary, /보정/, "\"보정\" 대신 \"수업 정정\"");

  /* 정정 상세: 회원 · 원래 수업 날짜 · 원래 금액 · 정정 금액 · 사유 · 처리 날짜 */
  const corrections = html.slice(correctionsAt, listAt);
  assert.match(corrections, /김하나/);
  assert.match(corrections, /수업 9월 16일/);
  assert.match(corrections, /원래 \+₩30,000/);
  assert.match(corrections, /사유: /);
  assert.match(corrections, /처리 9월 18일/);

  const list = html.slice(listAt);
  assert.match(list, /9월 14일 ~ 9월 20일/);
  assert.match(list, /김하나/);
  assert.match(list, /data-pay-row="pending"|data-pay-row="confirmed"/);
  assert.match(list, />전체</);
  assert.match(list, />정정</);

  // 달 이동은 위 한 곳. 이번 달에는 다음 달로 가지 않는다.
  assert.match(html, /aria-label="이전 달"/);
  assert.match(html, /aria-label="다음 달" disabled=""/);
  assert.doesNotMatch(html, /지난 달<\/button>/, "달 버튼 중복 없음");
});

test("급여 화면 · 큰 글씨: 고정 높이 없이 접히고, 누르는 곳은 44px 이상", async () => {
  const html = await markupOf("이달 예상 급여 · 큰 글씨");
  assert.match(html, /--t-hero:64px/);
  assert.deepEqual(fixedHeights(html), []);
  const heights = tapHeights(html);
  assert.ok(heights.length > 5);
  assert.ok(heights.every((height) => height >= 44), JSON.stringify(heights));
  // 금액은 넘치면 줄바꿈 (overflow-wrap), 글자는 칸 밖으로 나가지 않는다.
  assert.match(html, /data-pay-expected="true" style="[^"]*overflow-wrap:anywhere/);
});

test("급여는 본인 것만 — 카드는 소속 강사에게만, 읽기는 내 uid 로", async () => {
  /* 대표 · 총괄 · FC 에게는 이 카드가 없다 (그쪽은 급여 집계 화면). 강사는 자기
     uid 로만 읽고, 리포지토리가 남의 항목을 한 번 더 거른다
     (tests/payroll/instructor-pay-view.test.js). */
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /const canSeeOwnPay = organizationContext\.ready\s+&& !organizationContext\.isLegacy\s+&& organizationContext\.role === ROLES\.INSTRUCTOR;/);
  assert.match(source, /loadInstructorMonthlyPay\(organizationContext\.organizationId, \{\s+instructorId: account\.id, month: payMonth,/);
  assert.match(source, /payCard=\{canSeeOwnPay \? <InstructorPayCard/);
  assert.match(source, /\{payOpen && canSeeOwnPay \? \(/);
});
