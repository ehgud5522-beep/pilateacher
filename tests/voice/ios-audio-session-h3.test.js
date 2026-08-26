import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("iOS server recording always requests the approved play-and-record session", async () => {
  const source = await read("../../src/App.jsx");
  assert.match(source, /audioSessionMode:\s*"DEFAULT"/);
  assert.match(source, /audioSessionCategoryOptions:\s*\["ALLOW_BLUETOOTH",\s*"DEFAULT_TO_SPEAKER"\]/);
  assert.doesNotMatch(source.slice(source.indexOf("const SERVER_AUDIO_RECORDING_OPTIONS"), source.indexOf("const AppSettings")), /MEASUREMENT|DUCK_OTHERS/);
  assert.match(source, /releaseSpeechAudioSession\("before_server_recording"\)/);
});

test("the microphone diagnostic exposes every native stage and exact NSError fields", async () => {
  const [source, recorderPatch] = await Promise.all([
    read("../../src/App.jsx"),
    read("../../tools/patch-audio-recorder-edge.mjs"),
  ]);
  assert.match(source, /"마이크 테스트"/);
  assert.match(source, /CapacitorAudioRecorder\.runMicrophoneTest\(\)/);
  assert.match(source, /step\.domain/);
  assert.match(source, /step\.code/);
  assert.match(source, /step\.localizedDescription/);
  for (const stage of ["permission", "session_before_start", "set_category", "set_active", "record_start", "record_stop"]) {
    assert.match(recorderPatch, new RegExp(`stage: ["']${stage}["']`));
  }
  assert.match(recorderPatch, /\.now\(\) \+ 1\.0/);
  assert.match(recorderPatch, /"otherSessionOwner": "not_exposed_by_ios"/);
});

test("native recorder patch uses modern permission API and interruption diagnostics", async () => {
  const nativeSource = await read("../../node_modules/@capgo/capacitor-audio-recorder/ios/Sources/CapacitorAudioRecorderPlugin/CapacitorAudioRecorderPlugin.swift");
  assert.match(nativeSource, /AVAudioApplication\.shared\.recordPermission/);
  assert.match(nativeSource, /AVAudioApplication\.requestRecordPermission/);
  assert.match(nativeSource, /\.playAndRecord/);
  assert.match(nativeSource, /mode: \.default/);
  assert.match(nativeSource, /options: \[\.allowBluetooth, \.defaultToSpeaker\]/);
  assert.match(nativeSource, /setActive\(true, options: \.notifyOthersOnDeactivation\)/);
  assert.match(nativeSource, /AVAudioSession\.interruptionNotification/);
  assert.match(nativeSource, /audioSessionInterruption began/);
  assert.match(nativeSource, /audioSessionInterruption ended/);
});

test("speech recognition releases its audio session and never activates one at plugin load", async () => {
  const patch = await read("../../tools/patch-speech-recognition-capacitor8.mjs");
  assert.match(patch, /releaseAudioSession/);
  assert.match(patch, /releaseRecognitionAudioSession/);
  assert.match(patch, /setActive\(false, options: \.notifyOthersOnDeactivation\)/);
  assert.match(patch, /inputTapInstalled/);
  assert.doesNotMatch(patch, /override\s+(public\s+)?func\s+load[\s\S]*setActive\(true/);
});

test("two iOS server start failures fall back to native speech without hiding the failure", async () => {
  const source = await read("../../src/App.jsx");
  assert.match(source, /serverStartFailuresRef\.current = failedAttempts/);
  assert.match(source, /failedAttempts >= 2/);
  assert.match(source, /start\(\{ forceNative: true \}\)/);
  assert.match(source, /voiceEngine: "native"/);
  assert.match(source, /녹음 시작에 실패해 iOS 음성 인식으로 전환합니다/);
  assert.equal((source.match(/VOICE_ENGINE_MODE === "server" && sourceRef\.current !== "native"/g) || []).length, 2);
});

test("installed native plugin lines are Capacitor 8 compatible and pinned by patch guards", async () => {
  const [pkg, speechPatch, recorderPatch] = await Promise.all([
    read("../../package.json"),
    read("../../tools/patch-speech-recognition-capacitor8.mjs"),
    read("../../tools/patch-audio-recorder-edge.mjs"),
  ]);
  const parsed = JSON.parse(pkg);
  assert.match(parsed.dependencies["@capacitor/core"], /^\^8\./);
  assert.equal(parsed.dependencies["@capacitor-community/speech-recognition"], "^7.0.1");
  assert.equal(parsed.dependencies["@capgo/capacitor-audio-recorder"], "^8.2.7");
  assert.match(speechPatch, /expectedVersion = "7\.0\.1"/);
  assert.match(recorderPatch, /expectedVersion = "8\.2\.7"/);
});
