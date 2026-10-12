import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import yaml from "js-yaml";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("iOS release metadata and privacy usage descriptions are review-ready", async () => {
  const [plist, project] = await Promise.all([read("../../ios/App/App/Info.plist"), read("../../ios/App/App.xcodeproj/project.pbxproj")]);
  assert.match(plist, /NSMicrophoneUsageDescription[\s\S]*수업 직후 음성으로 기록을 남기기 위해 마이크를 사용합니다/);
  ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription", "ITSAppUsesNonExemptEncryption"].forEach((key) => assert.match(plist, new RegExp(key)));

  /* 앱이 한국어 앱이라고 선언해야 날짜 입력기가 한글로 뜬다. WKWebView 안의
     <input type="date"> 는 웹의 lang 이 아니라 *앱의* 지역화를 따르는데, 이
     값이 en 이면 iOS 는 영어 앱으로 보고 요일·월을 영어로 그린다. 폰 언어가
     한국어여도 그렇다 -- 실제로 그렇게 나왔다. */
  assert.match(plist, /<key>CFBundleDevelopmentRegion<\/key>\s*<string>ko<\/string>/);
  assert.match(plist, /<key>CFBundleLocalizations<\/key>\s*<array>\s*<string>ko<\/string>/);
  /* 숫자를 못박지 않는다. 버전을 올릴 때마다 이 줄 때문에 테스트가 깨지는데,
     그것은 버그를 잡는 것이 아니라 손이 하나 더 가는 것이다 (versionCode 쪽에서
     같은 이유로 못을 뺐다).

     진짜 불변은 "두 빌드 설정이 같은 값을 말한다"이다. tools/ios/prepare_build_metadata.py
     가 MARKETING_VERSION 이 하나로 모이지 않으면 빌드를 멈추므로, Debug 만 올리고
     Release 를 잊으면 Codemagic 에서 터진다 -- 여기서 먼저 잡는다. */
  const versions = project.match(/MARKETING_VERSION = ([^;]+);/g) || [];
  assert.equal(versions.length, 2, "빌드 설정은 Debug 와 Release 둘이다");
  assert.equal(new Set(versions).size, 1, `두 설정의 버전이 다르다: ${versions.join(" / ")}`);
  assert.match(versions[0], /MARKETING_VERSION = \d+\.\d+\.\d+;/);
  /* CFBundleVersion 은 저장소 값이 쓰이지 않는다. codemagic.yaml 이 빌드 직전에
     agvtool new-version -all $BUILD_NUMBER 로 덮어쓴다 -- 여기 적힌 숫자를 올려도
     스토어에 나가는 빌드 번호는 바뀌지 않는다. 그 연결이 끊기면 알아야 한다. */
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/);
});

test("iOS permanent microphone denial opens native app settings through a registered Capacitor plugin", async () => {
  const [delegate, storyboard] = await Promise.all([
    read("../../ios/App/App/AppDelegate.swift"),
    read("../../ios/App/App/Base.lproj/Main.storyboard"),
  ]);
  assert.match(delegate, /class AppSettingsPlugin: CAPPlugin, CAPBridgedPlugin/);
  assert.match(delegate, /UIApplication\.openSettingsURLString/);
  assert.match(delegate, /registerPluginType\(AppSettingsPlugin\.self\)/);
  assert.match(storyboard, /customClass="PilaTeacherBridgeViewController"/);
  assert.match(storyboard, /customModule="App"/);
});

test("Codemagic builds with Node 22, signing group, and uploads without submitting", async () => {
  const yaml = await read("../../codemagic.yaml");
  assert.match(yaml, /node: 22/);
  assert.match(yaml, /- signing/);

  /* 스토어 제출은 사람이 누른다. 이 줄만이 진짜 지켜야 할 것이다. */
  assert.match(yaml, /submit_to_app_store: false/);

  /* 베타 심사에 넣지 않는다. 내부 테스터는 처리만 끝나면 바로 받고, 심사는
     한 트레인에 하나뿐이라 같은 버전의 두 번째 빌드가 422 로 막힌다. */
  assert.match(yaml, /submit_to_testflight: false/);

  /* beta_groups 를 못 박지 않는다 -- 이 검사가 예전에 'Internal' 을 고정하고
     있었는데, 그 이름의 그룹은 App Store Connect 에 없었다. 저장소 안에만
     있는 문자열을 저장소 안에서 확인하니 늘 통과했고, 진짜 실패는 빌드
     로그에서만 보였다. 저쪽에 있는 것을 여기서 못 박으면 이렇게 된다.

     대신 여기 없는지만 본다. 없는 그룹을 가리키면 배포가 실패한다. */
  assert.doesNotMatch(yaml, /beta_groups:/);
});

/* 자동 트리거가 없다 — **빌드는 사람이 고른다.**

   한때 main 에 푸시가 들어가면 두 iOS 워크플로가 자동으로 돌았다. 병합 한
   번이 빌드 하나였고, 무료 플랜은 macOS 를 한 번에 하나만 돌린다. 2026-10-12
   에 네 번 병합했더니 네 개가 줄을 섰는데 올려야 할 것은 마지막 하나뿐이었고,
   앞의 셋 중에는 **버린 버전 번호로 만든 빌드**가 끼어 있었다. 그것이 먼저
   끝나 TestFlight 에 올라가면 1.1.36 빌드가 1.1.37 자리에 선다.

   강사 앱 쪽은 changeset 이 '.' 이라 **문서를 한 글자 고쳐도 돌았다.**

   이 검사가 지키는 것은 "자동으로 도는 자리가 없다" 하나다. 되살리는 방법은
   codemagic.yaml 의 주석에 그대로 남아 있다. */
test("iOS 워크플로 둘 다 수동 실행만 — 자동 트리거가 없다", async () => {
  const source = await read("../../codemagic.yaml");
  const { workflows } = yaml.load(source);

  for (const key of ["ios-testflight", "member-ios-testflight"]) {
    assert.ok(workflows[key], `${key} 가 없다`);
    assert.equal(workflows[key].triggering, undefined, `${key} 에 트리거가 남아 있다`);
    /* changeset 은 웹훅 빌드에만 적용된다. 트리거가 없는데 남아 있으면 읽는
       사람이 "이 조건으로 돈다" 고 믿게 된다 -- 아무것도 안 하는 설정이다. */
    assert.equal(workflows[key].when, undefined, `${key} 에 when 이 남아 있다`);
  }

  /* 회원 앱 Android 는 처음부터 수동이었다. 셋이 같아야 한다 -- 하나만 자동이면
     그 하나가 병합 때마다 조용히 돈다. */
  for (const flow of Object.values(workflows)) {
    assert.equal(flow.triggering, undefined);
  }
});

test("public privacy and deletion pages disclose Firebase, OpenAI, audio deletion and device photos", async () => {
  for (const path of ["../../public/privacy.html", "../../public/delete.html"]) {
    const page = await read(path);
    ["Firebase", "OpenAI", "오디오", "삭제", "체형 사진", "기기"].forEach((copy) => assert.match(page, new RegExp(copy)));
  }
});
