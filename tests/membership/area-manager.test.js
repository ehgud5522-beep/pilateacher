import assert from "node:assert/strict";
import test from "node:test";

import {
  OWNER_LEVEL_ROLES, OWNER_ONLY, ROLES, isOwnerLevelRole,
} from "../../functions/shared/constants.mjs";
import { SWAP_ERROR, swapError } from "../../functions/shared/instructor-swap.mjs";
import { AUDIT_ACTION, AUDIT_FIELDS } from "../../src/data/repositories/audit-repository.js";
import { setMembershipRole } from "../../src/data/repositories/instructor-repository.js";
import { adjustPass, cancelPass } from "../../src/data/repositories/pass-repository.js";

/**
 * 총괄매니저.
 *
 * 2026-10-10 결정: **지점 경계 없이 대표와 같은 권한.** 대표만 남은 것은
 * 넷뿐이다 (OWNER_ONLY).
 *
 * 이 파일이 지키는 것은 "무엇을 할 수 있나" 가 아니라 **무엇을 못 하나**다.
 * 할 수 있는 쪽은 대표와 같은 함수를 지나므로 이미 다른 파일이 고정하고 있고,
 * 못 하는 쪽은 여기서만 드러난다.
 */

/* ── 역할 값 ──────────────────────────────────────────────────────────────── */

test("the role value is not the branch-manager title", () => {
  /* `branch_manager` 는 이미 **직함**(점장)이고 급여 판정이 그것을 본다
     (MEMBERSHIP_TITLE · deduction-pricing). 같은 글자를 역할로도 쓰면 둘 중
     하나는 언젠가 틀린 쪽을 읽는다. */
  assert.equal(ROLES.AREA_MANAGER, "area_manager");
  assert.notEqual(ROLES.AREA_MANAGER, "branch_manager");
});

test("owner level is exactly two roles, and nothing below sneaks in", () => {
  assert.deepEqual([...OWNER_LEVEL_ROLES], ["owner", "area_manager"]);
  assert.equal(isOwnerLevelRole(ROLES.OWNER), true);
  assert.equal(isOwnerLevelRole(ROLES.AREA_MANAGER), true);
  // FC매니저는 지시대로 지금 범위 그대로다. 옆줄이 함께 넓어지는 일이
  // 제일 조용히 일어난다.
  for (const role of [ROLES.MANAGER, ROLES.INSTRUCTOR, ROLES.STAFF, ROLES.MEMBER, "", null]) {
    assert.equal(isOwnerLevelRole(role), false, String(role));
  }
});

test("the four owner-only doors are named, so nobody has to remember them", () => {
  assert.deepEqual(Object.values(OWNER_ONLY).sort(), [
    "area_manager_role", "migration_reset", "owner_grant", "owner_membership",
  ]);
});

/* ── 계정 교체 ────────────────────────────────────────────────────────────── */

const membership = (overrides = {}) => ({
  organizationId: "bonita", userId: "uid-old", role: "instructor", status: "active", ...overrides,
});

test("an area manager cannot swap another area manager's login", () => {
  /* 교체는 그 사람의 로그인 계정을 통째로 바꾸는 일이다. 열어 두면 총괄매니저가
     다른 총괄매니저의 자리를 자기가 아는 계정으로 옮길 수 있다. */
  const from = membership({ role: "area_manager" });
  const to = membership({ userId: "uid-new" });

  assert.equal(swapError({ from, to, actorRole: "area_manager" }), SWAP_ERROR.ACTOR_BELOW_TARGET);
  assert.equal(swapError({ from, to, actorRole: "owner" }), "", "대표는 할 수 있다");

  // 받는 쪽이 총괄매니저인 경우도 같다.
  assert.equal(
    swapError({ from: membership(), to: membership({ userId: "uid-new", role: "area_manager" }), actorRole: "area_manager" }),
    SWAP_ERROR.ACTOR_BELOW_TARGET,
  );
});

test("an area manager swaps an ordinary instructor just as the owner does", () => {
  assert.equal(
    swapError({ from: membership(), to: membership({ userId: "uid-new" }), actorRole: "area_manager" }),
    "",
  );
});

test("the owner is still refused on either side, whoever presses", () => {
  // 대표 계정은 이 통로로 바꾸지 않는다. 그 선은 그대로다.
  for (const actorRole of ["owner", "area_manager"]) {
    assert.equal(
      swapError({ from: membership({ role: "owner" }), to: membership({ userId: "uid-new" }), actorRole }),
      SWAP_ERROR.FROM_IS_OWNER,
    );
  }
});

/* ── 지정 · 해제 ──────────────────────────────────────────────────────────── */

const recordingStore = () => {
  const writes = [];
  return {
    writes,
    serverTimestamp: async () => "SERVER_TIME",
    commit: async (items) => { writes.push(...items); },
  };
};

test("only the owner may appoint, and never themselves", async () => {
  /* 총괄매니저가 총괄매니저를 세울 수 있으면 대표가 모르는 사이에 그 자리가
     늘고, 되돌리는 문은 없다. 규칙도 막지만 여기서 먼저 막는다 -- 거부된
     쓰기는 permission-denied 한 줄로만 돌아온다. */
  await assert.rejects(() => setMembershipRole("bonita", "u1", {
    role: ROLES.AREA_MANAGER, changedBy: "owner-uid", actorRole: ROLES.AREA_MANAGER,
  }, { store: recordingStore() }));

  await assert.rejects(() => setMembershipRole("bonita", "owner-uid", {
    role: ROLES.AREA_MANAGER, changedBy: "owner-uid", actorRole: ROLES.OWNER,
  }, { store: recordingStore() }), "자기 자신은 아니다");

  await assert.rejects(() => setMembershipRole("bonita", "u1", {
    role: ROLES.OWNER, changedBy: "owner-uid", actorRole: ROLES.OWNER,
  }, { store: recordingStore() }), "대표는 앱에서 세우지 않는다");
});

test("appointing writes the role, the default location and one audit entry", async () => {
  const store = recordingStore();
  await setMembershipRole("bonita", "u1", {
    role: ROLES.AREA_MANAGER, locationId: "bansong",
    changedBy: "owner-uid", actorRole: ROLES.OWNER,
  }, { store });

  const [patch, audit] = store.writes;
  assert.deepEqual(patch.data, { role: "area_manager", locationId: "bansong" });
  assert.equal(patch.operation, "update");
  assert.equal(audit.data.action, AUDIT_ACTION.AREA_MANAGER_SET);
  assert.equal(audit.data.actorId, "owner-uid");
  assert.equal(audit.data.actorRole, ROLES.OWNER);
  assert.equal(audit.data.targetId, "u1");
  // 한 동작에 두 방향이 있다. 이 칸이 없으면 지정인지 해제인지 읽을 수 없다.
  assert.equal(audit.data.enabled, true);
});

test("releasing leaves the default location alone", async () => {
  /* 해제하면서 지점을 지우면 그 사람이 강사로 돌아간 뒤 어느 지점 소속인지가
     사라진다. 해제는 역할 하나만 되돌리는 일이다. */
  const store = recordingStore();
  await setMembershipRole("bonita", "u1", {
    role: ROLES.INSTRUCTOR, changedBy: "owner-uid", actorRole: ROLES.OWNER,
  }, { store });

  const [patch, audit] = store.writes;
  assert.deepEqual(patch.data, { role: "instructor" });
  assert.equal(audit.data.enabled, false);
  assert.equal("locationId" in audit.data, false);
});

test("the audit entry fits the closed field list the rules enforce", () => {
  /* 규칙의 hasOnly 와 어긋나면 그 기록이 통째로 거부되고, 거부는 조용하다 --
     역할은 바뀌었는데 누가 바꿨는지가 없는 상태가 남는다. */
  assert.ok(AUDIT_FIELDS.includes("enabled"));
  assert.ok(AUDIT_FIELDS.includes("targetId"));
  assert.ok(AUDIT_FIELDS.includes("locationId"));
  assert.equal(AUDIT_ACTION.AREA_MANAGER_SET, "area_manager_set");
});

/* ── 처리자의 역할이 원장에 남는다 ────────────────────────────────────────── */

const pass = (overrides = {}) => ({
  id: "pass-1", clientId: "c1", locationId: "bansong",
  remainingCount: 8, status: "active", ...overrides,
});

test("an adjustment records the role that pressed it", async () => {
  /* createdBy 는 uid 뿐이라, 반년 뒤 그 줄을 보는 사람은 누른 사람이 그때
     무엇이었는지 알 수 없다 -- 소속 문서는 지금 상태만 들고 있다. */
  const store = recordingStore();
  await adjustPass("bonita", pass(), {
    delta: 2, reason: "엑셀 이관에서 두 회차가 빠졌습니다",
    createdBy: "area-uid", actorRole: ROLES.AREA_MANAGER,
  }, { store });

  const entry = store.writes[0].data;
  assert.equal(entry.createdBy, "area-uid");
  assert.equal(entry.actorRole, "area_manager");
});

test("a cancellation records it too", async () => {
  const store = recordingStore();
  await cancelPass("bonita", pass(), {
    reason: "발급을 잘못 눌렀습니다", createdBy: "area-uid", actorRole: ROLES.AREA_MANAGER,
    entries: [{ type: "issue", delta: 8 }],
  }, { store });

  const entry = store.writes[0].data;
  assert.equal(entry.actorRole, "area_manager");
});

test("an entry written without a role carries no empty field", async () => {
  /* 규칙의 hasOnly 는 닫힌 목록이지만, 빈 문자열은 역할이 아니다 -- 적힌
     것처럼 보이면서 아무것도 말하지 않는 칸이 하나 생긴다. 옛 앱은 아예
     보내지 않고, 그 항목은 지금도 유효하다. */
  const store = recordingStore();
  await adjustPass("bonita", pass(), {
    delta: 1, reason: "회차 하나를 되돌립니다", createdBy: "owner-uid",
  }, { store });

  const entry = store.writes[0].data;
  assert.equal("actorRole" in entry, false);

  const blank = recordingStore();
  await adjustPass("bonita", pass(), {
    delta: 1, reason: "회차 하나를 되돌립니다", createdBy: "owner-uid", actorRole: "   ",
  }, { store: blank });
  assert.equal("actorRole" in blank.writes[0].data, false);
});
