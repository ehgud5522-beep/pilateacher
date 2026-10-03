/**
 * 양도 판정과 금액 — **원본은 `functions/shared/pass-transfer.mjs` 에 있다.**
 *
 * 옮긴 이유는 constants.js 머리말과 같다. 양도가 callable 로 옮겨 가면서 이 판정이 서버에서도 돌아야 한다. 두 벌이 되면 한쪽만 고쳐지는 날이 오고, 그때 어긋나는 것이 금액이다.
 *
 * 껍데기를 남기는 것도 같은 이유다 -- 이 경로를 부르는 곳이 여럿이고, 한 줄로
 * 이어 두면 부르는 쪽은 아무것도 모른다.
 */

export * from "../../../functions/shared/pass-transfer.mjs";
