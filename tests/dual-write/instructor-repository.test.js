import assert from "node:assert/strict";
import test from "node:test";
import {
  createFirestoreInstructorRateStore, createFirestoreInstructorStore, fullRoomRateOf,
  hasUsableFullRoomRate, listInstructors, setInstructorFullRoomRate, syncOwnMembershipName,
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

/* ── 풀방금액 ─────────────────────────────────────────────────────────── */

function fakeRateStore({ failCommit = null } = {}) {
  const written = new Map();
  const calls = [];
  return {
    written,
    calls,
    commit: async (writes) => {
      calls.push(writes);
      if (failCommit) throw failCommit;
      for (const write of writes) written.set(write.path, write);
    },
    serverTimestamp: async () => "SERVER_TIME",
  };
}

test("a rate and its history entry are written together", async () => {
  /* 금액만 바뀌고 이력이 없으면 "언제부터 이 금액이었나"가 사라지고, 이력만
     남고 금액이 그대로면 둘이 어긋난다. */
  const store = fakeRateStore();
  await setInstructorFullRoomRate(ORG, "instructor-a", {
    newRate: 45000, changedBy: "owner-a",
  }, { store, newId: () => "entry-1" });
  assert.equal(store.calls.length, 1, "두 번 나눠 쓰면 하나만 저장되는 순간이 생긴다");
  const [membershipWrite, historyWrite] = store.calls[0];
  assert.equal(membershipWrite.path, "memberships/center-a_instructor-a");
  // set 이면 role 도 status 도 통째로 날아가고, 그 순간 강사는 아무것도 못 읽는다.
  assert.equal(membershipWrite.operation, "update");
  assert.deepEqual(membershipWrite.data, { fullRoomRate: 45000 });
  assert.equal(historyWrite.path, "memberships/center-a_instructor-a/rateHistory/entry-1");
});

test("the history entry records where the rate came from", async () => {
  const store = fakeRateStore();
  const { entry } = await setInstructorFullRoomRate(ORG, "instructor-a", {
    newRate: 50000, previousRate: 45000, changedBy: "owner-a",
  }, { store });
  assert.equal(entry.previousRate, 45000);
  assert.equal(entry.newRate, 50000);
  assert.equal(entry.changedBy, "owner-a");
  assert.equal(entry.createdAt, "SERVER_TIME", "규칙이 createdAt == request.time 을 요구한다");
  assert.equal(entry.effectiveFrom, "SERVER_TIME");
});

test("a first rate records that there was none before", async () => {
  const store = fakeRateStore();
  const { entry } = await setInstructorFullRoomRate(ORG, "instructor-a", {
    newRate: 45000, changedBy: "owner-a",
  }, { store });
  assert.equal(entry.previousRate, null, "0 이 아니라 null 이다 -- 없던 것과 0원은 다르다");
});

test("nothing is written when the rate commit fails", async () => {
  const store = fakeRateStore({ failCommit: Object.assign(new Error("denied"), { code: "permission-denied" }) });
  await assert.rejects(() => setInstructorFullRoomRate(ORG, "instructor-a", {
    newRate: 45000, changedBy: "owner-a",
  }, { store }), /denied/);
  assert.equal(store.written.size, 0);
});

test("a blank rate is refused, never read as zero", async () => {
  // Number("") 는 0 이다. 빈 칸이 통과하면 그 강사의 재등록 수업이 무보수가 된다.
  for (const blank of ["", "   ", null, undefined]) {
    const store = fakeRateStore();
    await assert.rejects(() => setInstructorFullRoomRate(ORG, "instructor-a", {
      newRate: blank, changedBy: "owner-a",
    }, { store }), /Missing newRate/, JSON.stringify(blank));
    assert.equal(store.calls.length, 0);
  }
});

test("a nonsense rate is refused and says so differently", async () => {
  for (const bad of [-1, 1.5, "abc"]) {
    const store = fakeRateStore();
    await assert.rejects(() => setInstructorFullRoomRate(ORG, "instructor-a", {
      newRate: bad, changedBy: "owner-a",
    }, { store }), /Invalid newRate/, JSON.stringify(bad));
  }
});

test("setting the same rate again is refused", async () => {
  // 바뀐 것이 없는데 이력만 쌓이면 이력이 읽히지 않게 된다.
  const store = fakeRateStore();
  await assert.rejects(() => setInstructorFullRoomRate(ORG, "instructor-a", {
    newRate: 45000, previousRate: 45000, changedBy: "owner-a",
  }, { store }), /Invalid newRate/);
  assert.equal(store.calls.length, 0);
});

test("the change needs an organization, an instructor and an author", async () => {
  const base = { newRate: 45000, changedBy: "owner-a" };
  const store = fakeRateStore();
  await assert.rejects(() => setInstructorFullRoomRate("", "instructor-a", base, { store }), /Missing organizationId/);
  await assert.rejects(() => setInstructorFullRoomRate(ORG, "", base, { store }), /Missing userId/);
  await assert.rejects(() => setInstructorFullRoomRate(ORG, "instructor-a", { ...base, changedBy: "" }, { store }), /Missing changedBy/);
  assert.equal(store.calls.length, 0);
});

test("a rate of zero reads as not set for issuing", () => {
  /* 저장은 0 을 허용한다 (대표가 비우는 동작). 다만 그 강사에게 재등록(정상)
     상품을 발급하는 것은 막아야 한다 -- 0원으로 기록되면 원장은 고칠 수 없다. */
  assert.equal(fullRoomRateOf({ fullRoomRate: 45000 }), 45000);
  assert.equal(fullRoomRateOf({ fullRoomRate: 0 }), 0);
  assert.equal(fullRoomRateOf({}), null);
  assert.equal(fullRoomRateOf({ fullRoomRate: "45000" }), null, "문자열은 값이 아니다");
  assert.equal(hasUsableFullRoomRate({ fullRoomRate: 45000 }), true);
  assert.equal(hasUsableFullRoomRate({ fullRoomRate: 0 }), false);
  assert.equal(hasUsableFullRoomRate({}), false);
});

test("the Firestore rate store answers the shape the caller needs", () => {
  const store = createFirestoreInstructorRateStore();
  for (const method of ["commit", "serverTimestamp"]) {
    assert.equal(typeof store[method], "function", method);
  }
  // 문서를 한 건씩 쓰는 입구는 두지 않는다. 있으면 언젠가 그리로 새 나간다.
  assert.equal(store.update, undefined);
});

/* ── 이름 동기화 ───────────────────────────────────────────────────────
   대표가 강사 목록에서 uid 가 아니라 이름을 보게 하는 유일한 경로다.
   users/{uid} 를 읽지 않는 이유는 규칙 파일의 memberships 주석에 있다 --
   이름을 얻자고 그 문서를 열면 전화번호와 이메일이 함께 열린다. */

function fakeNameStore() {
  const calls = [];
  return { calls, update: async (path, data) => { calls.push({ path, data }); } };
}

test("a name is written onto the member's own membership", async () => {
  const store = fakeNameStore();
  const result = await syncOwnMembershipName(ORG, "instructor-a", { displayName: "정예진" }, { store });
  assert.equal(result.written, true);
  assert.deepEqual(store.calls, [{
    path: "memberships/center-a_instructor-a",
    data: { displayName: "정예진" },
  }]);
});

test("the same name is not written again", async () => {
  // 앱을 열 때마다 같은 값을 다시 쓰면 비용만 늘고 얻는 것이 없다.
  const store = fakeNameStore();
  const result = await syncOwnMembershipName(ORG, "instructor-a", {
    displayName: "정예진", currentDisplayName: "정예진",
  }, { store });
  assert.equal(result.written, false);
  assert.equal(store.calls.length, 0);
});

test("a changed name is written", async () => {
  const store = fakeNameStore();
  const result = await syncOwnMembershipName(ORG, "instructor-a", {
    displayName: "정예진", currentDisplayName: "예전이름",
  }, { store });
  assert.equal(result.written, true);
  assert.equal(store.calls.length, 1);
});

test("a blank name never overwrites a real one", async () => {
  // 빈 이름으로 덮어쓰면 목록이 uid 로 되돌아간다. 규칙도 빈 문자열을 거부한다.
  for (const blank of ["", "   ", null, undefined]) {
    const store = fakeNameStore();
    const result = await syncOwnMembershipName(ORG, "instructor-a", { displayName: blank }, { store });
    assert.equal(result.written, false, JSON.stringify(blank));
    assert.equal(store.calls.length, 0);
  }
});

test("an absurdly long name is refused rather than truncated", async () => {
  // 규칙이 60자를 넘기면 거부한다. 잘라서 보내면 화면의 이름이 조용히 달라진다.
  const store = fakeNameStore();
  const result = await syncOwnMembershipName(ORG, "instructor-a", { displayName: "가".repeat(61) }, { store });
  assert.equal(result.written, false);
  assert.equal(store.calls.length, 0);
});

test("the sync needs an organization and a user", async () => {
  const store = fakeNameStore();
  await assert.rejects(() => syncOwnMembershipName("", "instructor-a", { displayName: "정예진" }, { store }), /Missing organizationId/);
  await assert.rejects(() => syncOwnMembershipName(ORG, "", { displayName: "정예진" }, { store }), /Missing userId/);
  assert.equal(store.calls.length, 0);
});
