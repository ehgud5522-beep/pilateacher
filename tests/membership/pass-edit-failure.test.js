/**
 * 회원권 수정 실패: 코드 → 문구가 한 줄로 이어지는지 (CLAUDE.md §8).
 *
 * FC매니저가 잔여를 늘리려다 막힌 것은 "권한이 없어요" 가 아니라 "증가는
 * 대표·총괄매니저만" 이라고 말해야 한다 -- 앱이 먼저 막든(increase_owner_only)
 * 규칙이 막든(permission-denied) 같은 뜻이다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ADJUST_INCREASE_NOTICE, OUT_OF_SCOPE_NOTICE, passEditFailure,
} from "../../src/features/membership/pass-edit-failure.js";

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

/* FC매니저는 맡은 지점의 회원권만 (2026-11-15). 규칙의 거절은 이유를 말하지 않으므로 FC매니저의
   방향 탓 아닌 permission-denied 는 지점 안내로, 서버(홀딩)는 원본 코드 pass_out_of_scope 로 온다. */
test("FC매니저의 지점 밖 거절은 지점 안내 + 원본 코드", () => {
  assert.equal(passEditFailure({ code: "permission-denied" }, { direction: "decrease", role: "manager" }),
    `${OUT_OF_SCOPE_NOTICE} (코드 permission-denied)`);
  assert.equal(passEditFailure({ code: "functions/permission-denied", details: { code: "pass_out_of_scope" } }),
    `${OUT_OF_SCOPE_NOTICE} (코드 pass_out_of_scope)`);
  // 증가 거절은 여전히 방향 문구가 먼저다.
  assert.equal(passEditFailure({ code: "permission-denied" }, { direction: "increase", role: "manager" }),
    `${ADJUST_INCREASE_NOTICE} (코드 permission-denied)`);
});

test("앱 판정 managerCanTouchPass 는 규칙 · 서버와 같은 선", async () => {
  const { managerCanTouchPass } = await import("../../src/data/repositories/location-repository.js");
  const fc = (scope) => ({ role: "manager", ...scope });
  assert.equal(managerCanTouchPass(fc({ locationIds: ["a"] }), { locationId: "a" }), true);
  assert.equal(managerCanTouchPass(fc({ locationIds: ["b"] }), { locationId: "a" }), false);
  assert.equal(managerCanTouchPass(fc({ locationId: "b" }), { locationId: "a" }), false, "옛 한 칸");
  assert.equal(managerCanTouchPass(fc({}), { locationId: "a" }), true, "FC 지점 없음");
  assert.equal(managerCanTouchPass(fc({ locationIds: ["b"] }), { locationId: "" }), true, "회원권 지점 없음");
  for (const role of ["owner", "area_manager", "instructor"]) {
    assert.equal(managerCanTouchPass({ role, locationIds: ["b"] }, { locationId: "a" }), true, role);
  }
});

test("회원 상세: FC매니저에게 다른 지점 회원권의 고치기 버튼을 세우지 않는다", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /const touchable = \(pass\) => managerCanTouchPass\(organization, pass\);/);
  for (const handler of ["onCancel={touchable(pass)", "onTransfer={canSessionUp && touchable(pass)", "onSessionUp={canSessionUp && touchable(pass)",
    "onAdjust={canAdjust && touchable(pass)", "onExpiry={canChangeExpiry && touchable(pass)", "onHandover={onHandover && touchable(pass)"]) {
    assert.ok(source.includes(handler), handler);
  }
});
