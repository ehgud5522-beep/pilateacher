import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_GROUP, groupProducts, issuableProducts, issueUnitPrice, isArchivedProduct,
  priceLabel, productGroupOf, productLine, productTable, sessionsWarning, unusedProducts,
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

/* ── 표 ───────────────────────────────────────────────────────────────── */

test("열은 있는 횟수만, 오름차순으로 선다", () => {
  /* 10/20/30/50/100 을 고정하면 쓰지 않는 열이 폭을 먹고, 센터가 파는 15회가
     들어갈 자리가 없다. */
  const table = productTable([
    product({ id: "a", defaultSessions: 20 }),
    product({ id: "b", defaultSessions: 10 }),
    product({ id: "c", defaultSessions: 15 }),
  ]);
  assert.deepEqual(table[0].sessions, [10, 15, 20]);
});

test("행은 이름, 칸은 그 이름·그 횟수의 상품들", () => {
  const table = productTable([
    product({ id: "a", name: "1차 정상가", defaultSessions: 10 }),
    product({ id: "b", name: "1차 정상가", defaultSessions: 20 }),
    product({ id: "c", name: "이벤트", defaultSessions: 10 }),
  ]);
  const row = table[0].rows.find((item) => item.name === "1차 정상가");
  assert.deepEqual(row.cells.map((cell) => cell.sessions), [10, 20]);
  assert.deepEqual(row.cells[0].items.map((item) => item.product.id), ["a"]);
  assert.deepEqual(row.cells[1].items.map((item) => item.product.id), ["b"]);
  // 이벤트 행에는 20회 칸이 비어 있다.
  const event = table[0].rows.find((item) => item.name === "이벤트");
  assert.deepEqual(event.cells[1].items, []);
});

test("한 칸에 둘이 들어가도 숨기지 않는다", () => {
  /* 같은 이름·같은 횟수로 금액이 다른 상품을 만들 수 있다. 숨기면 대표가
     그 상태를 모른 채 발급한다. */
  const table = productTable([
    product({ id: "a", defaultPrice: 1000000 }),
    product({ id: "b", defaultPrice: 1200000 }),
  ]);
  assert.deepEqual(table[0].rows[0].cells[0].items.map((item) => item.product.id), ["a", "b"]);
});

test("한 행에서 카테고리가 갈리면 표가 그것을 들고 있다", () => {
  const mixed = productTable([
    product({ id: "a", defaultSessions: 10 }),
    product({ id: "b", defaultSessions: 20, payCategory: "pt_1_1_repurchase_event" }),
  ]);
  assert.equal(mixed[0].rows[0].mixed, true);
  const same = productTable([product({ id: "a" }), product({ id: "b", defaultSessions: 20 })]);
  assert.equal(same[0].rows[0].mixed, false);
});

test("발급 인원을 세지 않았으면 0 이 아니라 null 이다", () => {
  /* "아무도 안 쓴다" 와 "아직 세지 않았다" 를 같은 얼굴로 보여주면 대표가
     0 을 믿고 지운다. */
  const table = productTable([product()]);
  assert.equal(table[0].rows[0].cells[0].items[0].usage, null);

  const counted = productTable([product()], new Map([["p1", { total: 3, active: 2 }]]));
  assert.deepEqual(counted[0].rows[0].cells[0].items[0].usage, { total: 3, active: 2 });
});

test("숨긴 상품은 표에 서지 않는다", () => {
  const table = productTable([product({ id: "a" }), product({ id: "b", status: "archived" })]);
  assert.equal(table[0].rows[0].cells[0].items.length, 1);
});

/* ── 안 쓰는 상품 정리 ────────────────────────────────────────────────── */

test("발급 0명인 것만 목록에 올린다", () => {
  const usage = new Map([["used", { total: 2 }], ["unused", { total: 0 }]]);
  const list = unusedProducts({
    products: [product({ id: "used" }), product({ id: "unused" })], usage, passes: [],
  });
  assert.deepEqual(list.map((item) => item.product.id), ["unused"]);
  assert.equal(list[0].risky, false);
});

test("세지 않은 상품도 0명으로 본다 -- usage 가 없으면 비어 있는 것이다", () => {
  const list = unusedProducts({ products: [product({ id: "x" })], passes: [] });
  assert.deepEqual(list.map((item) => item.product.id), ["x"]);
});

test("이관 회원권 이름과 비슷하면 위험으로 표시한다", () => {
  /* 발급 0명으로 보이는 이유가 "이관분을 못 맞혔다" 일 수 있다. 지우면 그
     회원권들이 가리킬 상품이 목록에서 사라진다. */
  const list = unusedProducts({
    products: [product({ id: "x", name: "PT 50회" })],
    usage: new Map([["x", { total: 0 }]]),
    passes: [{ id: "csv_a_1", productId: "1:1 PT 50회" }],
  });
  assert.equal(list[0].risky, true);
  assert.match(list[0].reason, /이관 회원권 이름과 비슷합니다/);
});

test("앱에서 발급한 회원권 이름은 위험 판정에 쓰지 않는다", () => {
  const list = unusedProducts({
    products: [product({ id: "x", name: "PT 50회" })],
    usage: new Map([["x", { total: 0 }]]),
    passes: [{ id: "app-1", productId: "1:1 PT 50회" }],
  });
  assert.equal(list[0].risky, false, "csv_ 접두가 아니면 이관분이 아니다");
});

test("이미 숨긴 상품은 정리 목록에 다시 오르지 않는다", () => {
  const list = unusedProducts({
    products: [product({ id: "x", status: "archived" })],
    usage: new Map([["x", { total: 0 }]]), passes: [],
  });
  assert.deepEqual(list, []);
});
