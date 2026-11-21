/**
 * FC 복지 수업료 화면 판정 (2026-11-21). 계산 · 한도는 functions/shared/fc-lessons.mjs, 여기는 화면 문구 · 코드만. 순수 함수다.
 */
import { FC_LESSON_PROBLEM_TEXT, fcCapCheck, fcLessonProblems, fcLessonTotals, isDesignated } from "../../../functions/shared/fc-lessons.mjs";

const text = (value) => String(value ?? "").trim();

/** 새 줄의 처음 값. */
export const blankFcLesson = ({ instructorId, month }) => ({ instructorId: text(instructorId), month: text(month), lessonDate: `${text(month)}-01`, outcome: "done", fcUserId: "", note: "" });

/** 저장 전 막을 것 → 문구 (코드 함께). */
export function fcLessonErrors(entry, context) {
  return fcLessonProblems(entry, context).map((code) => ({ code, text: FC_LESSON_PROBLEM_TEXT[code] || code }));
}

/**
 * 강사 한 명 · 한 달 FC 수업 칸.
 * @param {{ instructorId: string, monthEntries: any[], designation: any, monthDoc: any }} input  monthEntries = 그 달 센터 전체 fcLessons
 */
export function myFcLessonView({ instructorId, monthEntries, designation, monthDoc }) {
  const all = Array.isArray(monthEntries) ? monthEntries : [];
  const mine = all.filter((entry) => text(entry.instructorId) === text(instructorId)).sort((left, right) => text(right.lessonDate).localeCompare(text(left.lessonDate)));
  const { byFc, overIds } = fcCapCheck(all);
  const overCap = new Set([...(monthDoc?.lastCheck?.overCapEntryIds || []).map(text), ...[...overIds].filter((id) => mine.some((entry) => text(entry.id) === id))]);
  return {
    designated: isDesignated(designation, instructorId),
    locked: text(monthDoc?.status) === "confirmed",
    totals: text(monthDoc?.status) === "confirmed" && monthDoc?.snapshot ? monthDoc.snapshot : fcLessonTotals(mine),
    rows: mine.map((entry) => ({ ...entry, overCap: overCap.has(text(entry.id)) })),
    remainingOf: (fcUserId) => byFc.get(text(fcUserId))?.remaining ?? 8,
  };
}

/** 확정 거절 → 문구 (원본 코드 함께). */
export function fcConfirmFailureText(error) {
  const details = error?.details || {};
  const reason = text(details.reason || error?.message || error?.code || "unknown").replace(/^functions\//, "");
  const known = {
    fc_cap_exceeded: `FC 한 명당 한 달 8회(진행 + 캔슬)를 넘친 줄이 ${Number(details.overCap) || 0}건 있어요 -- 강사에게 고쳐 달라고 해 주세요`,
    not_designated: "이번 달 FC 수업 지정 강사가 아니에요",
    received_by_confirmer: "자기가 받은 수업은 다른 사람이 확정해야 해요",
    own_lessons: "자기 수업료는 다른 사람이 확정해야 해요",
    out_of_scope: "맡은 지점 강사가 아니에요",
    not_confirmer: "확정은 FC · 대표 · 총괄만 할 수 있어요",
    already_confirmed: "이미 확정된 달이에요",
  };
  if (known[reason]) return { kind: reason === "fc_cap_exceeded" ? "invalid_request" : reason === "already_confirmed" ? "data_conflict" : "permission", code: reason, text: `${known[reason]} (코드 ${reason})` };
  if (/unavailable|deadline|network/.test(reason)) return { kind: "network", code: reason, text: `연결이 불안정해 확정하지 못했어요. 다시 눌러 주세요 (코드 ${reason})` };
  return { kind: "unknown", code: reason, text: `확정하지 못했어요 (코드 ${reason})` };
}
