/**
 * 몸 상태 전하기 실패 문구 (2026-11-28). **순수 함수.** 코드 → 종류 → 문구 (CLAUDE.md 8).
 * 서버 이유는 functions/src/lesson-condition.js · functions/shared/lesson-condition.mjs.
 */

const text = (value) => String(value ?? "").trim();

export function conditionFailure(error) {
  const code = text(error?.code).replace(/^functions\//, "") || "unknown";
  const reason = text(error?.details?.reason);
  const tag = reason || code;
  if (reason === "not_own_lesson" || code === "permission-denied") {
    return { kind: "permission", code: tag, message: `이 수업에는 전할 수 없어요 (코드 ${tag})` };
  }
  if (reason === "lesson_started" || reason === "lesson_not_scheduled") {
    return { kind: "invalid_request", code: tag, message: `수업이 이미 시작됐거나 바뀌어서 전할 수 없어요 (코드 ${tag})` };
  }
  if (reason === "consent_required") {
    return { kind: "invalid_request", code: tag, message: `동의에 체크한 뒤 다시 눌러 주세요 (코드 ${tag})` };
  }
  if (code === "unauthenticated") return { kind: "authentication", code: tag, message: `다시 로그인한 뒤 눌러 주세요 (코드 ${tag})` };
  if (code === "unavailable" || code === "deadline-exceeded" || (code === "internal" && !reason)) {
    return { kind: "network", code: tag, message: `연결이 불안정해 전하지 못했어요. 고른 것은 그대로 있어요 (코드 ${tag})` };
  }
  if (code === "invalid-argument") return { kind: "invalid_request", code: tag, message: `고른 내용을 다시 확인해 주세요 (코드 ${tag})` };
  return { kind: "unknown", code: tag, message: `처리하지 못했어요 (코드 ${tag})` };
}
