/**
 * 담당 강사에게 요청 (2026-11-28) -- 결과 · 실패 문구. **순수 함수.**
 *
 * 코드 → 종류 → 문구가 한 줄로 이어진다 (CLAUDE.md 8). 서버 이유는 functions/src/member-request.js.
 */

export const MEMBER_REQUEST_KIND = Object.freeze({
  BEFORE_AFTER: "member_request_before_after",
  FEEDBACK: "member_request_feedback",
});

export const REQUEST_LABEL = Object.freeze({
  [MEMBER_REQUEST_KIND.FEEDBACK]: "피드백 요청",
  [MEMBER_REQUEST_KIND.BEFORE_AFTER]: "비포애프터 요청",
});

const text = (value) => String(value ?? "").trim();

/** 보냈을 때. */
export function requestDone(result) {
  if (text(result?.status) === "duplicate") return { kind: "duplicate", message: "오늘 이미 요청했어요. 선생님께 전달돼 있어요." };
  return { kind: "sent", message: "선생님께 알림을 보냈어요." };
}

/** 실패했을 때. 원본 코드를 함께 말한다. */
export function requestFailure(error) {
  const code = text(error?.code).replace(/^functions\//, "") || "unknown";
  const reason = text(error?.details?.reason);
  const tag = reason || code;
  if (reason === "member_request_no_instructor") {
    return { kind: "data_conflict", code: tag, message: `담당 선생님이 아직 정해지지 않았어요. 센터에 알려 주세요 (코드 ${tag})` };
  }
  if (code === "unavailable" || code === "deadline-exceeded" || (code === "internal" && !reason)) {
    return { kind: "network", code: tag, message: `연결이 불안정해 보내지 못했어요. 잠시 뒤 다시 눌러 주세요 (코드 ${tag})` };
  }
  if (code === "unauthenticated") return { kind: "authentication", code: tag, message: `다시 로그인한 뒤 눌러 주세요 (코드 ${tag})` };
  if (code === "permission-denied") return { kind: "permission", code: tag, message: `이 계정으로는 요청할 수 없어요. 센터에 알려 주세요 (코드 ${tag})` };
  if (code === "invalid-argument") return { kind: "invalid_request", code: tag, message: `요청을 처리하지 못했어요 (코드 ${tag})` };
  return { kind: "unknown", code: tag, message: `처리하지 못했어요 (코드 ${tag})` };
}
