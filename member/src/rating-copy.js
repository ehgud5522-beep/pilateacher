/**
 * 수업 후 별점 평가 — 실패 분류와 기기 기록 (2026-11-09). **순수 함수만.**
 *
 * 서버 이유 코드(functions/shared/lesson-rating.mjs 의 RATING_REASON) → 종류 → 문구가 한
 * 줄로 이어진다. tests/member/rating-copy.test.js 가 그것을 고정한다 (CLAUDE.md §8).
 *
 * 평가는 회원이 도와주는 일이다 -- 막힌 이유(기간 지남 · 꺼짐 · 취소된 수업)는 **오류가
 * 아니다**. 카드를 조용히 접는다 (hide). 오류를 띄우는 것은 다시 시도하면 될 수도 있는
 * 것(연결 · 서버)과 분류하지 못한 것뿐이고, 그때도 고른 별은 그대로 둔다 (§5).
 */

const text = (value) => String(value ?? "").trim();

export const RATING_FAILURE_KIND = Object.freeze({
  /** 결정적으로 받지 않는 수업 -- 카드를 접는다. 오류 화면 없음. */
  CLOSED: "invalid_request",
  INVALID: "invalid_request",
  NETWORK: "network",
  UNAVAILABLE: "server_unavailable",
  AUTH: "authentication",
  PERMISSION: "permission",
  UNKNOWN: "unknown",
});

/** 이 이유면 카드를 접고 다시 묻지 않는다. */
const CLOSED_REASONS = Object.freeze([
  "feature_off", "lesson_not_found", "lesson_cancelled", "lesson_not_attended", "lesson_not_started", "rating_expired",
]);

/**
 * 상태 · 보내기 호출이 실패했을 때.
 * @returns {{ kind: string, code: string, message: string, retry: boolean, hide: boolean }}
 */
export function ratingFailure(error) {
  const rawCode = text(error?.code).replace(/^functions\//, "") || "unknown";
  const reason = text(error?.details?.reason);
  if (CLOSED_REASONS.includes(reason)) {
    return { kind: RATING_FAILURE_KIND.CLOSED, code: reason, message: "", retry: false, hide: true };
  }
  if (reason === "not_own_lesson") {
    return { kind: RATING_FAILURE_KIND.PERMISSION, code: reason, message: "", retry: false, hide: true };
  }
  if (reason === "scores_invalid") {
    return { kind: RATING_FAILURE_KIND.INVALID, code: reason, message: `모든 항목에 별을 골라 주세요 (코드 ${reason})`, retry: false, hide: false };
  }
  if (["unavailable", "deadline-exceeded"].includes(rawCode) && reason !== "lesson_rating_failed") {
    return { kind: RATING_FAILURE_KIND.NETWORK, code: rawCode, message: `연결이 불안정해 보내지 못했어요. 다시 시도해 주세요 (코드 ${rawCode})`, retry: true, hide: false };
  }
  if (rawCode === "unavailable" || rawCode === "resource-exhausted") {
    return { kind: RATING_FAILURE_KIND.UNAVAILABLE, code: reason || rawCode, message: `잠시 뒤 다시 시도해 주세요 (코드 ${reason || rawCode})`, retry: true, hide: false };
  }
  if (rawCode === "unauthenticated") {
    return { kind: RATING_FAILURE_KIND.AUTH, code: rawCode, message: "다시 로그인해 주세요 (코드 unauthenticated)", retry: false, hide: false };
  }
  const code = reason || rawCode;
  return { kind: RATING_FAILURE_KIND.UNKNOWN, code, message: `처리하지 못했어요 (코드 ${code})`, retry: false, hide: false };
}

/* ── 이 기기에서 이미 물은 수업 ─────────────────────────────────────────
   보냈거나 "다음에 할게요" 를 누른 수업 id. 다시 열 때마다 같은 수업을 묻지 않게.
   기기 칸이 막혀 있어도(사생활 보호 모드) 화면은 돈다 -- 그때는 서버가 "이미 보냄" 을
   답하고, "다음에" 는 이번 실행 동안만 기억된다. 수업 id 만 적는다 (이름 · 점수 없음). */

export const RATING_SEEN_KEY = "pilateacher.member.ratingSeen";
const SEEN_LIMIT = 40;

/** @returns {string[]} */
export function readRatingSeen(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(RATING_SEEN_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean).slice(0, SEEN_LIMIT) : [];
  } catch (_error) {
    return [];
  }
}

/** 하나를 더한다. 최근 것이 앞, 상한을 넘으면 오래된 것부터 버린다. 돌려주는 것은 새 목록. */
export function addRatingSeen(storage, lessonId) {
  const id = text(lessonId);
  const next = [id, ...readRatingSeen(storage).filter((item) => item !== id)].filter(Boolean).slice(0, SEEN_LIMIT);
  try {
    storage?.setItem?.(RATING_SEEN_KEY, JSON.stringify(next));
  } catch (_error) {
    /* 기기 칸이 막혔다. 이번 실행 동안은 화면 상태가 기억한다. */
  }
  return next;
}
