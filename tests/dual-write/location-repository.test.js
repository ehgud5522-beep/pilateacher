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

// ── 지점 추가 · 지점별 목록 (2026-09-23, 율하점 개설) ──
import {
  ALL_LOCATIONS, NO_LOCATION, countByLocation, createLocation, filterByLocation,
} from "../../src/data/repositories/location-repository.js";

function writableStore() {
  const calls = { create: [] };
  return {
    calls,
    list: async () => [],
    create: async (path, data) => { calls.create.push({ path, data }); },
    serverTimestamp: async () => "SERVER_TIME",
  };
}

test("a new location is written under the organization with its name and author", async () => {
  const store = writableStore();
  const created = await createLocation(ORG, { name: " 율하점 ", createdBy: "owner-1" },
    { store, newId: () => "yulha" });
  assert.deepEqual(store.calls.create, [{
    path: "organizations/center-a/locations/yulha",
    data: { organizationId: ORG, name: "율하점", createdAt: "SERVER_TIME", createdBy: "owner-1" },
  }]);
  assert.equal(created.id, "yulha");
});

test("a location with the same name is not created twice", async () => {
  const store = writableStore();
  const error = await createLocation(ORG, { name: "율하 점", createdBy: "owner-1" },
    { store, existing: [location({ id: "yulha", name: "율하점" })] }).then(() => null, (thrown) => thrown);
  assert.equal(error?.code, "already-exists");
  assert.equal(error.locationId, "yulha");
  assert.equal(store.calls.create.length, 0);
});

test("a location needs a name and an author", async () => {
  const store = writableStore();
  await assert.rejects(() => createLocation(ORG, { name: "  ", createdBy: "u" }, { store }), /Missing name/);
  await assert.rejects(() => createLocation(ORG, { name: "율하점", createdBy: "" }, { store }), /Missing createdBy/);
  assert.equal(store.calls.create.length, 0);
});

test("lists split by location, and people without a known location stay findable", () => {
  const locations = [{ id: "bansong" }, { id: "yulha" }];
  const people = [
    { id: "a", locationId: "bansong" },
    { id: "b", locationId: "yulha" },
    { id: "c", locationId: "" },
    { id: "d", locationId: "closed" },
  ];
  assert.deepEqual(filterByLocation(people, ALL_LOCATIONS, locations).map((p) => p.id), ["a", "b", "c", "d"]);
  assert.deepEqual(filterByLocation(people, "yulha", locations).map((p) => p.id), ["b"]);
  assert.deepEqual(filterByLocation(people, NO_LOCATION, locations).map((p) => p.id), ["c", "d"]);
  assert.deepEqual(countByLocation(people, locations),
    { [ALL_LOCATIONS]: 4, [NO_LOCATION]: 2, bansong: 1, yulha: 1 });
});

test("the Firestore store can also write", () => {
  const store = createFirestoreLocationStore();
  assert.equal(typeof store.create, "function");
  assert.equal(typeof store.serverTimestamp, "function");
});
