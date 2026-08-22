import assert from "node:assert/strict";
import test from "node:test";

import { googleNativeSignInOptions } from "../../src/features/auth/google-sign-in.js";

test("Android Google 로그인은 멈춤이 반복된 Credential Manager 경로를 사용하지 않는다", () => {
  assert.deepEqual(googleNativeSignInOptions("android"), {
    skipNativeAuth: true,
    useCredentialManager: false,
  });
});

test("iOS Google 로그인 옵션에는 Android 전용 설정을 넣지 않는다", () => {
  assert.deepEqual(googleNativeSignInOptions("ios"), { skipNativeAuth: true });
});

