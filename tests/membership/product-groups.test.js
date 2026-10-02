import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_GROUP, groupProducts, issuableProducts, issueUnitPrice, isArchivedProduct,
  priceLabel, productGroupOf, productLine, sessionsWarning,
} from "../../src/features/membership/product-groups.js";

const product = (overrides = {}) => ({
  id: "p1", name: "1차 정상가", sessionType: "pt_1_1", payCategory: "pt_1_1_new",
  defaultSessions: 10, defaultPrice: 1000000, status: "active", ...overrides,
});

/* ── 묶음 ─────────────────────────────────────────────────────────────── */

test("sessionType 이 먼저이고, 없으면 급여카테고리로 가른다", () => {
  assert.equal(productGroupOf(product()), PRODUCT_GROUP.SOLO);
  assert.equal(productGroupOf(product({ sessionType: "pt_2_1" })), PRODUCT_GROUP.DUET);
  // 옛 상품은 sessionType 이 없다.
  assert.equal(productGroupOf({ payCategory: "pt_2_1_repurchase" }), PRODUCT_GROUP.DUET);
  assert.equal(productGroupOf({ payCategory: "pt_1_1_repurchase_normal" }), PRODUCT_GROUP.SOLO);
  assert.equal(productGroupOf({ payCategory: "service" }), PRODUCT_GROUP.OTHER);
  assert.equal(productGroupOf({}), PRODUCT_GROUP.OTHER);
});

test("1:1 · 2:1 · 기타 순으로 서고, 빈 묶음은 나오지 않는다", () => {
  const groups = groupProducts([
    product({ id: "a", sessionType: "pt_2_1", payCategory: "pt_2_1_new" }),
    product({ id: "b" }),
  ]);
  assert.deepEqual(groups.map((group) => group.label), ["1:1", "2:1"]);
  assert.equal(groups.every((group) => group.total > 0), true);
});

test("이름으로 묶고, 그 안에서 횟수 오름차순이다", () => {
  /* 10회와 20회가 나란히 서야 견줄 수 있다. 멀리 떨어지면 둘을 비교하지 못하고
     비슷한 이름의 다른 상품을 고르게 된다. */
  const groups = groupProducts([
    product({ id: "c", name: "1차 정상가", defaultSessions: 30 }),
    product({ id: "a", name: "1차 정상가", defaultSessions: 10 }),
    product({ id: "b", name: "1차 정상가", defaultSessions: 20 }),
    product({ id: "d", name: "이벤트", defaultSessions: 10 }),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].names.map((entry) => entry.name), ["1차 정상가", "이벤트"]);
  assert.deepEqual(groups[0].names[0].items.map((item) => item.id), ["a", "b", "c"]);
  assert.equal(groups[0].total, 4);
});

test("같은 횟수가 둘이면 싼 것이 먼저다", () => {
  const groups = groupProducts([
    product({ id: "expensive", defaultPrice: 1200000 }),
    product({ id: "cheap", defaultPrice: 900000 }),
  ]);
  assert.deepEqual(groups[0].names[0].items.map((item) => item.id), ["cheap", "expensive"]);
});

test("이름이 빠진 상품은 한 묶음으로 모은다 -- 흩어 두면 못 본다", () => {
  const groups = groupProducts([product({ id: "a", name: "" }), product({ id: "b", name: "   " })]);
  assert.deepEqual(groups[0].names.map((entry) => entry.name), ["(이름 없음)"]);
  assert.equal(groups[0].names[0].items.length, 2);
});

/* ── 숨김 ─────────────────────────────────────────────────────────────── */

test("숨긴 상품은 묶음에 섞이지 않는다", () => {
  /* 섞으면 대표가 "이 상품이 왜 발급 화면에 없지" 를 묻게 된다. */
  const list = [product({ id: "a" }), product({ id: "b", status: "archived" })];
  assert.deepEqual(groupProducts(list)[0].names[0].items.map((item) => item.id), ["a"]);
  // 보려고 하면 볼 수 있다 -- 되돌릴 길이 있어야 한다.
  assert.equal(groupProducts(list, { includeArchived: true })[0].total, 2);
});

test("숨긴 상품으로는 새로 발급하지 않는다", () => {
  /* 지우지 않는 이유는 이미 발급된 회원권이 그 상품의 이름과 금액을 계속
     가리키기 때문이다. */
  const list = [product({ id: "a" }), product({ id: "b", status: "archived" })];
  assert.deepEqual(issuableProducts(list).map((item) => item.id), ["a"]);
  assert.equal(isArchivedProduct(list[1]), true);
  assert.equal(isArchivedProduct(list[0]), false);
});

/* ── 한 줄 ────────────────────────────────────────────────────────────── */

test("한 줄은 횟수 · 금액 · 급여카테고리다", () => {
  assert.equal(productLine(product()), "10회 · 100만원 · 1:1 신규");
  assert.equal(productLine(product({ defaultSessions: 20, defaultPrice: 1500000, payCategory: "pt_1_1_repurchase_normal" })),
    "20회 · 150만원 · 1:1 재등록(정상)");
});

test("만원으로 떨어지지 않으면 원 그대로 적는다", () => {
  assert.equal(priceLabel(1000000), "100만원");
  assert.equal(priceLabel(1234500), "1,234,500원");
  assert.equal(priceLabel(0), "0원");
  assert.equal(priceLabel(null), "0원");
});

/* ── 발급 경고 ────────────────────────────────────────────────────────── */

test("총 횟수가 상품보다 적으면 남은 횟수를 넣은 것으로 보고 말한다", () => {
  /* 율하 김진희 건. 20회 상품을 11회로 적어 회당 금액이 136,364원이 됐다.
     발급은 되돌릴 수 없으므로 누르기 전에 말해야 한다. */
  assert.equal(
    sessionsWarning({ product: product({ defaultSessions: 20 }), totalSessions: 11 }),
    "상품은 20회인데 11회로 입력했어요. 남은 횟수가 아니라 총 횟수를 넣어 주세요.",
  );
});

test("많이 적은 것은 다른 실수라 다른 문구다", () => {
  assert.match(
    sessionsWarning({ product: product({ defaultSessions: 20 }), totalSessions: 30 }),
    /맞는지 확인해 주세요/,
  );
});

test("같으면 경고하지 않고, 읽을 수 없으면 지어내지 않는다", () => {
  assert.equal(sessionsWarning({ product: product({ defaultSessions: 20 }), totalSessions: 20 }), "");
  assert.equal(sessionsWarning({ product: product(), totalSessions: "" }), "");
  assert.equal(sessionsWarning({ product: null, totalSessions: 11 }), "");
  assert.equal(sessionsWarning({}), "");
});

test("회당 금액은 정규 유료 횟수로만 나눈다", () => {
  // 이 숫자가 눈에 보이면 총 횟수를 잘못 넣은 것이 드러난다.
  assert.equal(issueUnitPrice({ contractPrice: 1500000, totalSessions: 11 }), 136364);
  assert.equal(issueUnitPrice({ contractPrice: 1500000, totalSessions: 20 }), 75000);
  assert.equal(issueUnitPrice({ contractPrice: 0, totalSessions: 20 }), 0);
  assert.equal(issueUnitPrice({ contractPrice: 1000000, totalSessions: 0 }), 0);
});
