import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("every AI action checks member consent before invoking the gateway", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /fbLoadAIConsent/);
  assert.match(source, /fbGrantAIConsent/);
  assert.match(source, /AI_CONSENT_POLICY_VERSION/);

  const operations = [
    ["analyzeBody", "aiProvider.analyzeBody"],
    ["summarizeVoice", "lessonRecordLlm.structureLessonRecord"],
    ["generateReport", "aiProvider.generateReport"],
  ];
  for (const [consentOperation, providerCall] of operations) {
    const consentIndex = source.indexOf(`ensureMemberAIConsent(member?.id, \"${consentOperation}\"`);
    const alternateIndex = source.indexOf(`ensureMemberAIConsent(member.id, \"${consentOperation}\"`);
    const activeMemberIndex = source.indexOf(`ensureMemberAIConsent(activeMember.id, \"${consentOperation}\"`);
    const voiceIndex = source.indexOf(`ensureMemberAIConsent(memberId, \"${consentOperation}\"`);
    const firstConsent = Math.max(consentIndex, alternateIndex, activeMemberIndex, voiceIndex);
    const providerIndex = source.indexOf(providerCall);
    assert.ok(firstConsent >= 0, `${consentOperation} consent guard is missing`);
    assert.ok(providerIndex > firstConsent || source.indexOf(providerCall, firstConsent) > firstConsent, `${providerCall} must run after consent`);
  }
});

test("lesson sequence UI is deferred while its provider and schema contracts remain", async () => {
  const [source, inputBuilders, operationContracts] = await Promise.all([
    readFile(new URL("../../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/ai/input-builders.js", import.meta.url), "utf8"),
    readFile(new URL("../../functions/src/operation-contracts.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /AI 수업 시퀀스 추천|aiProvider\.recommendSequence|추천 생성/);
  assert.match(inputBuilders, /export function buildSequenceInput/);
  assert.match(operationContracts, /recommendSequence/);
});

test("AI consent copy discloses transmitted data and excludes original photos", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /수업 기록·음성 전사·체형 좌표와 각도/);
  assert.match(source, /사진 원본은 AI로 전송하지 않으며/);
  assert.match(source, /강사 검수 전 초안/);
});

test("Vite build settings use statically replaceable import.meta.env access", async () => {
  const [source, dualWriteSource] = await Promise.all([
    readFile(new URL("../../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/data/dual-write/app-runtime.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /import\.meta\.env\?\./);
  assert.match(source, /import\.meta\.env\.VITE_APP_VERSION/);
  assert.match(source, /import\.meta\.env\.VITE_BUILD_NUMBER/);
  assert.match(source, /import\.meta\.env\.VITE_IOS_NATIVE_CAPTURE_ENABLED/);
  assert.doesNotMatch(dualWriteSource, /\(import\.meta\)\.env/);
  assert.match(dualWriteSource, /VITE_FIREBASE_DUAL_WRITE_ENABLED: import\.meta\.env\.VITE_FIREBASE_DUAL_WRITE_ENABLED/);
});
