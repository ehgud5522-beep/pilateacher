import assert from "node:assert/strict";
import test from "node:test";
import {
  createFirestoreInstructorStore, listInstructors,
} from "../../src/data/repositories/instructor-repository.js";
import { RepositoryReadError, connectRepositoryLog, disconnectRepositoryLog } from "../../src/data/repositories/repository-read.js";

const ORG = "center-a";

function fakeStore(documents = []) {
  const calls = [];
  return {
    calls,
    listByRole: async (organizationId, role) => { calls.push({ organizationId, role }); return documents; },
  };
}

const membership = (overrides = {}) => ({
  id: "center-a_instructor-a",
  organizationId: ORG,
  userId: "instructor-a",
  role: "instructor",
  status: "active",
  ...overrides,
});

test("instructors are read from memberships, filtered by organization and role", () => {
  // 역할이 적힌 곳은 memberships 말고 없다. 명단을 따로 두면 화면의 목록과
  // 실제 권한이 다른 사람을 가리키는 날이 온다.
  const store = fakeStore([membership()]);
  return listInstructors(ORG, { store }).then(() => {
    assert.deepEqual(store.calls, [{ organizationId: ORG, role: "instructor" }]);
  });
});

test("an organizationId is required before anything is read", async () => {
  const store = fakeStore();
  await assert.rejects(() => listInstructors("", { store }), /Missing organizationId/);
  assert.equal(store.calls.length, 0);
});

test("instructors come back sorted by name", async () => {
  const store = fakeStore([
    membership({ id: "c", userId: "u3", displayName: "정예진" }),
    membership({ id: "a", userId: "u1", displayName: "강민아" }),
    membership({ id: "b", userId: "u2", displayName: "박서연" }),
  ]);
  const found = await listInstructors(ORG, { store });
  assert.deepEqual(found.map((item) => item.displayName), ["강민아", "박서연", "정예진"]);
});

test("an instructor without a name is still listed", async () => {
  /* 목록에서 빼면 그 강사에게 회원권을 발급할 길이 사라지는데, 화면에는 그
     강사가 없는 것처럼만 보인다. 이름이 없으면 화면이 userId 를 보여준다. */
  const store = fakeStore([membership({ userId: "u-nameless", displayName: "" }), membership({ displayName: "정예진" })]);
  const found = await listInstructors(ORG, { store });
  assert.equal(found.length, 2);
  assert.ok(found.some((item) => item.userId === "u-nameless"));
});

test("an entry with no userId is dropped instead of becoming an unpickable row", async () => {
  const store = fakeStore([{ organizationId: ORG, role: "instructor", displayName: "이름만" }, membership()]);
  const found = await listInstructors(ORG, { store });
  assert.deepEqual(found.map((item) => item.userId), ["instructor-a"]);
});

test("another role can be asked for without changing the caller", async () => {
  const store = fakeStore([]);
  await listInstructors(ORG, { store, role: "manager" });
  assert.deepEqual(store.calls, [{ organizationId: ORG, role: "manager" }]);
});

test("a refused read throws instead of becoming an empty list", async () => {
  /* 강사 목록이 조용히 비면 화면은 "강사가 없다"로 보이고, 발급이 막힌 이유를
     아무도 모른다 -- memberships·locations 에서 겪은 그 침묵이다. */
  const entries = [];
  connectRepositoryLog((code, detail) => entries.push({ code, detail }));
  const store = fakeStore();
  store.listByRole = async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); };
  await assert.rejects(() => listInstructors(ORG, { store }), RepositoryReadError);
  assert.equal(entries[0].code, "instructor_directory_read_failed");
  assert.equal(entries[0].detail.errorCode, "permission-denied");
  disconnectRepositoryLog();
});

test("an empty organization returns an empty list quietly", async () => {
  const entries = [];
  connectRepositoryLog((code) => entries.push(code));
  assert.deepEqual(await listInstructors(ORG, { store: fakeStore([]) }), []);
  assert.deepEqual(entries, [], "비어 있는 것은 실패가 아니다");
  disconnectRepositoryLog();
});

test("the Firestore store is what a caller gets when none is injected", async () => {
  const error = await listInstructors(ORG).then(() => null, (thrown) => thrown);
  assert.ok(error);
  assert.notEqual(error.name, "TypeError", `기본 store 가 사라졌다: ${error.message}`);
  assert.equal(error.code, "app/no-app", error.message);
});

test("the Firestore store answers the whole InstructorStore shape", () => {
  assert.equal(typeof createFirestoreInstructorStore().listByRole, "function");
});
