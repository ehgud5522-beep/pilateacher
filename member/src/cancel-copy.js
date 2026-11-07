/**
 * 회원 앱 수업 취소 — 문구와 실패 분류 (2026-11-07, 5차 1단계). **순수 함수만.**
 *
 * 서버가 돌려준 이유 코드(functions/shared/member-cancel.mjs 의 CANCEL_REASON) →
 * 종류 → 문구가 한 줄로 이어진다. tests/member/cancel-copy.test.js 가 그것을 고정한다
 * (CLAUDE.md §8 -- 화면이 "네트워크" 라고 하는데 코드가 deadline_passed 이면 버그다).
 *
 * 대표 결정 문구:
 * - 마감 지남: "취소 가능 시간이 지났어요. {담당 강사} 선생님에게 문의해 주세요"
 * - 횟수 소진: "취소 가능 횟수가 없습니다. {담당 강사} 선생님에게 문의하세요"
 * 강사 전화번호는 어디에도 쓰지 않는다. 이름을 모르면 "담당 선생님".
 */

const text = (value) => String(value ?? "").trim();

/** 종류 (CLAUDE.md §3). 막힌 이유는 결정적이라 자동 재시도하지 않는다. */
export const CANCEL_FAILURE_KIND = Object.freeze({
  BLOCKED: "invalid_request",
  NETWORK: "network",
  UNAVAILABLE: "server_unavailable",
  AUTH: "authentication",
  PERMISSION: "permission",
  UNKNOWN: "unknown",
});

const teacher = (name) => (text(name) ? `${text(name)} 선생님` : "담당 선생님");

/**
 * 버튼을 끄고 그 아래에 보일 말. 막힌 이유가 아니면 빈 문자열.
 * @param {string} reason 서버 이유 코드
 * @param {string} instructorName 담당 강사 이름 (서버가 돌려준 것)
 */
export function blockedMessage(reason, instructorName) {
  switch (text(reason)) {
    case "deadline_passed": return `취소 가능 시간이 지났어요. ${teacher(instructorName)}에게 문의해 주세요`;
    case "no_remaining": return `취소 가능 횟수가 없습니다. ${teacher(instructorName)}에게 문의하세요`;
    case "no_active_pass": return `사용 중인 회원권이 없어 앱에서 취소할 수 없어요. ${teacher(instructorName)}에게 문의해 주세요`;
    case "lesson_settled": return "이미 확정된 수업이라 취소할 수 없어요.";
    case "lesson_cancelled": return "이미 취소된 수업이에요.";
    case "not_own_lesson": return "이 수업은 앱에서 취소할 수 없어요 (코드 not_own_lesson)";
    default: return "";
  }
}

/** "11월 9일(월) 19:00까지". 읽을 수 없으면 빈 문자열. */
export function deadlineLabel(value) {
  const at = value instanceof Date ? value : new Date(value || "");
  if (!Number.isFinite(at.getTime())) return "";
  const dow = ["일", "월", "화", "수", "목", "금", "토"][at.getDay()];
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `${at.getMonth() + 1}월 ${at.getDate()}일(${dow}) ${hh}:${mm}까지`;
}

/** 남은 횟수 줄. 기간이 월이면 "이번 달", 회원권이면 "이 회원권". */
export function remainingLabel(status) {
  if (status?.remaining === null || status?.remaining === undefined || status?.remaining === "") return "";
  const remaining = Number(status.remaining);
  if (!Number.isFinite(remaining)) return "";
  const scope = text(status?.period) === "pass" ? "이 회원권" : "이번 달";
  return `${scope} 남은 취소 ${Math.max(0, remaining)}회`;
}

/**
 * 취소 · 상태 호출이 실패했을 때 무엇을 말하는가.
 * Firebase callable 오류: code "functions/failed-precondition", details.reason.
 *
 * @returns {{ kind: string, code: string, message: string, retry: boolean }}
 */
export function cancelFailure(error, instructorName = "") {
  const rawCode = text(error?.code).replace(/^functions\//, "") || "unknown";
  const reason = text(error?.details?.reason);
  const blocked = blockedMessage(reason, instructorName);
  if (blocked) {
    return {
      kind: reason === "not_own_lesson" ? CANCEL_FAILURE_KIND.PERMISSION : CANCEL_FAILURE_KIND.BLOCKED,
      code: reason, message: blocked, retry: false,
    };
  }
  if (["unavailable", "deadline-exceeded"].includes(rawCode) && reason !== "member_cancel_failed") {
    return { kind: CANCEL_FAILURE_KIND.NETWORK, code: rawCode, message: `연결이 불안정해 취소하지 못했어요. 다시 시도해 주세요 (코드 ${rawCode})`, retry: true };
  }
  if (rawCode === "unavailable" || rawCode === "resource-exhausted") {
    return { kind: CANCEL_FAILURE_KIND.UNAVAILABLE, code: reason || rawCode, message: `잠시 뒤 다시 시도해 주세요 (코드 ${reason || rawCode})`, retry: true };
  }
  if (rawCode === "unauthenticated") {
    return { kind: CANCEL_FAILURE_KIND.AUTH, code: rawCode, message: "다시 로그인해 주세요 (코드 unauthenticated)", retry: false };
  }
  if (reason === "feature_off") {
    return { kind: CANCEL_FAILURE_KIND.BLOCKED, code: reason, message: `지금은 앱에서 취소할 수 없어요. ${teacher(instructorName)}에게 문의해 주세요`, retry: false };
  }
  const code = reason || rawCode;
  return { kind: CANCEL_FAILURE_KIND.UNKNOWN, code, message: `처리하지 못했어요 (코드 ${code})`, retry: false };
}

/* ── 취소 완료 화면 (2026-11-07 대표 시안) ─────────────────────────────────
   초록 체크 · "수업 취소가 완료되었어요" · 그 아래 한 줄.

   그 한 줄은 서버가 돌려준 값으로 고른다. **실제로 강사에게 닿은 길이 있을 때만**
   "전달했어요" 라고 말한다: 푸시가 나갔거나(teacherNotice sent) · 강사 앱 알림함에
   한 건이 들어갔다(teacherInbox written · duplicate, 2026-11-07). 둘 다 아니면 --
   알림함 쓰기 실패 · 강사 없음 · 예전 서버(값 없음) -- 알림이 갔다고 말하지 않는다. 대신 사실인 것을
   말한다 -- 취소는 서버 일정 문서에 이미 들어갔고 강사 앱 일정이 그것을 받는다.
   이것은 오류가 아니다(취소는 성공) -- 코드도, 다시 시도 버튼도 보이지 않는다.
   원인은 진단(teacherNotice · teacherNoticeCode)에 남는다. */

export const CANCEL_DONE_TITLE = "수업 취소가 완료되었어요";
export const CANCEL_DONE_NOTIFIED = "담당 강사님께 취소 알림을 전달했어요";
export const CANCEL_DONE_NOT_NOTIFIED = "취소 내용은 담당 강사님 일정에 표시돼요";

/** 서버 결과 → 완료 화면 아래 줄. */
export function cancelDoneNote(result) {
  const pushed = text(result?.teacherNotice) === "sent";
  const inboxed = ["written", "duplicate"].includes(text(result?.teacherInbox));
  return pushed || inboxed ? CANCEL_DONE_NOTIFIED : CANCEL_DONE_NOT_NOTIFIED;
}
