/**
 * 스키마 상수. **원본은 `functions/shared/constants.mjs` 에 있다.**
 *
 * ── 왜 Functions 디렉터리에 사는가 ──
 * 회원용 투영을 만드는 Cloud Functions 트리거가 이 상수를 쓴다. 그런데
 * Functions 는 `functions/` 디렉터리만 배포되므로(firebase.ai-gateway.json 의
 * `"source": "functions"`), 거기서 `../../src/...` 를 require 하면 클라우드에서
 * 모듈을 찾지 못한다.
 *
 * 복사해 두는 길도 있었지만 쓰지 않았다. 두 벌이 되면 언젠가 한쪽만 고쳐지고,
 * 그때 어긋나는 것이 하필 PAY_CATEGORY 나 PASS_STATUS 면 급여와 회차가 조용히
 * 틀린다. 원본은 하나다.
 *
 * `.mjs` 인 것은 확장자로 모듈 형식을 못 박기 위해서다. `functions/` 는
 * CommonJS 인데 이 파일들은 ESM 이어야 앱이 그대로 import 할 수 있고,
 * Functions 쪽은 async 핸들러에서 `await import()` 로 읽는다.
 *
 * ── 왜 이 껍데기를 남기는가 ──
 * 이 경로를 가져다 쓰는 곳이 스물두 군데다. 전부 고치면 diff 가 커지고 그중
 * 하나를 빠뜨릴 자리가 생긴다. 한 줄로 이어 두면 부르는 쪽은 아무것도 모른다.
 */

export * from "../../../functions/shared/constants.mjs";
