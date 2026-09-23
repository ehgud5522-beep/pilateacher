import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  VOICE_SUPPORT, WEB_VOICE_CODE, WEB_VOICE_MESSAGE, serverVoiceSupport,
} from "../../src/features/voice/web-support.js";

test("the server engine records on the phone and not in a browser", () => {
  /* @capgo/capacitor-audio-recorder 에는 웹 구현이 없다. checkPermissions()
     부터 "not implemented" 로 던진다. */
  assert.equal(serverVoiceSupport({ engineMode: "server", isNative: true }), VOICE_SUPPORT.READY);
  assert.equal(serverVoiceSupport({ engineMode: "server", isNative: false }), VOICE_SUPPORT.WEB_UNSUPPORTED);
});

test("the on-device engine is left alone — it has a web path", () => {
  // 기기 내 음성 인식은 브라우저에서 Web Speech API 로 돈다. 이 판정을 지나면 안 된다.
  assert.equal(serverVoiceSupport({ engineMode: "native", isNative: false }), VOICE_SUPPORT.READY);
  assert.equal(serverVoiceSupport({ engineMode: "", isNative: false }), VOICE_SUPPORT.READY);
  assert.equal(serverVoiceSupport({}), VOICE_SUPPORT.READY);
});

test("the message says what to do instead, and never mentions permission", () => {
  /* 허용해도 달라지지 않는다. "권한을 켜 주세요" 라고 말하면 강사는 자기
     브라우저 설정을 뒤지고, 그래도 안 되는 이유를 영영 모른다. */
  assert.doesNotMatch(WEB_VOICE_MESSAGE, /권한/);
  assert.match(WEB_VOICE_MESSAGE, /폰 앱/);
  assert.match(WEB_VOICE_MESSAGE, /직접 입력/);
});

test("the diagnostic code is its own, not folded into a permission state", () => {
  // 서로 다른 원인이 같은 코드로 끝나면 안 된다 (CLAUDE.md 1항).
  assert.equal(WEB_VOICE_CODE, "voice_web_unsupported");
  assert.doesNotMatch(WEB_VOICE_CODE, /permission|denied|prompt/);
});

/* ── 화면이 실제로 이 판정을 쓰는가 ───────────────────────────────────── */

test("the screen asks before it asks the plugin", async () => {
  /* 순서가 전부다. 플러그인에 먼저 물으면 그 실패가 권한 없음으로 읽히고,
     화면은 "마이크 권한을 허용해 주세요" 를 띄운다 -- 허용해도 아무 일이
     일어나지 않는 안내다. */
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const judgement = source.indexOf("serverVoiceSupport({ engineMode: VOICE_ENGINE_MODE");
  const pluginCall = source.indexOf("await CapacitorAudioRecorder.checkPermissions()");
  assert.ok(judgement > 0, "판정이 화면에서 불리지 않는다");
  assert.ok(pluginCall > judgement, "플러그인 권한 확인이 판정보다 먼저 일어난다");
});

test("the web state hides the record button and shows its own line", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /voiceUnavailable = voiceAvailability === "unsupported" \|\| voiceAvailability === "web_unsupported"/);
  assert.match(source, /\) : voiceUnavailable \? null :/, "웹에서도 말하기 버튼이 서 있다");
  assert.match(source, /voiceAvailability === "web_unsupported" && <Sub/);
  assert.match(source, /\{WEB_VOICE_MESSAGE\}/);
});
