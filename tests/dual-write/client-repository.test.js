import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_STATUS_FOR_CREATE, createClient, createFirestoreClientStore,
  findSameNameClients, findSamePhoneClients, listClients, normalizePhone,
} from "../../src/data/repositories/client-repository.js";

const ORG = "center-a";

function fakeStore(documents = []) {
  const calls = { list: [], create: [] };
  return {
    calls,
    list: async (path) => { calls.list.push(path); return documents; },
    create: async (path, data) => { calls.create.push({ path, data }); },
    serverTimestamp: async () => "SERVER_TIME",
  };
}

const client = (overrides = {}) => ({
  id: "client-a",
  organizationId: ORG,
  name: "김하나",
  phone: "01012345678",
  locationId: "bansong",
  status: "active",
  ...overrides,
});

const input = (overrides = {}) => ({
  name: "김하나",
  phone: "010-1234-5678",
  locationId: "bansong",
  createdBy: "owner-a",
  ...overrides,
});

test("clients are read from the organization's own collection", async () => {
  const store = fakeStore([client()]);
  await listClients(ORG, { store });
  assert.deepEqual(store.calls.list, ["organizations/center-a/clients"]);
});

test("an organizationId is required before anything is read", async () => {
  const store = fakeStore();
  await assert.rejects(() => listClients("", { store }), /Missing organizationId/);
  assert.equal(store.calls.list.length, 0);
});

test("active members come before ended ones, then by name", async () => {
  const store = fakeStore([
    client({ id: "c3", name: "박세명", status: "ended" }),
    client({ id: "c2", name: "이두리", status: "active" }),
    client({ id: "c1", name: "강하나", status: "active" }),
  ]);
  const found = await listClients(ORG, { store });
  assert.deepEqual(found.map((item) => item.name), ["강하나", "이두리", "박세명"]);
});

test("a location filter keeps only that location", async () => {
  const store = fakeStore([
    client({ id: "c1", name: "반송", locationId: "bansong" }),
    client({ id: "c2", name: "다른곳", locationId: "other" }),
  ]);
  const found = await listClients(ORG, { locationId: "bansong", store });
  assert.deepEqual(found.map((item) => item.name), ["반송"]);
});

test("search matches a partial name", async () => {
  const store = fakeStore([client({ id: "c1", name: "김하나" }), client({ id: "c2", name: "이두리" })]);
  const found = await listClients(ORG, { search: "하나", store });
  assert.deepEqual(found.map((item) => item.name), ["김하나"]);
});

test("search matches a partial phone, hyphens or not", async () => {
  const store = fakeStore([
    client({ id: "c1", name: "김하나", phone: "01012345678" }),
    client({ id: "c2", name: "이두리", phone: "01099998888" }),
  ]);
  for (const term of ["5678", "1234-5678", "010-1234"]) {
    const found = await listClients(ORG, { search: term, store });
    assert.deepEqual(found.map((item) => item.name), ["김하나"], `검색어 ${term}`);
  }
});

test("an empty search returns everyone instead of nobody", async () => {
  const store = fakeStore([client({ id: "c1" }), client({ id: "c2", name: "이두리" })]);
  assert.equal((await listClients(ORG, { search: "   ", store })).length, 2);
});

test("a search that matches nothing returns an empty list, not everything", async () => {
  const store = fakeStore([client()]);
  assert.deepEqual(await listClients(ORG, { search: "없는이름", store }), []);
});

test("ended members can be excluded when the screen asks", async () => {
  const store = fakeStore([client({ id: "c1" }), client({ id: "c2", name: "이두리", status: "ended" })]);
  const found = await listClients(ORG, { includeEnded: false, store });
  assert.deepEqual(found.map((item) => item.name), ["김하나"]);
});

test("a phone keeps only digits so one number has one spelling", () => {
  for (const written of ["010-1234-5678", "010 1234 5678", "(010)1234-5678"]) {
    assert.equal(normalizePhone(written), "01012345678", written);
  }
  assert.equal(normalizePhone(undefined), "");
});

test("a created client stores the phone as digits", async () => {
  const store = fakeStore();
  const created = await createClient(ORG, input(), { store, newId: () => "client-new" });
  assert.equal(created.phone, "01012345678");
  assert.equal(store.calls.create[0].data.phone, "01012345678");
});

test("a created client is written to its own path with the server's time", async () => {
  const store = fakeStore();
  await createClient(ORG, input(), { store, newId: () => "client-new" });
  const { path, data } = store.calls.create[0];
  assert.equal(path, "organizations/center-a/clients/client-new");
  assert.equal(data.createdAt, "SERVER_TIME", "규칙이 createdAt == request.time 을 요구한다");
  assert.equal(data.createdBy, "owner-a");
  assert.equal(data.organizationId, ORG, "경로와 본문의 조직이 같아야 규칙이 통과한다");
});

test("a created client carries exactly the fields the rules expect", async () => {
  const store = fakeStore();
  await createClient(ORG, input(), { store, newId: () => "client-new" });
  assert.deepEqual(Object.keys(store.calls.create[0].data).sort(), [
    "createdAt", "createdBy", "locationId", "name", "organizationId", "phone", "status",
  ]);
});

test("a new client starts active", async () => {
  const store = fakeStore();
  assert.equal((await createClient(ORG, input(), { store })).status, "active");
});

test("registration refuses what the rules would refuse, before the round trip", async () => {
  const cases = [
    { payload: input({ name: "  " }), expected: /Missing name/ },
    { payload: input({ phone: "" }), expected: /Missing phone/ },
    // 하이픈만 친 값은 숫자가 남지 않는다. 빈 번호가 저장되면 동명이인 화면이
    // 구분할 것을 잃는다.
    { payload: input({ phone: "---" }), expected: /Missing phone/ },
    { payload: input({ locationId: "" }), expected: /Missing locationId/ },
    { payload: input({ createdBy: "" }), expected: /Missing createdBy/ },
    { payload: input({ status: "deleted" }), expected: /Invalid status/ },
    { payload: input({ status: "inactive" }), expected: /Invalid status/ },
    { payload: input({ status: "made-up" }), expected: /Invalid status/ },
  ];
  for (const { payload, expected } of cases) {
    const store = fakeStore();
    await assert.rejects(() => createClient(ORG, payload, { store }), expected);
    assert.equal(store.calls.create.length, 0, "거부된 입력은 쓰지 않는다");
  }
});

test("only the three statuses a registration screen can produce are allowed", () => {
  assert.deepEqual([...CLIENT_STATUS_FOR_CREATE], ["active", "hold", "ended"]);
});

test("a same-name check finds the duplicates without blocking them", () => {
  const existing = [
    client({ id: "c1", name: "김하나", phone: "01012341234" }),
    client({ id: "c2", name: "김하나", phone: "01055556666" }),
    client({ id: "c3", name: "이두리" }),
  ];
  const same = findSameNameClients(existing, "김하나");
  assert.equal(same.length, 2);
  assert.deepEqual(same.map((item) => item.phone), ["01012341234", "01055556666"]);
});

test("a same-name check ignores surrounding spaces and an empty name", () => {
  const existing = [client({ name: "김하나" })];
  assert.equal(findSameNameClients(existing, "  김하나  ").length, 1);
  assert.deepEqual(findSameNameClients(existing, "   "), []);
  assert.deepEqual(findSameNameClients(undefined, "김하나"), []);
});

/* store 는 테스트를 위한 주입 구멍이고, 운영 화면은 아무것도 넘기지 않는다.
   기본값이 사라지면 화면은 undefined.list 로 죽는다 -- product-repository 와
   같은 이유로 여기서 고정한다. */
test("the Firestore store is what a caller gets when none is injected", async () => {
  for (const call of [() => listClients(ORG), () => createClient(ORG, input())]) {
    const error = await call().then(() => null, (thrown) => thrown);
    assert.ok(error, "주입 없이 부르면 Firestore 로 나가야 한다");
    assert.notEqual(error.name, "TypeError", `기본 store 가 사라졌다: ${error.message}`);
    assert.equal(error.code, "app/no-app", error.message);
  }
});

test("the Firestore store answers the whole ClientStore shape", () => {
  const store = createFirestoreClientStore();
  for (const method of ["list", "create", "serverTimestamp"]) {
    assert.equal(typeof store[method], "function", `${method} 가 없으면 호출부가 죽는다`);
  }
});

/* ── 번호가 겹치면 등록하지 않는다 ───────────────────────────────────

   동명이인과 다르다. 이름이 같은 사람은 실제로 있지만 번호가 같은 사람은
   없다 -- 같은 번호가 둘이면 회원 앱이 둘을 찾아 누구의 잔여인지 정하지
   못하고(ambiguous), 연락처 변경도 그 번호를 영영 거부한다. */

test("같은 번호를 쓰는 회원을 찾는다", () => {
  const clients = [
    { id: "a", name: "김하나", phone: "01012345678" },
    { id: "b", name: "박두리", phone: "010-9999-8888" },
  ];
  assert.deepEqual(findSamePhoneClients(clients, "010-1234-5678").map((item) => item.id), ["a"]);
  // 철자가 달라도 같은 번호다. 양쪽 다 숫자만 남겨 비교한다.
  assert.deepEqual(findSamePhoneClients(clients, "01099998888").map((item) => item.id), ["b"]);
  assert.deepEqual(findSamePhoneClients(clients, "01055556666"), []);
  assert.deepEqual(findSamePhoneClients(clients, ""), []);
  assert.deepEqual(findSamePhoneClients(null, "01012345678"), []);
});

test("겹치는 번호로는 등록되지 않는다", async () => {
  const writes = [];
  const store = {
    create: async (path, data) => { writes.push([path, data]); },
    serverTimestamp: async () => "SERVER_TIME",
    list: async () => [],
  };
  await assert.rejects(
    () => createClient("center-a", {
      name: "김하나", phone: "010-1234-5678", locationId: "bansong", createdBy: "owner-a",
      existingClients: [{ id: "a", name: "박두리", phone: "01012345678" }],
    }, { store }),
    (error) => {
      const thrown = /** @type {any} */ (error);
      assert.equal(thrown.code, "duplicate_phone");
      // 누구의 번호인지 함께 올려 보낸다 -- 화면이 "같은 분이면 합치기" 를 말할 수 있어야 한다.
      assert.equal(thrown.clientName, "박두리");
      return true;
    },
  );
  assert.deepEqual(writes, [], "거부했는데 문서가 만들어졌다");
});

test("명부를 넘겨주지 않으면 검사하지 않는다", async () => {
  /* 여기서 명부 전체를 읽으면 등록 한 번에 회원 수만큼 읽기가 붙는다.
     부르는 쪽이 이미 읽어 둔 것을 넘겨 줄 때만 본다. */
  const writes = [];
  const store = {
    create: async (path, data) => { writes.push([path, data]); },
    serverTimestamp: async () => "SERVER_TIME",
    list: async () => [],
  };
  await createClient("center-a", {
    name: "김하나", phone: "010-1234-5678", locationId: "bansong", createdBy: "owner-a",
  }, { store });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].phone, "01012345678");
});
