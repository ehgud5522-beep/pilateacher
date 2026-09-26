/**
 * 기기 명부 청소.
 *
 * **이 판정이 틀리면 데이터가 없어진다.** 사진은 기기에만 있고 클라우드 사진
 * 백업은 선택이다 -- 켜지 않은 강사의 회원을 지우면 그 사진은 어디에도 없다.
 * 그래서 여기서 고정하는 것은 "무엇을 지우는가" 가 아니라 **"무엇을 지우지
 * 않는가"** 다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PRUNE_ACTION,
  planRosterPrune,
  pruneDecision,
  pruneMessage,
  recordsAreSafe,
  snapshotId,
  snapshotPayload,
} from "../../src/features/members/device-roster-prune.js";
import { ROSTER_SOURCE } from "../../src/features/roster/roster-bridge.js";

const orgRow = (clientId, overrides = {}) => ({
  id: `local-${clientId}`, orgClientId: clientId,
  rosterSource: ROSTER_SOURCE.ORG_LINKED, ...overrides,
});
const localRow = (id) => ({ id, orgClientId: "", rosterSource: ROSTER_SOURCE.LOCAL_ONLY });

const scope = (mine, backedUp) => ({
  myClientIds: new Set(mine),
  isBackedUp: (clientId) => new Set(backedUp).has(clientId),
});

test("미연결 회원은 지우지 않는다", () => {
  /* 이 기기에만 있는 사람이다. 지우면 센터 어디에도 남지 않는다. */
  assert.equal(pruneDecision(localRow("m-1"), scope([], [])), PRUNE_ACTION.KEEP);
});

test("내 담당은 지우지 않는다", () => {
  assert.equal(pruneDecision(orgRow("c1"), scope(["c1"], [])), PRUNE_ACTION.KEEP);
});

test("내 담당이 아니고 기록도 다 올라갔으면 지운다", () => {
  assert.equal(pruneDecision(orgRow("c2"), scope(["c1"], ["c2"])), PRUNE_ACTION.REMOVE);
});

test("센터에 안 올라간 기록이 있으면 지우지 않고 숨긴다", () => {
  /* 되돌릴 수 있는 수단이다. 목록은 짧아지고 데이터는 그대로 남는다. */
  assert.equal(pruneDecision(orgRow("c2"), scope(["c1"], [])), PRUNE_ACTION.HIDE);
});

test("조직 clientId 가 없으면 건드리지 않는다", () => {
  /* 맞물리지 않은 줄이다. 무엇인지 모르는 것을 지우지 않는다. */
  assert.equal(pruneDecision(orgRow("", { rosterSource: ROSTER_SOURCE.ORG }), scope([], [])), PRUNE_ACTION.KEEP);
});

test("계획은 아무것도 바꾸지 않고 셋으로 나눈다", () => {
  const roster = [
    orgRow("mine"), orgRow("safe"), orgRow("unsafe"), localRow("m-9"),
  ];
  const plan = planRosterPrune(roster, scope(["mine"], ["safe"]));
  assert.deepEqual(plan.remove.map((m) => m.orgClientId), ["safe"]);
  assert.deepEqual(plan.hide, ["unsafe"]);
  assert.equal(plan.keep, 2, "내 담당과 미연결");
  assert.equal(plan.unlinked, 1);
});

test("사진이 없으면 안전하다", () => {
  assert.equal(recordsAreSafe(orgRow("c1"), {
    photoIdsFor: () => [], photoBackupEnabled: false, backedUpPhotoIds: [],
  }), true);
});

test("사진 백업이 꺼져 있으면 사진이 있는 회원은 안전하지 않다", () => {
  /* 올라갈 길이 아예 없다. 이 회원을 지우면 그 사진은 어디에도 없다. */
  assert.equal(recordsAreSafe(orgRow("c1"), {
    photoIdsFor: () => ["p1"], photoBackupEnabled: false, backedUpPhotoIds: ["p1"],
  }), false);
});

test("한 장이라도 안 올라갔으면 안전하지 않다", () => {
  assert.equal(recordsAreSafe(orgRow("c1"), {
    photoIdsFor: () => ["p1", "p2"], photoBackupEnabled: true, backedUpPhotoIds: ["p1"],
  }), false);
  assert.equal(recordsAreSafe(orgRow("c1"), {
    photoIdsFor: () => ["p1", "p2"], photoBackupEnabled: true, backedUpPhotoIds: ["p1", "p2"],
  }), true);
});

test("지운 것과 숨긴 것을 섞어 말하지 않는다", () => {
  /* 되돌릴 수 있는지가 다르고, 강사가 그 차이를 알아야 대표에게 물을 수 있다. */
  const message = pruneMessage({ remove: [1, 2], hide: ["c3"] });
  assert.match(message, /2명을 이 기기에서 정리했어요/);
  assert.match(message, /1명은 아직 센터에 안 올라간 기록이 있어 감춰만 뒀어요/);
  assert.match(message, /센터 기록은 그대로/);
});

test("할 일이 없으면 아무 말도 하지 않는다", () => {
  /* 앱을 열 때마다 "0명을 정리했어요" 가 뜨면 그것은 알림이 아니라 소음이다. */
  assert.equal(pruneMessage({ remove: [], hide: [] }), "");
});

test("사본은 지울 회원만 담는다", () => {
  /* 명부 전체를 담으면 문서 하나가 금세 한계에 닿고, 그때 실패하는 것은
     사본이 아니라 청소 전체다. */
  const payload = snapshotPayload([orgRow("c2", { name: "지워질" })], {
    userId: "u1", organizationId: "org", now: new Date(2026, 8, 27),
  });
  assert.equal(payload.members.length, 1);
  assert.deepEqual(payload.clientIds, ["c2"]);
  assert.equal(payload.userId, "u1");
  assert.equal(payload.expireAt.getTime(), new Date(2026, 11, 26).getTime(), "90일 뒤");
});

test("사본에 사진 바이너리를 담지 않는다", () => {
  const payload = snapshotPayload([orgRow("c2", { src: "blob:…", blob: {} })], {
    userId: "u1", organizationId: "org",
  });
  assert.equal(payload.members[0].src, undefined);
  assert.equal(payload.members[0].blob, undefined);
});

test("사본 id 는 하루에 하나다", () => {
  /* 같은 날 두 번째 청소는 규칙의 덮어쓰기 금지에 막혀 지우지 못한다 --
     한 번 남긴 사본이 그날의 되돌릴 자리로 남는다. */
  assert.equal(snapshotId("u1", new Date(2026, 8, 27)), "u1_2026-09-27");
  assert.equal(snapshotId("u1", new Date(2026, 8, 27, 23)), "u1_2026-09-27");
});

test("기록이 올라갔는지 모르면 아무것도 지우지 않는다", () => {
  /* isBackedUp 을 안 주면 전부 숨기기로 떨어진다. 모르는 채 지우는 것보다
     목록이 긴 편이 낫다. */
  const plan = planRosterPrune([orgRow("c1"), orgRow("c2")], { myClientIds: new Set() });
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.hide, ["c1", "c2"]);
});
