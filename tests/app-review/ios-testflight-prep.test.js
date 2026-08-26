import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("iOS release metadata and privacy usage descriptions are review-ready", async () => {
  const [plist, project] = await Promise.all([read("../../ios/App/App/Info.plist"), read("../../ios/App/App.xcodeproj/project.pbxproj")]);
  assert.match(plist, /NSMicrophoneUsageDescription[\s\S]*수업 직후 음성으로 기록을 남기기 위해 마이크를 사용합니다/);
  ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription", "ITSAppUsesNonExemptEncryption"].forEach((key) => assert.match(plist, new RegExp(key)));
  assert.equal((project.match(/MARKETING_VERSION = 1\.1\.22;/g) || []).length, 2);
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
