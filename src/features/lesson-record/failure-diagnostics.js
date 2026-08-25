export const LESSON_RECORD_FAILURE_CATEGORY = Object.freeze({
  INPUT: "INPUT",
  TEMPORARY: "TEMPORARY",
  SERVICE: "SERVICE",
});

export const LESSON_RECORD_FAILURE = LESSON_RECORD_FAILURE_CATEGORY;

export const LESSON_RECORD_PROVENANCE_SOURCE = Object.freeze({
  OPENAI: "openai",
  FALLBACK_RAW: "fallback_raw",
});

export function lessonRecordProvenanceSource(value) {
  const record = value?.lessonRecord || value || {};
  if (Object.values(LESSON_RECORD_PROVENANCE_SOURCE).includes(record.provenanceSource)) return record.provenanceSource;
  if (record.structuredDraft || (record.stage === "confirmed_record" && Array.isArray(record.confirmedRecord?.didToday))) {
    return LESSON_RECORD_PROVENANCE_SOURCE.OPENAI;
  }
  return LESSON_RECORD_PROVENANCE_SOURCE.FALLBACK_RAW;
}

const detailsByCode = Object.freeze({
  stt_no_speech: { category: "INPUT", userCode: "E-VOICE", title: "말소리가 인식되지 않았어요", description: "다시 말하거나 직접 입력할 수 있어요.", retry: true },
  mic_permission_denied: { category: "INPUT", userCode: "E-MIC-PERMISSION", title: "마이크 권한이 필요해요", description: "기기 설정에서 마이크와 음성 인식 권한을 허용해 주세요.", retry: false },
  recognizer_busy: { category: "TEMPORARY", userCode: "E-STT-BUSY", title: "음성 인식을 준비하고 있어요", description: "잠시 후 다시 시도하거나 직접 입력할 수 있어요.", retry: true },
  recognizer_unavailable: { category: "SERVICE", userCode: "E-STT-UNAVAILABLE", title: "이 기기에서는 말하기를 사용할 수 없어요", description: "직접 입력으로 수업 기록을 남길 수 있어요.", retry: false },
  consent_missing: { category: "INPUT", userCode: "E-CONSENT", title: "AI 처리 동의가 필요해요", description: "동의를 확인한 뒤 말하기를 시작할 수 있어요.", retry: false },
  stt_provider_error: { category: "TEMPORARY", userCode: "E-STT", title: "음성 인식 연결이 불안정해요", description: "말씀하신 내용이 있다면 이 기기에 저장되어 있어요.", retry: true },
  network_offline: { category: "TEMPORARY", userCode: "E-NETWORK", title: "연결이 불안정해요", description: "말씀하신 내용은 저장되어 있어요.", retry: true },
  timeout: { category: "TEMPORARY", userCode: "E-TIMEOUT", title: "연결이 잠시 늦어지고 있어요", description: "말씀하신 내용은 저장되어 있어요.", retry: true },
  auth_expired: { category: "TEMPORARY", userCode: "E-AUTH", title: "로그인 연결을 다시 확인하고 있어요", description: "말씀하신 내용은 저장되어 있어요.", retry: true },
  auth_refresh_failed: { category: "SERVICE", userCode: "E-AUTH", title: "로그인 연결을 확인해 주세요", description: "말씀하신 내용은 저장되어 있어요.", retry: false },
  provider_rate_limited: { category: "TEMPORARY", userCode: "E-BUSY", title: "AI 요청이 잠시 많아요", description: "말씀하신 내용은 저장되어 있어요.", retry: true },
  provider_5xx: { category: "TEMPORARY", userCode: "E-SERVICE", title: "AI 연결이 잠시 불안정해요", description: "말씀하신 내용은 저장되어 있어요.", retry: true },
  provider_quota_exhausted: { category: "TEMPORARY", userCode: "E-QUOTA", title: "AI 정리를 지금 사용할 수 없어요", description: "말씀하신 내용은 저장되어 있고, 연결이 회복되면 다시 정리해요.", retry: true },
  provider_configuration: { category: "TEMPORARY", userCode: "E-CONFIG", title: "AI 정리를 지금 사용할 수 없어요", description: "말씀하신 내용은 저장되어 있고, 연결이 회복되면 다시 정리해요.", retry: true },
  client_internal: { category: "SERVICE", userCode: "E-INTERNAL", title: "AI 정리를 지금 사용할 수 없어요", description: "말씀하신 내용은 저장되어 있어요.", retry: false },
  schema_invalid: { category: "SERVICE", userCode: "E-FORMAT", title: "내용을 자동으로 정리하지 못했어요", description: "말씀하신 내용은 저장되어 있어요.", retry: false },
  member_session_unresolved: { category: "SERVICE", userCode: "E-LINK", title: "기록 연결을 확인하고 있어요", description: "말씀하신 내용은 회원 기록에 안전하게 남아 있어요.", retry: false },
  unknown: { category: "SERVICE", userCode: "E-AI", title: "AI 정리를 지금 사용할 수 없어요", description: "말씀하신 내용은 저장되어 있어요.", retry: false },
});

export function normalizeLessonRecordFailureCode({ code = "", status = null, reason = "", failureStage = "", contextStage = "", transportCode = "" } = {}) {
  const raw = String(code || reason || "").toLowerCase();
  const stage = String(failureStage || contextStage || "").toLowerCase();
  const transport = String(transportCode || "").toUpperCase();
  const httpStatus = Number(status) || 0;
  if (["stt_no_speech", "no_speech", "no-speech"].includes(raw)) return "stt_no_speech";
  if (raw === "mic_permission_denied") return "mic_permission_denied";
  if (raw === "recognizer_busy") return "recognizer_busy";
  if (raw === "recognizer_unavailable") return "recognizer_unavailable";
  if (raw === "consent_required" || raw === "consent_missing" || stage.includes("consent")) return "consent_missing";
  if (raw === "provider_quota_exhausted" || (httpStatus === 429 && raw.includes("quota"))) return "provider_quota_exhausted";
  if (raw === "rate_limited" || raw === "provider_rate_limited" || httpStatus === 429) return "provider_rate_limited";
  if (raw === "client_invocation_error" || transport === "E-INTERNAL" || stage === "fetch_internal") return "client_internal";
  if (["offline", "network_error", "network_offline"].includes(raw) || stage.includes("network")) return "network_offline";
  if (raw === "timeout" || httpStatus === 504) return "timeout";
  if (raw === "auth_refresh_failed" || stage === "auth_refresh") return "auth_refresh_failed";
  if (raw.includes("unauthenticated") || raw === "auth_expired" || httpStatus === 401) return "auth_expired";
  if (["speech_recognition_unavailable", "stt_provider_error"].includes(raw) || stage.includes("stt")) return "stt_provider_error";
  if (raw === "invalid_output" || raw === "schema_invalid" || stage.includes("schema")) return "schema_invalid";
  if (raw === "provider_unavailable" || raw === "provider_5xx" || httpStatus >= 500) return "provider_5xx";
  if (raw === "not_connected" || raw === "invalid_gateway_url" || raw === "provider_configuration") return "provider_configuration";
  if (raw.includes("member") || raw.includes("lesson") || stage.includes("authorization") || stage.includes("backup")) return "member_session_unresolved";
  return "unknown";
}

export function describeLessonRecordFailure(context = {}) {
  const internalCode = normalizeLessonRecordFailureCode(context);
  return { internalCode, ...(detailsByCode[internalCode] || detailsByCode.unknown) };
}

export function classifyLessonRecordFailure(context = {}) {
  return describeLessonRecordFailure(context).category;
}

export function lessonRecordFailureMessage(value) {
  if (value && typeof value === "object") return describeLessonRecordFailure(value).title;
  const byCategory = Object.values(detailsByCode).find((item) => item.category === value);
  return byCategory?.title || detailsByCode.unknown.title;
}

export function canAutoRetryLessonRecordFailure(context = {}) {
  return describeLessonRecordFailure(context).category === LESSON_RECORD_FAILURE_CATEGORY.TEMPORARY;
}

export const LESSON_RECORD_FAILURE_DETAILS = detailsByCode;

const DEBUG_FAILURE_KEY = "__PILATEACHER_LESSON_RECORD_FAILURE__";
export function setLessonRecordDebugFailure(code, target = globalThis) {
  target[DEBUG_FAILURE_KEY] = String(code || "");
}

export function takeLessonRecordDebugFailure(target = globalThis) {
  const code = String(target?.[DEBUG_FAILURE_KEY] || "");
  if (target) target[DEBUG_FAILURE_KEY] = "";
  return code;
}

export const LESSON_RECORD_DEBUG_CODES = Object.freeze(Object.keys(detailsByCode).filter((code) => code !== "unknown"));
