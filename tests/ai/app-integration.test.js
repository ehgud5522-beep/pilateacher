import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("body analysis has no call path from the app at all", async () => {
  /* The operation is still in the contract and the provider interface, but
     nothing on any screen reaches for it. Asking for a consent gate around
     a call that does not exist proves nothing; asking that the call stays
     absent is the thing that has to hold. Add one back and this fails,
     which is the moment to put it in the list above with its gate. */
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /aiProvider\.analyzeBody/, "a new call must be added to the consent list above");
});

test("every AI action checks member consent before invoking the gateway", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /fbLoadAIConsent/);
  assert.match(source, /fbGrantAIConsent/);
  assert.match(source, /AI_CONSENT_POLICY_VERSION/);

  const operations = [
    ["summarizeVoice", "lessonRecordLlm.structureLessonRecord"],
    ["generateReport", "aiProvider.generateReport"],
  ];
  for (const [consentOperation, providerCall] of operations) {
    const consentIndex = source.indexOf(`ensureMemberAIConsent(member?.id, \"${consentOperation}\"`);
    const alternateIndex = source.indexOf(`ensureMemberAIConsent(member.id, \"${consentOperation}\"`);
    const activeMemberIndex = source.indexOf(`ensureMemberAIConsent(activeMember.id, \"${consentOperation}\"`);
    const voiceIndex = source.indexOf(`ensureMemberAIConsent(memberId, \"${consentOperation}\"`);
    /* 수업기록의 문은 공용 판정을 거친다. 듀엣이면 두 사람 모두의 동의를 받아야
       하는데(수업기록에 두 사람 이야기가 같이 들어간다) 회원 하나만 보는 호출로는
       그 판정을 할 수 없어 ensureLessonConsent 로 모았다. 그 함수가 회원마다
       ensureMemberAIConsent 를 부르므로 문이 사라진 것이 아니다 -- 아래 두 줄이
       그 사실을 확인한다. 확인 없이 이름만 받아 주면 빈 함수도 통과한다. */
    const sharedIndex = consentOperation === "summarizeVoice" ? source.indexOf("await ensureLessonConsent(") : -1;
    if (sharedIndex >= 0) {
      assert.match(source, /const ensureLessonConsent = async[\s\S]{0,200}ensureEveryConsent\(/, "공용 판정이 동의를 건너뛴다");
      assert.match(source, /ensureMemberAIConsent\(id, "summarizeVoice"/, "공용 판정이 회원 동의를 부르지 않는다");
    }
    const firstConsent = Math.max(consentIndex, alternateIndex, activeMemberIndex, voiceIndex, sharedIndex);
    const providerIndex = source.indexOf(providerCall);
    assert.ok(firstConsent >= 0, `${consentOperation} consent guard is missing`);
    assert.ok(providerIndex > firstConsent || source.indexOf(providerCall, firstConsent) > firstConsent, `${providerCall} must run after consent`);
  }
});

test("lesson sequence UI and client call are deferred while schema contracts remain", async () => {
  const [source, providerSource, inputBuilders, operationContracts, gatewaySource, promptsSource] = await Promise.all([
    readFile(new URL("../../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/ai/provider.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/ai/input-builders.js", import.meta.url), "utf8"),
    readFile(new URL("../../functions/src/operation-contracts.js", import.meta.url), "utf8"),
    readFile(new URL("../../functions/src/ai-gateway.js", import.meta.url), "utf8"),
    readFile(new URL("../../functions/src/prompts.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /AI 수업 시퀀스 추천|aiProvider\.recommendSequence|추천 생성/);
  assert.doesNotMatch(providerSource, /recommendSequence\s*\(/);
  assert.match(inputBuilders, /export function buildSequenceInput/);
  assert.match(operationContracts, /recommendSequence/);
  assert.match(gatewaySource, /DEFERRED_OPERATIONS\.has\(request\.operation\)/);
  assert.match(promptsSource, /DEFER:/);
});

test("AI consent copy discloses transmitted data and excludes original photos", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /수업 기록·말한 내용·체형 좌표와 각도/);
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
