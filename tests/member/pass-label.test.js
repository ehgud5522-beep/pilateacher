import assert from "node:assert/strict";
import test from "node:test";
import {
  LESSON_TYPE, lessonTypeOf, passLabel, passTitle, serviceLabel,
} from "../../member/src/pass-label.js";

/**
 * 회원 화면의 수강권 이름 (2026-10-30, 대표 결정).
 *
 *   "{수업유형} 필라테스 수업 {유상횟수}회"  + 서비스는 따로 "서비스 {n}회"
 */

const pass = (overrides) => ({ totalSessions: 10, serviceSessions: 0, ...overrides });

test("1:1 · 2:1 은 유형을 앞에 붙인다", () => {
  assert.equal(passTitle(pass({ lessonType: "1:1" })), "1:1 필라테스 수업 10회");
  assert.equal(passTitle(pass({ lessonType: "2:1" })), "2:1 필라테스 수업 10회");
});

test("디오사는 디오사 프로그램, 그 밖은 유형 없이", () => {
  assert.equal(passTitle(pass({ lessonType: "diosa" })), "디오사 프로그램 10회");
  assert.equal(passTitle(pass({ lessonType: "other" })), "필라테스 수업 10회");
});

test("서비스는 유상 횟수에 더하지 않고 따로 적는다", () => {
  const withService = pass({ lessonType: "1:1", serviceSessions: 2 });
  assert.equal(passTitle(withService), "1:1 필라테스 수업 10회");
  assert.equal(serviceLabel(withService), "서비스 2회");
  assert.equal(passLabel(withService), "1:1 필라테스 수업 10회 + 서비스 2회");
});

test("서비스가 0회면 서비스 줄이 없다", () => {
  for (const serviceSessions of [0, null, undefined, -1, "abc"]) {
    assert.equal(serviceLabel(pass({ serviceSessions })), "", String(serviceSessions));
  }
  assert.equal(passLabel(pass({ lessonType: "1:1" })), "1:1 필라테스 수업 10회");
});

test("유상 횟수가 없으면 횟수를 붙이지 않는다 — 서비스만 받은 수강권", () => {
  const serviceOnly = { lessonType: "1:1", totalSessions: 0, serviceSessions: 3 };
  assert.equal(passLabel(serviceOnly), "1:1 필라테스 수업 + 서비스 3회");
});

test("상품명 · 차수가 남아 있어도 쓰지 않는다 — 서버가 다시 만들기 전의 옛 문서", () => {
  const old = { displayName: "1:1 깍두기 양도권", purchaseRound: 3, totalSessions: 10, isDuet: false };
  assert.equal(passLabel(old), "필라테스 수업 10회");
  assert.doesNotMatch(passLabel(old), /깍두기|양도권|3/);
  // 옛 문서에서 알 수 있는 유형은 "함께 쓴다" 하나다.
  assert.equal(lessonTypeOf({ isDuet: true }), LESSON_TYPE.DUET);
  assert.equal(lessonTypeOf({ lessonType: "pt_1_1_new" }), LESSON_TYPE.OTHER);
});

test("값은 서버의 LESSON_TYPE 과 같다", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const server = require("../../functions/src/member-view.js");
  assert.deepEqual({ ...server.LESSON_TYPE }, { ...LESSON_TYPE });
});
