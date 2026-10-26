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

/* ── 누구에게 어느 지점이 보이는가 ─────────────────────────────────────────
   강사는 자기 지점의 회원만 가르친다. 아홉 개 칩을 주면 그중 여덟은 눌러도
   빈 목록이고, 그 빈 화면은 **"회원이 없다" 로 읽힌다** -- 실제로는 볼 자격이
   없는 지점이다. */

const PLACES = [{ id: "bansong", name: "반송점" }, { id: "centum", name: "센텀점" }];

test("an instructor sees their own branch and no others", async () => {
  const { locationsVisibleTo } = await import("../../src/data/repositories/location-repository.js");
  const found = locationsVisibleTo(PLACES, { role: "instructor", locationId: "bansong" });
  assert.deepEqual(found.map((item) => item.id), ["bansong"]);
});

test("staff is narrowed the same way", async () => {
  const { locationsVisibleTo } = await import("../../src/data/repositories/location-repository.js");
  assert.deepEqual(
    locationsVisibleTo(PLACES, { role: "staff", locationId: "centum" }).map((item) => item.id),
    ["centum"],
  );
});

test("the owner level keeps every branch", async () => {
  /* 센터 전체를 보는 자리다. 거르면 대표가 자기 센터의 절반을 못 본다. */
  const { locationsVisibleTo } = await import("../../src/data/repositories/location-repository.js");
  for (const role of ["owner", "area_manager"]) {
    assert.deepEqual(
      locationsVisibleTo(PLACES, { role, locationId: "bansong" }).map((item) => item.id),
      ["bansong", "centum"],
      role,
    );
  }
});

test("the FC manager now keeps only the branches they hold", async () => {
  /* 2026-10-26 대표 결정으로 뒤집힌 자리다. 전에는 FC매니저도 전 지점이었다.

     한 사람이 두 지점 이상을 맡는 일이 실제로 있고, 그 사람에게 아홉 지점을
     전부 주면 자기 지점을 매번 칩으로 찾아야 한다. 반대로 한 칸짜리로
     고정하면 둘 중 하나를 버리게 된다. */
  const { locationsVisibleTo } = await import("../../src/data/repositories/location-repository.js");
  assert.deepEqual(
    locationsVisibleTo(PLACES, { role: "manager", locationIds: ["bansong"] }).map((item) => item.id),
    ["bansong"],
  );
  assert.deepEqual(
    locationsVisibleTo(PLACES, { role: "manager", locationIds: ["bansong", "centum"] }).map((item) => item.id),
    ["bansong", "centum"],
  );
  /* 옛 문서는 한 칸짜리뿐이다. 그것도 읽어야 한다 -- 새 필드만 보면 아직
     마이그레이션하지 않은 FC매니저의 지점이 통째로 사라진다. */
  assert.deepEqual(
    locationsVisibleTo(PLACES, { role: "manager", locationId: "centum" }).map((item) => item.id),
    ["centum"],
  );
});

test("an instructor with no branch set still sees everything", async () => {
  /* 아직 지점을 안 넣은 강사가 있다 (이 필드가 생기기 전에 만들어진 소속).
     빈 목록을 보여 주면 **자기 회원까지 사라진다** -- 모를 때는 다 보여주는
     쪽이 틀려도 덜 틀린다. */
  const { locationsVisibleTo } = await import("../../src/data/repositories/location-repository.js");
  for (const missing of ["", "   ", undefined]) {
    assert.equal(
      locationsVisibleTo(PLACES, { role: "instructor", locationId: missing }).length,
      2,
      JSON.stringify(missing),
    );
  }
});

test("a branch that no longer exists does not empty the list", async () => {
  /* 지점이 지워졌거나 목록을 못 읽었다. 그 강사의 칩만 사라지는 것이 아니라
     회원이 전부 사라지므로, 거르지 않는 쪽으로 둔다. */
  const { locationsVisibleTo } = await import("../../src/data/repositories/location-repository.js");
  assert.equal(
    locationsVisibleTo(PLACES, { role: "instructor", locationId: "yulha" }).length,
    2,
  );
});

test("an unreadable list is an empty one, not a crash", async () => {
  const { locationsVisibleTo } = await import("../../src/data/repositories/location-repository.js");
  for (const bad of [null, undefined, "nope"]) {
    assert.deepEqual(locationsVisibleTo(bad, { role: "instructor", locationId: "bansong" }), []);
  }
});
