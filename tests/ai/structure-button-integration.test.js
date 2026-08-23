import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const voiceStart = source.indexOf("function VoiceNote(");
const voiceEnd = source.indexOf("function NoteForm(", voiceStart);
const voice = source.slice(voiceStart, voiceEnd);

test("AI structure action starts loading before provider, consent, and gateway work", () => {
  const requestStart = voice.indexOf("const requestSummary = async");
  const requestEnd = voice.indexOf("const setSummaryField", requestStart);
  const request = voice.slice(requestStart, requestEnd);
  const busy = request.indexOf("setSummaryBusy(true)");
  assert.ok(busy >= 0);
  assert.ok(busy < request.indexOf("aiProvider.getStatus()"));
  assert.ok(busy < request.indexOf("ensureMemberAIConsent"));
  assert.ok(request.indexOf("lessonRecordLlm.structureLessonRecord") > request.indexOf("ensureMemberAIConsent"));
  assert.match(request, /finally \{ setSummaryBusy\(false\); \}/);
});

test("AI structure success renders all five editable sections", () => {
  ["오늘 진행", "관찰", "반응/변화", "다음 확인", "확인 필요"].forEach((label) => assert.match(voice, new RegExp(label)));
  assert.match(voice, /AI가 수업 기록을 정리하고 있습니다/);
  assert.match(voice, /structuredFieldText\(summaryDraft, field\.k\)/);
});

test("AI structure failure is visible and retryable without losing raw transcript", () => {
  assert.match(voice, /role="alert"/);
  assert.match(voice, />다시 시도<\/button>/);
  assert.match(voice, /전사 원문은 유지/);
  assert.match(voice, /미구조화 원문 적용/);
});

test("Android production config points only to the existing authenticated gateway", async () => {
  const env = await readFile(new URL("../../.env.production", import.meta.url), "utf8");
  assert.match(env, /^VITE_AI_ENABLED=true$/m);
  assert.match(env, /^VITE_AI_PROVIDER=openai$/m);
  assert.match(env, /^VITE_AI_GATEWAY_URL=https:\/\/asia-northeast3-pilateacher\.cloudfunctions\.net\/aiGateway\/v1\/ai\/execute$/m);
  assert.doesNotMatch(env, /API_KEY|sk-/);
});
