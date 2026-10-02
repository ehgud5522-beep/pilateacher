/**
 * 잔여 점검. **원본은 `functions/shared/pass-reconcile.mjs` 에 있다.**
 *
 * 야간 점검이 Cloud Functions 에서 같은 판정을 쓴다. 그런데 Functions 는
 * `functions/` 디렉터리만 배포되므로(firebase.ai-gateway.json 의
 * `"source": "functions"`), 거기서 `../../src/...` 를 import 하면 클라우드에서
 * 모듈을 찾지 못한다 -- 로컬에서는 멀쩡히 돌고 배포 후에만 터진다.
 *
 * 복사해 두는 길도 있었지만 쓰지 않았다. 두 벌이 되면 언젠가 한쪽만 고쳐지고,
 * 그때 밤에 세는 숫자와 아침에 보는 숫자가 달라진다 -- 대표는 어느 쪽을
 * 믿어야 할지 알 수 없다. 원본은 하나다.
 *
 * constants.mjs · instructor-scope.mjs 와 같은 방식이다.
 */

export * from "../../../functions/shared/pass-reconcile.mjs";
