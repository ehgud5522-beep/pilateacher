import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const voice = source.slice(source.indexOf("function VoiceNote("), source.indexOf("function NoteForm("));
const examples = JSON.parse(await readFile(new URL("../../src/features/lesson-record/lesson-record-examples.json", import.meta.url), "utf8"));

test("voice completion saves a pending draft, keeps results visible, and defers close for ten seconds", () => {
  assert.match(voice, /currentRecordPayload\(false\)/);
  assert.match(voice, /onDraftChange\(payload\.teacherText, payload\.meta, \{ confirmed: false, upsert: true \}\)/);
  assert.match(voice, /SERVER_AUDIO_FOREGROUND_WAIT_MS/);
  assert.match(voice, /waitBeforeDeferredClose/);
  assert.match(voice, /showDeferredToast\("기록 저장됨 · AI가 정리 중"\)/);
  assert.match(voice, /summaryView\.cards/);
  assert.match(voice, /typeof onClose === "function"[\s\S]*>닫기<\/button>/);
  assert.doesNotMatch(voice, /확인하고 저장|AI로 정리|이 영역 저장/);
});

test("voice UI has one conditional direct-entry textarea and mutually exclusive phases", () => {
  assert.equal((voice.match(/aria-label="직접 입력하는 수업 내용"/g) || []).length, 1);
  assert.match(voice, /manualEntry \? <>/);
  assert.match(voice, /!\["listening", "organizing"\]\.includes\(voicePhase\)/);
  ["waiting", "listening", "organizing", "result", "failed", "permission_required"].forEach((phase) => assert.match(voice, new RegExp(phase)));
  assert.doesNotMatch(voice, />마이크 테스트</);
  assert.doesNotMatch(voice, />카메라 테스트</);
  assert.match(source, /diagnosticTapCount[\s\S]*next >= 7[\s\S]*IOSMediaDiagnosticPanel/);
});

test("voice result, failure, and timeout terminate the organizing header", () => {
  assert.match(voice, /hasResult: !!summaryDraft/);
  assert.match(voice, /summaryFailed: Boolean\(summaryFailure \|\| summaryError\)/);
  assert.match(voice, /VOICE_ORGANIZING_TIMEOUT_MS/);
  assert.match(voice, /setSummaryBusy\(false\)[\s\S]*setFinishing\(false\)[\s\S]*정리 실패 · 자동 재시도/);
  assert.match(voice, /voicePhase === "result"[\s\S]*>결과<\/span>/);
  assert.match(voice, /voicePhase === "failed"[\s\S]*consentGate \? "동의 필요" : "실패"/);
  assert.match(voice, /const voicePhase = summaryDraft \? "result" : consentGate \? "failed"/);
  assert.match(voice, /voicePhase === "failed" && !consentGate && !summaryFailure/);
  assert.equal((voice.match(/summaryError && summaryFailure && !consentGate/g) || []).length, 1);
});

test("pending AI records expose optional confirmation and suppress review-flagged records", () => {
  assert.match(source, /\[AI · 확인 전\]/);
  assert.match(source, />확인 필요<\/button>/);
  assert.match(source, /title="AI 수업기록 확인"/);
  assert.match(source, />확인<\/button>/);
  assert.match(source, /LESSON_RECORD_REVIEW_FLAGS/);
  assert.match(source, /녹음 확인 필요/);
});

test("examples are JSON-driven, one-time, reopenable, and practice starts recording", () => {
  assert.equal(examples.cards.length, 5);
  assert.equal(examples.tips.length, 4);
  assert.equal(examples.cards[0].fields.didToday[0], "오른쪽 허리 운동");
  assert.match(source, /LESSON_RECORD_EXAMPLES_SEEN_KEY/);
  assert.match(source, /AI 수업기록 예시/);
  assert.match(source, /pilateacher:practice-record-example/);
  assert.match(voice, /startServerRecording\("append"\)/);
});

test("restore gate uses the approved first-install copy and preserves cloud on fresh start", () => {
  ["이 계정의 기록을 불러올까요?", "불러오기 전에는 이 기기의 내용이 클라우드에 올라가지 않아요.", "기록 불러오기", "새로 시작하기", "기존 기록은 클라우드에 그대로 남아요. 이 기기에서만 새로 시작할까요?"].forEach((copy) => assert.match(source, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  assert.match(source, /restoreBlockedRef\.current = true/);
  assert.match(source, /restoreDecisionKey/);
  assert.doesNotMatch(source.slice(source.indexOf("{restoreOffer &&"), source.indexOf("{lessonExamplesOpen")), /메타데이터|썸네일|캐시|빈 데이터 업로드|보라/);
});
