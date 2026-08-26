import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NATIVE_SPEECH_RESULT_TIMEOUT_MS,
  SPEECH_PERMISSION_STATE,
  describeSpeechError,
  isSpeechPermissionGranted,
  speechPermissionAvailability,
  speechPermissionState,
} from "../../src/features/voice/speech-session.js";

test("speech permission checks fail closed", () => {
  assert.equal(isSpeechPermissionGranted({ speechRecognition: "granted" }), true);
  assert.equal(isSpeechPermissionGranted({ speechRecognition: "denied" }), false);
  assert.equal(isSpeechPermissionGranted(null), false);
  assert.equal(isSpeechPermissionGranted(undefined), false);
});

test("Android speech permission states distinguish grant, retryable denial, and permanent denial", () => {
  assert.equal(speechPermissionState({ speechRecognition: "granted" }), SPEECH_PERMISSION_STATE.GRANTED);
  assert.equal(speechPermissionState({ speechRecognition: "prompt" }), SPEECH_PERMISSION_STATE.DENIED);
  assert.equal(speechPermissionState({ speechRecognition: "prompt-with-rationale" }), SPEECH_PERMISSION_STATE.DENIED);
  assert.equal(speechPermissionState({ speechRecognition: "denied" }), SPEECH_PERMISSION_STATE.PERMANENTLY_DENIED);
  assert.equal(speechPermissionAvailability({ speechRecognition: "granted" }), "ready");
  assert.equal(speechPermissionAvailability({ speechRecognition: "denied" }), "permission_permanently_denied");
});

test("native speech failures produce cause-specific guidance", () => {
  assert.equal(describeSpeechError(new Error("Network timeout")).kind, "network");
  assert.equal(describeSpeechError(new Error("Network timeout")).code, "stt_network");
  assert.equal(describeSpeechError(new Error("error from server")).kind, "network");
  assert.equal(describeSpeechError(new Error("Audio recording error")).kind, "audio");
  assert.equal(describeSpeechError(new Error("Audio recording error")).code, "stt_audio");
  assert.equal(describeSpeechError(new Error("No match")).kind, "no_speech");
  assert.equal(describeSpeechError(new Error("No match")).code, "stt_no_speech");
  assert.equal(describeSpeechError(new Error("RecognitionService busy")).kind, "busy");
  assert.equal(describeSpeechError(new Error("RecognitionService busy")).code, "recognizer_busy");
  assert.equal(describeSpeechError(new Error("Insufficient permissions")).kind, "permission");
  assert.equal(describeSpeechError(new Error("Insufficient permissions")).code, "mic_permission_denied");
  assert.equal(describeSpeechError(new Error("speech_recognition_unavailable")).kind, "unavailable");
  assert.equal(describeSpeechError(new Error("speech_recognition_unavailable")).code, "recognizer_unavailable");
  assert.ok(NATIVE_SPEECH_RESULT_TIMEOUT_MS >= 5000);
});

test("VoiceNote gives the native recognizer exclusive microphone ownership", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const startIndex = source.indexOf("  const start = async (options = {}) => {");
  const stopIndex = source.indexOf("  const stop = (reason = \"manual\") => {", startIndex);
  assert.ok(startIndex >= 0 && stopIndex > startIndex);
  const startSource = source.slice(startIndex, stopIndex);

  assert.match(startSource, /if \(!NS\) \{[\s\S]*?await prepareMedia\(\);/);
  assert.match(startSource, /NS\.start\(\{[^}]*partialResults: false[^}]*popup: false/);
  assert.doesNotMatch(startSource, /NS\.start\(\{[^}]*partialResults: true/);
  assert.match(startSource, /sessionId !== speechSessionRef\.current/);
  assert.match(startSource, /NATIVE_SPEECH_RESULT_TIMEOUT_MS/);
  assert.match(startSource, /startNativeSegment/);
  assert.match(startSource, /RECOGNIZER_BUSY_RETRY_MS/);
  assert.match(startSource, /stitchSpeechTranscript/);
});

test("native packaging declares Android and iOS speech requirements", async () => {
  const [manifest, infoPlist, appPackage, postinstall, spmPatch] = await Promise.all([
    readFile(new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
    readFile(new URL("../../ios/App/App/Info.plist", import.meta.url), "utf8"),
    readFile(new URL("../../ios/App/CapApp-SPM/Package.swift", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../tools/patch-speech-recognition-capacitor8.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android\.speech\.RecognitionService/);
  assert.match(infoPlist, /NSMicrophoneUsageDescription/);
  assert.match(infoPlist, /NSSpeechRecognitionUsageDescription/);
  assert.match(appPackage, /CapacitorCommunitySpeechRecognition/);
  assert.doesNotMatch(appPackage, /path: "[^"\n]*\\/);
  assert.match(postinstall, /patch-speech-recognition-capacitor8\.mjs/);
  assert.match(spmPatch, /CapacitorCommunitySpeechRecognition/);
  assert.match(spmPatch, /call\\\.resolve/);
  assert.match(spmPatch, /CAPBridgedPlugin/);
  assert.match(spmPatch, /sources: \["Plugin\.swift"\]/);
});
