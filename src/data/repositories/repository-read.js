/**
 * 리포지토리 조회의 공통 규칙.
 *
 * ── 왜 있는가 ──
 * memberships 도 locations 도 같은 방식으로 숨었다. 조회가 거부됐는데 화면에는
 * "없다"로만 보였고, 원인을 찾는 데 매번 하루가 걸렸다. 둘 다 같은 두 가지가
 * 겹쳐서 생긴 일이다.
 *
 *   1. 호출부가 실패를 빈 배열로 바꿔 버렸다 (`.catch(() => [])`).
 *   2. 실패했다는 사실이 어디에도 기록되지 않았다.
 *
 * ── 새 리포지토리가 지킬 것 ──
 * 컬렉션을 읽는 함수는 `readCollection` 을 통해 읽는다. 그러면 아래가 공짜로
 * 따라온다.
 *
 *   - 빈 결과와 조회 실패가 갈린다. 성공은 배열(비어 있을 수 있다)을 돌려주고,
 *     실패는 RepositoryReadError 를 던진다. 호출부는 둘을 구분할 수 있고,
 *     구분하지 않으려면 그 선택을 코드에 적어야 한다.
 *   - 실패가 errorCode 와 함께 로그로 남는다. 호출부가 어떻게 처리하든,
 *     무엇이 실패했는지는 남는다.
 *
 * 조회 실패를 빈 결과로 바꾸는 것 자체가 늘 틀린 것은 아니다 -- 지점 이름을
 * 못 붙이는 것과 회원을 못 보는 것은 다르니까. 다만 그 결정은 호출부에서
 * 눈에 보이게 내려야 하고, 결정했더라도 로그는 남아야 한다.
 */

/**
 * 조회가 실패했다는 사실을 빈 결과와 구분해서 나르는 오류.
 *
 * `code` 는 원본 계층의 코드를 그대로 싣는다. 정규화한 내부 코드로 갈아끼우면
 * permission-denied 와 unavailable 이 한 덩어리가 되어 원인 확정이 불가능해진다.
 */
export class RepositoryReadError extends Error {
  /**
   * @param {{ feature: string, stage: string, path: string, code: string, cause?: any }} detail
   */
  constructor({ feature, stage, path, code, cause }) {
    super(`${feature} read failed at ${path} (${code})`);
    this.name = "RepositoryReadError";
    this.feature = feature;
    this.stage = stage;
    this.path = path;
    this.code = code;
    this.errorDomain = "firestore";
    this.cause = cause;
  }
}

/* 진단 싱크. 리포지토리는 App.jsx 를 import 할 수 없으므로(순환), 앱이 시작할
   때 deviceLog 를 여기에 꽂아 준다 -- auth-diagnostics 의 connectAuthInitLog 와
   같은 방식이다. 꽂히기 전에도 조회는 정상 동작하며, 로그만 나가지 않는다. */
/** @type {(code: string, detail: object) => void} */
let sink = (_code, _detail) => {};

/** @param {(code: string, detail: object) => void} log */
export function connectRepositoryLog(log) {
  sink = typeof log === "function" ? log : (_code, _detail) => {};
}

/** 테스트가 싱크를 비우는 자리. */
export function disconnectRepositoryLog() {
  sink = (_code, _detail) => {};
}

/**
 * 컬렉션 하나를 읽고, 실패하면 기록한 뒤 던진다.
 *
 * @template T
 * @param {{ feature: string, path: string, read: (path: string) => Promise<Array<T>>, stage?: string }} options
 * @returns {Promise<Array<T>>} 성공한 조회의 결과. 비어 있을 수 있다.
 */
export async function readCollection({ feature, path, read, stage = "list" }) {
  try {
    const found = await read(path);
    return (Array.isArray(found) ? found : []).filter(Boolean);
  } catch (error) {
    const code = error?.code || "unknown";
    sink(`${feature}_read_failed`, {
      feature,
      stage,
      path,
      errorDomain: "firestore",
      errorCode: code,
      message: error?.message || "",
    });
    throw new RepositoryReadError({ feature, stage, path, code, cause: error });
  }
}

/**
 * 조회 실패를 호출부가 의도적으로 견디고 넘어갈 때 쓴다. 삼키는 것과 다른
 * 점은, 이 자리를 지나면 로그가 이미 남아 있고 코드에 "여기서 견딘다"가
 * 적혀 있다는 것이다.
 *
 * @template T
 * @param {Promise<Array<T>>} pending
 * @param {{ onError?: (error: any) => void }} [options]
 * @returns {Promise<{ items: Array<T>, failed: boolean, errorCode: string }>}
 */
export async function toleratingReadFailure(pending, { onError = () => {} } = {}) {
  try {
    return { items: await pending, failed: false, errorCode: "" };
  } catch (error) {
    try { onError(error); } catch (_ignored) { /* 진단이 화면을 깨뜨리면 안 된다. */ }
    return { items: [], failed: true, errorCode: error?.code || "unknown" };
  }
}
