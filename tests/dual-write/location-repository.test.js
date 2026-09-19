import assert from "node:assert/strict";
import test from "node:test";
import {
  createFirestoreLocationStore, listLocations,
} from "../../src/data/repositories/location-repository.js";

const ORG = "center-a";

function fakeStore(documents = []) {
  const calls = { list: [] };
  return {
    calls,
    list: async (path) => { calls.list.push(path); return documents; },
  };
}

const location = (overrides = {}) => ({
  id: "bansong",
  organizationId: ORG,
  name: "반송점",
  ...overrides,
});

test("locations are read from the organization's own collection", async () => {
  const store = fakeStore([location()]);
  await listLocations(ORG, { store });
  assert.deepEqual(store.calls.list, ["organizations/center-a/locations"]);
});

test("an organizationId is required before anything is read", async () => {
  const store = fakeStore();
  await assert.rejects(() => listLocations("", { store }), /Missing organizationId/);
  assert.equal(store.calls.list.length, 0);
});

test("locations come back sorted by name", async () => {
  const store = fakeStore([
    location({ id: "c", name: "해운대점" }),
    location({ id: "a", name: "반송점" }),
    location({ id: "b", name: "센텀점" }),
  ]);
  const found = await listLocations(ORG, { store });
  assert.deepEqual(found.map((item) => item.name), ["반송점", "센텀점", "해운대점"]);
});

test("a location without a name is still listed", async () => {
  // 목록에서 빼면 그 지점 회원을 등록할 길이 사라지는데, 화면에서는 지점이
  // 없는 것처럼만 보여 원인을 찾을 수 없다.
  const store = fakeStore([location({ id: "nameless", name: "" }), location()]);
  const found = await listLocations(ORG, { store });
  assert.equal(found.length, 2);
  assert.ok(found.some((item) => item.id === "nameless"));
});

test("a document id falls back to locationId so the picker has a value", async () => {
  const store = fakeStore([{ locationId: "bansong", name: "반송점" }]);
  assert.equal((await listLocations(ORG, { store }))[0].id, "bansong");
});

test("an entry with no id at all is dropped instead of becoming an unpickable row", async () => {
  const store = fakeStore([{ name: "이름만 있는 지점" }, location()]);
  const found = await listLocations(ORG, { store });
  assert.deepEqual(found.map((item) => item.id), ["bansong"]);
});

test("the Firestore store is what a caller gets when none is injected", async () => {
  const error = await listLocations(ORG).then(() => null, (thrown) => thrown);
  assert.ok(error);
  assert.notEqual(error.name, "TypeError", `기본 store 가 사라졌다: ${error.message}`);
  assert.equal(error.code, "app/no-app", error.message);
});

test("the Firestore store answers the whole LocationStore shape", () => {
  assert.equal(typeof createFirestoreLocationStore().list, "function");
});
