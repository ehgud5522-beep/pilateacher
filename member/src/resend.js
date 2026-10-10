/**
 * 인증번호 재요청 간격. **판정은 순수 함수다.**
 *
 * 문자를 보낸 뒤 60초 동안은 다시 보내지 않는다. 회원이 "안 오네" 하고 여러
 * 번 누르면 Firebase 가 그 기기를 auth/too-many-requests 로 한 시간쯤 막고,
 * 그때부터는 센터도 풀어 줄 방법이 없다. 누를 수 없게 하는 편이 낫다.
 *
 * 마지막으로 보낸 시각은 기기에 적는다. 새로고침으로 기다림을 건너뛰면
 * 막으려던 일이 그대로 일어난다. 로그아웃하면 session.js 의
 * forgetDevice 가 이 칸도 걷는다.
 */

export const RESEND_AFTER_SECONDS = 60;

/** 기기에 마지막 발송 시각을 적어 두는 칸. */
export const CODE_SENT_AT_KEY = "pilateacher.member.codeSentAt";

/**
 * 다시 보낼 수 있을 때까지 남은 초. 0 이면 지금 보낼 수 있다.
 *
 * @param {unknown} sentAt 마지막 발송 시각 (밀리초 · ISO 문자열 · 없음)
 * @param {number} now 밀리초
 */
export function resendSecondsLeft(sentAt, now = Date.now()) {
  const at = typeof sentAt === "number" ? sentAt : Date.parse(String(sentAt ?? ""));
  if (!Number.isFinite(at)) return 0;
  /* 미래 시각은 시계가 바뀌었거나 손댄 것이다. 그대로 믿으면 버튼이 몇 시간씩
     잠긴다 -- 이 장치는 보안 경계가 아니므로 막는 쪽으로 틀릴 이유가 없다. */
  if (at > now) return 0;
  const left = Math.ceil((at + RESEND_AFTER_SECONDS * 1000 - now) / 1000);
  return left > 0 ? left : 0;
}

/** 버튼 문구. 기다리는 동안은 남은 초를 보인다. */
export function sendButtonLabel({ busy, secondsLeft, resend = false }) {
  if (busy) return "보내는 중…";
  if (secondsLeft > 0) return `다시 받기 (${secondsLeft}초)`;
  return resend ? "인증번호 다시 받기" : "인증번호 받기";
}

/** @param {{ getItem?: (key: string) => any }} [store] */
export function readCodeSentAt(store) {
  try {
    const box = store || (typeof localStorage === "undefined" ? null : localStorage);
    const value = box ? Number(box.getItem(CODE_SENT_AT_KEY)) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (_error) {
    return null;
  }
}

/** 적지 못해도 넘어간다 -- 화면 안의 기다림은 그대로 돈다. */
export function writeCodeSentAt(at, store) {
  try {
    const box = store || (typeof localStorage === "undefined" ? null : localStorage);
    if (box) box.setItem(CODE_SENT_AT_KEY, String(at));
  } catch (_error) {
    /* 저장이 막힌 기기다. 새로고침하면 기다림이 풀릴 뿐이다. */
  }
}
