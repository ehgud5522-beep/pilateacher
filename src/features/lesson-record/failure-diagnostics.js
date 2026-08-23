export const LESSON_RECORD_FAILURE = Object.freeze({
  NETWORK: "NETWORK",
  AUTH: "AUTH",
  CONSENT: "CONSENT",
  MEMBER_AUTHORIZATION: "MEMBER_AUTHORIZATION",
  GATEWAY: "GATEWAY",
  PROVIDER: "PROVIDER",
  RESPONSE: "RESPONSE",
  SCHEMA: "SCHEMA",
  CLIENT_MAPPING: "CLIENT_MAPPING",
  STALE_BUILD: "STALE_BUILD",
  UNKNOWN: "UNKNOWN",
});

export function classifyLessonRecordFailure({ code = "", status = null, reason = "", failureStage = "", contextStage = "" } = {}) {
  const normalizedCode = String(code || reason || "").toLowerCase();
  const normalizedStage = String(failureStage || contextStage || "").toLowerCase();
  const httpStatus = Number(status) || 0;
  if (normalizedStage.includes("backup") || normalizedStage.includes("member_authorization") || normalizedCode.startsWith("backup/") || normalizedCode.startsWith("ai/member") || normalizedCode.startsWith("ai/lesson")) return LESSON_RECORD_FAILURE.MEMBER_AUTHORIZATION;
  if (["offline", "network_error", "timeout"].includes(normalizedCode) || normalizedStage.includes("network")) return LESSON_RECORD_FAILURE.NETWORK;
  if (normalizedCode.includes("unauthenticated") || httpStatus === 401) return LESSON_RECORD_FAILURE.AUTH;
  if (normalizedCode === "consent_required" || normalizedStage.includes("consent")) return LESSON_RECORD_FAILURE.CONSENT;
  if (normalizedCode === "not_connected" || normalizedCode === "invalid_gateway_url") return LESSON_RECORD_FAILURE.STALE_BUILD;
  if (normalizedStage === "client_schema_validation") return LESSON_RECORD_FAILURE.CLIENT_MAPPING;
  if (normalizedCode === "invalid_output" && httpStatus === 502) return LESSON_RECORD_FAILURE.RESPONSE;
  if (normalizedCode === "invalid_output" || normalizedStage.includes("schema")) return LESSON_RECORD_FAILURE.SCHEMA;
  if (normalizedCode.startsWith("provider_") || normalizedStage.startsWith("provider")) return LESSON_RECORD_FAILURE.PROVIDER;
  if (normalizedCode.includes("gateway") || httpStatus >= 400) return LESSON_RECORD_FAILURE.GATEWAY;
  return LESSON_RECORD_FAILURE.UNKNOWN;
}

export function lessonRecordFailureMessage(failureClass) {
  if (failureClass === LESSON_RECORD_FAILURE.NETWORK) return "인터넷에 연결되지 않았어요. 작성한 내용은 이 기기에 남아 있습니다. 연결 후 다시 시도하거나 직접 수정할 수 있어요.";
  if (failureClass === LESSON_RECORD_FAILURE.AUTH) return "로그인 상태를 확인하지 못했어요. 다시 로그인한 뒤 시도해 주세요. 작성한 내용은 그대로 남아 있습니다.";
  if (failureClass === LESSON_RECORD_FAILURE.CONSENT) return "회원의 AI 처리 동의를 확인한 뒤 다시 시도해 주세요. 작성한 내용은 그대로 남아 있습니다.";
  if (failureClass === LESSON_RECORD_FAILURE.MEMBER_AUTHORIZATION) return "회원·수업 정보를 클라우드와 확인하지 못했어요. 백업 상태를 확인한 뒤 다시 시도해 주세요. 작성한 내용은 그대로 남아 있습니다.";
  if (failureClass === LESSON_RECORD_FAILURE.STALE_BUILD) return "현재 앱 빌드에서는 AI 수업기록 연결을 확인하지 못했어요. 앱 버전을 확인한 뒤 다시 시도해 주세요.";
  return "내용을 자동으로 정리하지 못했어요. 작성한 내용은 그대로 남아 있습니다. 다시 시도하거나 직접 수정할 수 있어요.";
}
