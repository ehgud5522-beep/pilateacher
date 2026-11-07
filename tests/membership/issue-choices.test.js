import assert from "node:assert/strict";
import test from "node:test";
import { issueChoiceOf, issueChoices, searchIssuableProducts } from "../../src/features/membership/product-groups.js";

/* 회원권 발급 상품 고르기 (2026-11-07 대표: "리스트가 너무 많아서 뭘 눌러야 할지 모름").
   종류 → 구분 → 상품. 단계마다 몇 개뿐이어야 한다. */

const p = (id, name, payCategory, sessionType, defaultSessions, defaultPrice, extra = {}) => ({
  id, name, payCategory, sessionType, defaultSessions, defaultPrice, status: "active", ...extra,
});
const products = [
  p("a", "1:1 PT 1차 정상가", "pt_1_1_new", "pt_1_1", 20, 1900000),
  p("b", "1:1 PT 1차 정상가", "pt_1_1_new", "pt_1_1", 10, 1000000),
  p("c", "1:1 렛미인 24회(재등)", "pt_1_1_repurchase_event", "pt_1_1", 24, 1500000),
  p("d", "1:1 공동구매(재등)", "pt_1_1_repurchase_normal", "pt_1_1", 30, 2000000),
  p("e", "2:1 듀엣 정상가", "pt_2_1_new", "pt_2_1", 20, 2400000),
  p("f", "디오사A 10회", "diosa_a", "", 10, 500000),
  p("g", "지난 이벤트", "pt_1_1_new", "pt_1_1", 5, 300000, { status: "archived" }),
];

test("종류는 넷까지, 구분은 급여카테고리 순서대로, 상품은 회차 적은 순 — 숨긴 상품은 없다", () => {
  const choices = issueChoices(products);
  assert.deepEqual(choices.map((group) => group.label), ["1:1", "2:1", "디오사"]);
  const solo = choices[0];
  assert.deepEqual(solo.categories.map((entry) => entry.label), ["1:1 신규", "1:1 재등록(이벤트)", "1:1 재등록(정상)"]);
  assert.deepEqual(solo.categories[0].items.map((item) => item.id), ["b", "a"], "10회가 20회보다 먼저");
  assert.equal(solo.count, 4, "숨긴 상품(g)은 세지 않는다");
});

test("고른 상품이 어느 단계인가", () => {
  assert.deepEqual(issueChoiceOf(products[2]), { group: "solo", category: "pt_1_1_repurchase_event" });
  assert.deepEqual(issueChoiceOf(null), { group: "", category: "" });
});

test("검색: 띄어쓰기 · 대소문자 무시, 구분 이름으로도, 숨긴 것은 없음", () => {
  assert.deepEqual(searchIssuableProducts(products, "1차정상").map((item) => item.id), ["b", "a"]);
  assert.deepEqual(searchIssuableProducts(products, "렛미인").map((item) => item.id), ["c"]);
  assert.deepEqual(searchIssuableProducts(products, "재등록(정상)").map((item) => item.id), ["d"]);
  assert.deepEqual(searchIssuableProducts(products, "이벤트").map((item) => item.id), ["c"], "숨긴 '지난 이벤트' 는 없다");
  assert.deepEqual(searchIssuableProducts(products, "  "), []);
});
