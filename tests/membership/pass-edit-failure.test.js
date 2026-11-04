/**
 * 회원권 수정 실패: 코드 → 문구가 한 줄로 이어지는지 (CLAUDE.md §8).
 *
 * FC매니저가 잔여를 늘리려다 막힌 것은 "권한이 없어요" 가 아니라 "증가는
 * 대표·총괄매니저만" 이라고 말해야 한다 -- 앱이 먼저 막든(increase_owner_only)
 * 규칙이 막든(permission-denied) 같은 뜻이다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ADJUST_INCREASE_NOTICE, passEditFailure } from "../../src/features/membership/pass-edit-failure.js";

test("앱이 먼저 막은 증가는 누가 할 수 있는지 말하고 코드를 붙인다", () => {
  const text = passEditFailure({ code: "increase_owner_only", direction: "increase" });
  assert.match(text, /증가는 대표·총괄매니저만 가능해요/);
  assert.match(text, /코드 increase_owner_only/);
  assert.doesNotMatch(text, /권한이 없어요/);
});

test("규칙이 막은 FC매니저의 증가도 같은 말이고, 원본 코드가 남는다", () => {
  const text = passEditFailure({ code: "permission-denied" }, { direction: "increase", role: "manager" });
  assert.equal(text, `${ADJUST_INCREASE_NOTICE} (코드 permission-denied)`);
});

test("방향 탓이 아닌 권한 거부는 일반 문구다", () => {
  for (const context of [
    { direction: "decrease", role: "manager" },
    { direction: "increase", role: "owner" },
    { direction: "increase", role: "area_manager" },
    {},
  ]) {
    const text = passEditFailure({ code: "permission-denied" }, context);
    assert.match(text, /이 회원권을 고칠 권한이 없어요/, JSON.stringify(context));
    assert.match(text, /코드 permission-denied/);
  }
});

test("나머지 종류도 각자의 문구 · 모르는 것은 코드와 함께", () => {
  assert.match(passEditFailure({ code: "below_zero", remaining: 2 }), /지금 2회 남아/);
  assert.match(passEditFailure({ code: "role_not_allowed" }), /코드 role_not_allowed/);
  assert.match(passEditFailure({ code: "unavailable" }), /다시 시도해 주세요. \(코드 unavailable\)/);
  assert.equal(passEditFailure({}), "저장하지 못했어요. (코드 unknown)");
});
