/**
 * FC 복지 수업료 화면 판정 (2026-11-21, 횟수만 · 지점마다 한 명). 계산은 functions/shared/fc-lessons.mjs. 순수 함수다.
 */
import { FC_LESSON_PROBLEM_TEXT, fcCountProblems, fcLessonTotals, fcRemaining, isDesignated } from "../../../functions/shared/fc-lessons.mjs";

const text = (value) => String(value ?? "").trim();

/** 저장 전 막을 것 → 문구 (코드 함께). */
export function fcCountErrors(counts, context) {
  return fcCountProblems(counts, context).map((code) => ({ code, text: FC_LESSON_PROBLEM_TEXT[code] || code }));
}

/**
 * 강사 한 명 · 한 달 FC 수업 칸. monthDoc = fcLessonMonths/{강사}_{달} (없으면 아직 안 넣음).
 */
export function myFcLessonView({ instructorId, designation, monthDoc }) {
  const counts = { done: Number(monthDoc?.done) || 0, cancel: Number(monthDoc?.cancel) || 0 };
  const confirmed = text(monthDoc?.status) === "confirmed";
  return {
    designated: isDesignated(designation, instructorId),
    locked: confirmed,
    counts,
    totals: confirmed && monthDoc?.snapshot ? monthDoc.snapshot : fcLessonTotals(counts),
    remaining: fcRemaining(counts),
    hasCounts: counts.done + counts.cancel > 0,
  };
}

/** 확정 거절 → 문구 (원본 코드 함께). */
export function fcConfirmFailureText(error) {
  const details = error?.details || {};
  const reason = text(details.reason || error?.message || error?.code || "unknown").replace(/^functions\//, "");
  const known = {
    fc_cap_exceeded: "진행 + 캔슬이 한 달 8회를 넘어요 -- 강사에게 고쳐 달라고 해 주세요",
    not_designated: "이번 달 FC 수업 지정 강사가 아니에요",
    nothing_to_confirm: "강사가 아직 횟수를 넣지 않았어요",
    own_lessons: "자기 수업료는 다른 사람이 확정해야 해요",
    out_of_scope: "맡은 지점 강사가 아니에요",
    not_confirmer: "확정은 FC · 대표 · 총괄만 할 수 있어요",
    already_confirmed: "이미 확정된 달이에요",
  };
  if (known[reason]) return { kind: reason === "already_confirmed" ? "data_conflict" : ["fc_cap_exceeded", "nothing_to_confirm"].includes(reason) ? "invalid_request" : "permission", code: reason, text: `${known[reason]} (코드 ${reason})` };
  if (/unavailable|deadline|network/.test(reason)) return { kind: "network", code: reason, text: `연결이 불안정해 확정하지 못했어요. 다시 눌러 주세요 (코드 ${reason})` };
  return { kind: "unknown", code: reason, text: `확정하지 못했어요 (코드 ${reason})` };
}
