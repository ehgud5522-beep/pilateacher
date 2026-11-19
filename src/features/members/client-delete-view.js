/**
 * 보관된 빈 회원 삭제 — 화면이 하는 말 (2026-11-19).
 *
 * 판정의 원본은 서버다 (functions/src/client-delete.js). 여기는 서버가 준 코드를
 * 문구로 옮기기만 한다. 코드는 callable 오류의 details.code 에 있다 -- 겉의
 * error.code 는 "functions/failed-precondition" 같은 HTTP 갈래라서, 그것을 먼저
 * 읽으면 사유가 사라진다 (연락처 수정이 그렇게 "functions/invalid-argument" 만
 * 보여 줬다).
 */

export const CLIENT_DELETE_KIND_LABEL = Object.freeze({
  pass: "회원권",
  lesson: "수업",
  lesson_record: "수업 기록",
  lesson_note: "회원에게 보낸 말",
  cancellation: "앱 취소 기록",
  summary: "회원 요약",
});

/** callable 오류에서 서버의 코드를 꺼낸다. details.code 가 먼저다. */
export function serverCodeOf(thrown) {
  return String(thrown?.details?.code || thrown?.code || "").trim();
}

/**
 * @param {{ code?: string, kinds?: string[] }} failure
 */
export function clientDeleteMessage(failure) {
  const code = String(failure?.code ?? "").trim();
  const kinds = (Array.isArray(failure?.kinds) ? failure.kinds : [])
    .map((kind) => CLIENT_DELETE_KIND_LABEL[kind]).filter(Boolean);
  switch (code) {
    case "client_delete_has_history":
      return kinds.length
        ? `지울 수 없어요 — 남아 있는 것: ${kinds.join(" · ")}. 같은 분이면 회원 합치기가 필요합니다.`
        : "기록이 남아 있어 지울 수 없어요.";
    case "client_delete_not_archived":
      return "보관된 회원만 지울 수 있어요. 먼저 보관해 주세요.";
    case "client_delete_not_allowed":
      return "대표 · 총괄매니저만 지울 수 있어요.";
    case "client_delete_no_client":
      return "이미 지워졌거나 찾지 못했어요. 목록을 새로 열어 주세요.";
    case "client_delete_unavailable":
    case "functions/unavailable":
    case "functions/deadline-exceeded":
      return "연결이 불안정해 끝내지 못했어요. 다시 시도해 주세요.";
    default:
      return `지우지 못했어요 (코드 ${code || "unknown"})`;
  }
}
