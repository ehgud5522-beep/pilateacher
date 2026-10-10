/* 일정 유형 7종 — 개인 / 듀엣 / 관리 A / 관리 B / 그룹 / 상담 / 휴무.
   일정표 카드의 색·도형·약자·라벨이 모두 이 정의 하나를 따른다.

   shape 는 주간 격자에서 유형 글자를 대신한다. 글자를 뺀 자리에 색만
   남으면 색으로만 구분하는 화면이 되는데, 밝은 야외나 색각 이상에서는
   구분이 사라진다. 도형은 색이 안 보여도 남는다.

   흔한 글자만 쓴다 -- 안드로이드 기본 글꼴에 없는 도형은 네모(두부)로
   나오고, 그러면 다섯 유형이 전부 같아 보인다. */

export const LESSON_TYPES = Object.freeze([
  Object.freeze({ key: "private", label: "개인", short: "개", shape: "●", formKind: "solo", legacyType: "개인레슨", span: 3 }),
  Object.freeze({ key: "duet", label: "듀엣", short: "듀", shape: "◆", formKind: "duet", legacyType: "듀엣", span: 3 }),
  /* 디오사 관리 수업 (2026-10-05). 혼자 받는 수업이라 모양은 개인과 같은
     계열이지만, **차감하는 회원권이 다르다** -- 관리 A 는 디오사 A 에서,
     관리 B 는 디오사 B 에서 빠진다. 1:1 PT 회원권에서 빠지면 회원은 자기가
     산 것과 다른 회차를 잃는다 (lesson-settlement.js 의 carePayCategory).

     legacyType 이 일정 문서에 적히는 값이고, lessonTypeKeyOf 가 그것으로
     되읽는다 -- 종류를 못 읽으면 개인으로 떨어져 PT 에서 빠진다. */
  /* 이름에 분이 들어간다. 디오사만 끊은 회원이 있고(PT 회원권 없음), 그
     사람의 수업을 넣는 사람은 "관리 A" 가 몇 분짜리인지부터 물어야 했다.
     A·B 는 회원권에 적힌 이름이고, 고를 때 보는 것은 길이다.

     PT 와 같은 폭으로 한 줄을 쓴다 (span 3). 전에는 A 가 개인·듀엣 옆에
     끼고 B 만 아랫줄로 밀려, 둘이 한 쌍이라는 것이 화면에서 끊겼다. */
  Object.freeze({ key: "care_a", label: "디오사 관리 30분", short: "A", shape: "▶", formKind: "care_a", legacyType: "관리A", span: 3, minutes: 30 }),
  Object.freeze({ key: "care_b", label: "디오사 관리 50분", short: "B", shape: "▷", formKind: "care_b", legacyType: "관리B", span: 3, minutes: 50 }),
  Object.freeze({ key: "group", label: "그룹", short: "그", shape: "■", formKind: "group", legacyType: "그룹", span: 2 }),
  Object.freeze({ key: "consult", label: "상담", short: "상", shape: "▲", formKind: "consult", legacyType: "개인일정", span: 2 }),
  Object.freeze({ key: "off", label: "휴무", short: "휴", shape: "○", formKind: "off", legacyType: "개인일정", span: 2 }),
]);

/** 이 종류가 단독 디오사 관리 수업인가. */
export const isCareLessonKey = (key) => key === "care_a" || key === "care_b";

/**
 * 이 길이에 맞는 관리 수업 종류. 30분이면 A, 50분이면 B 다.
 *
 * 둘은 **따로 파는 회원권**이라 길이를 틀리면 그 수업은 아예 확정되지 않는다
 * (A 회원권으로 50분을 할 수 없다). 그래서 길이를 고르면 종류가 따라가고,
 * 종류를 고르면 길이가 따라간다 -- 한쪽만 맞춰 두면 반드시 어긋난다.
 *
 * 맞는 길이가 없으면 빈 문자열이다. **짐작하지 않는다** -- 40분짜리 관리
 * 수업을 A 로 밀면 회원은 30분 회차를 40분 수업에 쓴다.
 */
export function careKeyForMinutes(minutes) {
  const wanted = Number(minutes);
  /* 관리 수업만 minutes 를 들고 있다. 넓혀 읽는다 -- 없는 칸을 묻는 것이
     이 함수의 일이고, 좁은 타입이면 그 질문 자체를 할 수 없다. */
  const found = LESSON_TYPES.find(
    (item) => Number(/** @type {{ minutes?: number }} */ (item).minutes) === wanted,
  );
  return found ? found.key : "";
}

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
