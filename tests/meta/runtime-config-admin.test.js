import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CONFIG_ERROR, appUpdatePayload, buildField, settlementPayload, writeRuntimeConfig,
} = require("../../functions/src/runtime-config-admin.js");

/**
 * 운영 설정 쓰기.
 *
 * 이 숫자 하나가 센터 전체의 수업 확정을 막을 수 있다. 그래서 들어오는 값을
 * 믿지 않고, **빈 칸과 0 을 가른다** -- 0 으로 채우면 "모두 통과" 로 읽혀,
 * 나중에 값을 넣었을 때와 동작이 달라진다.
 */

/* ── 가짜 Firestore ──────────────────────────────────────────────────────── */
const fakeFirestore = (seed = {}) => {
  const docs = new Map(Object.entries(seed));
  return {
    docs,
    collection: () => ({
      doc: (id) => ({
        async set(data) { docs.set(id, data); },
        async get() {
          const data = docs.get(id);
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  };
};

/* ── 빌드 번호 칸 ────────────────────────────────────────────────────────── */

test("an empty build field stays empty and never becomes zero", () => {
  /* 빈 값은 "정하지 않았다" 이다. 0 으로 채우면 최소 빌드 0 이 되어, 아무도
     안 걸리는 것처럼 보이지만 나중에 값을 넣었을 때의 동작과 달라진다. */
  assert.equal(buildField("", "x"), "");
  assert.equal(buildField(null, "x"), "");
  assert.equal(buildField(undefined, "x"), "");
  assert.equal(buildField("  ", "x"), "");
});

test("a build field takes digits only", () => {
  assert.equal(buildField("65", "x"), "65");
  assert.equal(buildField(65, "x"), "65");
  for (const bad of ["1.1.33", "65회", "-3", "6 5"]) {
    assert.throws(() => buildField(bad, "android_latest_build"), /android_latest_build_invalid/, bad);
  }
});

/* ── 안내 설정 ───────────────────────────────────────────────────────────── */

test("a minimum above the latest is refused", () => {
  /* 그대로 두면 최신 앱을 깐 사람까지 필수 팝업에 갇히고, 푸는 길은 이 화면
     뿐인데 그 화면도 폰에 있다. */
  assert.throws(
    () => appUpdatePayload({ android: { latestBuild: "65", minimumBuild: "70" } }),
    new RegExp(CONFIG_ERROR.MINIMUM_ABOVE_LATEST),
  );
  // 같은 번호는 괜찮다 -- "이 빌드부터 쓰라" 는 뜻이다.
  assert.equal(appUpdatePayload({ android: { latestBuild: "65", minimumBuild: "65" } }).android.minimumBuild, "65");
});

test("a minimum with no latest is allowed", () => {
  /* 최신을 안 적고 최소만 올리는 운영이 있다. 그때는 최소가 곧 기준이고,
     update-gate 가 그 번호를 안내에 쓴다. */
  const payload = appUpdatePayload({ ios: { latestBuild: "", minimumBuild: "70" } });
  assert.equal(payload.ios.minimumBuild, "70");
  assert.equal(payload.ios.latestBuild, "");
});

test("the notice is trimmed and both platforms always exist", () => {
  const payload = appUpdatePayload({ android: { message: "x".repeat(500) } });
  assert.equal(payload.android.message.length, 200);
  assert.deepEqual(payload.ios, { latestBuild: "", minimumBuild: "", message: "" });
});

/* ── 확정 차단 ───────────────────────────────────────────────────────────── */

test("the settlement minimums are kept per platform", () => {
  /* 안드로이드 versionCode 와 iOS CFBundleVersion 과 웹 빌드 번호는 서로 다른
     수열이다. 하나로 묶으면 한 플랫폼을 막으려다 다른 쪽을 통째로 막는다. */
  const payload = settlementPayload({ minBuilds: { web: "602", android: "65", ios: "" } });
  assert.deepEqual(payload.minBuilds, { web: "602", android: "65", ios: "" });
});

test("a missing minBuilds object becomes three empty fields", () => {
  assert.deepEqual(settlementPayload({}).minBuilds, { web: "", android: "", ios: "" });
  assert.deepEqual(settlementPayload(null).minBuilds, { web: "", android: "", ios: "" });
});

/* ── 쓰기 ────────────────────────────────────────────────────────────────── */

test("only the two known documents can be written", () => {
  /* 통로를 하나 내면서 runtimeConfig 전체를 열지 않는다. aiRecording 은
     서버가 쓰는 문서라 여기로 들어오면 안 된다. */
  const store = fakeFirestore();
  return assert.rejects(
    () => writeRuntimeConfig(store, { document: "aiRecording", value: {}, actorId: "u1" }),
    new RegExp(CONFIG_ERROR.UNKNOWN_DOCUMENT),
  );
});

test("a write records who changed it and when", async () => {
  /* 이 값이 센터 전체를 막을 수 있어, 바뀐 뒤에 "왜 이렇게 되어 있지" 에
     답할 것이 있어야 한다. */
  const store = fakeFirestore();
  await writeRuntimeConfig(store, {
    document: "appUpdate",
    value: { android: { latestBuild: "65" } },
    actorId: "u-owner",
    now: () => new Date(2026, 9, 5, 12, 0),
  });

  const saved = store.docs.get("appUpdate");
  assert.equal(saved.android.latestBuild, "65");
  assert.equal(saved.updatedBy, "u-owner");
  assert.deepEqual(saved.updatedAt, new Date(2026, 9, 5, 12, 0));
});

test("a refused write leaves the document untouched", async () => {
  /* 절반만 쓰고 멈추면 최소만 올라간 상태로 남는다. */
  const store = fakeFirestore();
  await assert.rejects(() => writeRuntimeConfig(store, {
    document: "appUpdate",
    value: { android: { latestBuild: "65", minimumBuild: "70" } },
    actorId: "u-owner",
  }));
  assert.equal(store.docs.has("appUpdate"), false);
});
