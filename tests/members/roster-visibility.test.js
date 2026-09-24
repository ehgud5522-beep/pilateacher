import assert from "node:assert/strict";
import test from "node:test";
import {
  canBrowseAllClients, exactNameMatches, isMyClient, phoneForViewer, showsFullPhone,
  visibleClients,
} from "../../src/features/members/roster-visibility.js";

/**
 * 강사가 명부에서 무엇을 보는가.
 *
 * 규칙은 지금도 강사에게 센터 전체를 열어 준다. 여기서 고정하는 것은 **화면이
 * 먼저 보여 주지 않는다**는 것이고, 그 사실을 테스트 이름에도 남긴다 --
 * 다음 사람이 이것을 보안 경계로 읽으면 안 된다.
 */

const client = (id, name, phone) => ({ id, name, phone });
const pass = (clientId, instructorId, extra = {}) => ({ clientId, instructorId, ...extra });

/* ── 연락처 ──────────────────────────────────────────────────────────── */

test("강사에게는 뒤 4자리만 보인다", () => {
  assert.equal(phoneForViewer("010-1234-5678", "instructor"), "···5678");
  assert.equal(phoneForViewer("01012345678", "instructor"), "···5678");
});

test("대표 · FC매니저 · 직원은 지금처럼 전체를 본다", () => {
  for (const role of ["owner", "manager", "staff"]) {
    assert.equal(showsFullPhone(role), true, role);
    assert.equal(phoneForViewer("010-1234-5678", role), "01012345678", role);
  }
  assert.equal(showsFullPhone("instructor"), false);
});

test("전체를 보는 역할에는 서식을 맡길 수 있다", () => {
  const dashed = (digits) => `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  assert.equal(phoneForViewer("01012345678", "owner", { full: dashed }), "010-1234-5678");
  // 강사에게는 서식이 적용되지 않는다. 자를 것은 자른다.
  assert.equal(phoneForViewer("01012345678", "instructor", { full: dashed }), "···5678");
});

test("번호가 없거나 너무 짧으면 지어내지 않는다", () => {
  assert.equal(phoneForViewer("", "instructor"), "");
  assert.equal(phoneForViewer(null, "owner"), "");
  assert.equal(phoneForViewer("12", "instructor"), "···");
});

test("모르는 역할은 좁은 쪽으로 간다", () => {
  /* 역할이 비었거나 새 역할이 생겼을 때, 기본이 "전체 공개" 이면 그 실수는
     조용히 지나간다. 기본은 가리는 쪽이다. */
  for (const role of ["", null, "member", "새역할"]) {
    assert.equal(showsFullPhone(role), false, String(role));
    assert.equal(canBrowseAllClients(role), false, String(role));
  }
});

/* ── 내 회원 ─────────────────────────────────────────────────────────── */

test("담당은 회원권에서 온다 — 회원 문서에는 없다", () => {
  const passes = [pass("client-a", "u1"), pass("client-b", "u2")];
  assert.equal(isMyClient(passes, "client-a", "u1"), true);
  assert.equal(isMyClient(passes, "client-b", "u1"), false);
  assert.equal(isMyClient(passes, "client-a", ""), false);
});

test("듀엣이면 짝도 내 회원이다", () => {
  /* 회원권 하나에 두 사람이고 담당은 하나다. 짝을 남으로 보면 그 사람만
     화면에서 사라진다. */
  const passes = [pass("client-a", "u1", { clientIds: ["client-a", "client-b"] })];
  assert.equal(isMyClient(passes, "client-b", "u1"), true);
});

/* ── 목록과 검색 ─────────────────────────────────────────────────────── */

const ROSTER = [
  client("c1", "김하나", "01011112222"),
  client("c2", "박서연", "01033334444"),
  client("c3", "이수민", "01055556666"),
];
const PASSES = [pass("c1", "u1"), pass("c2", "u2"), pass("c3", "u2")];

test("강사는 기본으로 내 회원만 본다", () => {
  const shown = visibleClients({ clients: ROSTER, passes: PASSES, instructorId: "u1", query: "" });
  assert.deepEqual(shown.map((item) => item.id), ["c1"]);
});

test("한 글자 검색으로 남의 회원을 훑지 못한다", () => {
  /* 한 글자에 스무 명이 나오면 그것은 명부를 여는 것과 같다. */
  const shown = visibleClients({ clients: ROSTER, passes: PASSES, instructorId: "u1", query: "이" });
  assert.deepEqual(shown.map((item) => item.id), []);
});

test("대타 — 이름을 전부 치면 남의 회원도 나온다", () => {
  /* 길을 닫지는 않는다. 대타로 들어간 강사가 차감을 못 하면 그 회차는
     아무에게도 지급되지 않는다. */
  const shown = visibleClients({ clients: ROSTER, passes: PASSES, instructorId: "u1", query: "이수민" });
  assert.deepEqual(shown.map((item) => item.id), ["c3"]);
});

test("내 회원은 부분 일치로 찾는다", () => {
  const shown = visibleClients({ clients: ROSTER, passes: PASSES, instructorId: "u1", query: "하나" });
  assert.deepEqual(shown.map((item) => item.id), ["c1"]);
});

test("같은 사람이 두 번 나오지 않는다", () => {
  // 내 회원의 이름을 전부 쳐도 한 번만.
  const shown = visibleClients({ clients: ROSTER, passes: PASSES, instructorId: "u1", query: "김하나" });
  assert.deepEqual(shown.map((item) => item.id), ["c1"]);
});

test("대표 · FC매니저의 목록은 좁아지지 않는다", () => {
  const all = visibleClients({ clients: ROSTER, passes: PASSES, instructorId: "u1", query: "", browseAll: true });
  assert.equal(all.length, 3);
  const some = visibleClients({ clients: ROSTER, passes: PASSES, instructorId: "u1", query: "이", browseAll: true });
  assert.deepEqual(some.map((item) => item.id), ["c3"]);
});

test("이름 전체 일치는 앞뒤 공백을 지운 뒤에 본다", () => {
  assert.deepEqual(exactNameMatches(ROSTER, "  이수민  ").map((item) => item.id), ["c3"]);
  assert.deepEqual(exactNameMatches(ROSTER, "수민"), []);
  assert.deepEqual(exactNameMatches(ROSTER, ""), []);
});
