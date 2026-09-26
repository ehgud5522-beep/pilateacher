/**
 * 누가 어느 회원을 보는가.
 *
 * 화면이 아니라 조회에 붙는 조건이다. 여기서 틀리면 명부가 열리거나, 강사
 * 화면이 이유 없이 빈다 -- 둘 다 조용히 일어난다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  FULL_SCOPE_ROLES,
  NO_CLIENTS,
  SCOPED_ROLES,
  clientScopeFor,
  isScopedToInstructor,
  unlinkedNotice,
} from "../../src/features/members/client-scope.js";
import { listClients } from "../../src/data/repositories/client-repository.js";

test("강사만 좁혀진다", () => {
  assert.deepEqual(clientScopeFor({ role: "instructor" }, "uid-a"), { instructorId: "uid-a" });
});

test("대표 · FC매니저 · 직원은 전체를 본다", () => {
  for (const role of FULL_SCOPE_ROLES) {
    assert.deepEqual(clientScopeFor({ role }, "uid-a"), { instructorId: "" }, role);
  }
});

test("미소속 개인 강사는 좁히지 않는다 — 조직도 담당도 없다", () => {
  assert.deepEqual(clientScopeFor({ role: "instructor", isLegacy: true }, "uid-a"), { instructorId: "" });
});

test("강사인데 uid 를 모르면 아무것도 보여 주지 않는다", () => {
  /* 여기서 전체를 돌려주면 로그인 정보를 못 읽은 순간이 명부를 여는 순간이
     된다. 빈 화면은 이상해 보이지만 새는 것보다 낫다. */
  assert.deepEqual(clientScopeFor({ role: "instructor" }, ""), { instructorId: NO_CLIENTS });
  assert.notEqual(NO_CLIENTS, "", "빈 문자열이면 전체 조회가 된다");
});

test("역할을 못 읽으면 전체다 — 대표가 화면을 잃지 않게", () => {
  /* 소속을 못 읽은 상태는 강사가 아니라 "모름" 이다. 이때 좁히면 대표의
     화면이 비고, 대표는 그것을 고칠 자리에 있지 않다. 규칙이 뒤에서 막는다. */
  assert.deepEqual(clientScopeFor({ role: "" }, "uid-a"), { instructorId: "" });
  assert.deepEqual(clientScopeFor(null, "uid-a"), { instructorId: "" });
});

test("좁혀졌는지 한 줄로 안다", () => {
  assert.equal(isScopedToInstructor({ instructorId: "uid-a" }), true);
  assert.equal(isScopedToInstructor({ instructorId: "" }), false);
});

test("좁혀지는 역할과 전체를 보는 역할이 겹치지 않는다", () => {
  /* 겹치면 그 역할은 순서에 따라 답이 달라진다. */
  for (const role of SCOPED_ROLES) {
    assert.equal(FULL_SCOPE_ROLES.includes(role), false, role);
  }
});

test("조회는 instructorId 를 그대로 서버에 넘긴다", async () => {
  /* 기기에서 거르는 것이 아니라 애초에 안 내려온다. 이 한 줄이 그 차이다. */
  const seen = [];
  await listClients("org", {
    instructorId: "uid-a",
    store: {
      list: async (path, options) => { seen.push({ path, options }); return []; },
    },
  });
  assert.equal(seen[0].options.instructorId, "uid-a");
  assert.match(seen[0].path, /clients$/);
});

test("전체 조회에는 조건이 붙지 않는다", async () => {
  const seen = [];
  await listClients("org", {
    store: { list: async (path, options) => { seen.push(options); return []; } },
  });
  assert.equal(seen[0].instructorId, "");
});

test("강사에게는 '센터에 없다' 고 말하지 않는다", () => {
  /* 담당 회원만 내려오므로 안 맞은 줄이 둘 중 무엇인지 기기가 알 수 없다 --
     센터에 정말 없는 회원이거나, 있지만 내 담당이 아닌 회원이다. 모르는 것을
     단정하면 강사는 이미 있는 회원을 다시 등록한다. */
  const scoped = unlinkedNotice({ scoped: true, count: 3 });
  assert.match(scoped.title, /내 담당 명부에 없는 회원 3명/);
  assert.doesNotMatch(scoped.title, /센터에 등록되지 않은/);
  assert.match(scoped.body, /다른 강사가 담당이거나/);
  assert.match(scoped.body, /새로 등록하지 마시고/);
});

test("대표에게는 전체가 내려오므로 그때만 '센터에 없다' 가 참이다", () => {
  const full = unlinkedNotice({ scoped: false, count: 1 });
  assert.match(full.title, /센터에 등록되지 않은 회원 1명/);
  assert.doesNotMatch(full.title, /내 담당 명부에 없는/);
});

test("어느 쪽이든 기록과 사진은 남는다고 말한다", () => {
  /* 이 한 줄이 빠지면 강사는 목록에서 사라진 회원의 기록도 사라졌다고 읽는다. */
  for (const scoped of [true, false]) {
    assert.match(unlinkedNotice({ scoped, count: 1 }).body, /기록과 사진은 그대로 남아 있습니다/);
  }
});
