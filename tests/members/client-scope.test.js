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
