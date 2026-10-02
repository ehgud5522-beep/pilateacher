import assert from "node:assert/strict";
import test from "node:test";
import {
  USAGE_MATCH, isMigratedPass, looksLikeProduct, mixedCategories, productMemberRows, productUsage,
} from "../../src/features/membership/product-usage.js";

const NOW = new Date(2026, 9, 1);

const product = (overrides = {}) => ({
  id: "p-10", name: "1차 정상가", sessionType: "pt_1_1", payCategory: "pt_1_1_new",
  defaultSessions: 10, defaultPrice: 1000000, status: "active", ...overrides,
});
const pass = (overrides = {}) => ({
  id: "pass-1", productId: "p-10", clientId: "client-a", locationId: "bansong",
  instructorId: "u-1", totalSessions: 10, serviceSessions: 0, remainingCount: 5,
  status: "active", expiresAt: new Date(2027, 0, 1), ...overrides,
});

/* ── 이관분 판별 ──────────────────────────────────────────────────────── */

test("id 접두로 이관분을 가른다", () => {
  assert.equal(isMigratedPass({ id: "csv_csv_01011112222_1" }), true);
  assert.equal(isMigratedPass({ passId: "csv_x" }), true, "투영은 passId 를 쓴다");
  assert.equal(isMigratedPass({ id: "abc-123" }), false);
  assert.equal(isMigratedPass({}), false);
});

/* ── 맞혀 보기 ────────────────────────────────────────────────────────── */

test("횟수와 이름이 둘 다 맞아야 같은 상품으로 본다", () => {
  /* 횟수만 같으면 10회짜리 상품 전부에 붙고, 이름만 같으면 같은 이름의
     10회와 20회가 섞인다. */
  const p = product({ name: "정상가", defaultSessions: 10 });
  assert.equal(looksLikeProduct({ productId: "1:1 PT 정상가 10회", totalSessions: 10 }, p), true);
  assert.equal(looksLikeProduct({ productId: "1:1 PT 정상가 10회", totalSessions: 20 }, p), false, "횟수가 다르다");
  assert.equal(looksLikeProduct({ productId: "1:1 PT 이벤트 10회", totalSessions: 10 }, p), false, "이름이 없다");
});

test("띄어쓰기와 대소문자는 지우고 본다 -- 엑셀은 손으로 적은 글이다", () => {
  const p = product({ name: "1:1 PT", defaultSessions: 50 });
  assert.equal(looksLikeProduct({ productId: "1:1PT50회", totalSessions: 50 }, p), true);
  assert.equal(looksLikeProduct({ productId: "1:1  pt  50회", totalSessions: 50 }, p), true);
});

test("이름이 없는 상품에는 아무것도 붙지 않는다", () => {
  assert.equal(looksLikeProduct(pass(), product({ name: "" })), false);
  assert.equal(looksLikeProduct(pass(), product({ name: "   " })), false);
});

/* ── 집계 ─────────────────────────────────────────────────────────────── */

test("productId 가 상품 id 면 확실한 것으로 센다", () => {
  const usage = productUsage({ products: [product()], passes: [pass()], now: NOW });
  assert.deepEqual(usage.get("p-10"), { exact: 1, guessed: 0, active: 1, ended: 0, total: 1 });
});

test("이관분은 맞혀서 세고, 추정으로 표시한다", () => {
  const usage = productUsage({
    products: [product({ name: "PT 50회", defaultSessions: 50 })],
    passes: [pass({ id: "csv_a_1", productId: "1:1 PT 50회", totalSessions: 50 })],
    now: NOW,
  });
  assert.deepEqual(usage.get("p-10"), { exact: 0, guessed: 1, active: 1, ended: 0, total: 1 });
});

test("이관분인데 productId 가 상품 id 면 맞혀 보지 않는다", () => {
  /* 정확히 가리키는 것이 먼저다. 맞혀 볼 이유가 없다. */
  const usage = productUsage({
    products: [product()], passes: [pass({ id: "csv_a_1", productId: "p-10" })], now: NOW,
  });
  assert.equal(usage.get("p-10").exact, 1);
  assert.equal(usage.get("p-10").guessed, 0);
});

test("후보가 둘이면 어느 쪽에도 붙이지 않는다", () => {
  /* 아무 쪽에나 붙이면 그 상품의 발급 인원이 거짓이 되고, 대표는 그 숫자를
     보고 지울지 정한다. */
  const usage = productUsage({
    products: [
      product({ id: "p-a", name: "PT", defaultSessions: 50 }),
      product({ id: "p-b", name: "PT", defaultSessions: 50, defaultPrice: 1200000 }),
    ],
    passes: [pass({ id: "csv_a_1", productId: "1:1 PT 50회", totalSessions: 50 })],
    now: NOW,
  });
  assert.equal(usage.get("p-a").total, 0);
  assert.equal(usage.get("p-b").total, 0);
});

test("끝난 회원권도 센다 -- 지울지 정할 때 둘 다 필요하다", () => {
  const usage = productUsage({
    products: [product()],
    passes: [
      pass({ id: "a" }),
      pass({ id: "b", remainingCount: 0 }),
      pass({ id: "c", expiresAt: new Date(2026, 7, 1) }),
    ],
    now: NOW,
  });
  assert.deepEqual(usage.get("p-10"), { exact: 3, guessed: 0, active: 1, ended: 2, total: 3 });
});

test("아무도 안 쓰는 상품은 0 으로 선다 -- 목록에서 빠지지 않는다", () => {
  const usage = productUsage({ products: [product({ id: "unused" })], passes: [], now: NOW });
  assert.deepEqual(usage.get("unused"), { exact: 0, guessed: 0, active: 0, ended: 0, total: 0 });
});

/* ── 회원 목록 ────────────────────────────────────────────────────────── */

const NAMES = { "client-a": "김하나", "client-b": "박서연" };
const rowsFor = (passes, products = [product()]) => productMemberRows({
  product: products[0], products, passes, now: NOW,
  clientName: (id) => NAMES[id] || "",
  locationName: (id) => ({ bansong: "반송점" }[id] || ""),
  instructorName: (id) => ({ "u-1": "정예진" }[id] || ""),
});

test("회원 줄에 이름·지점·담당강사·잔여·만료일이 담긴다", () => {
  const { active } = rowsFor([pass()]);
  assert.equal(active.length, 1);
  assert.equal(active[0].clientName, "김하나");
  assert.equal(active[0].locationName, "반송점");
  assert.equal(active[0].instructorName, "정예진");
  assert.equal(active[0].remaining, 5);
  assert.equal(active[0].issued, 10);
  assert.equal(active[0].guessed, false);
});

test("사용 중과 종료를 나눠 돌려준다", () => {
  const { active, ended } = rowsFor([pass({ id: "a" }), pass({ id: "b", remainingCount: 0 })]);
  assert.deepEqual(active.map((row) => row.passId), ["a"]);
  assert.deepEqual(ended.map((row) => row.passId), ["b"]);
});

test("추정으로 붙은 줄은 그렇다고 표시한다", () => {
  const { active } = rowsFor(
    [pass({ id: "csv_a_1", productId: "1:1 PT 50회", totalSessions: 50 })],
    [product({ name: "PT 50회", defaultSessions: 50 })],
  );
  assert.equal(active.length, 1);
  assert.equal(active[0].guessed, true);
});

test("다른 상품에도 들어맞는 이관분은 이 상품의 회원으로 세지 않는다", () => {
  const { active, ended } = productMemberRows({
    product: product({ id: "p-a", name: "PT", defaultSessions: 50 }),
    products: [
      product({ id: "p-a", name: "PT", defaultSessions: 50 }),
      product({ id: "p-b", name: "PT", defaultSessions: 50 }),
    ],
    passes: [pass({ id: "csv_a_1", productId: "1:1 PT 50회", totalSessions: 50 })],
    now: NOW,
  });
  assert.deepEqual([...active, ...ended], []);
});

test("이름이 없으면 이름 자리를 비우고 터지지 않는다", () => {
  const { active } = productMemberRows({
    product: product(), passes: [pass({ clientId: "모르는-회원" })], now: NOW,
  });
  assert.equal(active[0].clientName, "");
  assert.equal(active[0].clientId, "모르는-회원");
});

/* ── 카테고리 섞임 ────────────────────────────────────────────────────── */

test("한 행에서 급여카테고리가 갈리면 알린다", () => {
  /* 같은 이름인데 10회는 신규, 20회는 재등록이면 급여가 회차마다 달라진다. */
  assert.equal(mixedCategories([product(), product({ payCategory: "pt_1_1_repurchase_event" })]), true);
  assert.equal(mixedCategories([product(), product({ defaultSessions: 20 })]), false);
  assert.equal(mixedCategories([product()]), false);
  assert.equal(mixedCategories([]), false);
});
