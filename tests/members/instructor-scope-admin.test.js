/**
 * 대표의 재계산·점검 화면이 말하는 것.
 *
 * 숫자가 아니라 **대표가 그 다음에 무엇을 하는가**를 고정한다. 같은 0 이라도
 * "아직 안 돌았다" 와 "다 맞다" 는 다음 행동이 다르다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  SCOPE_HEALTH,
  instructorScopeRows,
  rebuildDoneMessage,
  rebuildPreviewMessage,
  scopeHealth,
  scopeHealthMessage,
} from "../../src/features/members/instructor-scope-admin.js";

test("아직 안 돌았을 때와 빠진 회원이 있을 때를 가른다", () => {
  /* 둘 다 재계산을 누르게 되지만, 문구가 같으면 대표는 지금이 어느 쪽인지
     알 수 없다. 처음 켠 날과 트리거가 실패한 날은 다른 일이다. */
  assert.equal(scopeHealth({ clients: 106, withInstructors: 0, emptyActive: 106 }), SCOPE_HEALTH.NOT_FILLED);
  assert.equal(scopeHealth({ clients: 106, withInstructors: 104, emptyActive: 2 }), SCOPE_HEALTH.MISSING);
  assert.equal(scopeHealth({ clients: 106, withInstructors: 100, emptyActive: 0 }), SCOPE_HEALTH.OK);
});

test("회원이 한 명도 없으면 문제가 아니다", () => {
  assert.equal(scopeHealth({ clients: 0, withInstructors: 0, emptyActive: 0 }), SCOPE_HEALTH.OK);
});

test("종료 회원이 비어 있는 것은 정상이다", () => {
  /* 회원권이 한 번도 안 나간 회원이 있다. 운영중인데 비어 있을 때만 문제다. */
  assert.equal(scopeHealth({ clients: 106, withInstructors: 80, emptyActive: 0 }), SCOPE_HEALTH.OK);
});

test("점검 문구는 빠진 회원 수를 말한다", () => {
  assert.match(scopeHealthMessage({ clients: 106, withInstructors: 104, emptyActive: 2 }), /2명/);
  assert.match(scopeHealthMessage({ clients: 106, withInstructors: 0, emptyActive: 106 }), /한 번도/);
  assert.match(scopeHealthMessage({ clients: 106, withInstructors: 106, emptyActive: 0 }), /모든/);
});

test("미리보기 — 바뀌는 것이 없을 때를 따로 말한다", () => {
  /* "0명이 바뀝니다" 를 보고 누르면 아무 일도 안 일어나고, 대표는 실패로
     읽는다. */
  assert.match(rebuildPreviewMessage({ scanned: 106, wouldUpdate: 0 }), /바뀌는 것이 없습니다/);
  assert.match(rebuildPreviewMessage({ scanned: 106, wouldUpdate: 12 }), /12명/);
});

test("미리보기 — 못 읽은 회원이 있으면 그것을 먼저 말한다", () => {
  const message = rebuildPreviewMessage({ scanned: 106, wouldUpdate: 3, failed: 2 });
  assert.match(message, /2명을 읽지 못했습니다/);
  assert.doesNotMatch(message, /3명의 담당/, "실패가 있으면 바뀔 숫자를 앞세우지 않는다");
});

test("실행 결과 — 실패가 있으면 함께 말한다", () => {
  assert.match(rebuildDoneMessage({ updated: 12, failed: 0 }), /12명/);
  assert.match(rebuildDoneMessage({ updated: 10, failed: 2 }), /2명은 실패/);
  assert.match(rebuildDoneMessage({ updated: 0, failed: 0 }), /바뀐 회원이 없습니다/);
});

test("강사별 목록에 이름을 붙인다", () => {
  const rows = instructorScopeRows(
    [{ instructorId: "uid-a", clients: 12 }, { instructorId: "uid-b", clients: 3 }],
    [{ userId: "uid-a", name: "김강사" }],
  );
  assert.equal(rows[0].name, "김강사");
  assert.equal(rows[0].known, true);
});

test("이름을 모르는 강사도 어느 줄인지 알 수 있어야 한다", () => {
  /* 빈칸으로 두면 퇴사한 강사의 회원이 몇 명 남았는지 세는 줄이 무명이 된다. */
  const [row] = instructorScopeRows([{ instructorId: "uid-zzzzzzzz", clients: 4 }], []);
  assert.equal(row.known, false);
  assert.match(row.name, /uid-zz/);
  assert.equal(row.clients, 4);
});
