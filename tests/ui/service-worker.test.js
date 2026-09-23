import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  OWNED_CACHE_PREFIX, purgeServiceWorkers, serviceWorkerAction,
} from "../../src/features/ui/service-worker.js";

/* ── 어디서 등록하고 어디서 걷어내는가 ─────────────────────────────────── */

test("production web is the only place a worker is registered", () => {
  assert.equal(serviceWorkerAction({ isNative: false, isDev: false }), "register");
});

test("the dev server never registers one, and cleans up what is already there", () => {
  /* 코드를 고쳐도 화면이 안 바뀌는 일이 반복됐다. 한 번 등록된 워커는 dev 서버를
     껐다 켜도 살아 있어서, 등록을 멈추는 것만으로는 이미 걸린 사람이 풀려나지
     않는다. */
  assert.equal(serviceWorkerAction({ isNative: false, isDev: true }), "unregister");
});

test("the native app cleans up too — it carries its own assets", () => {
  // 그 위에 워커가 끼면 앱을 새로 깔아도 옛 화면이 남는다.
  assert.equal(serviceWorkerAction({ isNative: true, isDev: false }), "unregister");
  assert.equal(serviceWorkerAction({ isNative: true, isDev: true }), "unregister");
});

test("a browser without service workers is left alone", () => {
  // 등록할 것도 걷어낼 것도 없다. 없는 API 를 부르면 그 자리에서 앱이 죽는다.
  assert.equal(serviceWorkerAction({ isNative: false, isDev: false, supported: false }), "none");
  assert.equal(serviceWorkerAction({ isNative: false, isDev: true, supported: false }), "none");
});

/* ── 걷어내기 ────────────────────────────────────────────────────────── */

const fakeRuntime = ({ workers = [], cacheKeys = [] } = {}) => {
  const deleted = [];
  return {
    deleted,
    serviceWorker: { getRegistrations: async () => workers },
    caches: {
      keys: async () => cacheKeys,
      delete: async (key) => { deleted.push(key); return true; },
    },
  };
};

test("every registration is removed, and only this app's caches", () => {
  return (async () => {
    const unregistered = [];
    const runtime = fakeRuntime({
      workers: [
        { unregister: async () => { unregistered.push("a"); return true; } },
        { unregister: async () => { unregistered.push("b"); return true; } },
      ],
      cacheKeys: ["pilateacher-v4", "pilateacher-v3", "someone-elses-cache"],
    });
    const removed = await purgeServiceWorkers(runtime);
    assert.deepEqual(unregistered, ["a", "b"]);
    // 같은 origin 의 다른 캐시는 남의 것이다.
    assert.deepEqual(runtime.deleted, ["pilateacher-v4", "pilateacher-v3"]);
    assert.equal(removed.workers, 2);
    assert.equal(removed.caches, 2);
    assert.equal(OWNED_CACHE_PREFIX, "pilateacher-");
  })();
});

test("one failure does not stop the rest, and nothing throws at the caller", async () => {
  /* 정리하다 만 상태가 정리하지 않은 상태보다 나쁘지는 않다. 여기서 던지면
     앱이 아예 뜨지 않는다. */
  const unregistered = [];
  const runtime = fakeRuntime({
    workers: [
      { unregister: async () => { throw new Error("denied"); } },
      { unregister: async () => { unregistered.push("b"); return true; } },
    ],
    cacheKeys: ["pilateacher-v4"],
  });
  const removed = await purgeServiceWorkers(runtime);
  assert.deepEqual(unregistered, ["b"]);
  assert.equal(removed.workers, 1);
});

test("a runtime without the APIs is handled rather than crashed into", async () => {
  await assert.doesNotReject(() => purgeServiceWorkers({}));
  await assert.doesNotReject(() => purgeServiceWorkers({ serviceWorker: {}, caches: {} }));
});

/* ── 화면이 실제로 이 판정을 쓰는가 ───────────────────────────────────── */

test("main.jsx asks the judgement instead of testing the platform itself", async () => {
  /* 판정이 아무리 맞아도 불리지 않으면 dev 서버는 여전히 워커를 등록한다.
     main.jsx 는 브라우저 밖에서 불러올 수 없어 소스로 확인한다. */
  const source = await readFile(new URL("../../src/main.jsx", import.meta.url), "utf8");
  assert.match(source, /serviceWorkerAction\(\{/);
  assert.match(source, /isDev: import\.meta\.env\.DEV/);
  assert.match(source, /isNative: Capacitor\.isNativePlatform\(\)/);
  assert.match(source, /purgeServiceWorkers\(/);
  // 등록은 한 곳에서만 일어난다.
  assert.equal((source.match(/serviceWorker\.register\(/g) || []).length, 1);
});
