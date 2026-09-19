import assert from "node:assert/strict";
import test from "node:test";
import {
  ROSTER_SOURCE, isMyRosterMember, isRosterMember, isUnlinkedLocalMember, mergeRoster,
  rosterHideKey,
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

/* ── 이용권 카드가 묻는 것들 ───────────────────────────────────────────────

   누적 등록 횟수 · 이용권 만료일 · 회원 회당 금액. 회원권에 다 있는데 아무도
   옮겨 오지 않아 "미등록 · 미설정 · 결제 내역 없음" 으로 비어 있었다 -- 잔여만
   29회라고 적혀 있는 옆에서. 값이 없는 것이 아니라 명부에서 끊겨 있었다. */

test("the pass card's three fields come from the centre's passes", () => {
  const { roster } = mergeRoster({
    clients: [client()],
    members: [],
    passes: [pass({
      category: "pt_1_1_repurchase_event",
      totalSessions: 20, serviceSessions: 2, contractPrice: 1300000,
      remainingCount: 8, expiresAt: new Date(2027, 0, 31),
    })],
    now: NOW,
  });
  const [row] = roster;
  assert.equal(row.total, 22, "누적 등록은 서비스까지 센다");
  assert.equal(row.contractEnd, "2027-01-31");
  // 총 결제액 ÷ 정규 유료 횟수. 서비스는 분모에서 뺀다 -- 레거시 paidAvg 와 같다.
  assert.equal(row.orgUnitPrice, 65000);
  // 잔여 29회 옆에 "이용권 없음" 이 서지 않게 한다.
  assert.equal(row.passName, "1:1 재등록(이벤트)");
});

test("the expiry shown is the one that will run out first", () => {
  /* 만료가 이른 것부터 쓰므로(pickPassForClient) 회원이 물어볼 날짜도 그것이다. */
  const { roster } = mergeRoster({
    clients: [client()],
    members: [],
    passes: [
      pass({ id: "later", expiresAt: new Date(2027, 5, 1), totalSessions: 10, contractPrice: 500000 }),
      pass({ id: "sooner", expiresAt: new Date(2026, 11, 1), totalSessions: 10, contractPrice: 500000 }),
    ],
    now: NOW,
  });
  assert.equal(roster[0].contractEnd, "2026-12-01");
});

test("a member with nothing usable still sees the date that passed", () => {
  /* "미설정" 은 날짜를 정하지 않았다는 뜻인데 실제로는 지난 것이다. 누적과
     회당 금액은 소진·만료분도 센다 -- "누적" 이 그런 뜻이다. */
  const { roster } = mergeRoster({
    clients: [client()],
    members: [],
    passes: [pass({ remainingCount: 0, totalSessions: 10, contractPrice: 400000, expiresAt: new Date(2026, 6, 1) })],
    now: NOW,
  });
  assert.equal(roster[0].orgRemaining, 0);
  assert.equal(roster[0].contractEnd, "2026-07-01");
  assert.equal(roster[0].total, 10);
  assert.equal(roster[0].orgUnitPrice, 40000);
});

test("a centre member with no pass at all says nothing rather than zero", () => {
  const { roster } = mergeRoster({ clients: [client()], members: [], passes: [], now: NOW });
  assert.equal(roster[0].total, 0);
  assert.equal(roster[0].contractEnd, "", "없는 날짜를 지어내지 않는다");
  assert.equal(roster[0].orgUnitPrice, 0);
  assert.equal(roster[0].passName, "");
});

test("a matched member's device pass fields are replaced, not mixed", () => {
  /* 한 카드 안에서 잔여는 조직 값인데 만료일은 기기 값이면 두 출처가 섞인다. */
  const { roster } = mergeRoster({
    clients: [client()],
    members: [member({ total: 99, contractEnd: "2020-01-01", passName: "옛 이용권" })],
    passes: [pass({ totalSessions: 20, serviceSessions: 0, contractPrice: 1000000, category: "pt_1_1_new" })],
    now: NOW,
  });
  assert.equal(roster[0].total, 20);
  assert.equal(roster[0].contractEnd, "2027-01-01");
  assert.equal(roster[0].passName, "1:1 신규");
});

/* ── 숨김 ─────────────────────────────────────────────────────────────────

   조직 회원은 강사가 지울 대상이 아니다. 지우면 그 회원의 수업 기록과 사진이
   함께 사라지고, 그 데이터는 센터가 아니라 강사 기기에만 있다. */

test("a hidden centre member leaves the list but stays counted", () => {
  const { roster, hiddenCount } = mergeRoster({
    clients: [client(), client({ id: "client-b", name: "박서연", phone: "01055556666" })],
    members: [],
    passes: [],
    hiddenClientIds: ["client-a"],
    now: NOW,
  });
  assert.deepEqual(roster.map((row) => row.id), ["client-b"]);
  // 몇 명을 숨겼는지 모르면 되돌릴 길이 없고, 되돌릴 수 없는 숨김은 삭제다.
  assert.equal(hiddenCount, 1);
});

test("hiding a matched member uses the centre id, not the device id", () => {
  /* 기기 id 로 숨기면 다음 병합에서 같은 조직 회원이 새 줄로 돌아온다. */
  const { roster, hiddenCount } = mergeRoster({
    clients: [client()],
    members: [member()],
    passes: [],
    hiddenClientIds: ["client-a"],
    now: NOW,
  });
  assert.deepEqual(roster, []);
  assert.equal(hiddenCount, 1);
});

test("a device-only member can be hidden by its own id", () => {
  const { roster, unlinkedLocal, hiddenCount } = mergeRoster({
    clients: [],
    members: [member({ id: "m-local-1" })],
    passes: [],
    hiddenClientIds: ["m-local-1"],
    now: NOW,
  });
  assert.deepEqual(roster, []);
  assert.deepEqual(unlinkedLocal, [], "숨긴 회원은 '센터에 등록되지 않음' 수에서도 빠진다");
  assert.equal(hiddenCount, 1);
});

test("nothing hidden means nothing is filtered, and the count is zero", () => {
  const { roster, hiddenCount } = mergeRoster({
    clients: [client()], members: [], passes: [], now: NOW,
  });
  assert.equal(roster.length, 1);
  assert.equal(hiddenCount, 0);
  // 목록에 없는 id 를 숨겨도 아무 일이 없어야 한다.
  assert.equal(mergeRoster({
    clients: [client()], members: [], passes: [], hiddenClientIds: ["없는아이디"], now: NOW,
  }).hiddenCount, 0);
});

test("the hide key prefers the centre id", () => {
  assert.equal(rosterHideKey({ orgClientId: "client-a", id: "m-local-1" }), "client-a");
  assert.equal(rosterHideKey({ id: "m-local-1" }), "m-local-1");
  assert.equal(rosterHideKey(null), "");
});
