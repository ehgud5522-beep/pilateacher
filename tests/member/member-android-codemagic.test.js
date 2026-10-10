import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

/**
 * Codemagic 회원 앱 Android 워크플로. 대표 결정(2026-10-10)을 고정한다.
 *
 *   그룹 이름   bonita_member_signing  -- 강사 앱 때 "singing" 오타로 아홉 번 실패
 *   트리거      없음 (수동 실행만)
 *   결과물      AAB + APK
 *   업로드      하지 않는다 (스토어 업로드는 대표가 한다)
 *   versionCode Codemagic 빌드 번호
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(path.join(root, "codemagic.yaml"), "utf8");
const workflows = yaml.load(source).workflows;
const android = workflows["member-android"];
const scripts = () => android.scripts.map((step) => `${step.name}\n${step.script}`).join("\n");

test("회원 앱 Android 워크플로가 있다", () => {
  assert.ok(android, "member-android 가 없다");
  assert.equal(android.environment.vars.PACKAGE_NAME, "com.bonitapilates.member");
});

test("그룹 이름은 bonita_member_signing 이다 — singing 이 아니다", () => {
  assert.deepEqual(android.environment.groups, ["bonita_member_signing"]);
  /* 오타 난 이름이 그룹으로 적힌 곳이 없어야 한다. 한 군데 남아 있으면 누군가
     그것을 복사한다. (설명 주석에 그 낱말이 나오는 것은 괜찮다.) */
  for (const workflow of Object.values(workflows)) {
    for (const group of workflow.environment?.groups || []) assert.doesNotMatch(group, /singing/);
  }
});

test("수동 실행만 — 트리거가 없다", () => {
  assert.equal(android.triggering, undefined);
  assert.equal(android.when, undefined);
});

test("올리지 않는다 — AAB 와 APK 를 남기기만 한다", () => {
  assert.equal(android.publishing, undefined);
  assert.ok(android.artifacts.some((item) => /bundle\/release\/\*\.aab$/.test(item)));
  assert.ok(android.artifacts.some((item) => /apk\/release\/\*\.apk$/.test(item)));
  assert.match(scripts(), /bundleRelease assembleRelease/);
});

test("versionCode 는 빌드 번호다", () => {
  assert.match(scripts(), /-PmemberVersionCode="\$BUILD_NUMBER"/);
  const gradle = readFileSync(path.join(root, "member-app/android/app/build.gradle"), "utf8");
  assert.match(gradle, /versionCode\(\(project\.findProperty\('memberVersionCode'\) \?: '1'\) as Integer\)/);
});

test("변수를 먼저 보고, 키와 설정 파일을 검사한다", () => {
  const body = scripts();
  for (const name of ["MEMBER_KEYSTORE_BASE64", "MEMBER_KEYSTORE_PASSWORD", "MEMBER_KEY_ALIAS",
    "MEMBER_KEY_PASSWORD", "MEMBER_GOOGLE_SERVICES_JSON"]) {
    assert.ok(body.includes(name), name);
  }
  // 첫 단계가 변수 검사다 -- 그룹을 못 찾으면 변수가 빈 채로 빌드가 시작된다.
  assert.match(android.scripts[0].name, /변수/);
  assert.match(body, /node tools\/member\/google-services\.mjs/);
  assert.match(body, /checkUploadSignature/);
  assert.match(body, /bonita-member-upload/);
});

test("비밀을 로그에 찍지 않는다", () => {
  /* echo 는 파일로만 간다. 화면으로 나가는 echo 에 비밀번호 변수가 있으면 안 된다. */
  /* keystore.properties 를 쓰는 { … } > 파일 묶음은 통째로 파일로 간다. */
  const outsideFileBlocks = scripts()
    .replace(/\{[^{}]*\}\s*>\s*member-app\/android\/keystore\.properties/g, "");
  assert.notEqual(outsideFileBlocks, scripts(), "keystore.properties 묶음을 찾지 못했다");
  for (const line of outsideFileBlocks.split("\n")) {
    if (/PASSWORD|BASE64|GOOGLE_SERVICES_JSON/.test(line) && /\becho\b/.test(line)) {
      assert.match(line, /(>|\|\s*base64)/, `화면으로 나가는 줄: ${line.trim()}`);
    }
  }
  assert.doesNotMatch(scripts(), /set -x/);
});

test("강사 앱 워크플로는 그대로다", () => {
  assert.ok(workflows["ios-testflight"]);
  assert.ok(workflows["member-ios-testflight"]);
  // 강사 앱 Android 를 회원 앱 워크플로가 만들지 않는다.
  assert.doesNotMatch(scripts(), /android:aab|\bcd android\b/);
});
