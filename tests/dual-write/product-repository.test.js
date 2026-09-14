import assert from "node:assert/strict";
import test from "node:test";
import {
  createFirestoreProductStore, createProduct, listProducts, setProductStatus,
} from "../../src/data/repositories/product-repository.js";

const ORG = "center-a";

function fakeStore(documents = []) {
  const calls = { list: [], create: [], update: [] };
  return {
    calls,
    list: async (path) => { calls.list.push(path); return documents; },
    create: async (path, data) => { calls.create.push({ path, data }); },
    update: async (path, data) => { calls.update.push({ path, data }); },
    serverTimestamp: async () => "SERVER_TIME",
  };
}

const product = (overrides = {}) => ({
  id: "product-1",
  organizationId: ORG,
  name: "1:1 20회",
  sessionType: "pt_1_1",
  payCategory: "pt_1_1_new",
  defaultSessions: 20,
  defaultPrice: 1200000,
  status: "active",
  createdBy: "owner-a",
  ...overrides,
});

const input = (overrides = {}) => ({
  name: "1:1 20회 이벤트",
  sessionType: "pt_1_1",
  payCategory: "pt_1_1_new",
  defaultSessions: 20,
  defaultPrice: 1200000,
  createdBy: "owner-a",
  ...overrides,
});

test("listProducts reads the organization's own products collection", async () => {
  const store = fakeStore([]);
  await listProducts(ORG, { store });
  assert.deepEqual(store.calls.list, ["organizations/center-a/products"]);
});

test("archived products are hidden unless asked for", async () => {
  const documents = [product({ id: "a", status: "archived" }), product({ id: "b", status: "active" })];
  assert.deepEqual(
    (await listProducts(ORG, { store: fakeStore(documents) })).map((item) => item.id),
    ["b"],
  );
  assert.deepEqual(
    (await listProducts(ORG, { store: fakeStore(documents), includeArchived: true })).map((item) => item.id),
    ["b", "a"],
  );
});

test("active products come first and each group is ordered by name", async () => {
  const documents = [
    product({ id: "z-active", name: "하 이벤트", status: "active" }),
    product({ id: "old", name: "가 종료건", status: "archived" }),
    product({ id: "a-active", name: "가 이벤트", status: "active" }),
  ];
  assert.deepEqual(
    (await listProducts(ORG, { store: fakeStore(documents), includeArchived: true })).map((item) => item.id),
    ["a-active", "z-active", "old"],
  );
});

test("createProduct writes the server timestamp, never a client clock", async () => {
  const store = fakeStore();
  await createProduct(ORG, input(), { store, newId: () => "product-new" });
  assert.equal(store.calls.create.length, 1);
  const { path, data } = store.calls.create[0];
  assert.equal(path, "organizations/center-a/products/product-new");
  assert.equal(data.createdAt, "SERVER_TIME");
  assert.equal(data.status, "active");
});

test("createProduct writes exactly the nine fields the rules allow", async () => {
  const store = fakeStore();
  await createProduct(ORG, input(), { store });
  assert.deepEqual(Object.keys(store.calls.create[0].data).sort(), [
    "createdAt", "createdBy", "defaultPrice", "defaultSessions",
    "name", "organizationId", "payCategory", "sessionType", "status",
  ]);
});

test("a pay category from the other session shape is refused before the write", async () => {
  const store = fakeStore();
  await assert.rejects(
    () => createProduct(ORG, input({ sessionType: "pt_2_1", payCategory: "pt_1_1_new" }), { store }),
    /Invalid payCategory for sessionType/,
  );
  await assert.rejects(
    () => createProduct(ORG, input({ sessionType: "pt_1_1", payCategory: "pt_2_1_new" }), { store }),
    /Invalid payCategory for sessionType/,
  );
  await assert.rejects(
    () => createProduct(ORG, input({ sessionType: "pt_2_1", payCategory: "letmein" }), { store }),
    /Invalid payCategory for sessionType/,
  );
  assert.equal(store.calls.create.length, 0, "nothing may reach Firestore");
});

test("service and etc are accepted on either session shape", async () => {
  for (const sessionType of ["pt_1_1", "pt_2_1"]) {
    for (const payCategory of ["service", "etc"]) {
      const store = fakeStore();
      await createProduct(ORG, input({ sessionType, payCategory }), { store });
      assert.equal(store.calls.create.length, 1, `${sessionType}+${payCategory} should be written`);
    }
  }
});

test("createProduct refuses a body the rules would reject anyway", async () => {
  const cases = [
    [{ name: "" }, /Missing name/],
    [{ sessionType: "pt_3_1" }, /Invalid sessionType/],
    [{ payCategory: "pt_1_1_New" }, /Invalid payCategory/],
    [{ defaultSessions: 0 }, /Invalid defaultSessions/],
    [{ defaultSessions: "twenty" }, /Invalid defaultSessions/],
    [{ defaultSessions: 1.5 }, /Invalid defaultSessions/],
    [{ defaultPrice: -1 }, /Invalid defaultPrice/],
    [{ createdBy: "" }, /Missing createdBy/],
  ];
  for (const [overrides, expected] of cases) {
    const store = fakeStore();
    await assert.rejects(() => createProduct(ORG, input(overrides), { store }), expected);
    assert.equal(store.calls.create.length, 0);
  }
});

test("a free product is allowed but a zero-session product is not", async () => {
  const store = fakeStore();
  await createProduct(ORG, input({ defaultPrice: 0 }), { store });
  assert.equal(store.calls.create[0].data.defaultPrice, 0);
  await assert.rejects(() => createProduct(ORG, input({ defaultSessions: 0 }), { store }), /Invalid defaultSessions/);
});

test("setProductStatus sends status and nothing else", async () => {
  const store = fakeStore();
  await setProductStatus(ORG, "product-1", "archived", { store });
  assert.deepEqual(store.calls.update, [
    { path: "organizations/center-a/products/product-1", data: { status: "archived" } },
  ]);
});

test("setProductStatus moves both ways and refuses any other status", async () => {
  const store = fakeStore();
  await setProductStatus(ORG, "product-1", "active", { store });
  assert.equal(store.calls.update[0].data.status, "active");
  await assert.rejects(() => setProductStatus(ORG, "product-1", "draft", { store }), /Invalid status/);
  await assert.rejects(() => setProductStatus(ORG, "product-1", "", { store }), /Missing status/);
  assert.equal(store.calls.update.length, 1);
});

test("a missing organization id stops every call before it reaches Firestore", async () => {
  const store = fakeStore();
  await assert.rejects(() => listProducts("", { store }), /Missing organizationId/);
  await assert.rejects(() => createProduct("", input(), { store }), /Missing organizationId/);
  await assert.rejects(() => setProductStatus("", "product-1", "active", { store }), /Missing organizationId/);
  assert.deepEqual(store.calls, { list: [], create: [], update: [] });
});

/* store 는 테스트를 위한 주입 구멍이고, 운영에서는 아무도 넘기지 않는다 --
   화면이 동작하는 것은 여기 기본값이 Firestore 를 집어 주기 때문이다.
   이 기본값이 사라지면 화면은 undefined.list 로 죽지만 스모크 테스트는 자기
   store 를 주입하므로 아무것도 눈치채지 못한다. 그래서 여기서 고정한다. */

test("the Firestore store is what a caller gets when none is injected", async () => {
  for (const call of [
    () => listProducts(ORG),
    () => createProduct(ORG, {
      name: "이벤트 10회", sessionType: "pt_1_1", payCategory: "pt_1_1_new",
      defaultSessions: 10, defaultPrice: 500000, createdBy: "owner-a",
    }),
    () => setProductStatus(ORG, "product-a", "archived"),
  ]) {
    const error = await call().then(() => null, (thrown) => thrown);
    assert.ok(error, "주입 없이 부르면 Firestore 로 나가야 한다");
    // 기본값이 빠지면 store 가 undefined 가 되어 TypeError 로 죽는다.
    assert.notEqual(error.name, "TypeError", `기본 store 가 사라졌다: ${error.message}`);
    // 실제로 Firestore 까지 갔다는 증거. 이 테스트에는 앱이 초기화돼 있지 않다.
    assert.equal(error.code, "app/no-app", error.message);
  }
});

test("the Firestore store answers the whole ProductStore shape", () => {
  const store = createFirestoreProductStore();
  for (const method of ["list", "create", "update", "serverTimestamp"]) {
    assert.equal(typeof store[method], "function", `${method} 가 없으면 호출부가 죽는다`);
  }
});
