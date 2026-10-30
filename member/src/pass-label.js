/**
 * 회원 화면에서 수강권을 부르는 이름. **순수 함수다.**
 *
 *   "{수업유형} 필라테스 수업 {유상횟수}회"     1:1 필라테스 수업 10회
 *   서비스가 있으면 따로                        서비스 2회
 *
 * ── 상품명을 쓰지 않는다 (2026-10-30, 대표 결정) ──
 * 상품명에는 "깍두기 · 양도권 · 세일즈" 같은 센터 안의 이름이 붙는다. 차수 ·
 * 세션업 · 급여카테고리 · 단가도 관리용이다. 회원은 무슨 수업을 몇 회 샀는지만
 * 알면 된다. 그래서 서버 투영이 상품명과 차수를 아예 보내지 않고
 * (functions/src/member-view.js), 화면은 수업 유형과 횟수로 이름을 짓는다.
 * 회원용 이름 입력칸은 두지 않는다 -- 사람이 적는 이름은 다시 상품명이 된다.
 *
 * ── 서비스는 더하지 않는다 ──
 * "1:1 필라테스 수업 12회" 라고 하면 회원은 12회를 샀다고 기억하고, 재등록 때
 * 10회 계약서를 보면 숫자가 안 맞는다고 느낀다. 산 것과 받은 것을 나눠 적는다.
 */

/** 서버 투영의 lessonType (member-view.js 의 LESSON_TYPE 과 같은 값). */
export const LESSON_TYPE = Object.freeze({
  SOLO: "1:1",
  DUET: "2:1",
  DIOSA: "diosa",
  OTHER: "other",
});

const text = (value) => String(value ?? "").trim();
const count = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
};

/**
 * 수업 유형. 투영에 lessonType 이 없는 옛 문서(서버가 다시 만들기 전)는 함께
 * 쓰는 회원권만 2:1 로 알 수 있고, 나머지는 유형 없이 부른다 -- 모르는 유형을
 * 지어내지 않는다.
 */
export function lessonTypeOf(pass) {
  const given = text(pass?.lessonType);
  if (Object.values(LESSON_TYPE).includes(given)) return given;
  return pass?.isDuet ? LESSON_TYPE.DUET : LESSON_TYPE.OTHER;
}

/**
 * 수업 한 번의 이름. "1:1 필라테스 수업" · "디오사 프로그램".
 *
 * 수강권 카드와 수업 카드(홈 · 수업기록)가 같은 말을 쓴다 -- 한쪽만 "PT" 라고
 * 부르면 회원은 다른 수업으로 읽는다. 그룹 표기는 없다 (2026-10-30).
 *
 * @param {{ lessonType?: string, isDuet?: boolean }} source 회원권이나 이력 한 줄
 */
export function lessonName(source) {
  const type = lessonTypeOf(source);
  if (type === LESSON_TYPE.DIOSA) return "디오사 프로그램";
  if (type === LESSON_TYPE.SOLO || type === LESSON_TYPE.DUET) return `${type} 필라테스 수업`;
  return "필라테스 수업";
}

/** "1:1 필라테스 수업 10회". 유상 횟수가 0 이면 횟수를 붙이지 않는다. */
export function passTitle(pass) {
  const paid = count(pass?.totalSessions);
  const base = lessonName(pass);
  return paid ? `${base} ${paid}회` : base;
}

/** "서비스 2회". 서비스가 없으면 빈 문자열 -- 화면은 그 줄을 그리지 않는다. */
export function serviceLabel(pass) {
  const service = count(pass?.serviceSessions);
  return service ? `서비스 ${service}회` : "";
}

/** 한 줄로 쓸 자리(홈)에서: "1:1 필라테스 수업 10회 + 서비스 2회". */
export function passLabel(pass) {
  const service = serviceLabel(pass);
  return service ? `${passTitle(pass)} + ${service}` : passTitle(pass);
}
