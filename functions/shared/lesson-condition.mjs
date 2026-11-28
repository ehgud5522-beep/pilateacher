/**
 * 수업 전 몸 상태 전하기 (2026-11-28 대표: "보니따 앱에 이번 주 수업 컨디션 미리 강사에게 전달하기 --
 * 강사님에게 내 몸 상태를 미리 전달해 주세요").
 *
 * 대표 결정 (같은 날):
 *   1. 회원은 보니따 수업 상세(오늘 수업 카드를 누르면 열리는 곳)에서 버튼으로 -- 좋아요 · 피곤해요 ·
 *      불편한 곳 있어요(부위 고르기) + 적고 싶으면 한 줄. 수업 시작 전까지 고칠 수 있다.
 *      강사는 원래 보는 수업 관리 → [수업 전] 브리핑 맨 위에서 본다. 강사 입력은 없다.
 *      "불편한 곳" 일 때만 강사 알림함에 한 건. 수업 30분 전 알림이 이 칸을 권한다
 *   2. **수업 뒤 30일이 지나면 지운다** (Firestore TTL: expireAt)
 *   3. 동의 문구를 넣고 바로 켠다 (처음 한 번 동의, 동의 기록을 남김)
 *
 * 몸 상태는 건강에 관한 정보(개인정보보호법의 민감정보)다. 그래서:
 *   - 담당 강사(그 수업의 instructorId)만 읽는다. 대표 · FC 화면에도 띄우지 않는다
 *   - 강사 알림함 글에는 부위 · 메모를 적지 않는다 (알림함은 지워지지 않는다)
 *   - 진단 · 로그에 부위 · 메모를 남기지 않는다
 *
 * **판정은 여기 한 곳이다.** 서버 함수 · 보니따 · 강사 앱이 같은 값을 쓴다.
 */

export const CONDITION_MOOD = Object.freeze({ GOOD: "good", TIRED: "tired", DISCOMFORT: "discomfort" });

export const CONDITION_MOODS = Object.freeze([
  Object.freeze({ key: CONDITION_MOOD.GOOD, label: "좋아요", emoji: "😊" }),
  Object.freeze({ key: CONDITION_MOOD.TIRED, label: "피곤해요", emoji: "😮‍💨" }),
  Object.freeze({ key: CONDITION_MOOD.DISCOMFORT, label: "불편한 곳 있어요", emoji: "🤕" }),
]);

export const CONDITION_AREAS = Object.freeze([
  Object.freeze({ key: "neck", label: "목" }),
  Object.freeze({ key: "shoulder", label: "어깨" }),
  Object.freeze({ key: "back", label: "허리" }),
  Object.freeze({ key: "pelvis", label: "골반" }),
  Object.freeze({ key: "knee", label: "무릎" }),
  Object.freeze({ key: "ankle", label: "발목" }),
  Object.freeze({ key: "other", label: "기타" }),
]);

export const CONDITION_MEMO_MAX = 100;
export const CONDITION_RETENTION_DAYS = 30;
/** 동의 문구가 바뀌면 올린다 -- 올리면 회원에게 다시 묻는다. */
export const CONDITION_CONSENT_VERSION = "2026-11-28";
export const CONDITION_CONSENT_TEXT = Object.freeze([
  "적어 주신 몸 상태는 이 수업의 담당 선생님께만 전달돼요.",
  "수업이 끝나고 30일이 지나면 자동으로 지워져요.",
  "전하지 않아도 수업은 그대로 받을 수 있어요.",
]);

const text = (value) => String(value ?? "").trim();
/** @type {string[]} */
const AREA_KEYS = CONDITION_AREAS.map((area) => area.key);
/** @type {string[]} */
const MOOD_KEYS = CONDITION_MOODS.map((mood) => mood.key);
const DAY_MS = 24 * 60 * 60 * 1000;

/** 저장할 수 없으면 코드 하나. 되면 "". 불편한 곳이 아니면 부위를 받지 않는다. */
export function conditionError(value) {
  const mood = text(value?.mood);
  const areas = Array.isArray(value?.areas) ? value.areas.map(text) : [];
  const memo = String(value?.memo ?? "");
  if (!MOOD_KEYS.includes(mood)) return "condition_bad_mood";
  if (areas.some((area) => !AREA_KEYS.includes(area))) return "condition_bad_area";
  if (new Set(areas).size !== areas.length) return "condition_bad_area";
  if (mood !== CONDITION_MOOD.DISCOMFORT && areas.length) return "condition_areas_without_discomfort";
  if (mood === CONDITION_MOOD.DISCOMFORT && !areas.length && !memo.trim()) return "condition_discomfort_empty";
  if (memo.length > CONDITION_MEMO_MAX) return "condition_memo_too_long";
  return "";
}

/** 저장할 모양으로 다듬는다 (부위는 정해진 순서로). */
export function cleanCondition(value) {
  const mood = text(value?.mood);
  const picked = new Set(Array.isArray(value?.areas) ? value.areas.map(text) : []);
  return {
    mood,
    areas: mood === CONDITION_MOOD.DISCOMFORT ? AREA_KEYS.filter((key) => picked.has(key)) : [],
    memo: String(value?.memo ?? "").trim().slice(0, CONDITION_MEMO_MAX),
  };
}

/** 지울 날 = 수업 시각 + 30일. */
export function conditionExpireAt(lessonStartsAt) {
  const at = lessonStartsAt instanceof Date ? lessonStartsAt : new Date(lessonStartsAt);
  return new Date((Number.isFinite(at.getTime()) ? at.getTime() : Date.now()) + CONDITION_RETENTION_DAYS * DAY_MS);
}

/** 강사 브리핑 한 줄. "허리 · 무릎 불편" / "피곤해요" / "좋아요". 메모는 따로. */
export function conditionHeadline(condition) {
  const mood = text(condition?.mood);
  if (mood === CONDITION_MOOD.DISCOMFORT) {
    const labels = (Array.isArray(condition?.areas) ? condition.areas : [])
      .map((key) => CONDITION_AREAS.find((area) => area.key === key)?.label).filter(Boolean);
    return labels.length ? `${labels.join(" · ")} 불편` : "불편한 곳 있어요";
  }
  return CONDITION_MOODS.find((item) => item.key === mood)?.label || "";
}

/** 문서 id. 한 수업 · 한 회원에 하나. */
export const conditionDocId = (lessonId, clientId) => `${text(lessonId)}_${text(clientId)}`;
