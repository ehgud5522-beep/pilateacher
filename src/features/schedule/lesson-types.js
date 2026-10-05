/* 일정 유형 7종 — 개인 / 듀엣 / 관리 A / 관리 B / 그룹 / 상담 / 휴무.
   일정표 카드의 색·도형·약자·라벨이 모두 이 정의 하나를 따른다.

   shape 는 주간 격자에서 유형 글자를 대신한다. 글자를 뺀 자리에 색만
   남으면 색으로만 구분하는 화면이 되는데, 밝은 야외나 색각 이상에서는
   구분이 사라진다. 도형은 색이 안 보여도 남는다.

   흔한 글자만 쓴다 -- 안드로이드 기본 글꼴에 없는 도형은 네모(두부)로
   나오고, 그러면 다섯 유형이 전부 같아 보인다. */

export const LESSON_TYPES = Object.freeze([
  Object.freeze({ key: "private", label: "개인", short: "개", shape: "●", formKind: "solo", legacyType: "개인레슨" }),
  Object.freeze({ key: "duet", label: "듀엣", short: "듀", shape: "◆", formKind: "duet", legacyType: "듀엣" }),
  /* 디오사 관리 수업 (2026-10-05). 혼자 받는 수업이라 모양은 개인과 같은
     계열이지만, **차감하는 회원권이 다르다** -- 관리 A 는 디오사 A 에서,
     관리 B 는 디오사 B 에서 빠진다. 1:1 PT 회원권에서 빠지면 회원은 자기가
     산 것과 다른 회차를 잃는다 (lesson-settlement.js 의 carePayCategory).

     legacyType 이 일정 문서에 적히는 값이고, lessonTypeKeyOf 가 그것으로
     되읽는다 -- 종류를 못 읽으면 개인으로 떨어져 PT 에서 빠진다. */
  Object.freeze({ key: "care_a", label: "관리 A(30분)", short: "A", shape: "▶", formKind: "care_a", legacyType: "관리A" }),
  Object.freeze({ key: "care_b", label: "관리 B(50분)", short: "B", shape: "▷", formKind: "care_b", legacyType: "관리B" }),
  Object.freeze({ key: "group", label: "그룹", short: "그", shape: "■", formKind: "group", legacyType: "그룹" }),
  Object.freeze({ key: "consult", label: "상담", short: "상", shape: "▲", formKind: "consult", legacyType: "개인일정" }),
  Object.freeze({ key: "off", label: "휴무", short: "휴", shape: "○", formKind: "off", legacyType: "개인일정" }),
]);

export const LESSON_TYPE_KEYS = Object.freeze(LESSON_TYPES.map((item) => item.key));

/* 키를 문자열로 넓혀 둔다. Object.freeze 가 다섯 글자의 합집합으로 좁히는데,
   이 맵은 저장된 일정에서 온 아무 문자열이나 받아 "없으면 개인" 으로 답하는
   것이 일이다 -- 좁은 타입이면 그 질문 자체를 할 수 없다. */
/** @type {Map<string, (typeof LESSON_TYPES)[number]>} */
const BY_KEY = new Map(LESSON_TYPES.map((item) => [item.key, item]));
/** @type {Map<string, (typeof LESSON_TYPES)[number]>} */
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
  /* 관리 수업은 적힌 종류가 그대로 답이다. 사람 수로 맞히지 않는다 -- 혼자
     받는 수업이라 세어 보면 개인과 구분이 안 되고, 그러면 PT 회원권에서
     빠진다. 듀엣보다 먼저 보는 이유도 같다. */
  const written = String(lesson?.type || "").trim();
  if (written === "관리A") return "care_a";
  if (written === "관리B") return "care_b";
  if (attendeeCountOf(lesson) > 1 || written === "듀엣") return "duet";
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
