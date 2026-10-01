/**
 * 네이티브 문자 인증.
 *
 * 여기서 고정하는 것은 **막힌 화면이 생기지 않는다** 는 것이다. 네이티브
 * API 는 결과를 이벤트로 던지므로, 아무 이벤트도 오지 않는 갈래가 있으면
 * 화면은 영영 "확인하는 중" 이고 회원은 무엇을 해야 할지 모른다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PHONE_FAILURE,
  isNativePhoneAuth,
  phoneAuthError,
  phoneFailureMessage,
  shouldFallBackToWeb,
  startNativePhoneSignIn,
} from "../../member/src/phone-auth.js";

/** 플러그인 흉내. 이벤트를 우리가 원할 때 던진다. */
function fakePlugin({ onSignIn } = {}) {
  const listeners = new Map();
  const removed = [];
  return {
    removed,
    calls: [],
    emit(name, event) { listeners.get(name)?.forEach((handler) => handler(event)); },
    addListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
      return Promise.resolve({ remove: () => { removed.push(name); return Promise.resolve(); } });
    },
    signInWithPhoneNumber(options) {
      this.calls.push(options);
      onSignIn?.(this, options);
      return Promise.resolve();
    },
  };
}

const started = (plugin, overrides = {}) => startNativePhoneSignIn({
  plugin, phoneNumber: "+821000000000",
  signInWithCode: async (verificationId, code) => ({ verificationId, code }),
  ...overrides,
});

test("문자가 가면 웹과 같은 모양을 돌려준다", async () => {
  /* 화면은 웹인지 앱인지 몰라야 한다. 두 길이 갈라지면 갈라진 만큼 버그가
     한쪽에만 생긴다. */
  const plugin = fakePlugin({ onSignIn: (p) => p.emit("phoneCodeSent", { verificationId: "vid-1" }) });
  const pending = await started(plugin);
  assert.equal(pending.verificationId, "vid-1");
  assert.deepEqual(await pending.confirm("123456"), { verificationId: "vid-1", code: "123456" });
});

test("보내는 번호와 자동 읽기 시간을 그대로 넘긴다", async () => {
  const plugin = fakePlugin({ onSignIn: (p) => p.emit("phoneCodeSent", { verificationId: "vid" }) });
  await started(plugin);
  assert.deepEqual(plugin.calls, [{ phoneNumber: "+821000000000", timeout: 60 }]);
});

test("즉시 인증은 고유한 코드로 올라온다", async () => {
  /* **이 갈래가 이 파일이 있는 이유다.** Android 는 문자 없이 인증이 끝날 수
     있는데, 그때 넘어오는 자격에는 providerId 만 남는다 -- JS 로 로그인할
     재료가 없다. 조용히 두면 화면이 영영 기다린다. */
  const plugin = fakePlugin({ onSignIn: (p) => p.emit("phoneVerificationCompleted", { user: {}, credential: { providerId: "phone" } }) });
  await assert.rejects(started(plugin), (error) => {
    assert.equal(error.code, PHONE_FAILURE.INSTANT_UNUSABLE);
    return true;
  });
});

test("즉시 인증이면 웹 길로 되돌아가라고 말한다", () => {
  assert.equal(shouldFallBackToWeb(phoneAuthError(PHONE_FAILURE.INSTANT_UNUSABLE)), true);
  // 다른 실패는 되돌아가지 않는다 -- 같은 이유로 또 막힌다.
  assert.equal(shouldFallBackToWeb(phoneAuthError(PHONE_FAILURE.NATIVE_FAILED)), false);
  assert.equal(shouldFallBackToWeb(new Error("무엇인가")), false);
});

test("문자를 앱이 읽으면 칸만 채우고 끝내지 않는다", async () => {
  /* 자동 입력은 `phoneCodeSent` **뒤에** 온다. 그때 리스너를 이미 걷었으면
     이벤트가 허공으로 간다. */
  const auto = [];
  const plugin = fakePlugin({ onSignIn: (p) => p.emit("phoneCodeSent", { verificationId: "vid-2" }) });
  const pending = await started(plugin, { onAutoCode: (code) => auto.push(code) });
  plugin.emit("phoneVerificationCompleted", { verificationCode: "654321" });
  assert.deepEqual(auto, ["654321"], "성공 뒤에도 리스너가 붙어 있어야 한다");
  assert.deepEqual(plugin.removed, [], "성공은 리스너를 걷지 않는다");

  await pending.cancel();
  assert.equal(plugin.removed.length, 3, "끝낼 때는 셋 다 걷는다");
});

test("네이티브 실패는 원본 문구를 지우지 않는다", async () => {
  /* 이 이벤트에는 코드가 없고 문구만 온다. 정제해 버리면 원인을 확정할
     재료가 남지 않는다. */
  const plugin = fakePlugin({
    onSignIn: (p) => p.emit("phoneVerificationFailed", { message: "This app is not authorized to use Firebase Authentication." }),
  });
  await assert.rejects(started(plugin), (error) => {
    assert.equal(error.code, PHONE_FAILURE.NATIVE_FAILED);
    assert.match(error.message, /not authorized/);
    return true;
  });
});

test("실패하면 리스너를 걷는다", async () => {
  const plugin = fakePlugin({ onSignIn: (p) => p.emit("phoneVerificationFailed", { message: "x" }) });
  await assert.rejects(started(plugin));
  assert.equal(plugin.removed.length, 3);
});

test("verificationId 가 비면 성공으로 보지 않는다", async () => {
  /* 빈 값으로 자격을 만들면 로그인이 실패하는데, 그 실패는 인증번호가 틀린
     것처럼 보인다 -- 회원은 맞는 번호를 몇 번이고 다시 넣는다. */
  const plugin = fakePlugin({ onSignIn: (p) => p.emit("phoneCodeSent", { verificationId: "" }) });
  await assert.rejects(started(plugin), (error) => {
    assert.equal(error.code, PHONE_FAILURE.NO_VERIFICATION_ID);
    return true;
  });
});

test("플러그인 호출 자체가 던져도 코드가 붙는다", async () => {
  const plugin = fakePlugin();
  plugin.signInWithPhoneNumber = () => Promise.reject(new Error("BILLING_NOT_ENABLED"));
  await assert.rejects(started(plugin), (error) => {
    assert.equal(error.code, PHONE_FAILURE.NATIVE_FAILED);
    assert.match(error.message, /BILLING_NOT_ENABLED/);
    return true;
  });
});

test("첫 이벤트만 센다", async () => {
  /* 자동 읽기와 코드 전송이 겹치면 둘 다 온다. 두 번 resolve 하면 화면이
     두 번 넘어간다. */
  const plugin = fakePlugin({ onSignIn: (p) => { p.emit("phoneCodeSent", { verificationId: "a" }); p.emit("phoneCodeSent", { verificationId: "b" }); } });
  const pending = await started(plugin);
  assert.equal(pending.verificationId, "a");
});

test("네이티브인지 묻다가 터져도 웹 길로 간다", () => {
  assert.equal(isNativePhoneAuth(null), false);
  assert.equal(isNativePhoneAuth({}), false);
  assert.equal(isNativePhoneAuth({ isNativePlatform: () => true }), true);
  assert.equal(isNativePhoneAuth({ isNativePlatform() { throw new Error("no"); } }), false);
});

test("어떤 실패든 회원이 읽을 말이 있고, 모르는 것은 코드를 보여준다", () => {
  assert.match(phoneFailureMessage("auth/invalid-verification-code"), /인증번호가 맞지 않아요/);
  assert.match(phoneFailureMessage("auth/code-expired"), /만료/);
  assert.match(phoneFailureMessage(PHONE_FAILURE.NATIVE_FAILED), /다시 시도/);
  /* 분류하지 못한 것도 숨기지 않는다 -- 코드 없는 "오류가 발생했습니다" 는
     회원도 센터도 아무것도 할 수 없게 만든다. */
  assert.match(phoneFailureMessage("auth/internal-error-99"), /코드 auth\/internal-error-99/);
  assert.match(phoneFailureMessage(""), /코드 unknown/);
});
