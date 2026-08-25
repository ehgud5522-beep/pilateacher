export const NATIVE_SPEECH_RESULT_TIMEOUT_MS = 8000;

export const SPEECH_NO_RESULT_MESSAGE =
  "말소리를 인식하지 못했습니다. 기기 마이크와 음성 인식 설정을 확인한 뒤 다시 시도해 주세요.";

export const SPEECH_RESULT_TIMEOUT_MESSAGE =
  "음성 인식 결과가 늦어지고 있습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.";

export function isSpeechPermissionGranted(status) {
  return status?.speechRecognition === "granted";
}

function speechErrorText(error) {
  return [error?.code, error?.name, error?.message, typeof error === "string" ? error : ""]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function describeSpeechError(error) {
  const detail = speechErrorText(error);

  if (/permission|not.allowed|denied|insufficient/.test(detail)) {
    return {
      kind: "permission",
      code: "mic_permission_denied",
      message: "마이크와 음성 인식 권한이 필요합니다. 기기 설정에서 필라티쳐의 마이크 권한을 허용해 주세요.",
    };
  }
  if (/network|timeout.*network|error from server|server error/.test(detail)) {
    return {
      kind: "network",
      message: "네트워크 문제로 음성 인식을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
    };
  }
  if (/audio recording|error.audio|microphone|audio.*error/.test(detail)) {
    return {
      kind: "audio",
      message: "마이크를 사용할 수 없습니다. 통화나 다른 녹음 앱을 종료하고 다시 시도해 주세요.",
    };
  }
  if (/language.*(not supported|unavailable)|not supported.*language/.test(detail)) {
    return {
      kind: "language",
      message: "한국어 음성 인식 언어를 사용할 수 없습니다. 기기의 음성 인식 언어 설정을 확인해 주세요.",
    };
  }
  if (/no match|no speech|speech timeout|didn.t understand/.test(detail)) {
    return { kind: "no_speech", message: SPEECH_NO_RESULT_MESSAGE };
  }
  if (/recognitionservice busy|recognizer busy|client side|ongoing|error[_ .-]*recognizer[_ .-]*busy|error 8\b/.test(detail)) {
    return {
      kind: "busy",
      code: "recognizer_busy",
      message: "기기의 음성 인식 서비스가 응답하지 않습니다. 잠시 기다린 뒤 다시 시도해 주세요.",
    };
  }
  if (/server disconnected|error.server|error 11/.test(detail)) {
    return {
      kind: "service",
      code: "stt_provider_error",
      message: "기기의 음성 인식 서비스가 응답하지 않습니다. 잠시 기다린 뒤 다시 시도해 주세요.",
    };
  }
  if (/unavailable|not implemented|unimplemented/.test(detail)) {
    return {
      kind: "unavailable",
      code: "recognizer_unavailable",
      message: "이 기기에서는 음성 인식을 사용할 수 없습니다. 아래 직접 입력란을 이용해 주세요.",
    };
  }
  return {
    kind: "unknown",
    message: "음성 인식이 중단되었습니다. 작성된 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.",
  };
}
