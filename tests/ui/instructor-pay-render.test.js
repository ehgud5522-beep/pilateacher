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

test("급여 화면: 확정 급여가 맨 위, 그 아래 확정 대기 포함, 단가별 요약 · 보정 · 센터 지원 · 날짜별", async () => {
  const html = await markupOf("이달 예상 급여 · 확정 대기 · 보정");
  // 9월을 9월에 본다 -- "이번 달".
  assert.match(html, /이번 달 확정 급여/);
  /* 130,000 + 센터 지원 15,000 − 보정 30,000 = 115,000. 손으로 적은 값이 아니라
     summarizeInstructorPay 가 낸 픽스처의 합계다. */
  const confirmedAt = html.indexOf("data-pay-confirmed");
  const pendingAt = html.indexOf("data-pay-with-pending");
  const summaryAt = html.indexOf("data-pay-unit-summary");
  const listAt = html.indexOf("날짜별 내역");
  assert.ok(confirmedAt > 0 && confirmedAt < pendingAt && pendingAt < summaryAt && summaryAt < listAt, "순서");
  assert.match(html.slice(confirmedAt, pendingAt), /₩115,000/);
  assert.match(html.slice(pendingAt, summaryAt), /확정 대기 포함/);
  assert.match(html.slice(pendingAt, summaryAt), /₩140,000/);
  assert.match(html.slice(pendingAt, summaryAt), /확정 대기 1건 \(\+₩25,000\)/);

  const summary = html.slice(summaryAt, listAt);
  assert.match(summary, /₩30,000 × 2건 = <b[^>]*>₩60,000/);
  assert.match(summary, /센터 지원 \(서비스\)/);
  assert.match(summary, /₩15,000 × 1건 = <b[^>]*>₩15,000/);
  assert.match(summary, /보정 \(되돌린 수업\)/);
  assert.match(summary, /1건 = −₩30,000/);
  assert.match(summary, /합계<\/span><span[^>]*>₩115,000/);
  assert.match(summary, /잔여 횟수 조정은 수업이 아니라 급여에 들어가지 않습니다/);

  // 날짜별: 날짜 · 회원 · 구분 · 금액.
  const list = html.slice(listAt);
  assert.match(list, /9\.16/);
  assert.match(list, /김하나/);
  assert.match(list, /1:1 재등록\(이벤트\)/);
  assert.match(list, /₩30,000/);

  // 지난 달로.
  assert.match(html, /지난 달/);
  assert.doesNotMatch(html, /다음 달/, "이번 달에는 다음 달이 없다");
});

test("급여 화면 · 큰 글씨: 고정 높이 없이 접히고, 누르는 곳은 44px 이상", async () => {
  const html = await markupOf("이달 예상 급여 · 큰 글씨");
  assert.match(html, /--t-hero:64px/);
  assert.deepEqual(fixedHeights(html), []);
  const heights = tapHeights(html);
  assert.ok(heights.length > 5);
  assert.ok(heights.every((height) => height >= 44), JSON.stringify(heights));
  // 요약 줄 · 날짜 줄은 넘치면 접힌다.
  assert.match(html, /class="flex flex-wrap items-baseline gap-x-2 gap-y-0\.5" data-pay-unit-row="true"/);
  assert.match(html, /class="flex w-full flex-wrap items-center gap-x-2 text-left"/);
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
