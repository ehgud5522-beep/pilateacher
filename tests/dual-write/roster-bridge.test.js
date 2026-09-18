import assert from "node:assert/strict";
import test from "node:test";
import {
  ROSTER_SOURCE, isMyRosterMember, isRosterMember, isUnlinkedLocalMember, mergeRoster,
} from "../../src/features/roster/roster-bridge.js";
import { transitionAttendance } from "../../src/features/schedule/attendance-transitions.js";

const NOW = new Date(2026, 8, 18);

const client = (overrides = {}) => ({
  id: "client-a",
  name: "김하나",
  phone: "01012345678",
  locationId: "bansong",
  status: "active",
  ...overrides,
});

const member = (overrides = {}) => ({
  id: "m-local-1",
  name: "김하나",
  phone: "010-1234-5678",
  regular: 7,
  service: 2,
  total: 20,
  notes: [{ id: "n1", body: "숄더브릿지 3세트" }],
  status: "active",
  ...overrides,
});

const pass = (overrides = {}) => ({
  id: "pass-a",
  clientId: "client-a",
  instructorId: "u1",
  remainingCount: 8,
  status: "active",
  expiresAt: new Date(2027, 0, 1),
  ...overrides,
});

/* ── 이어 붙이기 ───────────────────────────────────────────────────────── */

test("a matched member keeps its own id, so its records keep working", () => {
  /* 기록은 회원 객체 안(notes)에, 사진과 체형분석은 회원 id 를 키로 하는 저장소에
     있다. id 를 바꾸면 둘 다 가리킬 곳을 잃는다 -- 이 테스트가 그 한 줄을
     지킨다. */
  const { roster } = mergeRoster({ clients: [client()], members: [member()], passes: [pass()], now: NOW });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].id, "m-local-1", "레거시 id 를 그대로 쓴다");
  assert.equal(roster[0].orgClientId, "client-a");
  assert.equal(roster[0].rosterSource, ROSTER_SOURCE.ORG_LINKED);
  assert.deepEqual(roster[0].notes, member().notes, "수업 기록이 끊기지 않는다");
});

test("the name and the phone come from the centre, not from the device", () => {
  // FC매니저가 고친 이름이 강사 화면에도 보여야 한다. 원본은 조직 쪽이다.
  const { roster } = mergeRoster({
    clients: [client({ name: "김하나리", phone: "01099998888" })],
    members: [member({ name: "김하나", phone: "01012345678" })],
    passes: [],
    now: NOW,
  });
  assert.equal(roster[0].name, "김하나리");
  assert.equal(roster[0].phone, "01099998888");
});

test("the remaining count comes only from the centre's passes", () => {
  /* 두 숫자가 한 화면에 함께 있으면 어느 것이 맞는지 아무도 모르고, 일정 탭의
     옛 차감 흐름이 그중 하나를 줄인다. */
  const { roster } = mergeRoster({
    clients: [client()],
    members: [member({ regular: 7, service: 2 })],
    passes: [pass({ remainingCount: 8 }), pass({ id: "pass-b", remainingCount: 3 })],
    now: NOW,
  });
  assert.equal(roster[0].orgRemaining, 11, "쓸 수 있는 회원권을 모두 더한다");
  assert.equal(roster[0].regular, 0, "레거시 잔여는 눌러 내린다");
  assert.equal(roster[0].service, 0);
  assert.equal(roster[0].total, 0);
});

test("a spent or expired pass adds nothing to the remaining count", () => {
  const { roster } = mergeRoster({
    clients: [client()],
    members: [],
    passes: [
      pass({ id: "usable", remainingCount: 4 }),
      pass({ id: "spent", remainingCount: 0 }),
      pass({ id: "cancelled", status: "cancelled", remainingCount: 5 }),
      pass({ id: "expired", remainingCount: 6, expiresAt: new Date(2026, 7, 1) }),
    ],
    now: NOW,
  });
  assert.equal(roster[0].orgRemaining, 4);
});

test("a centre member nobody has on their device gets the centre's id", () => {
  /* 앞으로의 기록이 그 id 로 쌓이므로, 나중에 조직으로 옮길 때 이미 맞는 id 다. */
  const { roster } = mergeRoster({ clients: [client()], members: [], passes: [pass()], now: NOW });
  assert.equal(roster[0].id, "client-a");
  assert.equal(roster[0].rosterSource, ROSTER_SOURCE.ORG);
  assert.deepEqual(roster[0].notes, [], "기록은 아직 없다 -- 없는 것을 지어내지 않는다");
});

test("a device member the centre does not know is shown, never hidden", () => {
  /* 숨기면 강사 화면에서 자기 기록이 사라진다. 이관 직후에는 연락처가 달라
     못 맞춘 같은 사람이 여기 섞인다. */
  const { roster, unlinkedLocal } = mergeRoster({
    clients: [],
    members: [member({ id: "m-orphan", name: "이두리" })],
    passes: [],
    now: NOW,
  });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].rosterSource, ROSTER_SOURCE.LOCAL_ONLY);
  assert.deepEqual(unlinkedLocal.map((item) => item.id), ["m-orphan"]);
  // 조직 회원권이 없으니 쓸 수 있는 회차를 아는 방법이 없다. 지어내지 않는다.
  assert.equal(roster[0].orgRemaining, 0);
  assert.equal(roster[0].regular, 0);
});

/* ── 맞추는 규칙 ───────────────────────────────────────────────────────── */

test("the phone matches even when one side writes the hyphens", () => {
  const { roster } = mergeRoster({
    clients: [client({ phone: "01012345678" })],
    members: [member({ phone: "010-1234-5678" })],
    passes: [],
    now: NOW,
  });
  assert.equal(roster[0].rosterSource, ROSTER_SOURCE.ORG_LINKED);
});

test("a member with no phone at all still matches by name", () => {
  // 연락처가 없는 옛 회원이 실제로 있다.
  const { roster } = mergeRoster({
    clients: [client({ phone: "" })],
    members: [member({ phone: "" })],
    passes: [],
    now: NOW,
  });
  assert.equal(roster[0].rosterSource, ROSTER_SOURCE.ORG_LINKED);
  assert.equal(roster[0].id, "m-local-1");
});

test("a member with neither a phone nor a name matches nothing", () => {
  /* 빈 열쇠로 맞추면 이름 없는 회원 여럿이 한 조직 회원에 달라붙는다. */
  const { roster, unlinkedLocal } = mergeRoster({
    clients: [client({ name: "김하나", phone: "" })],
    members: [member({ id: "m-blank", name: "", phone: "" })],
    passes: [],
    now: NOW,
  });
  assert.equal(roster[0].rosterSource, ROSTER_SOURCE.ORG);
  assert.equal(unlinkedLocal.length, 1);
});

test("one device member never attaches to two centre members", () => {
  /* 달라붙으면 같은 기록이 두 사람 아래에 보이고, 강사는 어느 쪽이 진짜인지
     알 수 없다. */
  const { roster } = mergeRoster({
    clients: [
      client({ id: "c1", name: "김하나", phone: "" }),
      client({ id: "c2", name: "김하나", phone: "" }),
    ],
    members: [member({ id: "m-one", name: "김하나", phone: "" })],
    passes: [],
    now: NOW,
  });
  assert.deepEqual(roster.map((item) => item.rosterSource), [ROSTER_SOURCE.ORG_LINKED, ROSTER_SOURCE.ORG]);
  assert.deepEqual(roster.map((item) => item.id), ["m-one", "c2"]);
});

test("the phone wins over the name", () => {
  // 이름은 동명이인이 있고 개명도 된다. 연락처가 더 단단하다.
  const { roster } = mergeRoster({
    clients: [client({ name: "김하나", phone: "01012345678" })],
    members: [
      member({ id: "m-by-name", name: "김하나", phone: "01055556666" }),
      member({ id: "m-by-phone", name: "다른이름", phone: "01012345678" }),
    ],
    passes: [],
    now: NOW,
  });
  assert.equal(roster[0].id, "m-by-phone");
});

/* ── 화면이 묻는 것 ────────────────────────────────────────────────────── */

test("the screen can tell a bridged row from a plain legacy one", () => {
  /* 옛 차감 경로를 막는 판정이다. 개인 강사의 회원은 이 표시가 없어 지금
     그대로 동작한다. */
  const { roster } = mergeRoster({ clients: [client()], members: [], passes: [], now: NOW });
  assert.equal(isRosterMember(roster[0]), true);
  assert.equal(isRosterMember(member()), false, "개인 모드 회원은 거치지 않는다");
  assert.equal(isUnlinkedLocalMember(roster[0]), false);
});

test("my members are the ones whose passes name me", () => {
  const { roster } = mergeRoster({
    clients: [client({ id: "mine" }), client({ id: "theirs", phone: "01077778888" })],
    members: [],
    passes: [
      pass({ clientId: "mine", instructorId: "u1" }),
      pass({ id: "p2", clientId: "theirs", instructorId: "u2" }),
    ],
    now: NOW,
  });
  const mine = roster.find((item) => item.orgClientId === "mine");
  const theirs = roster.find((item) => item.orgClientId === "theirs");
  assert.equal(isMyRosterMember(mine, "u1"), true);
  assert.equal(isMyRosterMember(theirs, "u1"), false);
  // uid 를 모르면 아무도 내 회원이 아니다. 전체를 내 것으로 보여주지 않는다.
  assert.equal(isMyRosterMember(mine, ""), false);
});

test("an expired pass still says whose member this is", () => {
  /* 지난주에 만료됐다고 그 회원이 내 회원이 아니게 되는 것은 아니다. "내 회원"
     필터가 그 사람을 잃으면 강사는 목록을 다시 만들기 시작한다. */
  const { roster } = mergeRoster({
    clients: [client()],
    members: [],
    passes: [pass({ remainingCount: 0, expiresAt: new Date(2026, 7, 1) })],
    now: NOW,
  });
  assert.equal(roster[0].orgRemaining, 0);
  assert.equal(isMyRosterMember(roster[0], "u1"), true);
});

test("the centre's status decides which section a row lands in", () => {
  const { roster } = mergeRoster({
    clients: [
      client({ id: "c1", phone: "01000000001", status: "active" }),
      client({ id: "c2", phone: "01000000002", status: "hold" }),
      client({ id: "c3", phone: "01000000003", status: "ended" }),
      client({ id: "c4", phone: "01000000004", status: "deleted" }),
    ],
    members: [],
    passes: [],
    now: NOW,
  });
  assert.deepEqual(roster.map((item) => item.status), ["active", "hold", "ended", "ended"]);
});

test("nothing is returned when there is nothing on either side", () => {
  const { roster, unlinkedLocal } = mergeRoster({});
  assert.deepEqual(roster, []);
  assert.deepEqual(unlinkedLocal, []);
});

/* ── 옛 차감 경로 ───────────────────────────────────────────────────────

   잔여의 원본이 조직 회원권으로 옮겨졌고, 그 숫자는 원장과 함께만 움직인다.
   일정 탭에서 기기 쪽 숫자를 줄이면 두 숫자가 갈라지고, 급여는 원장에서 나오므로
   그렇게 줄인 회차는 아무에게도 지급되지 않는다. */

const attendee = (overrides = {}) => ({
  memberId: "m-local-1", status: "booked", deductFrom: null, noshowFee: null, ...overrides,
});

test("in organization mode attendance changes the status and nothing else", () => {
  const before = [member({ regular: 7, service: 2 })];
  const result = transitionAttendance({
    members: before,
    attendees: [attendee()],
    memberIds: ["m-local-1"],
    status: "done",
    organizationMode: true,
  });
  assert.equal(result.changed, true);
  assert.equal(result.attendees[0].status, "done");
  assert.equal(result.attendees[0].deductFrom, null, "차감했다고 적지 않는다");
  assert.equal(result.members[0].regular, 7, "기기 저장 잔여는 그대로다");
  assert.equal(result.members[0].service, 2);
  /* 조용히 "0회 차감"으로 넘어가면 강사는 차감된 줄로 안다. 화면이 어디서
     하는지 말할 수 있어야 한다. */
  assert.equal(result.blocked, true);
});

test("a personal instructor's deduction still works exactly as before", () => {
  const result = transitionAttendance({
    members: [member({ regular: 7, service: 2 })],
    attendees: [attendee()],
    memberIds: ["m-local-1"],
    status: "done",
  });
  assert.equal(result.attendees[0].deductFrom, "정규");
  assert.equal(result.members[0].regular, 6);
  assert.equal(result.blocked, false);
});

test("rolling an attendance back still restores what it took, in both modes", () => {
  /* 소속 모드로 바뀌기 전에 차감된 건이 기기에 남아 있다. 그것을 되돌릴 때는
     돌려줘야 한다 -- 막는 것은 새로 줄이는 일이다. */
  for (const organizationMode of [true, false]) {
    const result = transitionAttendance({
      members: [member({ regular: 6 })],
      attendees: [attendee({ status: "done", deductFrom: "정규" })],
      memberIds: ["m-local-1"],
      status: "booked",
      organizationMode,
    });
    assert.equal(result.members[0].regular, 7, String(organizationMode));
    assert.equal(result.blocked, false);
  }
});
