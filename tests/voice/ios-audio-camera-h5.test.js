import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("H-5 overrides the H-4 load-time category with per-recording session configuration", async () => {
  const [patch, native] = await Promise.all([
    read("../../tools/patch-audio-recorder-h5.mjs"),
    read("../../node_modules/@capgo/capacitor-audio-recorder/ios/Sources/CapacitorAudioRecorderPlugin/CapacitorAudioRecorderPlugin.swift"),
  ]);
  assert.match(patch, /PILATEACHER_H5_SESSION_PER_START/);
  assert.match(native, /private func configureAndActivateAudioSession\(\) throws/);
  assert.match(native, /setCategory\([\s\S]*\.playAndRecord[\s\S]*mode: \.default[\s\S]*\.allowBluetooth, \.defaultToSpeaker/);
  assert.match(native, /setActive\(true, options: \.notifyOthersOnDeactivation\)/);
  assert.doesNotMatch(native, /configureCategoryOnce|categoryConfigured/);
  assert.ok((native.match(/try self\.configureAndActivateAudioSession\(\)/g) || []).length >= 3);
});

test("H-5 uses a fresh supported m4a recorder and exposes full initialization diagnostics", async () => {
  const native = await read("../../node_modules/@capgo/capacitor-audio-recorder/ios/Sources/CapacitorAudioRecorderPlugin/CapacitorAudioRecorderPlugin.swift");
  assert.match(native, /AVFormatIDKey: Int\(kAudioFormatMPEG4AAC\)/);
  assert.match(native, /AVSampleRateKey: 44_100\.0/);
  assert.match(native, /AVNumberOfChannelsKey: 1/);
  assert.match(native, /AVEncoderAudioQualityKey: AVAudioQuality\.medium\.rawValue/);
  assert.match(native, /temporaryDirectory\.appendingPathComponent\("CapacitorAudioRecorder", isDirectory: true\)/);
  assert.match(native, /UUID\(\)\.uuidString\)\.m4a/);
  assert.match(native, /stage=recorder_init/);
  assert.match(native, /"recordingSettings": settings/);
  assert.match(native, /"audioSessionCategoryOptions": audioSession\.categoryOptions\.rawValue/);
});

test("H-5 camera patch serializes teardown and releases audio around preview", async () => {
  const [controller, plugin] = await Promise.all([
    read("../../node_modules/@capgo/camera-preview/ios/Sources/CapgoCameraPreviewPlugin/CameraController.swift"),
    read("../../node_modules/@capgo/camera-preview/ios/Sources/CapgoCameraPreviewPlugin/Plugin.swift"),
  ]);
  assert.match(controller, /PILATEACHER_H5_CAMERA_SESSION_SAFETY/);
  assert.match(controller, /requestPilaTeacherSafeCleanup/);
  assert.match(controller, /dataOutput\?\.setSampleBufferDelegate\(nil, queue: nil\)/);
  assert.match(controller, /metadataOutput\?\.setMetadataObjectsDelegate\(nil, queue: nil\)/);
  const stopRunning = controller.indexOf("session?.stopRunning()");
  const removePreview = controller.indexOf("self.previewLayer?.removeFromSuperlayer()", stopRunning);
  assert.ok(stopRunning >= 0 && removePreview > stopRunning);
  assert.match(plugin, /setActive\(false, options: \.notifyOthersOnDeactivation\)/);
  assert.match(plugin, /restorePilaTeacherAudioSessionAfterCamera/);
  assert.match(plugin, /Processing capture off main thread/);
});

test("the app persists the five camera pipeline stages and provides an iOS camera test", async () => {
  const app = await read("../../src/App.jsx");
  for (const stage of ["capture_start", "captured", "saved", "preview_stopped", "returned"]) {
    assert.match(app, new RegExp(`cameraPipelineLog\\("${stage}"`));
  }
  assert.match(app, /카메라 테스트/);
  assert.match(app, /CameraPreview\.start\(/);
  assert.match(app, /CameraPreview\.capture\(/);
  assert.match(app, /Filesystem\.writeFile\([\s\S]*camera-test-/);
  assert.match(app, /quality: 85, width: 1080, height: 1440/);
  assert.match(app, /audioSessionCategoryOptions: step\?\.audioSessionCategoryOptions/);
});

test("postinstall applies camera safety and H-5 after their prerequisite patches", async () => {
  const [pkgSource, validator] = await Promise.all([
    read("../../package.json"),
    read("../../tools/ios/validate_release_source.py"),
  ]);
  const pkg = JSON.parse(pkgSource);
  const script = pkg.scripts.postinstall;
  assert.ok(script.indexOf("patch-camera-preview-ios-session-safety.mjs") > script.indexOf("patch-camera-preview-ios-no-location.mjs"));
  assert.ok(script.indexOf("patch-audio-recorder-h5.mjs") > script.indexOf("patch-audio-recorder-h4.mjs"));
  assert.match(validator, /PILATEACHER_H5_SESSION_PER_START/);
  assert.match(validator, /PILATEACHER_H5_CAMERA_SESSION_SAFETY/);
  assert.match(validator, /configureCategoryOnce" not in audio_recorder/);
});
