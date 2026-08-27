import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const firebase = fs.readFileSync(path.join(root, "src/lib/firebase.js"), "utf8");
const voice = app.slice(app.indexOf("function VoiceNote("), app.indexOf("function NoteForm("));

test("voice consent is scoped to the current Firebase uid and persisted in Firestore", () => {
  assert.match(app, /aiConsentCacheId = \(memberId, accountId = fbCurrentUserId\(\)\)/);
  assert.match(app, /`\$\{String\(accountId \|\| "signed-out"\)\}:\$\{String\(memberId \|\| ""\)\}`/);
  assert.match(firebase, /users", user\.uid, "aiConsents", safeMemberId/);
  assert.match(firebase, /grantedAt: serverTimestamp\(\)/);
  assert.match(firebase, /revokedAt: null/);
  assert.match(app, /resetAIConsentSessionChecks\(\)/);
  assert.match(app, /fbCurrentUserId\(\) !== expectedAccountId/);
});

test("missing consent shows the in-sheet disclosure and grant retries the interrupted action", () => {
  assert.match(voice, /음성은 기록 정리를 위해 서버로 전송된 뒤 즉시 삭제되며 보관하지 않습니다\./);
  assert.match(voice, /https:\/\/pilateacher\.vercel\.app\/privacy\.html/);
  assert.match(voice, /동의하고 계속/);
  assert.match(voice, /await grantMemberAIConsent\(memberId, \["summarizeVoice"\]\)[\s\S]*if \(continuation\) await continuation\(\)/);
  assert.match(voice, /presentVoiceConsent\(\(\) => startServerRecording\(mode, \{ skipConsent: true \}\)/);
  assert.match(voice, /presentVoiceConsent\(async \(\) => \{[\s\S]*await uploadServerAudio\(clip, currentDraft\)/);
});

test("declining consent falls back to direct input and every consent failure stops organizing", () => {
  assert.match(voice, /fallbackToDirectEntry\("동의하지 않아 직접 입력으로 전환했습니다\."\)/);
  assert.match(voice, /const currentDraft = loadPendingLessonRecord\(memberId, lessonId\) \|\| previousDraft/);
  assert.match(voice, /handleServerAudioFailure[\s\S]*setFinishing\(false\)[\s\S]*setSummaryBusy\(false\)/);
  assert.match(voice, /const voicePhase = summaryDraft \? "result" : consentGate \? "failed" : resolveVoicePhase/);
  assert.match(voice, /voicePhase === "failed" && !consentGate && !summaryFailure/);
});
