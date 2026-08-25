export const LESSON_RECORD_GUIDE_COUNT_KEY = "pilateacher_lesson_record_guide_count_v1";

const itemText = (item) => String(typeof item === "string" ? item : item?.text || "").trim();
const valuesOf = (draft, field) => (Array.isArray(draft?.[field]) ? draft[field] : []).map(itemText).filter(Boolean);
const joined = (values) => values.join(" · ");

export function lessonRecordPresentation(draft) {
  const source = String(draft?.provenanceSource || "openai");
  if (source === "fallback_raw") {
    return {
      cards: [],
      narrative: String(draft?.rawTranscript || "").trim(),
      narrativeLabel: "선생님 기록",
    };
  }
  const didToday = valuesOf(draft, "didToday");
  const observations = valuesOf(draft, "observations");
  const responses = valuesOf(draft, "responses");
  const nextFocus = valuesOf(draft, "nextFocus");
  const cards = [
    { key: "observations", label: "변화", value: joined(observations) || "추가해 주세요" },
    { key: "didToday", label: "오늘 수업", value: joined(didToday) || "추가해 주세요" },
    { key: "responses", label: "회원 반응", value: joined(responses) || "추가해 주세요" },
    { key: "nextFocus", label: "다음 확인", value: joined(nextFocus) || "아직 계획 없음" },
  ];
  const narrative = String(draft?.summary || "").trim();
  return { cards, narrative, narrativeLabel: "수업 기록" };
}

export function shouldShowLessonRecordGuide(storage, limit = 3) {
  try { return Math.max(0, Number(storage?.getItem?.(LESSON_RECORD_GUIDE_COUNT_KEY)) || 0) < limit; }
  catch (error) { return true; }
}

export function markLessonRecordGuideUsed(storage, limit = 3) {
  try {
    const current = Math.max(0, Number(storage?.getItem?.(LESSON_RECORD_GUIDE_COUNT_KEY)) || 0);
    const next = Math.min(limit, current + 1);
    storage?.setItem?.(LESSON_RECORD_GUIDE_COUNT_KEY, String(next));
    return next;
  } catch (error) { return 0; }
}
