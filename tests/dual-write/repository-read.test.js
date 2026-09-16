import assert from "node:assert/strict";
import test from "node:test";
import {
  RepositoryReadError, connectRepositoryLog, disconnectRepositoryLog,
  readCollection, toleratingReadFailure,
} from "../../src/data/repositories/repository-read.js";
import { listClients } from "../../src/data/repositories/client-repository.js";
import { listLocations } from "../../src/data/repositories/location-repository.js";
import { listProducts } from "../../src/data/repositories/product-repository.js";
import { listPasses } from "../../src/data/repositories/pass-repository.js";
import { listInstructors } from "../../src/data/repositories/instructor-repository.js";

const ORG = "center-a";
const denied = () => Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });

function recorder() {
  const entries = [];
  connectRepositoryLog((code, detail) => entries.push({ code, detail }));
  return entries;
}

test.afterEach(() => disconnectRepositoryLog());

/* 이 파일이 지키는 것은 하나다 -- 빈 결과와 조회 실패가 같아 보이지 않는 것.
   memberships 도 locations 도 그 둘이 같아 보여서 원인을 찾는 데 하루씩 걸렸다. */

test("an empty collection is a result, not a failure", async () => {
  const entries = recorder();
  assert.deepEqual(await readCollection({ feature: "f", path: "p", read: async () => [] }), []);
  assert.deepEqual(entries, [], "빈 결과는 실패가 아니므로 로그를 남기지 않는다");
});

test("a refused read throws instead of becoming an empty list", async () => {
  const error = await readCollection({ feature: "f", path: "p", read: async () => { throw denied(); } })
    .then(() => null, (thrown) => thrown);
  assert.ok(error instanceof RepositoryReadError);
  assert.equal(error.code, "permission-denied", "원본 코드를 그대로 싣는다");
  assert.equal(error.errorDomain, "firestore");
  assert.equal(error.path, "p");
  assert.equal(error.feature, "f");
});

test("a refused read is recorded with its original code", async () => {
  const entries = recorder();
  await readCollection({ feature: "location_directory", path: "organizations/center-a/locations", read: async () => { throw denied(); } })
    .catch(() => {});
  assert.equal(entries.length, 1);
  assert.equal(entries[0].code, "location_directory_read_failed");
  assert.equal(entries[0].detail.errorCode, "permission-denied");
  assert.equal(entries[0].detail.errorDomain, "firestore");
  assert.equal(entries[0].detail.stage, "list");
  assert.equal(entries[0].detail.path, "organizations/center-a/locations");
});

test("an error with no code is still traceable", async () => {
  const entries = recorder();
  await readCollection({ feature: "f", path: "p", read: async () => { throw new Error("boom"); } }).catch(() => {});
  assert.equal(entries[0].detail.errorCode, "unknown", "코드 없는 실패도 코드 자리를 비우지 않는다");
});

test("reads work before a log sink is connected", async () => {
  disconnectRepositoryLog();
  assert.deepEqual(await readCollection({ feature: "f", path: "p", read: async () => [{ id: "a" }] }), [{ id: "a" }]);
  await assert.rejects(() => readCollection({ feature: "f", path: "p", read: async () => { throw denied(); } }), RepositoryReadError);
});

test("tolerating a failure still leaves the record behind", async () => {
  const entries = recorder();
  const seen = [];
  const result = await toleratingReadFailure(
    readCollection({ feature: "location_directory", path: "p", read: async () => { throw denied(); } }),
    { onError: (error) => seen.push(error.code) },
  );
  assert.deepEqual(result.items, []);
  assert.equal(result.failed, true, "견딘 실패도 실패였다는 사실은 남는다");
  assert.equal(result.errorCode, "permission-denied");
  assert.deepEqual(seen, ["permission-denied"]);
  assert.equal(entries.length, 1, "리포지토리가 이미 기록했다");
});

test("tolerating a success reports it as a success, not a silent empty", async () => {
  const result = await toleratingReadFailure(Promise.resolve([{ id: "a" }]));
  assert.deepEqual(result.items, [{ id: "a" }]);
  assert.equal(result.failed, false);
  assert.equal(result.errorCode, "");
});

test("an empty tolerated read is not marked as failed", async () => {
  const result = await toleratingReadFailure(Promise.resolve([]));
  assert.deepEqual(result.items, []);
  assert.equal(result.failed, false, "비어 있는 것과 못 읽은 것은 다르다");
});

test("a broken onError cannot break the screen", async () => {
  const result = await toleratingReadFailure(Promise.reject(denied()), {
    onError: () => { throw new Error("diagnostics exploded"); },
  });
  assert.equal(result.failed, true);
  assert.equal(result.errorCode, "permission-denied");
});

/* 컬렉션을 읽는 리포지토리가 모두 같은 규칙을 따르는지 본다. 새 리포지토리를
   추가할 때 이 목록에 한 줄을 더하는 것이 관례다 -- repository-read.js 의
   머리말 참고. read 는 그 리포지토리의 store 모양에 맞춰 조회 하나를 흉내낸다. */
/** 쓰기 입구는 쓰지 않지만, store 는 제 모양을 다 갖춰야 타입이 맞는다. */
const listOnly = (read) => ({
  list: read,
  create: async () => {},
  update: async () => {},
  commit: async () => {},
  serverTimestamp: async () => "SERVER_TIME",
});

const repositories = [
  { name: "listClients", feature: "client_directory", call: (read) => listClients(ORG, { store: listOnly(read) }) },
  { name: "listLocations", feature: "location_directory", call: (read) => listLocations(ORG, { store: listOnly(read) }) },
  { name: "listProducts", feature: "product_catalog", call: (read) => listProducts(ORG, { store: listOnly(read) }) },
  { name: "listPasses", feature: "pass_directory", call: (read) => listPasses(ORG, { store: listOnly(read) }) },
  { name: "listInstructors", feature: "instructor_directory", call: (read) => listInstructors(ORG, { store: { listByRole: read } }) },
];

test("every list repository turns a refused read into a traceable error", async () => {
  for (const { name, feature, call } of repositories) {
    const entries = recorder();
    const error = await call(async () => { throw denied(); }).then(() => null, (thrown) => thrown);
    assert.ok(error instanceof RepositoryReadError, `${name} 은 실패를 던져야 한다`);
    assert.equal(error.code, "permission-denied", name);
    assert.equal(entries.length, 1, `${name} 의 실패가 기록되지 않았다`);
    assert.equal(entries[0].code, `${feature}_read_failed`, name);
    assert.equal(entries[0].detail.errorCode, "permission-denied", name);
    disconnectRepositoryLog();
  }
});

test("every list repository returns an empty list quietly when there is nothing", async () => {
  for (const { name, call } of repositories) {
    const entries = recorder();
    assert.deepEqual(await call(async () => []), [], name);
    assert.deepEqual(entries, [], `${name} 이 빈 결과를 실패처럼 기록했다`);
    disconnectRepositoryLog();
  }
});
