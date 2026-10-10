/**
 * 번호 인증 실패를 종류별로 가른다. **순수 함수다.**
 *
 * 전에는 "인증번호가 틀림 · 너무 많음 · 그 밖" 셋뿐이라, 번호 형식이 틀린
 * 것도 reCAPTCHA 가 막힌 것도 승인되지 않은 도메인도 모두 "지금 확인하지
 * 못했어요" 로 끝났다. 회원은 무엇을 고쳐야 하는지 모르고, 센터는 무엇을
 * 물어야 하는지 모른다.
 *
 * 코드 → 종류 → 문구가 한 줄로 이어진다 (tests/member/auth-errors.test.js).
 */

/** 원본 코드별 종류와 문구. 여기 없는 코드는 unknown 이다. */
const KNOWN = {
  "auth/invalid-phone-number": {
    kind: "invalid_request", message: "휴대폰 번호 형식을 확인해 주세요.",
  },
  "auth/missing-phone-number": {
    kind: "invalid_request", message: "휴대폰 번호 형식을 확인해 주세요.",
  },
  "auth/too-many-requests": {
    kind: "rate_limited", message: "시도가 많았어요. 잠시 후 다시 시도해 주세요.",
  },
  "auth/quota-exceeded": {
    kind: "rate_limited", message: "시도가 많았어요. 잠시 후 다시 시도해 주세요.",
  },
  /* reCAPTCHA 가 실패했거나, 이 주소가 Firebase 콘솔의 승인된 도메인에 없다.
     둘 다 새로고침이 첫 처방이고, 계속되면 센터가 콘솔을 봐야 한다. */
  "auth/captcha-check-failed": {
    kind: "security_check", message: "보안 확인에 실패했어요. 새로고침 후 다시 시도해 주세요.",
  },
  "auth/unauthorized-domain": {
    kind: "security_check", message: "보안 확인에 실패했어요. 새로고침 후 다시 시도해 주세요.",
  },
  "auth/invalid-app-credential": {
    kind: "security_check", message: "보안 확인에 실패했어요. 새로고침 후 다시 시도해 주세요.",
  },
  "auth/invalid-verification-code": {
    kind: "invalid_request", message: "인증번호가 맞지 않아요. 다시 입력해 주세요.",
  },
  /* 문자로 받은 번호가 만료됐다. 같은 번호를 다시 넣어도 안 되므로 번호
     입력 단계로 돌아가야 한다 -- restart 가 그 신호다. */
  "auth/code-expired": {
    kind: "invalid_request", message: "인증번호가 만료됐어요. 번호를 다시 받아 주세요.", restart: true,
  },
  "auth/network-request-failed": {
    kind: "network", message: "연결이 불안정해요. 잠시 후 다시 시도해 주세요.",
  },
};

/** 그 밖의 실패. 코드를 함께 보여준다 -- 코드 없는 오류 문구는 쓰지 않는다. */
const UNKNOWN_MESSAGE = "지금 확인하지 못했어요.";

/**
 * reCAPTCHA 를 새로 만들어야 하는 실패. 한 번 실패한 verifier 는 토큰이
 * 소모됐거나 위젯이 깨진 상태라, 같은 것으로 다시 보내면 같은 이유로 진다.
 */
const RESET_RECAPTCHA = new Set([
  "auth/captcha-check-failed", "auth/invalid-app-credential", "auth/unauthorized-domain",
  "auth/too-many-requests", "auth/quota-exceeded", "auth/network-request-failed",
  "auth/internal-error",
]);

const codeOf = (error) => String(error?.code ?? "").trim() || "unknown";

/**
 * @param {unknown} error Firebase Auth 가 던진 것
 * @param {{ dev?: boolean }} [options] dev 이면 알려진 실패에도 코드를 붙인다
 * @returns {{ code: string, kind: string, message: string, restart: boolean,
 *   resetRecaptcha: boolean, text: string }}
 */
export function classifyPhoneAuthError(error, { dev = false } = {}) {
  const code = codeOf(error);
  const known = KNOWN[code];
  const kind = known ? known.kind : "unknown";
  const message = known ? known.message : UNKNOWN_MESSAGE;
  /* unknown 은 언제나 코드를 보인다. 알려진 실패는 문구가 이미 할 일을
     말하므로 개발 모드에서만 코드를 덧붙인다. */
  const showCode = !known || dev;
  return {
    code,
    kind,
    message,
    restart: Boolean(known?.restart),
    resetRecaptcha: RESET_RECAPTCHA.has(code) || !known,
    text: showCode ? `${message} (코드 ${code})` : message,
  };
}
