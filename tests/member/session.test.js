import assert from "node:assert/strict";
import test from "node:test";
import {
  REVERIFY_AFTER_DAYS, VERIFIED_AT_KEY, needsReverification, readVerifiedAt, writeVerifiedAt,
} from "../../member/src/session.js";

const NOW = new Date(2026, 8, 24, 12, 0);
const daysAgo = (days) => new Date(NOW.getTime() - days * 86400000);

test("확정 5번 — 90일이다", () => {
  assert.equal(REVERIFY_AFTER_DAYS, 90);
});

test("89일은 통과, 90일은 다시 묻는다", () => {
  assert.equal(needsReverification(daysAgo(89).toISOString(), NOW), false);
  assert.equal(needsReverification(daysAgo(90).toISOString(), NOW), true);
  assert.equal(needsReverification(daysAgo(200).toISOString(), NOW), true);
});

test("기록이 없거나 읽을 수 없으면 다시 묻는다", () => {
  /* 기기 저장은 지워질 수 있다. 지워지면 다시 인증한다 -- 틀리는 방향이
     안전한 쪽이어야 한다. */
  for (const value of [null, undefined, "", "   ", "어제", {}, NaN]) {
    assert.equal(needsReverification(value, NOW), true, String(value));
  }
});

test("미래 시각은 믿지 않는다", () => {
  // 시계가 틀렸거나 손댄 것이다. 통과시키면 그 기기는 영영 다시 묻지 않는다.
  assert.equal(needsReverification(new Date(NOW.getTime() + 86400000), NOW), true);
});

test("Date 와 숫자도 받는다", () => {
  assert.equal(needsReverification(daysAgo(10), NOW), false);
  assert.equal(needsReverification(daysAgo(10).getTime(), NOW), false);
});

test("저장이 막힌 기기에서도 화면이 죽지 않는다", () => {
  /* 시크릿 창과 저장 차단에서 던지는 것이 정상이다. 그때 예외가 올라가면
     로그인 화면 자체가 뜨지 않는다. */
  const throwing = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.equal(readVerifiedAt(throwing), null);
  assert.doesNotThrow(() => writeVerifiedAt(NOW, throwing));
});

test("적은 값을 그대로 읽는다", () => {
  const box = new Map();
  const store = { getItem: (key) => box.get(key) ?? null, setItem: (key, value) => box.set(key, value) };
  writeVerifiedAt(NOW, store);
  assert.equal(box.get(VERIFIED_AT_KEY), NOW.toISOString());
  assert.equal(needsReverification(readVerifiedAt(store), NOW), false);
});
