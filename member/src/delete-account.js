/**
 * 계정 삭제 — 화면이 하는 말.
 *
 * ── 이 파일이 있는 이유 ──
 * 되돌릴 수 없는 버튼이다. 누르기 전에 **무엇이 사라지고 무엇이 남는지**를
 * 회원이 알아야 하는데, 그 말이 JSX 안에 흩어져 있으면 서버가 실제로 하는
 * 일과 갈라져도 아무도 모른다. 그래서 목록으로 꺼내 두고 테스트가 서버 쪽
 * 구현과 나란히 읽게 한다 (`functions/src/member-account.js`).
 *
 * ── 특히 "남는 것" ──
 * 회원이 앱 계정을 지우는 것과 센터를 그만두는 것은 다른 일이다. 남은
 * 회원권도 원장도 그대로 있고, 그것을 말하지 않으면 회원은 자기 잔여가
 * 사라졌다고 믿는다 -- 그 오해는 센터에 전화가 와야 드러난다.
 */

/** 사라지는 것. 서버가 실제로 지우는 것과 같아야 한다. */
export const DELETED_ITEMS = Object.freeze([
  "이 앱의 로그인 계정",
  "센터 회원 정보와의 연결",
  "앱에서 보던 잔여·수업 기록 화면",
]);

/** 남는 것. 회원이 "내 회원권이 사라진다" 고 읽지 않게 한다. */
export const KEPT_ITEMS = Object.freeze([
  "센터에 등록된 회원 정보",
  "남은 회원권과 이용 기록",
]);

export const DELETE_STEP = Object.freeze({
  IDLE: "idle",
  CONFIRM: "confirm",
  WORKING: "working",
  FAILED: "failed",
});

const text = (value) => String(value ?? "").trim();

/**
 * 실패를 회원이 읽을 말로. **코드는 언제나 함께 보인다.**
 *
 * `account_not_removed` 는 다른 말을 한다 -- 연결은 이미 끊겼고 계정만 남은
 * 상태라, 그 사람이 다음에 열면 처음 가입한 것처럼 보인다. 그것을 "실패했으니
 * 그대로입니다" 라고 말하면 화면과 사실이 어긋난다.
 */
export function deleteFailureMessage(code) {
  const normalized = text(code);
  if (normalized === "account_not_removed") {
    return "연결은 끊었지만 계정을 완전히 지우지 못했어요. 다시 시도해 주세요. "
      + `(코드 ${normalized})`;
  }
  if (normalized === "unauthenticated") {
    return "로그인이 풀렸어요. 다시 로그인한 뒤에 시도해 주세요.";
  }
  if (normalized === "unavailable" || normalized === "delete_unavailable") {
    return `지금 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요. (코드 ${normalized})`;
  }
  return `지금 처리하지 못했어요. (코드 ${normalized || "unknown"})`;
}

/**
 * 삭제가 끝난 뒤 기기에서 걷어낼 칸.
 *
 * 계정을 지웠는데 마지막 확인 시각과 오프라인 사본이 남아 있으면, 다음에 이
 * 폰을 여는 사람이 **지워진 사람의 잔여**를 본다. 서버에는 없는 숫자다.
 */
export function deviceKeysToForget(keys) {
  return Object.freeze([...new Set((keys || []).map(text).filter(Boolean))]);
}
