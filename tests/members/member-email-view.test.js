/**
 * 강사 관리: 같은 이름의 계정을 이메일로 가린다 (2026-11-19 대표).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { accountLabel, emailsFailure, sameNameMembers } from "../../src/features/members/member-email-view.js";

const members = [
  { userId: "u-old", displayName: "박서연", status: "ended" },
  { userId: "u-new", displayName: "박서연", status: "active" },
  { userId: "u-kim", displayName: "김하나", status: "active" },
];
const emails = { "u-old": "seoyeon@naver.com", "u-new": "seoyeon.park@gmail.com" };

test("계정 한 줄: 이름 · 이메일, 이메일을 모르면 이름만", () => {
  assert.equal(accountLabel(members[0], emails), "박서연 · seoyeon@naver.com");
  assert.equal(accountLabel(members[2], emails), "김하나");
  assert.equal(accountLabel({ userId: "u-x" }, {}), "u-x");
});

test("같은 이름: 재직 · 퇴사 모두, 자기 자신은 빼고", () => {
  assert.deepEqual(sameNameMembers(members, " 박서연 ").map((m) => m.userId), ["u-old", "u-new"]);
  assert.deepEqual(sameNameMembers(members, "박서연", "u-new").map((m) => m.userId), ["u-old"]);
  assert.deepEqual(sameNameMembers(members, ""), []);
});

test("이메일 못 읽음은 코드와 함께 (서버 코드가 먼저)", () => {
  assert.equal(emailsFailure({ code: "functions/permission-denied", details: { code: "not_owner" } }), "이메일을 불러오지 못했어요 (코드 not_owner)");
  assert.equal(emailsFailure(null), "이메일을 불러오지 못했어요 (코드 unknown)");
});

test("배선: 교체 · 목록 · 추가가 이메일을 쓴다", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /<option key=\{item\.userId\} value=\{item\.userId\}>\{accountLabel\(item, emails\)\}<\/option>/);
  assert.match(app, /<b>\{accountLabel\(from, emails\)\}<\/b> 계정을 새 계정으로 넘깁니다/);
  assert.equal(app.match(/email=\{emails\[membership\.userId\] \|\| ""\}/g)?.length, 3);
  assert.match(app, /sameNameMembers\(members, draft\.displayName\)\.map/);
  assert.match(app, /isOwnerLevelRole\(organization\?\.role\) && typeof listEmails === "function"/);
  assert.match(app, /\{emailsError \? /);
  const lib = readFileSync(new URL("../../src/lib/firebase.js", import.meta.url), "utf8");
  assert.ok(lib.indexOf("const callableAsOwner") < lib.indexOf('fbListCentreMemberEmails = callableAsOwner("listCentreMemberEmails")'));
  const server = readFileSync(new URL("../../functions/src/index.js", import.meta.url), "utf8");
  assert.match(server, /exports\.listCentreMemberEmails = onCall\(/);
});

test("강사 관리 상태: 교체된 옛 계정은 영어가 아니라 '계정 교체됨'", async () => {
  const { MEMBERSHIP_STATUS_LABELS } = await import("../../src/data/schema/display-names.js");
  const { MEMBERSHIP_SWAPPED } = await import("../../functions/shared/instructor-swap.mjs");
  assert.equal(MEMBERSHIP_STATUS_LABELS[MEMBERSHIP_SWAPPED], "계정 교체됨");
});
