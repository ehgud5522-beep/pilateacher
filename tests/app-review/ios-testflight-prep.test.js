import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("iOS release metadata and privacy usage descriptions are review-ready", async () => {
  const [plist, project] = await Promise.all([read("../../ios/App/App/Info.plist"), read("../../ios/App/App.xcodeproj/project.pbxproj")]);
  assert.match(plist, /NSMicrophoneUsageDescription[\s\S]*수업 직후 음성으로 기록을 남기기 위해 마이크를 사용합니다/);
  ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription", "ITSAppUsesNonExemptEncryption"].forEach((key) => assert.match(plist, new RegExp(key)));
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

test("Codemagic builds main with Node 22, signing group, and TestFlight only", async () => {
  const yaml = await read("../../codemagic.yaml");
  assert.match(yaml, /pattern: main/);
  assert.match(yaml, /node: 22/);
  assert.match(yaml, /- signing/);
  assert.match(yaml, /submit_to_testflight: true/);
  assert.match(yaml, /submit_to_app_store: false/);
  assert.match(yaml, /beta_groups:[\s\S]*- Internal/);
});

test("public privacy and deletion pages disclose Firebase, OpenAI, audio deletion and device photos", async () => {
  for (const path of ["../../public/privacy.html", "../../public/delete.html"]) {
    const page = await read(path);
    ["Firebase", "OpenAI", "오디오", "삭제", "체형 사진", "기기"].forEach((copy) => assert.match(page, new RegExp(copy)));
  }
});
