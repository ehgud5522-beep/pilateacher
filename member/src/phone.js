/**
 * 한국 번호를 E.164 로. **순수 함수다.** 서버는 토큰의 번호만 믿으므로
 * 여기 값은 편의다 -- 다만 signInWithPhoneNumber 는 "+82..." 가 아니면
 * auth/invalid-phone-number 로 거부한다.
 *
 *   "010-2025-5511" · "01020255511" · "+82 10-2025-5511" → "+821020255511"
 *
 * 숫자만 남기고, 국가번호 82 가 앞에 있으면 떼고, 맨 앞 0 을 떼고, +82 를
 * 붙인다. "+82 010-…" 처럼 둘 다 적은 경우도 0 을 뗀다 -- 국내 번호는 0 으로
 * 시작하므로 앞의 82 는 국가번호일 수밖에 없다.
 */
export function toE164(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("82")) digits = digits.slice(2);
  digits = digits.replace(/^0+/, "");
  return digits ? `+82${digits}` : "";
}
