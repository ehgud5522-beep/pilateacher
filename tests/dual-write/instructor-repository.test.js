import assert from "node:assert/strict";
import test from "node:test";
import {
  addMembership, createFirestoreInstructorRateStore, createFirestoreInstructorStore, fullRoomRateOf,
  hasUsableFullRoomRate, isActiveMembership, isDeputyDirectorOf, listInstructors, listMemberships,
  setInstructorDeputyDirector, setInstructorFullRoomRate, setMembershipProfile,
  setMembershipStatus, syncOwnMembershipName,
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
    newRate: 45000, changedBy: "owner-a", actorRole: "owner",
  }, { store, newId: () => "entry-1" });
  assert.equal(store.calls.length, 1, "두 번 나눠 쓰면 하나만 저장되는 순간이 생긴다");
  const [membershipWrite, historyWrite, auditWrite] = store.calls[0];
  assert.equal(membershipWrite.path, "memberships/center-a_instructor-a");
  // set 이면 role 도 status 도 통째로 날아가고, 그 순간 강사는 아무것도 못 읽는다.
  assert.equal(membershipWrite.operation, "update");
  assert.deepEqual(membershipWrite.data, { fullRoomRate: 45000 });
  assert.equal(historyWrite.path, "memberships/center-a_instructor-a/rateHistory/entry-1");
  /* 감사 항목도 같은 배치다. 따로 쓰면 기록만 실패한 변경이 생기고, 감사
     로그에서 그것은 "일어나지 않은 일"과 구별되지 않는다. */
  assert.ok(auditWrite.path.startsWith("auditLogs/"), auditWrite.path);
  assert.equal(auditWrite.data.action, "full_room_rate_set");
  assert.equal(auditWrite.data.amount, 45000);
  assert.equal(auditWrite.data.actorId, "owner-a");
});

test("the audit entry carries no name, only ids", async () => {
  /* 이름은 개명과 오타 수정으로 바뀌는데 이 컬렉션은 고칠 수 없고, 삭제 요청이
     왔을 때 지울 수도 없다. 규칙도 칸 자체를 닫아 둔다. */
  const store = fakeRateStore();
  const { audit } = await setInstructorFullRoomRate(ORG, "instructor-a", {
    newRate: 45000, changedBy: "owner-a", actorRole: "owner",
  }, { store });
  assert.deepEqual(Object.keys(audit).sort(), [
    "action", "actorId", "actorRole", "amount", "createdAt", "organizationId", "targetId",
  ]);
  assert.equal(audit.targetId, "instructor-a", "대상은 id 로 가리킨다");
});

test("a rate change cannot be filed without saying which role did it", async () => {
  // 규칙이 이 값을 membership 과 대조한다. 비어 있으면 거부되므로 여기서 먼저 막는다.
  const store = fakeRateStore();
  await assert.rejects(() => setInstructorFullRoomRate(ORG, "instructor-a", {
    newRate: 45000, changedBy: "owner-a",
  }, { store }), /Missing actorRole/);
  assert.equal(store.calls.length, 0);
});

test("the history entry records where the rate came from", async () => {
  const store = fakeRateStore();
  const { entry } = await setInstructorFullRoomRate(ORG, "instructor-a", {
    newRate: 50000, previousRate: 45000, changedBy: "owner-a", actorRole: "owner",
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
    newRate: 45000, changedBy: "owner-a", actorRole: "owner",
  }, { store });
  assert.equal(entry.previousRate, null, "0 이 아니라 null 이다 -- 없던 것과 0원은 다르다");
});

/* ── 부원장 ───────────────────────────────────────────────────────────── */

test("a deputy is whoever was designated one, and nothing else counts as yes", () => {
  assert.equal(isDeputyDirectorOf(membership({ isDeputyDirector: true })), true);
  for (const value of [undefined, null, false, "true", 1]) {
    assert.equal(isDeputyDirectorOf(membership({ isDeputyDirector: value })), false, JSON.stringify(value));
  }
});

test("the deputy flag and its history entry are written together", async () => {
  /* 플래그만 바뀌고 이력이 없으면 "언제부터 5:5 였나"가 사라진다. 급여 분쟁은
     대개 지난달 이야기라 그 질문이 실제로 나온다. */
  const store = fakeRateStore();
  await setInstructorDeputyDirector(ORG, "instructor-a", {
    isDeputyDirector: true, changedBy: "owner-a", actorRole: "owner",
  }, { store, newId: () => "entry-1" });
  assert.equal(store.calls.length, 1, "두 번 나눠 쓰면 하나만 저장되는 순간이 생긴다");
  const [membershipWrite, historyWrite, auditWrite] = store.calls[0];
  assert.equal(membershipWrite.path, "memberships/center-a_instructor-a");
  assert.equal(membershipWrite.operation, "update");
  assert.deepEqual(membershipWrite.data, { isDeputyDirector: true });
  // 금액 변경과 같은 컬렉션이다 -- 둘이 답하는 질문이 같고, 한 줄로 이어져야 한다.
  assert.equal(historyWrite.path, "memberships/center-a_instructor-a/rateHistory/entry-1");
  assert.ok(auditWrite.path.startsWith("auditLogs/"), auditWrite.path);
  assert.equal(auditWrite.data.action, "deputy_director_set");
  assert.equal(auditWrite.data.enabled, true, "켠 것인지 끈 것인지가 남아야 한다");
});

test("the deputy entry carries one pair, never the rate pair", async () => {
  /* 한 항목이 두 종류의 변경을 동시에 말하면 무엇이 바뀐 것인지 알 수 없다.
     규칙도 둘 중 하나만 허용한다. */
  const store = fakeRateStore();
  const { entry } = await setInstructorDeputyDirector(ORG, "instructor-a", {
    isDeputyDirector: true, previousDeputyDirector: false, changedBy: "owner-a", actorRole: "owner",
  }, { store });
  assert.deepEqual(Object.keys(entry).sort(), [
    "changedBy", "createdAt", "effectiveFrom", "newDeputyDirector",
    "organizationId", "previousDeputyDirector", "userId",
  ]);
  assert.equal(entry.newDeputyDirector, true);
  assert.equal(entry.previousDeputyDirector, false);
  assert.equal(entry.createdAt, "SERVER_TIME", "규칙이 createdAt == request.time 을 요구한다");
});

test("a first designation records that nobody had decided before", async () => {
  const store = fakeRateStore();
  const { entry } = await setInstructorDeputyDirector(ORG, "instructor-a", {
    isDeputyDirector: true, changedBy: "owner-a", actorRole: "owner",
  }, { store });
  assert.equal(entry.previousDeputyDirector, null, "false 가 아니라 null 이다 -- 정해진 적 없는 것과 다르다");
});

test("nobody makes themselves a deputy", async () => {
  /* 부원장은 카테고리도 누적도 보지 않고 계약 금액의 5:5 를 받는다. 자기
     수업을 스스로 그 위에 올릴 수 있으면 아무도 확인하지 않는 인상이 된다. */
  const store = fakeRateStore();
  await assert.rejects(() => setInstructorDeputyDirector(ORG, "owner-a", {
    isDeputyDirector: true, changedBy: "owner-a", actorRole: "owner",
  }, { store }), /Invalid userId/);
  assert.equal(store.calls.length, 0);
});

test("a designation that changes nothing is refused", async () => {
  const store = fakeRateStore();
  await assert.rejects(() => setInstructorDeputyDirector(ORG, "instructor-a", {
    isDeputyDirector: true, previousDeputyDirector: true, changedBy: "owner-a", actorRole: "owner",
  }, { store }), /Invalid isDeputyDirector/);
  assert.equal(store.calls.length, 0);
});

test("an unanswered deputy flag is refused, never read as no", async () => {
  for (const blank of /** @type {Array<any>} */ ([undefined, null, "", "true", 1])) {
    const store = fakeRateStore();
    await assert.rejects(() => setInstructorDeputyDirector(ORG, "instructor-a", {
      isDeputyDirector: blank, changedBy: "owner-a", actorRole: "owner",
    }, { store }), /Missing isDeputyDirector/, JSON.stringify(blank));
    assert.equal(store.calls.length, 0);
  }
});

test("nothing is written when the deputy commit fails", async () => {
  const store = fakeRateStore({ failCommit: Object.assign(new Error("denied"), { code: "permission-denied" }) });
  await assert.rejects(() => setInstructorDeputyDirector(ORG, "instructor-a", {
    isDeputyDirector: true, changedBy: "owner-a", actorRole: "owner",
  }, { store }), /denied/);
  assert.equal(store.written.size, 0);
});

test("nothing is written when the rate commit fails", async () => {
  const store = fakeRateStore({ failCommit: Object.assign(new Error("denied"), { code: "permission-denied" }) });
  await assert.rejects(() => setInstructorFullRoomRate(ORG, "instructor-a", {
    newRate: 45000, changedBy: "owner-a", actorRole: "owner",
  }, { store }), /denied/);
  assert.equal(store.written.size, 0);
});

test("a blank rate is refused, never read as zero", async () => {
  // Number("") 는 0 이다. 빈 칸이 통과하면 그 강사의 재등록 수업이 무보수가 된다.
  for (const blank of ["", "   ", null, undefined]) {
    const store = fakeRateStore();
    await assert.rejects(() => setInstructorFullRoomRate(ORG, "instructor-a", {
      newRate: blank, changedBy: "owner-a", actorRole: "owner",
    }, { store }), /Missing newRate/, JSON.stringify(blank));
    assert.equal(store.calls.length, 0);
  }
});

test("a nonsense rate is refused and says so differently", async () => {
  for (const bad of [-1, 1.5, "abc"]) {
    const store = fakeRateStore();
    await assert.rejects(() => setInstructorFullRoomRate(ORG, "instructor-a", {
      newRate: bad, changedBy: "owner-a", actorRole: "owner",
    }, { store }), /Invalid newRate/, JSON.stringify(bad));
  }
});

test("setting the same rate again is refused", async () => {
  // 바뀐 것이 없는데 이력만 쌓이면 이력이 읽히지 않게 된다.
  const store = fakeRateStore();
  await assert.rejects(() => setInstructorFullRoomRate(ORG, "instructor-a", {
    newRate: 45000, previousRate: 45000, changedBy: "owner-a", actorRole: "owner",
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

/* ── 강사 관리 ──────────────────────────────────────────────────────────────

   대표가 강사를 센터에 붙이고, 직함을 고치고, 퇴사시킨다. uid 를 옮겨 적게
   하지 않는다 -- 이메일로 찾은 uid 가 여기로 들어온다. */

function fakeDirectory(documents = []) {
  const calls = [];
  return {
    calls,
    listByOrganization: async (organizationId) => { calls.push(organizationId); return documents; },
  };
}

test("the directory holds everyone the centre has had, retired included", async () => {
  /* 급여 화면이 지난달 줄에 이름을 붙이려면 퇴사자도 읽어야 한다. 거르면 그
     줄이 uid 로 떨어지고, 누구 것인지 화면이 말하지 못한다. */
  const store = fakeDirectory([
    membership({ userId: "u1", displayName: "정예진", status: "revoked" }),
    membership({ userId: "u2", displayName: "박서연" }),
  ]);
  const found = await listMemberships(ORG, { store });
  assert.deepEqual(found.map((item) => item.userId), ["u2", "u1"], "재직이 먼저");
  assert.deepEqual(store.calls, [ORG], "조직 하나만 건다 -- 규칙이 그것 없이는 거부한다");
});

test("the retired sink below, and each half is sorted by name", async () => {
  const store = fakeDirectory([
    membership({ userId: "u1", displayName: "정예진" }),
    membership({ userId: "u2", displayName: "박서연", status: "revoked" }),
    membership({ userId: "u3", displayName: "강민아" }),
    membership({ userId: "u4", displayName: "김하나", status: "revoked" }),
  ]);
  const found = await listMemberships(ORG, { store });
  assert.deepEqual(found.map((item) => item.displayName), ["강민아", "정예진", "김하나", "박서연"]);
});

test("adding an instructor writes the membership and its audit entry at once", async () => {
  /* 따로 쓰면 기록 없이 붙은 사람이 생기고, 감사 로그에서 그것은 "붙지 않은
     사람"과 구별되지 않는다. */
  const store = fakeRateStore();
  await addMembership(ORG, {
    userId: "u-new", displayName: "박서연", title: "team_lead", locationId: "bansong",
    createdBy: "owner-a", actorRole: "owner",
  }, { store });
  assert.equal(store.calls.length, 1);
  const [membershipWrite, auditWrite] = store.calls[0];
  assert.equal(membershipWrite.path, "memberships/center-a_u-new");
  assert.deepEqual(membershipWrite.data, {
    organizationId: ORG,
    userId: "u-new",
    role: "instructor",
    status: "active",
    displayName: "박서연",
    title: "team_lead",
    locationId: "bansong",
    createdAt: "SERVER_TIME",
    createdBy: "owner-a",
  });
  assert.equal(auditWrite.data.action, "member_added");
  assert.equal(auditWrite.data.targetId, "u-new");
  assert.equal(auditWrite.data.title, "team_lead");
});

test("every title still teaches, so the role never moves", async () => {
  /* 팀장도 점장도 부원장도 수업료를 받는 강사다. 다른 role 로 두면 규칙의 모든
     hasRole 목록을 손봐야 하고, 하나라도 빠뜨리면 그 사람이 조용히 아무것도
     읽지 못한다. */
  for (const title of ["instructor", "team_lead", "branch_manager"]) {
    const store = fakeRateStore();
    await addMembership(ORG, {
      userId: `u-${title}`, displayName: "박서연", title, createdBy: "owner-a", actorRole: "owner",
    }, { store });
    assert.equal(store.calls[0][0].data.role, "instructor", title);
  }
});

test("an FC manager is added as a manager, and only those two roles are accepted", async () => {
  /* FC매니저는 수업하지 않는다. instructor 로 두면 담당 강사 목록과 급여에
     섞인다 (2026-09-23). */
  const store = fakeRateStore();
  await addMembership(ORG, {
    userId: "u-fc", displayName: "김상담", role: "manager", createdBy: "owner-a", actorRole: "owner",
  }, { store });
  assert.equal(store.calls[0][0].data.role, "manager");
  for (const role of ["staff", "member", "admin"]) {
    await assert.rejects(
      () => addMembership(ORG, {
        userId: "u-x", displayName: "김상담", role, createdBy: "owner-a", actorRole: "owner",
      }, { store: fakeRateStore() }),
      /Invalid role/,
      role,
    );
  }
});

test("a title outside the three is refused rather than stored", async () => {
  // 부원장은 직함이 아니라 플래그다 -- 같은 사실을 두 곳에 적으면 어긋난다.
  for (const title of ["deputy_director", "owner", "", "  ", "3"]) {
    const store = fakeRateStore();
    await assert.rejects(
      () => addMembership(ORG, {
        userId: "u-new", displayName: "박서연", title, createdBy: "owner-a", actorRole: "owner",
      }, { store }),
      /Invalid title/,
      JSON.stringify(title),
    );
    assert.equal(store.calls.length, 0);
  }
});

test("a location nobody set is left off, not written empty", async () => {
  // 규칙이 빈 문자열을 거부한다. 없는 것은 없다고 둔다.
  const store = fakeRateStore();
  await addMembership(ORG, {
    userId: "u-new", displayName: "박서연", createdBy: "owner-a", actorRole: "owner",
  }, { store });
  assert.equal("locationId" in store.calls[0][0].data, false);
  assert.equal(store.calls[0][0].data.title, "instructor", "직함을 안 고르면 강사다");
});

test("an owner cannot add themselves, and cannot mint another owner", async () => {
  /* 자기 소속을 자기가 만들 수 있으면 아무나 아무 센터의 대표가 된다. 대표를
     앱에서 세우지도 않는다 -- 되돌리는 문이 없다. */
  const store = fakeRateStore();
  await assert.rejects(
    () => addMembership(ORG, {
      userId: "owner-a", displayName: "나", createdBy: "owner-a", actorRole: "owner",
    }, { store }),
    /Invalid userId/,
  );
  await assert.rejects(
    () => addMembership(ORG, {
      userId: "u-new", displayName: "박서연", role: "owner", createdBy: "owner-a", actorRole: "owner",
    }, { store }),
    /Invalid role/,
  );
  assert.equal(store.calls.length, 0);
});

test("a nameless membership is refused -- the list would fall back to a uid", async () => {
  const store = fakeRateStore();
  for (const displayName of ["", "   ", undefined, "가".repeat(61)]) {
    await assert.rejects(
      () => addMembership(ORG, {
        userId: "u-new", displayName, createdBy: "owner-a", actorRole: "owner",
      }, { store }),
      /displayName/,
      JSON.stringify(displayName),
    );
  }
});

test("the profile moves its three fields together, with a record", async () => {
  const store = fakeRateStore();
  await setMembershipProfile(ORG, "u-1", {
    displayName: "박서연", title: "branch_manager", locationId: "haeundae",
    changedBy: "owner-a", actorRole: "owner",
  }, { store });
  const [profileWrite, auditWrite] = store.calls[0];
  assert.equal(profileWrite.operation, "update", "set 이면 role 도 status 도 날아간다");
  assert.deepEqual(profileWrite.data, {
    displayName: "박서연", title: "branch_manager", locationId: "haeundae",
  });
  assert.equal(auditWrite.data.action, "member_profile_changed");
  assert.equal(auditWrite.data.targetId, "u-1");
});

test("retiring someone flips the status and nothing else", async () => {
  const store = fakeRateStore();
  await setMembershipStatus(ORG, "u-1", {
    status: "revoked", changedBy: "owner-a", actorRole: "owner",
  }, { store });
  const [statusWrite, auditWrite] = store.calls[0];
  assert.equal(statusWrite.operation, "update");
  assert.deepEqual(statusWrite.data, { status: "revoked" });
  assert.equal(auditWrite.data.action, "member_revoked");
  // 퇴사와 복직이 한 동작이라, 어느 방향이었는지가 남아야 읽을 수 있다.
  assert.equal(auditWrite.data.enabled, true);
});

test("coming back is the same door, the other way", async () => {
  const store = fakeRateStore();
  await setMembershipStatus(ORG, "u-1", {
    status: "active", changedBy: "owner-a", actorRole: "owner",
  }, { store });
  assert.deepEqual(store.calls[0][0].data, { status: "active" });
  assert.equal(store.calls[0][1].data.enabled, false);
});

test("an owner cannot retire themselves", async () => {
  /* 대표가 자기 소속을 회수하면 그 센터에 owner 가 없어지고, 되돌릴 문이 아무
     데도 없다. */
  const store = fakeRateStore();
  await assert.rejects(
    () => setMembershipStatus(ORG, "owner-a", {
      status: "revoked", changedBy: "owner-a", actorRole: "owner",
    }, { store }),
    /Invalid userId/,
  );
  assert.equal(store.calls.length, 0);
});

test("only the two statuses this screen makes are accepted", async () => {
  /* 화면이 보낼 수 있는 값과 규칙이 받는 값이 어긋나면 "저장했는데 안 됐다"가
     된다. 규칙도 이 둘만 연다. */
  const store = fakeRateStore();
  for (const status of ["invited", "suspended", "deleted", ""]) {
    await assert.rejects(
      () => setMembershipStatus(ORG, "u-1", {
        status, changedBy: "owner-a", actorRole: "owner",
      }, { store }),
      /status/,
      JSON.stringify(status),
    );
  }
  assert.equal(store.calls.length, 0);
});

test("the screen can tell who is still working here", () => {
  assert.equal(isActiveMembership(membership()), true);
  assert.equal(isActiveMembership(membership({ status: "revoked" })), false);
  assert.equal(isActiveMembership(null), false);
});
