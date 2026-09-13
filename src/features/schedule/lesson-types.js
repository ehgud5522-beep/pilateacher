/* 일정 유형 5종 — 개인 / 듀엣 / 그룹 / 상담 / 휴무.
   일정표 카드의 색·도형·약자·라벨이 모두 이 정의 하나를 따른다.

   shape 는 주간 격자에서 유형 글자를 대신한다. 글자를 뺀 자리에 색만
   남으면 색으로만 구분하는 화면이 되는데, 밝은 야외나 색각 이상에서는
   구분이 사라진다. 도형은 색이 안 보여도 남는다.

   흔한 글자만 쓴다 -- 안드로이드 기본 글꼴에 없는 도형은 네모(두부)로
   나오고, 그러면 다섯 유형이 전부 같아 보인다. */

export const LESSON_TYPES = Object.freeze([
  Object.freeze({ key: "private", label: "개인", short: "개", shape: "●", formKind: "solo", legacyType: "개인레슨" }),
  Object.freeze({ key: "duet", label: "듀엣", short: "듀", shape: "◆", formKind: "duet", legacyType: "듀엣" }),
  Object.freeze({ key: "group", label: "그룹", short: "그", shape: "■", formKind: "group", legacyType: "그룹" }),
  Object.freeze({ key: "consult", label: "상담", short: "상", shape: "▲", formKind: "consult", legacyType: "개인일정" }),
  Object.freeze({ key: "off", label: "휴무", short: "휴", shape: "○", formKind: "off", legacyType: "개인일정" }),
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
