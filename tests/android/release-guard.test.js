import assert from "node:assert/strict";
import test from "node:test";

import {
  compareNumericVersions,
  isAllowedBranch,
  isAllowedGeneratedPath,
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

test("이전 또는 같은 버전을 새 버전으로 보지 않는다", () => {
  assert.equal(compareNumericVersions("1.1.11", "1.1.10"), 1);
  assert.equal(compareNumericVersions("1.1.10", "1.1.10"), 0);
  assert.equal(compareNumericVersions("1.1.9", "1.1.10"), -1);
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
