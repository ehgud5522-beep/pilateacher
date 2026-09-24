/**
 * 연락처 하나의 철자. **원본은 여기다** (앱은 client-repository 가 재수출한다).
 *
 * ── 왜 한 곳이어야 하는가 ──
 * 이 함수가 회원의 정체를 정한다. 이관은 clientIdForPhone(phone) 으로 문서
 * id 를 만들고(`csv_01012345678`), 회원 앱은 인증된 전화번호로 그 회원을 찾는다.
 * 두 쪽이 다르게 정규화하면 같은 사람이 서로 다른 회원이 되고, 그것은 로그인한
 * 회원에게 "등록된 번호를 찾지 못했습니다" 로 나타난다.
 *
 * ── 왜 functions 에 있는가 ──
 * Cloud Functions 는 functions/ 만 배포된다. 연결 함수(member-link.js)가 이
 * 정규화를 쓰는데, src/ 를 require 하면 클라우드에서 모듈을 찾지 못한다.
 * 복사해 두면 두 벌이 되고, 여기서 두 벌은 곧 두 사람이 된다.
 *
 * `.mjs` 인 것은 확장자로 모듈 형식을 못 박기 위해서다 -- constants.mjs 와 같다.
 */

/**
 * 숫자만 남긴다. 하이픈·공백·국가번호 표기가 섞여 들어와도 한 철자가 된다.
 *
 * 010-1234-5678 과 01012345678 이 갈라지면 검색도 동명이인 확인도 조용히
 * 깨진다 -- 그래서 저장은 언제나 숫자만이다.
 */
export const normalizePhone = (value) => String(value ?? "").replace(/\D/g, "");

/**
 * 인증된 번호를 명부의 철자로 옮긴다. `+82 10-1234-5678` → `01012345678`.
 *
 * Firebase Auth 가 주는 `phone_number` 는 언제나 E.164 다 -- 국가번호가 붙고
 * 앞의 0 이 빠진다. 명부는 대표가 입력한 대로 `010…` 으로 들고 있다. 숫자만
 * 남기는 것으로는 이 둘이 절대 만나지 않는다: `821012345678` 과
 * `01012345678` 은 다른 문자열이고, 그 결과는 **정상적으로 등록된 회원 전원이
 * "등록된 번호를 찾지 못했습니다"** 로 끝나는 것이다.
 *
 * `+` 로 시작할 때만 국가번호로 본다. 그러지 않으면 82 로 시작하는 국번을
 * 가진 번호가 언젠가 잘린다.
 */
export function phoneFromVerifiedToken(value) {
  const raw = String(value ?? "").trim();
  const digits = normalizePhone(raw);
  if (raw.startsWith("+") && digits.startsWith("82")) return `0${digits.slice(2)}`;
  return digits;
}
