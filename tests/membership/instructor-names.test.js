import assert from "node:assert/strict";
import test from "node:test";

import {
  DISPLAY_NAME_BY_OWNER, NAME_SKIP, nameConfirmationPatch, planNameConfirmation,
} from "../../functions/shared/instructor-names.mjs";

/**
 * 강사 이름 확정 — 한 번 쓰는 통로.
 *
 * 2026-10-10 까지 강사 앱이 열릴 때마다 로그인 계정 이름을 덮어썼다. 그 문을
 * 닫는 표시(displayNameBy)가 **이미 있는 소속에는 없고**, 붙는 길은 대표가
 * 한 사람씩 다시 저장하는 것뿐이었다. 열 명 중 하나를 빠뜨리면 그 사람만
 * 계속 되돌아가고, 왜 그 사람만인지는 화면 어디에도 없다.
 */

const membership = (overrides = {}) => ({
  organizationId: "bonita", userId: "u1", role: "instructor", status: "active",
  displayName: "최형인", ...overrides,
});

test("the mark is the one the rules read", () => {
  // 글자가 다르면 규칙이 그 표시를 못 알아보고, 이름은 계속 되돌아간다.
  assert.equal(DISPLAY_NAME_BY_OWNER, "owner");
  assert.deepEqual(nameConfirmationPatch(), { displayNameBy: "owner" });
});

test("the name itself is never touched", () => {
  /* 지금 적혀 있는 글자를 그대로 확정한다. 고르거나 추측하지 않는다 --
     되돌아간 이름이 있으면 그것이 굳지만, 그 판단은 대표의 것이다. */
  assert.equal("displayName" in nameConfirmationPatch(), false);
});

test("an unmarked active instructor is the one thing this fixes", () => {
  const { targets, skipped } = planNameConfirmation([membership()]);
  assert.deepEqual(targets, [{ userId: "u1", displayName: "최형인" }]);
  assert.deepEqual(skipped, []);
});

test("pressing twice changes nothing the second time", () => {
  /* 대표가 한 번 더 누르는 일은 반드시 생긴다. 이미 찍힌 것을 다시 세면
     "열 명 확정" 이 두 번 떠서 뭔가 또 일어난 것으로 읽힌다. */
  const { targets, skipped } = planNameConfirmation([
    membership({ displayNameBy: "owner" }),
  ]);
  assert.deepEqual(targets, []);
  assert.equal(skipped[0].reason, NAME_SKIP.ALREADY);
});

test("someone who left is not touched", () => {
  /* 앱을 열지 않으므로 되돌아갈 일이 없고, 지난 급여에 붙은 이름을 지금 와서
     굳힐 이유도 없다. */
  const { targets, skipped } = planNameConfirmation([membership({ status: "revoked" })]);
  assert.deepEqual(targets, []);
  assert.equal(skipped[0].reason, NAME_SKIP.NOT_ACTIVE);
});

test("a blank name is skipped, not frozen", () => {
  /* 빈 이름을 확정하면 목록이 uid 로 선 채로 굳는다 -- 로그인 동기화가 채울
     길만 막고 얻는 것이 없다. 그 사람은 강사 관리에서 이름을 넣는다. */
  for (const blank of ["", "   ", undefined]) {
    const { targets, skipped } = planNameConfirmation([membership({ displayName: blank })]);
    assert.deepEqual(targets, [], JSON.stringify(blank));
    assert.equal(skipped[0].reason, NAME_SKIP.NO_NAME);
  }
});

test("every skip says why, so a partial result is readable", () => {
  /* 건수만으로는 "열 명 중 셋만 찍혔다" 에 답할 수 없다. 이유가 셋 다 다르고,
     대표가 할 일도 셋 다 다르다. */
  const { targets, skipped } = planNameConfirmation([
    membership({ userId: "u1" }),
    membership({ userId: "u2", displayNameBy: "owner" }),
    membership({ userId: "u3", status: "revoked" }),
    membership({ userId: "u4", displayName: "" }),
  ]);
  assert.deepEqual(targets.map((item) => item.userId), ["u1"]);
  assert.deepEqual(
    skipped.map((item) => [item.userId, item.reason]).sort(),
    [["u2", NAME_SKIP.ALREADY], ["u3", NAME_SKIP.NOT_ACTIVE], ["u4", NAME_SKIP.NO_NAME]],
  );
});

test("a membership with no userId is not a membership", () => {
  // 가리킬 문서가 없다. 건너뛰었다고 세면 그 수가 무엇인지 아무도 모른다.
  const { targets, skipped } = planNameConfirmation([membership({ userId: "" }), null, undefined]);
  assert.deepEqual(targets, []);
  assert.deepEqual(skipped, []);
});

test("an unreadable list is an empty one, not a crash", () => {
  for (const bad of [null, undefined, "nope", 7]) {
    assert.deepEqual(planNameConfirmation(bad), { targets: [], skipped: [] }, JSON.stringify(bad));
  }
});
