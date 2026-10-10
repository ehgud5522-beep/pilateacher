import assert from "node:assert/strict";
import test from "node:test";
import { classifyPhoneAuthError } from "../../member/src/auth-errors.js";
import { toE164 } from "../../member/src/phone.js";

const fail = (code) => ({ code, message: `Firebase: Error (${code}).` });

test("E.164 — 하이픈 · 숫자만 · 국가번호 붙은 것 모두 같은 번호가 된다", () => {
  for (const input of ["010-2025-5511", "01020255511", " 010 2025 5511 ", "+82 10-2025-5511",
    "+82 010-2025-5511", "821020255511"]) {
    assert.equal(toE164(input), "+821020255511", input);
  }
  assert.equal(toE164(""), "");
  assert.equal(toE164(null), "");
  assert.equal(toE164("---"), "");
});

test("코드 → 종류 → 문구가 한 줄로 이어진다", () => {
  const rows = [
    ["auth/invalid-phone-number", "invalid_request", "휴대폰 번호 형식을 확인해 주세요."],
    ["auth/too-many-requests", "rate_limited", "시도가 많았어요. 잠시 후 다시 시도해 주세요."],
    ["auth/captcha-check-failed", "security_check", "보안 확인에 실패했어요. 새로고침 후 다시 시도해 주세요."],
    ["auth/unauthorized-domain", "security_check", "보안 확인에 실패했어요. 새로고침 후 다시 시도해 주세요."],
    ["auth/invalid-verification-code", "invalid_request", "인증번호가 맞지 않아요. 다시 입력해 주세요."],
    ["auth/network-request-failed", "network", "연결이 불안정해요. 잠시 후 다시 시도해 주세요."],
  ];
  for (const [code, kind, message] of rows) {
    const result = classifyPhoneAuthError(fail(code));
    assert.equal(result.code, code);
    assert.equal(result.kind, kind, code);
    assert.equal(result.message, message, code);
    // 알려진 실패는 문구가 할 일을 말한다 -- 운영에서는 코드를 붙이지 않는다.
    assert.equal(result.text, message, code);
  }
});

test("모르는 실패는 원본 코드를 숨기지 않는다", () => {
  const result = classifyPhoneAuthError(fail("auth/something-new"));
  assert.equal(result.kind, "unknown");
  assert.match(result.text, /지금 확인하지 못했어요\. \(코드 auth\/something-new\)/);
  // 코드가 아예 없는 것도 "unknown" 이라는 코드로 남는다.
  assert.match(classifyPhoneAuthError(new Error("boom")).text, /코드 unknown/);
  assert.match(classifyPhoneAuthError(undefined).text, /코드 unknown/);
});

test("개발 모드에서는 알려진 실패에도 코드를 붙인다", () => {
  const result = classifyPhoneAuthError(fail("auth/invalid-phone-number"), { dev: true });
  assert.equal(result.text, "휴대폰 번호 형식을 확인해 주세요. (코드 auth/invalid-phone-number)");
});

test("보안 확인 실패는 reCAPTCHA 를 새로 만들고, 인증번호 오타는 그대로 둔다", () => {
  assert.equal(classifyPhoneAuthError(fail("auth/captcha-check-failed")).resetRecaptcha, true);
  assert.equal(classifyPhoneAuthError(fail("auth/too-many-requests")).resetRecaptcha, true);
  assert.equal(classifyPhoneAuthError(fail("auth/something-new")).resetRecaptcha, true);
  /* 인증번호만 다시 넣으면 되는 실패에서 verifier 를 걷을 이유가 없다 -- 이미
     받은 confirmationResult 는 verifier 없이 confirm 된다. */
  assert.equal(classifyPhoneAuthError(fail("auth/invalid-verification-code")).resetRecaptcha, false);
  assert.equal(classifyPhoneAuthError(fail("auth/invalid-phone-number")).resetRecaptcha, false);
});

test("만료된 인증번호는 번호 입력으로 돌려보낸다", () => {
  assert.equal(classifyPhoneAuthError(fail("auth/code-expired")).restart, true);
  assert.equal(classifyPhoneAuthError(fail("auth/invalid-verification-code")).restart, false);
});
