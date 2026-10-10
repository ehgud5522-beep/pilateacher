import assert from "node:assert/strict";
import test from "node:test";
import {
  CODE_SENT_AT_KEY, RESEND_AFTER_SECONDS, readCodeSentAt, resendSecondsLeft, sendButtonLabel,
  writeCodeSentAt,
} from "../../member/src/resend.js";
import { clearMemberStorage } from "../../member/src/session.js";

const NOW = Date.UTC(2026, 9, 10, 3, 0, 0);

const memoryStore = () => {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
};

test("60초다", () => {
  assert.equal(RESEND_AFTER_SECONDS, 60);
});

test("보낸 직후 60초, 18초 지나면 42초, 60초가 되면 0", () => {
  assert.equal(resendSecondsLeft(NOW, NOW), 60);
  assert.equal(resendSecondsLeft(NOW, NOW + 18000), 42);
  // 남은 0.5초도 1초로 보인다 -- "0초" 인데 못 누르는 버튼을 만들지 않는다.
  assert.equal(resendSecondsLeft(NOW, NOW + 59500), 1);
  assert.equal(resendSecondsLeft(NOW, NOW + 60000), 0);
  assert.equal(resendSecondsLeft(NOW, NOW + 3600000), 0);
});

test("보낸 적 없거나 읽을 수 없으면 바로 보낼 수 있다", () => {
  for (const value of [null, undefined, "", "어제", NaN]) {
    assert.equal(resendSecondsLeft(value, NOW), 0, String(value));
  }
});

test("미래 시각에 버튼이 잠기지 않는다", () => {
  assert.equal(resendSecondsLeft(NOW + 3600000, NOW), 0);
});

test("버튼 문구 — 기다리는 동안 남은 초를 보인다", () => {
  assert.equal(sendButtonLabel({ busy: false, secondsLeft: 42 }), "다시 받기 (42초)");
  assert.equal(sendButtonLabel({ busy: false, secondsLeft: 42, resend: true }), "다시 받기 (42초)");
  assert.equal(sendButtonLabel({ busy: false, secondsLeft: 0 }), "인증번호 받기");
  assert.equal(sendButtonLabel({ busy: false, secondsLeft: 0, resend: true }), "인증번호 다시 받기");
  assert.equal(sendButtonLabel({ busy: true, secondsLeft: 0 }), "보내는 중…");
});

test("새로고침해도 기다림이 이어진다 — 기기에 적고 읽는다", () => {
  const store = memoryStore();
  assert.equal(readCodeSentAt(store), null);
  writeCodeSentAt(NOW, store);
  assert.equal(readCodeSentAt(store), NOW);
  assert.equal(resendSecondsLeft(readCodeSentAt(store), NOW + 18000), 42);
});

test("로그아웃이 발송 시각도 걷는다", () => {
  const store = memoryStore();
  writeCodeSentAt(NOW, store);
  clearMemberStorage(store);
  assert.equal(store.getItem(CODE_SENT_AT_KEY), null);
});

test("저장이 막힌 기기에서 죽지 않는다", () => {
  const blocked = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
  };
  assert.equal(readCodeSentAt(blocked), null);
  assert.doesNotThrow(() => writeCodeSentAt(NOW, blocked));
});
