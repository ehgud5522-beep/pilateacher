/**
 * 서비스 워커를 언제 등록하고 언제 걷어낼지.
 *
 * ── 세 가지 환경이 서로 다른 것을 원한다 ──
 * 네이티브 앱(Capacitor)은 자기 자산을 자기가 들고 있다. 그 위에 서비스 워커가
 * 끼면 앱을 새로 깔아도 옛 화면이 남는다 -- 그래서 등록하지 않고, 이미 등록된
 * 것이 있으면 걷어낸다.
 *
 * 개발 서버(vite dev)도 등록하지 않는다. 코드를 고쳐도 화면이 안 바뀌는 일이
 * 반복됐고, 원인을 찾는 데 매번 시간이 든다. 한 번 등록된 워커는 dev 서버를
 * 껐다 켜도 살아 있어서, 등록을 멈추는 것만으로는 부족하다 -- 이미 있는 것도
 * 걷어내야 한다.
 *
 * 프로덕션 웹(호스팅)에서만 등록한다. 대표가 PC 브라우저에서 쓰는 자리이고,
 * 오프라인 셸이 실제로 쓸모가 있다.
 *
 * ── 왜 순수 함수인가 ──
 * 이 판정이 틀리면 개발자는 유령 화면을 보고 사용자는 옛 화면을 본다. 둘 다
 * 재현이 어렵고, 재현이 어려운 것은 테스트로 고정해야 한다. main.jsx 는
 * 브라우저 밖에서 불러올 수 없으므로 판정만 여기로 옮긴다.
 */

/** 등록할 것인가, 걷어낼 것인가. */
export const SERVICE_WORKER_ACTION = Object.freeze({
  REGISTER: "register",
  UNREGISTER: "unregister",
});

/**
 * @param {{ isNative?: boolean, isDev?: boolean, supported?: boolean }} input
 * @returns {"register" | "unregister" | "none"}
 */
export function serviceWorkerAction(input = {}) {
  // 브라우저가 지원하지 않으면 등록할 것도 걷어낼 것도 없다.
  if (input.supported === false) return "none";
  if (input.isNative === true) return SERVICE_WORKER_ACTION.UNREGISTER;
  if (input.isDev === true) return SERVICE_WORKER_ACTION.UNREGISTER;
  return SERVICE_WORKER_ACTION.REGISTER;
}

/** 이 앱이 만든 캐시만 지운다. 같은 origin 의 다른 캐시는 남의 것이다. */
export const OWNED_CACHE_PREFIX = "pilateacher-";

/**
 * 등록된 워커를 전부 걷어내고 이 앱의 캐시를 지운다.
 *
 * 하나가 실패해도 나머지는 계속한다. 정리하다 만 상태가 정리하지 않은 상태보다
 * 나쁘지는 않고, 여기서 던지면 앱이 뜨지 않는다.
 *
 * @param {{ serviceWorker?: any, caches?: any }} runtime
 */
export async function purgeServiceWorkers(runtime = {}) {
  const removed = { workers: 0, caches: 0 };
  try {
    const registrations = await runtime.serviceWorker?.getRegistrations?.() ?? [];
    for (const registration of registrations) {
      try { if (await registration.unregister()) removed.workers += 1; } catch (_error) { /* 다음 것을 계속한다 */ }
    }
  } catch (_error) { /* 조회 자체가 막힌 브라우저가 있다 */ }
  try {
    const keys = await runtime.caches?.keys?.() ?? [];
    for (const key of keys) {
      if (!String(key).startsWith(OWNED_CACHE_PREFIX)) continue;
      try { if (await runtime.caches.delete(key)) removed.caches += 1; } catch (_error) { /* 다음 것을 계속한다 */ }
    }
  } catch (_error) { /* 캐시 API 가 없는 환경 */ }
  return removed;
}
