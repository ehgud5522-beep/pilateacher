export const LESSON_RECORD_GUIDE_COUNT_KEY = "pilateacher_lesson_record_guide_count_v1";

export const EMPTY_FIELD_MARK = "—";

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
  /* 빈 칸에는 대시 하나만 둔다.

     "추가해 주세요"는 기록을 덜 채웠다고 강사를 재촉하는 말이었다. 말하지 않은
     것은 숙제가 아니고, 비어 있다는 사실 자체가 기록이다. */
  const card = (key, label, values) => ({ key, label, value: joined(values) || EMPTY_FIELD_MARK, empty: values.length === 0 });
  const cards = [
    card("observations", "변화", observations),
    card("didToday", "오늘 수업", didToday),
    card("responses", "회원 반응", responses),
    card("nextFocus", "다음 확인", nextFocus),
  ];
  const narrative = String(draft?.summary || "").trim();
  return { cards, narrative, narrativeLabel: "수업 기록" };
}

/* 저장 후 반영 화면을 몇 번 보여 줬는지.

   처음 몇 번은 "말한 것이 다음 수업에 뜬다"를 눈으로 보여 줄 값어치가 있지만,
   알고 나면 저장할 때마다 가로막는 화면이 된다. 네 번째부터는 기존 토스트로
   돌아간다.

   초기화: 이 키를 지우면 다시 처음부터 센다.
     localStorage.removeItem("pilateacher_next_lesson_reflection_count_v1") */
export const NEXT_LESSON_REFLECTION_COUNT_KEY = "pilateacher_next_lesson_reflection_count_v1";

export function shouldShowNextLessonReflection(storage, limit = 3) {
  try { return Math.max(0, Number(storage?.getItem?.(NEXT_LESSON_REFLECTION_COUNT_KEY)) || 0) < limit; }
  catch (error) { return true; }
}

export function markNextLessonReflectionShown(storage, limit = 3) {
  try {
    const current = Math.max(0, Number(storage?.getItem?.(NEXT_LESSON_REFLECTION_COUNT_KEY)) || 0);
    const next = Math.min(limit, current + 1);
    storage?.setItem?.(NEXT_LESSON_REFLECTION_COUNT_KEY, String(next));
    return next;
  } catch (error) { return 0; }
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
