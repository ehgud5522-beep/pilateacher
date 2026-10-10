/**
 * 급여 단가표 — **원본은 `functions/shared/pay-rates.mjs` 에 있다.**
 *
 * 옮긴 이유는 constants.js 머리말과 같다. 양도 callable 이 받는 회원권의
 * 단가를 서버에서 정해야 한다 -- 앱이 보낸 단가를 그대로 박으면 그것은 잠긴
 * 문이 아니고, 원장은 append-only 라 고칠 수 없다.
 *
 * 껍데기를 남기는 것도 같은 이유다 -- 이 경로를 부르는 곳이 여럿이고, 한 줄로
 * 이어 두면 부르는 쪽은 아무것도 모른다.
 */

export * from "../../../functions/shared/pay-rates.mjs";
