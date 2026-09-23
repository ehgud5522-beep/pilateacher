/**
 * 음성 수업기록이 이 환경에서 되는가.
 *
 * ── 왜 필요한가 ──
 * 서버 녹음 엔진은 @capgo/capacitor-audio-recorder 를 쓴다. 그 플러그인에는 웹
 * 구현이 없어서, 브라우저에서는 checkPermissions() 부터 "not implemented" 로
 * 던진다.
 *
 * 화면은 그 실패를 권한 문제로 읽고 있었다 -- 실패를 잡아 null 로 만든 뒤
 * nativeAudioPermissionState(null) 이 "prompt" 를 돌려주기 때문이다. 그래서
 * PC 브라우저에서 "말하기를 사용하려면 마이크 권한을 허용해 주세요" 가 뜨고,
 * 허용해도 아무 일이 일어나지 않는다. 강사는 자기 브라우저 설정을 뒤지게 된다.
 *
 * 서로 다른 원인이 같은 문구로 끝나면 안 된다 (CLAUDE.md 1항). 웹에서 안 되는
 * 것은 권한이 아니라 기능이 없는 것이고, 할 일도 다르다 -- 켜는 것이 아니라
 * 폰 앱으로 옮기거나 직접 입력하는 것이다.
 *
 * ── 웹에서 녹음을 살리지 않는 이유 ──
 * MediaRecorder 로 만들 수는 있다. 다만 그러면 같은 기능에 코드 경로가 둘이
 * 되고, 업로드 형식·무음 판정·중단 복구가 각각 따로 움직인다. 음성 기록은 이
 * 앱에서 가장 많이 깨졌던 자리라 경로를 늘리지 않는다.
 *
 * PC 는 이관·발급·급여 집계를 하러 켜는 화면이고, 수업기록은 폰에서 쓴다.
 */

/** 어떤 종류의 불가인가. 화면 문구와 진단 코드가 여기서 갈린다. */
export const VOICE_SUPPORT = Object.freeze({
  READY: "ready",
  /* 웹 브라우저다. 권한과 무관하고, 허용해도 달라지지 않는다. */
  WEB_UNSUPPORTED: "web_unsupported",
});

/**
 * @param {{ engineMode?: string, isNative?: boolean }} input
 * @returns {"ready" | "web_unsupported"}
 */
export function serverVoiceSupport(input = {}) {
  /* 서버 엔진일 때만 해당한다. 기기 내 음성 인식(native STT)은 웹에서
     Web Speech API 로 돌아가므로 이 판정을 지나면 안 된다. */
  if (String(input.engineMode ?? "") !== "server") return VOICE_SUPPORT.READY;
  return input.isNative === true ? VOICE_SUPPORT.READY : VOICE_SUPPORT.WEB_UNSUPPORTED;
}

/** 화면이 그대로 쓰는 문구. 무엇을 하면 되는지까지 말한다. */
export const WEB_VOICE_MESSAGE = "음성 수업기록은 폰 앱에서만 됩니다. 이 화면에서는 직접 입력으로 기록해 주세요.";

/** 진단에 남길 코드. 권한 거부와 섞이지 않게 따로 둔다. */
export const WEB_VOICE_CODE = "voice_web_unsupported";
