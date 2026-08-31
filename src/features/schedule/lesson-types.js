/* 일정 유형 5종 — 개인 / 듀엣 / 그룹 / 상담 / 휴무.
   일정표 카드의 색·약자·라벨이 모두 이 정의 하나를 따른다. */

export const LESSON_TYPES = Object.freeze([
  Object.freeze({ key: "private", label: "개인", short: "개", formKind: "solo", legacyType: "개인레슨" }),
  Object.freeze({ key: "duet", label: "듀엣", short: "듀", formKind: "duet", legacyType: "듀엣" }),
  Object.freeze({ key: "group", label: "그룹", short: "그", formKind: "group", legacyType: "그룹" }),
  Object.freeze({ key: "consult", label: "상담", short: "상", formKind: "consult", legacyType: "개인일정" }),
  Object.freeze({ key: "off", label: "휴무", short: "휴", formKind: "off", legacyType: "개인일정" }),
]);

export const LESSON_TYPE_KEYS = Object.freeze(LESSON_TYPES.map((item) => item.key));

const BY_KEY = new Map(LESSON_TYPES.map((item) => [item.key, item]));
const BY_FORM_KIND = new Map(LESSON_TYPES.map((item) => [item.formKind, item]));

export const lessonTypeDef = (key) => BY_KEY.get(String(key ?? "").trim()) || BY_KEY.get("private");
export const lessonTypeByFormKind = (kind) => BY_FORM_KIND.get(String(kind ?? "").trim()) || BY_KEY.get("private");

/* App 의 attendeesOf 와 같은 규칙 — 옛 일정은 memberId 하나만 갖고 있다. */
const attendeeCountOf = (lesson) => {
  const list = Array.isArray(lesson?.attendees) ? lesson.attendees.filter((item) => item && item.memberId) : [];
  if (list.length) return list.length;
  return lesson?.memberId ? 1 : 0;
};

export function lessonTypeKeyOf(lesson) {
  if (lesson?.personal) return String(lesson.title || "").trim() === "상담" ? "consult" : "off";
  if (attendeeCountOf(lesson) === 0) return "group";
  if (attendeeCountOf(lesson) > 1 || String(lesson?.type || "").trim() === "듀엣") return "duet";
  return "private";
}

export const lessonTypeOf = (lesson) => lessonTypeDef(lessonTypeKeyOf(lesson));

/* 그룹 인원 — 등록 화면 기본값 8명, 1~20명. */
export const DEFAULT_GROUP_COUNT = 8;
export const GROUP_COUNT_MIN = 1;
export const GROUP_COUNT_MAX = 20;

export function clampGroupCount(value, fallback = DEFAULT_GROUP_COUNT) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(GROUP_COUNT_MAX, Math.max(GROUP_COUNT_MIN, parsed));
}
