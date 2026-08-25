import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const voiceStart = source.indexOf("function VoiceNote(");
const voiceEnd = source.indexOf("function NoteForm(", voiceStart);
const voice = source.slice(voiceStart, voiceEnd);

test("AI structure action persists raw input and starts loading before gateway work", () => {
  const requestStart = voice.indexOf("const requestSummary = async");
  const requestEnd = voice.indexOf("const setSummaryField", requestStart);
  const request = voice.slice(requestStart, requestEnd);
  const busy = request.indexOf("setSummaryBusy(true)");
  assert.ok(busy >= 0);
  assert.ok(busy < request.indexOf("aiProvider.getStatus()"));
  assert.ok(request.indexOf("persistRawDraft(transcript") < request.indexOf("lessonRecordLlm.structureLessonRecord"));
  assert.equal(request.indexOf("prepareAIGatewayContext"), -1);
  assert.match(request, /finally \{ setSummaryBusy\(false\); \}/);
});

test("AI result renders the teacher-facing summary and all five editable sections", () => {
  ["회원의 변화", "오늘 수업", "회원 반응/특이사항", "다음 확인", "확인이 필요한 내용"].forEach((label) => assert.match(voice, new RegExp(label)));
  ["AI 수업 요약", "수업 기록", "확인하고 저장"].forEach((label) => assert.match(voice, new RegExp(label)));
  assert.match(voice, /AI가 수업 기록을 정리하고 있습니다/);
  assert.match(voice, /structuredFieldText\(summaryDraft, field\.k\)/);
});

test("AI narrative is omitted when the model did not return a valid summary", () => {
  const narrativeGuard = voice.indexOf("summaryView.narrative &&");
  const narrativeLabel = voice.indexOf("summaryView.narrativeLabel", narrativeGuard);
  const narrativeValue = voice.indexOf("summaryView.narrative}", narrativeGuard);
  assert.ok(narrativeGuard >= 0);
  assert.ok(narrativeLabel > narrativeGuard);
  assert.ok(narrativeValue > narrativeLabel);
  assert.doesNotMatch(voice, /말한 내용에서 정리할 항목이 아직 없습니다/);
});

test("AI structure failure preserves raw text and only offers retry for temporary failures", () => {
  assert.match(voice, /role="alert"/);
  assert.match(voice, /summaryFailure\.category === LESSON_RECORD_FAILURE_CATEGORY\.TEMPORARY/);
  assert.match(voice, /직접 정리/);
  assert.match(voice, /나중에/);
  assert.match(voice, /summaryFailure\.userCode/);
  assert.doesNotMatch(voice, /입력한 내용 그대로 저장|회원·수업 정보를 클라우드와 확인하지 못했어요/);
});

test("Android production config points only to the existing authenticated gateway", async () => {
  const env = await readFile(new URL("../../.env.production", import.meta.url), "utf8");
  assert.match(env, /^VITE_AI_ENABLED=true$/m);
  assert.match(env, /^VITE_AI_PROVIDER=openai$/m);
  assert.match(env, /^VITE_AI_GATEWAY_URL=https:\/\/asia-northeast3-pilateacher\.cloudfunctions\.net\/aiGateway\/v1\/ai\/execute$/m);
  assert.doesNotMatch(env, /API_KEY|sk-/);
});
