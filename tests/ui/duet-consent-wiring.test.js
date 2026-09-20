import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * 듀엣 동의가 화면까지 이어졌는지 본다.
 *
 * App.jsx 는 단위 테스트로 열 수 없어서 소스로 확인한다. 순수 판정은
 * tests/voice/duet-consent.test.js 가 보고, 여기서는 그 판정이 실제로 불리는지,
 * 그리고 짝이 화면까지 내려오는지만 본다 -- 판정이 아무리 맞아도 호출되지
 * 않으면 동의 없는 녹음이 그대로 올라간다.
 */
const appSource = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

const countOf = (pattern) => (appSource.match(pattern) || []).length;

test("every voice consent gate goes through the one judgement", () => {
  /* 문이 셋이다: 녹음 시작 · 서버 녹음 · 재확인. 따로 두면 그중 하나가 짝을
     빠뜨리는 날이 오고, 그 길로 들어온 녹음은 이미 올라간 뒤다. */
  assert.match(appSource, /const ensureLessonConsent = async/, "공용 판정이 없다");
  assert.equal(countOf(/await ensureLessonConsent\(/g), 3, "녹음 시작 · 서버 녹음 · 재확인");
  assert.equal(
    countOf(/ensureMemberAIConsent\(memberId, "summarizeVoice"/g), 0,
    "수업기록 동의가 회원 한 명만 보고 지나가는 길이 남아 있다",
  );
});

test("the shared judgement is built from the member and the partner", () => {
  assert.match(appSource, /consentTargetsFor\(\{\s*memberId,\s*memberName,\s*duetPartner\s*\}\)/);
  assert.match(appSource, /ensureEveryConsent\(/);
});

test("every voice recorder on screen is told who the partner is", () => {
  /* 하나라도 빠지면 그 화면에서만 듀엣 동의가 조용히 한 명분이 된다. */
  const recorders = countOf(/<VoiceNote\b/g);
  const wired = countOf(/duetPartner=\{duetPartnerOf\(/g);
  assert.ok(recorders > 0, "VoiceNote 호출부를 찾지 못했다");
  assert.equal(wired, recorders, `VoiceNote ${recorders}곳 중 ${wired}곳만 짝을 받는다`);
});

test("the partner comes off the member the roster built, not from a second lookup", () => {
  /* 명부가 회원권에서 duetWith 와 이름을 유도해 회원 객체에 실어 준다. 화면이
     따로 찾아 나서면 그 경로가 명부와 어긋날 수 있다. */
  assert.match(appSource, /const duetPartnerOf = \(member\) => \(member\?\.duetWith/);
  assert.match(appSource, /member\.duetWithName/);
});

test("names reach the screen but never the diagnostics", () => {
  // CLAUDE.md 7항 — 회원 이름은 진단에 남기지 않는다.
  const consentDiagnostics = appSource.match(/voiceDiagnostic\("voice_consent_checked",[^;]*;/s)?.[0] || "";
  assert.ok(consentDiagnostics, "동의 진단 줄을 찾지 못했다");
  for (const forbidden of ["memberName", "duetPartner", "missing"]) {
    assert.ok(!consentDiagnostics.includes(forbidden), `동의 진단에 ${forbidden} 이 실려 있다`);
  }
});
