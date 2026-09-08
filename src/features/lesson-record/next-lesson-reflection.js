import { createMemberBriefing, memberMemorySummary } from "../member-memory/briefing.js";
import { formatMemberLessonDate, selectMemberDetailStatus } from "./member-detail-selectors.js";
import { LESSON_RECORD_PROVENANCE_SOURCE } from "./failure-diagnostics.js";

/* 저장 직후 "이 내용이 다음 수업에 뜬다"를 보여주는 화면이 무엇을 그릴지 정한다.

   화면은 이미 저장된 값만 읽는다. 새로 부르는 것도, 채워 넣는 것도 없다 -- 빈 칸은
   빈 칸으로 두고 그 경우의 레이아웃으로 간다. */

const itemsOf = (draft, field) => (Array.isArray(draft?.[field]) ? draft[field] : [])
  .map((item) => String(typeof item === "string" ? item : item?.text || "").trim())
  .filter(Boolean);

const joined = (values) => values.join(" · ");

/* 정리된 기록인가.

   lesson-record-presentation 이 쓰는 것과 같은 판정이다. 정리에 실패했거나 아직
   원문만 있는 기록으로 카드를 만들면, 강사가 말하지 않은 모양을 보여주게 된다. */
export function isStructuredLessonRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (String(record.provenanceSource || "") === LESSON_RECORD_PROVENANCE_SOURCE.FALLBACK_RAW) return false;
  const draft = record.structuredDraft;
  return Boolean(draft && typeof draft === "object");
}

/* 이번에 처음 확정되는 기록인가.

   stage 는 저장하면서 confirmed_record 로 바뀐다. 바뀐 뒤에 읽으면 언제나 참이라
   조건이 영영 성립하지 않으므로, 부르는 쪽이 저장 직전 값을 잡아 넘겨야 한다. */
export function isFirstConfirmation(stageBeforeSave) {
  return String(stageBeforeSave || "") !== "confirmed_record";
}

/* 다음 수업 카드에 실을 문장. 없으면 null 이고, 없는 것을 지어내지 않는다. */
function nextFocusLine(draft) {
  const values = itemsOf(draft, "nextFocus");
  return values.length ? joined(values) : null;
}

/* B: 다음 확인이 비었을 때 대신 보여줄 지난 수업. 두 칸 다 비면 그것도 null 이다. */
function lastLessonLine(draft) {
  const parts = [joined(itemsOf(draft, "didToday")), joined(itemsOf(draft, "observations"))].filter(Boolean);
  return parts.length ? parts.join(" / ") : null;
}

export function selectNextLessonReflection({
  record = null,
  stageBeforeSave = "",
  member = null,
  schedule = [],
  recordDate = "",
  now = new Date(),
} = {}) {
  if (!isFirstConfirmation(stageBeforeSave)) return null;
  if (!isStructuredLessonRecord(record)) return null;

  const draft = record.structuredDraft;
  const { nextLesson } = selectMemberDetailStatus({ member, schedule, now });
  const memberName = String(member?.name || "회원").trim() || "회원";
  // 근거로 쓸 날짜. 이 기록이 언제 만들어졌는지를 그대로 적는다.
  const basisDate = String(recordDate || record.recordedAt || "").slice(0, 10);

  if (!nextLesson) {
    /* C. briefing 의 repeated 는 없을 때도 "반복 기록 없음" 이라는 문자열을 돌려주므로,
       그 문자열이 아니라 원본 항목의 유무로 판정한다. 없으면 줄 자체를 내보내지 않는다. */
    const summary = memberMemorySummary(createMemberBriefing({ member, schedule }));
    return {
      layout: "C",
      memberName,
      repeated: summary?.repeatedMemory ? summary.repeated : null,
    };
  }

  const focus = nextFocusLine(draft);
  return {
    layout: focus ? "A" : "B",
    memberName,
    lessonDate: formatMemberLessonDate(nextLesson.date, { weekday: true, now }),
    lessonTime: String(nextLesson.start || "").trim(),
    focus,
    lastLesson: focus ? null : lastLessonLine(draft),
    basisDate: basisDate ? formatMemberLessonDate(basisDate, { now }) : "",
  };
}
