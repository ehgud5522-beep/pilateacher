/**
 * 보관된 빈 회원 삭제 · 연락처 수정 실패 문구 (2026-11-19).
 * 서버 코드 → 문구가 한 줄로 이어지는지, 화면이 겉 코드(functions/…)가 아니라 details.code 를 읽는지.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientDeleteMessage, serverCodeOf } from "../../src/features/members/client-delete-view.js";
import { phoneEditMessage } from "../../src/features/members/phone-edit.js";

test("callable 오류에서는 details.code 가 먼저다", () => {
  const thrown = { code: "functions/invalid-argument", details: { code: "phone_duplicate", clientName: "정미혜" } };
  assert.equal(serverCodeOf(thrown), "phone_duplicate");
  assert.equal(phoneEditMessage({ code: serverCodeOf(thrown), clientName: thrown.details.clientName }),
    "이미 정미혜 회원 번호예요 — 같은 분이면 회원 합치기가 필요합니다.");
  // details 가 없으면 겉 코드라도 보여 준다 (코드 없는 문구 금지).
  assert.equal(serverCodeOf({ code: "functions/internal" }), "functions/internal");
  assert.equal(serverCodeOf(null), "");
});

test("삭제 실패 문구: 무엇이 남아 있는지 말하고, 모르는 코드는 코드째", () => {
  assert.equal(clientDeleteMessage({ code: "client_delete_has_history", kinds: ["pass", "lesson_note"] }),
    "지울 수 없어요 — 남아 있는 것: 회원권 · 회원에게 보낸 말. 같은 분이면 회원 합치기가 필요합니다.");
  assert.equal(clientDeleteMessage({ code: "client_delete_not_archived" }), "보관된 회원만 지울 수 있어요. 먼저 보관해 주세요.");
  assert.equal(clientDeleteMessage({ code: "client_delete_not_allowed" }), "대표 · 총괄매니저만 지울 수 있어요.");
  assert.match(clientDeleteMessage({ code: "client_delete_unavailable" }), /다시 시도/);
  assert.equal(clientDeleteMessage({ code: "weird" }), "지우지 못했어요 (코드 weird)");
  assert.equal(clientDeleteMessage({}), "지우지 못했어요 (코드 unknown)");
});

test("배선: 연락처 수정은 serverCodeOf, 삭제 버튼은 보관된 회원 + 대표급 + 통로가 있을 때만", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /code: serverCodeOf\(thrown\),\r?\n\s+clientName: thrown\?\.details\?\.clientName/);
  assert.doesNotMatch(app, /code: thrown\?\.code \|\| thrown\?\.details\?\.code/);
  assert.match(app, /isArchivedClient\(client\) && canUndo && typeof onDeleteClient === "function" \? \(\s*<button type="button" data-client-delete/);
  assert.match(app, /onDeleteClient=\{fbDeleteArchivedClient\}/);
  const lib = readFileSync(new URL("../../src/lib/firebase.js", import.meta.url), "utf8");
  assert.match(lib, /fbDeleteArchivedClient = callableAsOwner\("deleteArchivedClient"\)/);
  const server = readFileSync(new URL("../../functions/src/index.js", import.meta.url), "utf8");
  assert.match(server, /exports\.deleteArchivedClient = onCall\(/);
});
