/**
 * 차감 단가 판정 — **원본은 `functions/shared/deduction-pricing.mjs` 에 있다.**
 *
 * 옮긴 이유는 constants.js 머리말과 같다. 양도 callable 이 받는 회원권의 계약 금액과 부원장 단가를 서버에서 다시 세야 한다 -- 앱이 보낸 금액을 믿으면 그것은 잠긴 문이 아니다.
 *
 * 껍데기를 남기는 것도 같은 이유다 -- 이 경로를 부르는 곳이 여럿이고, 한 줄로
 * 이어 두면 부르는 쪽은 아무것도 모른다.
 */

export * from "../../../functions/shared/deduction-pricing.mjs";
