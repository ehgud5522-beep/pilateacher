import assert from "node:assert/strict";
import test from "node:test";

import {
  MEMBERSHIP_SWAPPED, SWAP_ERROR, SWAP_ERROR_LABEL,
  alreadySwapped, canonicalInstructorIdFrom, instructorIdsOf, mergeTotals,
  previousUidsOf, swapError, swappedMembershipPatch,
} from "../../functions/shared/instructor-swap.mjs";

/**
 * 강사 계정 교체.
 *
 * 이 파일이 지키는 것은 셋이다.
 *
 * 하나. **원장은 움직이지 않는다.** 옛 uid 로 박힌 차감은 그대로 두고, 세는
 * 쪽이 둘을 한 사람으로 본다 (canonicalInstructorIdFrom).
 *
 * 둘. **누적은 더한다.** 덮어쓰면 한쪽의 횟수가 사라지고, 그 숫자는 급여
 * 판정 3(누적 20회 미만)을 직접 움직인다.
 *
 * 셋. **두 번 눌러도 같다.** 대표가 한 번 더 누르는 일은 반드시 생긴다.
 */

const membership = (overrides = {}) => ({
  organizationId: "bonita",
  userId: "uid-old",
  role: "instructor",
  status: "active",
  displayName: "",
  ...overrides,
});

/* ── 막는 것 ─────────────────────────────────────────────────────────────── */

test("the two accounts must be two, in one centre, and the new one active", () => {
  const from = membership();
  assert.equal(swapError({ from, to: membership({ userId: "uid-new" }) }), "");

  assert.equal(swapError({ from, to: membership({ userId: "uid-old" }) }), SWAP_ERROR.SAME_UID);
  assert.equal(swapError({ from: null, to: membership({ userId: "uid-new" }) }), SWAP_ERROR.FROM_MISSING);
  assert.equal(swapError({ from, to: null }), SWAP_ERROR.TO_MISSING);
  assert.equal(
    swapError({ from, to: membership({ userId: "uid-new", organizationId: "other" }) }),
    SWAP_ERROR.DIFFERENT_ORG,
  );
  assert.equal(
    swapError({ from, to: membership({ userId: "uid-new", status: "revoked" }) }),
    SWAP_ERROR.TO_NOT_ACTIVE,
  );
});

test("the owner account is not swapped through here", () => {
  /* 규칙이 owner 를 앱에서 세우지 못하게 해 두었다 (memberships create).
     여기로 열면 그 선이 뒤로 뚫린다. */
  assert.equal(
    swapError({ from: membership({ role: "owner" }), to: membership({ userId: "uid-new" }) }),
    SWAP_ERROR.FROM_IS_OWNER,
  );
  assert.equal(
    swapError({ from: membership(), to: membership({ userId: "uid-new", role: "owner" }) }),
    SWAP_ERROR.FROM_IS_OWNER,
  );
});

test("an account that already took over someone else is refused", () => {
  /* 두 사람의 원장이 한 줄로 합쳐지면 그것을 가르는 길이 없다. */
  const to = membership({ userId: "uid-new", previousUids: ["uid-someone-else"] });
  assert.equal(swapError({ from: membership(), to }), SWAP_ERROR.TO_ALREADY_SWAPPED);

  // 같은 사람을 다시 누르는 것은 막지 않는다 -- 두 번 눌러도 같아야 한다.
  const again = membership({ userId: "uid-new", previousUids: ["uid-old"] });
  assert.equal(swapError({ from: membership(), to: again }), "");
});

test("every refusal says what to fix", () => {
  for (const code of Object.values(SWAP_ERROR)) {
    assert.equal(typeof SWAP_ERROR_LABEL[code], "string", code);
    assert.ok(SWAP_ERROR_LABEL[code].length > 0, code);
  }
});

/* ── 한 사람으로 세기 ────────────────────────────────────────────────────── */

test("the old uid resolves to the new one, and unknown uids stay themselves", () => {
  /* 급여와 누적이 이것으로 합친다. 소속 문서가 지워진 옛 계정의 원장도 줄로는
     서야 하고, 그때는 uid 가 곧 이름이다. */
  const canonical = canonicalInstructorIdFrom([
    membership({ userId: "uid-new", previousUids: ["uid-old"] }),
    membership({ userId: "uid-other" }),
  ]);

  assert.equal(canonical("uid-old"), "uid-new");
  assert.equal(canonical("uid-new"), "uid-new");
  assert.equal(canonical("uid-other"), "uid-other");
  assert.equal(canonical("uid-nobody"), "uid-nobody");
  assert.equal(canonical(""), "");
});

test("a second swap keeps the first one", () => {
  /* 애플 → gmail → 회사 메일. 앞의 것이 떨어지면 그 기간의 급여가 다시
     흩어진다. */
  const first = swappedMembershipPatch(membership({ userId: "uid-apple" }), membership({ userId: "uid-gmail" }));
  assert.deepEqual(first.previousUids, ["uid-apple"]);

  const second = swappedMembershipPatch(
    membership({ userId: "uid-gmail", previousUids: ["uid-apple"] }),
    membership({ userId: "uid-work" }),
  );
  assert.deepEqual(second.previousUids.sort(), ["uid-apple", "uid-gmail"]);

  const canonical = canonicalInstructorIdFrom([
    membership({ userId: "uid-work", previousUids: second.previousUids }),
  ]);
  assert.equal(canonical("uid-apple"), "uid-work", "첫 계정도 끝까지 따라온다");
  assert.equal(canonical("uid-gmail"), "uid-work");
});

test("a membership never lists itself as a previous uid", () => {
  /* 자기 자신이 들어가면 canonical 이 자기를 가리켜 무한히 맴돈다. */
  const patch = swappedMembershipPatch(
    membership({ userId: "uid-old", previousUids: ["uid-new"] }),
    membership({ userId: "uid-new" }),
  );
  assert.equal(patch.previousUids.includes("uid-new"), false);
  assert.deepEqual(patch.previousUids, ["uid-old"]);
});

test("instructorIdsOf puts the live uid first and drops duplicates", () => {
  assert.deepEqual(
    instructorIdsOf(membership({ userId: "uid-new", previousUids: ["uid-old", "uid-old", "uid-new"] })),
    ["uid-new", "uid-old"],
  );
  assert.deepEqual(previousUidsOf({ previousUids: ["a", "", null, "b"] }), ["a", "b"]);
  assert.deepEqual(previousUidsOf({}), []);
});

/* ── 넘겨받는 설정 ───────────────────────────────────────────────────────── */

test("the pay-moving settings come across only where the new account is empty", () => {
  /* 대표가 추가하면서 직접 넣었을 수 있다. 옛 값으로 덮으면 방금 정한 것이
     조용히 되돌아간다. */
  const from = membership({ title: "branch_manager", fullRoomRate: 90000, isDeputyDirector: true, locationId: "bansong" });

  const empty = swappedMembershipPatch(from, membership({ userId: "uid-new" }));
  assert.equal(empty.title, "branch_manager");
  assert.equal(empty.fullRoomRate, 90000);
  assert.equal(empty.isDeputyDirector, true);
  assert.equal(empty.locationId, "bansong");

  const filled = swappedMembershipPatch(from, membership({
    userId: "uid-new", title: "team_lead", fullRoomRate: 70000, locationId: "yulha",
  }));
  assert.equal("title" in filled, false, "이미 정한 직급은 그대로");
  assert.equal("fullRoomRate" in filled, false);
  assert.equal("locationId" in filled, false);
});

/* ── 누적 ────────────────────────────────────────────────────────────────── */

test("totals are added, never overwritten", () => {
  /* 두 계정이 같은 회원을 맡은 적이 있으면 문서가 둘이다. 그 숫자는 급여
     판정 3(누적 20회 미만)을 직접 움직인다. */
  assert.equal(mergeTotals({ sessions: 12 }, { sessions: 7 }), 19);
  assert.equal(mergeTotals({ sessions: 12 }, null), 12);
  assert.equal(mergeTotals(null, { sessions: 7 }), 7);
  assert.equal(mergeTotals({ sessions: "열둘" }, { sessions: 7 }), 7, "못 읽는 값은 0 으로");
});

/* ── 두 번 눌러도 같다 ───────────────────────────────────────────────────── */

test("a finished swap is recognised, so pressing again changes nothing", () => {
  const from = membership({ userId: "uid-old", status: MEMBERSHIP_SWAPPED });
  const to = membership({ userId: "uid-new", previousUids: ["uid-old"] });
  assert.equal(alreadySwapped({ from, to }), true);

  // 아직 안 끝난 것은 끝난 것으로 보지 않는다.
  assert.equal(alreadySwapped({ from: membership(), to }), false);
  assert.equal(alreadySwapped({ from, to: membership({ userId: "uid-new" }) }), false);
});

test("the swapped marker is not the revoked one", () => {
  /* 퇴사로 두면 강사 목록에서 "나간 사람" 으로 읽히고, 대표는 그 사람이 아직
     다니는데 왜 나간 것으로 되어 있는지 매번 다시 묻는다. */
  assert.equal(MEMBERSHIP_SWAPPED, "swapped");
  assert.notEqual(MEMBERSHIP_SWAPPED, "revoked");
});
