import assert from "node:assert/strict";
import test from "node:test";

import {
  blockedVersionReason,
  compareNumericVersions,
  hasFirebaseWebClient,
  isAllowedBranch,
  isAllowedGeneratedPath,
  missingAndroidOAuthSha1,
  parsePorcelainPaths,
  parseGradleVersion,
} from "../../tools/android/release-guard.mjs";

test("Android Gradle 버전 정보를 읽는다", () => {
  const result = parseGradleVersion(`
    defaultConfig {
      versionCode 15
      versionName "1.1.11"
    }
  `);
  assert.deepEqual(result, { versionCode: 15, versionName: "1.1.11" });
});

test("첫 porcelain 행의 선행 공백이 trim되어도 전체 경로를 보존한다", () => {
  assert.deepEqual(
    parsePorcelainPaths("M dist/assets/index.js\n M android/app/src/main/assets/public/index.html"),
    ["dist/assets/index.js", "android/app/src/main/assets/public/index.html"],
  );
});

test("Play 서명 SHA-1과 Firebase Android OAuth 설정을 대조한다", () => {
  const googleServices = {
    client: [{ oauth_client: [
      { client_type: 1, android_info: { certificate_hash: "aabb" } },
      { client_type: 3, client_id: "web-client.apps.googleusercontent.com" },
    ] }],
  };
  assert.deepEqual(missingAndroidOAuthSha1(googleServices, ["AA:BB"]), []);
  assert.deepEqual(missingAndroidOAuthSha1(googleServices, ["AA:BB", "CC:DD"]), ["ccdd"]);
  assert.equal(hasFirebaseWebClient(googleServices, "web-client.apps.googleusercontent.com"), true);
  assert.equal(hasFirebaseWebClient(googleServices, "wrong-client.apps.googleusercontent.com"), false);
});

test("이전 또는 같은 버전을 새 버전으로 보지 않는다", () => {
  assert.equal(compareNumericVersions("1.1.11", "1.1.10"), 1);
  assert.equal(compareNumericVersions("1.1.10", "1.1.10"), 0);
  assert.equal(compareNumericVersions("1.1.9", "1.1.10"), -1);
});

test("versionCode는 반드시 오르고, versionName은 같아도 되지만 낮아질 수 없다", () => {
  const policy = { lastPublishedVersionCode: 42, lastPublishedVersionName: "1.1.22" };
  assert.equal(blockedVersionReason({ versionCode: 43, versionName: "1.1.22" }, policy), null,
    "한 마케팅 버전으로 여러 테스트 빌드를 내는 것이 현재 방식이다");
  assert.equal(blockedVersionReason({ versionCode: 44, versionName: "1.1.23" }, policy), null);
  assert.match(blockedVersionReason({ versionCode: 42, versionName: "1.1.22" }, policy), /versionCode 42/,
    "이미 게시된 코드는 재사용할 수 없다");
  assert.match(blockedVersionReason({ versionCode: 41, versionName: "1.1.23" }, policy), /versionCode 41/);
  assert.match(blockedVersionReason({ versionCode: 43, versionName: "1.1.21" }, policy), /versionName 1\.1\.21/,
    "versionName이 뒤로 가는 것은 실수다");
  assert.equal(blockedVersionReason({ versionCode: 43, versionName: "beta" }, policy), null,
    "숫자로 비교할 수 없는 이름은 versionCode 규칙만 적용한다");
});

test("Android 전용 릴리스 브랜치만 허용한다", () => {
  const patterns = ["^codex/android-", "^release/android-"];
  assert.equal(isAllowedBranch("codex/android-private-test-v15", patterns), true);
  assert.equal(isAllowedBranch("release/android-1.1.11", patterns), true);
  assert.equal(isAllowedBranch("codex/testflight-ui-fixes-v1", patterns), false);
});

test("빌드 중에는 생성 파일만 바뀔 수 있다", () => {
  const allowed = ["dist/", "android/app/src/main/assets/"];
  assert.equal(isAllowedGeneratedPath("dist/assets/index.js", allowed), true);
  assert.equal(
    isAllowedGeneratedPath("android/app/src/main/assets/public/index.html", allowed),
    true,
  );
  assert.equal(isAllowedGeneratedPath("src/App.jsx", allowed), false);
});
