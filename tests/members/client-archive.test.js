/**
 * 회원 이름 수정 · 보관 (2026-11-04). 지우지 않는다 -- client-archive.js 머리말.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CLIENT_EDIT_ERROR, CLIENT_NAME_MAX, archiveBlock, clientEditMessage, isArchivedClient,
  onlyArchived, validateClientName, withoutArchived,
} from "../../src/features/members/client-archive.js";
import { renameClient, setClientArchived } from "../../src/data/repositories/client-repository.js";
import { mergeRoster } from "../../src/features/roster/roster-bridge.js";

const NOW = new Date(2026, 10, 4, 12, 0);
const LATER = new Date(2027, 0, 1);
const pass = (overrides = {}) => ({
  id: "p1", clientId: "c1", status: "active", remainingCount: 3, expiresAt: LATER, ...overrides,
});

test("보관할 수 있는 회원: 쓸 수 있는 회원권이 하나도 없을 때만", () => {
  const client = { id: "c1" };
  assert.equal(archiveBlock(client, [pass()], NOW), CLIENT_EDIT_ERROR.ACTIVE_PASS);
  assert.equal(archiveBlock(client, [pass({ remainingCount: 0 })], NOW), null, "다 쓴 회원권");
  assert.equal(archiveBlock(client, [pass({ expiresAt: new Date(2026, 5, 1) })], NOW), null, "만료된 회원권");
  assert.equal(archiveBlock(client, [pass({ status: "cancelled" })], NOW), null, "취소된 회원권");
  assert.equal(archiveBlock(client, [], NOW), null, "회원권 없음");
  assert.equal(archiveBlock({ id: "c1", archived: true }, [], NOW), CLIENT_EDIT_ERROR.ALREADY_ARCHIVED);
});

test("듀엣: 짝이 쓰는 회원권에 들어 있으면 보관하지 않는다", () => {
  const duet = pass({ clientId: "partner", clientIds: ["partner", "c1"] });
  assert.equal(archiveBlock({ id: "c1" }, [duet], NOW), CLIENT_EDIT_ERROR.ACTIVE_PASS);
  // 남의 회원권(이 회원이 안 든)은 상관없다.
  assert.equal(archiveBlock({ id: "c1" }, [pass({ clientId: "someone" })], NOW), null);
});

test("목록 거르기: 보관된 회원만 빠지고, 보관 묶음에는 그 회원만", () => {
  const list = [{ id: "a" }, { id: "b", archived: true }, { id: "c", archived: false }];
  assert.deepEqual(withoutArchived(list).map((item) => item.id), ["a", "c"]);
  assert.deepEqual(onlyArchived(list).map((item) => item.id), ["b"]);
  assert.equal(isArchivedClient({ archived: "true" }), false, "문자열은 보관이 아니다");
});

test("회원 탭 명부: 보관된 회원은 빠지되 기기 회원과는 맞춘다 (센터 미등록으로 떨어지지 않게)", () => {
  const result = mergeRoster({
    clients: [
      { id: "c1", name: "가", phone: "01011112222", status: "active" },
      { id: "c2", name: "나", phone: "01033334444", status: "ended", archived: true },
    ],
    members: [{ id: "m2", name: "나", phone: "01033334444" }],
    passes: [],
    now: NOW,
  });
  assert.deepEqual(result.roster.map((member) => member.orgClientId), ["c1"]);
  assert.equal(result.unlinkedLocal.length, 0, "보관된 회원의 기기 기록이 미등록으로 보이면 안 된다");
  assert.equal(result.archivedCount, 1);
  assert.equal(result.hiddenCount, 0, "보관은 '숨긴 회원' 이 아니다");
});

test("이름 검사: 비어 있음 · 너무 김 · 그대로 · 공백 정리", () => {
  assert.deepEqual(validateClientName("  ", { current: "가" }), { ok: false, code: "name_empty" });
  assert.deepEqual(validateClientName("가".repeat(CLIENT_NAME_MAX + 1)), { ok: false, code: "name_too_long" });
  assert.deepEqual(validateClientName(" 가 ", { current: "가" }), { ok: false, code: "name_unchanged" });
  assert.deepEqual(validateClientName("  새 이름 ", { current: "가" }), { ok: true, name: "새 이름" });
});

test("문구: 코드가 언제나 붙는다", () => {
  assert.match(clientEditMessage({ code: "active_pass" }), /보관할 수 없어요.*코드 active_pass/);
  assert.match(clientEditMessage({ code: "permission-denied" }), /권한이 없어요.*코드 permission-denied/);
  assert.match(clientEditMessage({ code: "unavailable" }), /다시 시도.*코드 unavailable/);
  assert.equal(clientEditMessage({}), "저장하지 못했어요. (코드 unknown)");
});

function memoryStore() {
  const writes = [];
  return { writes, commit: async (list) => { writes.push(...list); }, serverTimestamp: async () => "SERVER_TIME" };
}

test("이름 수정: 이름 한 칸 update + 감사 기록을 한 배치로, 기록에 이름은 없다", async () => {
  const store = memoryStore();
  const result = await renameClient("org-a", { id: "c1", name: "가", locationId: "loc" }, {
    name: " 새 이름 ", actorId: "u-owner", actorRole: "owner",
  }, { store, stamp: () => "1" });
  assert.equal(result.name, "새 이름");
  assert.equal(store.writes.length, 2);
  const [clientWrite, audit] = store.writes;
  assert.equal(clientWrite.operation, "update");
  assert.deepEqual(clientWrite.data, { name: "새 이름" });
  assert.match(clientWrite.path, /organizations\/org-a\/clients\/c1$/);
  assert.equal(audit.data.action, "client_renamed");
  assert.equal(audit.data.clientId, "c1");
  assert.ok(!JSON.stringify(audit.data).includes("새 이름") && !JSON.stringify(audit.data).includes("가\""), "이름은 기록에 없다");
  await assert.rejects(renameClient("org-a", { id: "c1", name: "가" }, { name: "가", actorId: "u", actorRole: "owner" }, { store }),
    (error) => error.code === "name_unchanged");
});

test("보관 · 되살림: 회원권이 남았으면 쓰지 않고, 방향이 기록에 남는다", async () => {
  const store = memoryStore();
  await assert.rejects(
    setClientArchived("org-a", { id: "c1" }, true, { actorId: "u", actorRole: "manager", passes: [pass()], now: NOW }, { store }),
    (error) => error.code === "active_pass",
  );
  assert.equal(store.writes.length, 0, "막히면 아무것도 쓰지 않는다");

  await setClientArchived("org-a", { id: "c1" }, true, { actorId: "u", actorRole: "manager", passes: [], now: NOW }, { store, stamp: () => "1" });
  assert.deepEqual(store.writes[0].data, { archived: true, archivedAt: "SERVER_TIME", archivedBy: "u" });
  assert.equal(store.writes[1].data.action, "client_archived");
  assert.equal(store.writes[1].data.enabled, true);

  await setClientArchived("org-a", { id: "c1", archived: true }, false, { actorId: "u", actorRole: "owner" }, { store, stamp: () => "2" });
  assert.deepEqual(store.writes[2].data, { archived: false, archivedAt: null, archivedBy: null });
  assert.equal(store.writes[3].data.enabled, false);
  assert.notEqual(store.writes[1].path, store.writes[3].path, "보관과 되살림은 다른 기록");

  await assert.rejects(
    setClientArchived("org-a", { id: "c1" }, false, { actorId: "u", actorRole: "owner" }, { store }),
    (error) => error.code === "not_archived",
  );
});
