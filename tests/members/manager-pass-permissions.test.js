import assert from "node:assert/strict";
import test from "node:test";

import {
  MANAGER_CANCEL_WINDOW_MS, isFreshlyIssuedPass,
} from "../../src/data/repositories/pass-repository.js";

/**
 * FC매니저의 회원권 취소 창 — **대표 확정 (2026-10-26).**
 *
 * 갓 발급하고 한 회차도 안 쓴 것만이다. 자기가 방금 잘못 발급한 것을 되무르는
 * 자리이지, 어제 판 것이나 쓰던 것을 지우는 길이 아니다.
 *
 * ── 왜 잔여로 재는가 ──
 * 규칙이 하위 컬렉션(원장)을 훑지 못해 차감 건수를 셀 수 없다. 그래서 **잔여가
 * 총회차(서비스 포함)와 같은가**로 본다 -- 앱과 규칙이 같은 조건을 쓸 수 있는
 * 유일한 길이다.
 *
 * 이 파일은 그 판정을 고정한다. 규칙 쪽 짝은 tests/rules 에 있다.
 */

const NOW = new Date(2026, 9, 26, 12, 0, 0);
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

const pass = (overrides = {}) => ({
  totalSessions: 20,
  serviceSessions: 0,
  remainingCount: 20,
  createdAt: hoursAgo(1),
  ...overrides,
});

test("갓 발급하고 안 쓴 회원권은 창 안이다", () => {
  assert.equal(isFreshlyIssuedPass(pass(), NOW), true);
});

test("한 회차라도 썼으면 창 밖이다", () => {
  /* 수업이 실제로 일어났을 수 있다. 취소하면 그 회차의 급여 근거가 사라지고,
     원장은 append-only 라 되돌리려면 또 한 줄을 쌓아야 한다. */
  assert.equal(isFreshlyIssuedPass(pass({ remainingCount: 19 }), NOW), false);
});

test("서비스 회차를 총회차에 더해서 센다", () => {
  /* 서비스를 빼고 세면 서비스가 붙은 회원권은 발급 직후에도 "이미 쓴 것" 으로
     읽혀, 되무를 길이 영영 없다. */
  assert.equal(isFreshlyIssuedPass(pass({ totalSessions: 18, serviceSessions: 2, remainingCount: 20 }), NOW), true);
  assert.equal(isFreshlyIssuedPass(pass({ totalSessions: 18, serviceSessions: 2, remainingCount: 18 }), NOW), false);
});

test("서비스 칸이 없는 옛 회원권도 센다", () => {
  const old = pass({ totalSessions: 20, remainingCount: 20 });
  delete old.serviceSessions;
  assert.equal(isFreshlyIssuedPass(old, NOW), true);
});

test("24시간이 지나면 창 밖이다", () => {
  assert.equal(isFreshlyIssuedPass(pass({ createdAt: hoursAgo(23) }), NOW), true);
  assert.equal(isFreshlyIssuedPass(pass({ createdAt: hoursAgo(25) }), NOW), false);
  assert.equal(MANAGER_CANCEL_WINDOW_MS, 24 * 60 * 60 * 1000);
});

test("발급 시각을 못 읽으면 창 밖이다", () => {
  /* 모를 때 열어 두면 그 칸이 없던 시절의 옛 회원권이 전부 통과한다. */
  for (const bad of [null, undefined, "", "어제", {}]) {
    assert.equal(isFreshlyIssuedPass(pass({ createdAt: bad }), NOW), false, String(bad));
  }
});

test("Firestore Timestamp 로 와도 읽는다", () => {
  /* 저장소에서 바로 온 회원권은 Date 가 아니라 Timestamp 다. 못 읽으면
     모든 회원권이 "창 밖" 이 되어 FC매니저는 아무것도 취소하지 못한다. */
  const at = hoursAgo(2);
  assert.equal(isFreshlyIssuedPass(pass({ createdAt: { toDate: () => at } }), NOW), true);
});

test("미래 시각은 창 밖이다", () => {
  /* 시계가 어긋난 기기가 쓴 값이다. 열어 두면 그 회원권은 영영 취소 가능하다. */
  assert.equal(isFreshlyIssuedPass(pass({ createdAt: new Date(NOW.getTime() + 60000) }), NOW), false);
});

test("회원권이 없으면 거짓이다", () => {
  assert.equal(isFreshlyIssuedPass(null, NOW), false);
  assert.equal(isFreshlyIssuedPass(undefined, NOW), false);
});
