/**
 * 수업 후 별점 평가 — 항목 · 판정 · 집계 한 벌 (2026-11-09). **순수 함수만 둔다.**
 *
 * 서버(functions/src/lesson-rating.js) · 회원 앱(member/src/lesson-rating.jsx) · 강사 앱
 * 대표 화면이 같은 파일을 쓴다. 항목 문구와 id 가 세 곳에서 따로 적히면, 회원이 본 질문과
 * 대표가 보는 평균이 다른 질문을 가리키게 된다.
 *
 * ── 대표 요청 (2026-11-09) ──
 * "매 수업은 어땠는지 평가 항목을 별 표시로 빠르게 체크 · 강사님에겐 공개되지 않습니다 ·
 *  나중에 강사들 평가 항목을 빠르게 알 수 있게 몇 점 받고 있는지 누적 횟수로 체크"
 *
 * ── 지키는 것 ──
 * - 저장은 서버 함수만. 규칙은 lessonRatings · lessonRatingStats 를 **누구에게도** 열지
 *   않는다 -- 강사는 물론 대표도 개별 응답을 읽지 못한다. 대표는 서버가 돌려주는 강사별
 *   건수 · 평균만 본다
 * - 회원 이름 · 연락처는 평가 문서에도 집계에도 없다
 * - 스위치(runtimeConfig/scheduleSync.memberRating)가 없거나 못 읽으면 꺼진 것이다
 */

const text = (value) => String(value ?? "").trim();

/**
 * 평가 항목. **문구는 여기서만 바꾼다.** id 는 저장 · 집계의 열쇠라 한 번 쓰면 바꾸지
 * 않는다 -- 문구를 크게 바꿔 다른 질문이 되면 새 id 로 추가하고 옛 것은 빼라 (옛 집계는
 * 그 id 로 남는다). 별 5 가 언제나 "좋음" 쪽이어야 평균이 읽힌다 -- "강도가 알맞았나" 처럼
 * 가운데가 좋은 질문은 넣지 않는다.
 *
 * 첫 항목은 대표가 보낸 화면 그대로다. 나머지 둘은 제안이다 (PR 설명에 다른 후보).
 */
export const RATING_ITEMS = Object.freeze([
  Object.freeze({ id: "body", question: "오늘 수업 후 몸 상태는 어떠세요?", low: "매우 불편함", high: "매우 좋음" }),
  Object.freeze({ id: "care", question: "선생님이 내 몸에 맞게 봐 주셨나요?", low: "전혀 아니에요", high: "아주 그래요" }),
  Object.freeze({ id: "again", question: "다음 수업도 기대되나요?", low: "전혀 아니에요", high: "아주 기대돼요" }),
]);

/** @type {readonly string[]} */
export const RATING_ITEM_IDS = Object.freeze(RATING_ITEMS.map((item) => /** @type {string} */ (item.id)));
export const SCORE_RANGE = Object.freeze({ min: 1, max: 5 });

/** 화면 문구. 대표 요청: "강사님에게는 공개되지 않습니다 · 추후 피드백" 뜻을 한 줄로. */
export const RATING_COPY = Object.freeze({
  CAPTION: "BONITA VIP · 수업 완료",
  TITLE: "오늘 수업은 어떠셨나요?",
  SECONDS: "10초",
  PRIVACY: "강사님에게는 공개되지 않아요 · 더 좋은 수업을 위한 피드백으로만 쓰여요",
  SUBMIT: "보내기",
  LATER: "다음에 할게요",
  THANKS: "소중한 의견 고마워요",
  THANKS_NOTE: "강사님에게는 공개되지 않아요.",
});

/** 수업이 끝나고 며칠 안에 평가할 수 있는가. 서버 · 화면이 같은 값을 쓴다. */
export const RATING_WINDOW_DAYS = 3;
const MS_DAY = 24 * 60 * 60 * 1000;

export const RATING_MODE = Object.freeze({ OFF: "off", LISTED: "listed", ALL: "all" });

/**
 * 왜 평가를 받지 않는가. 화면 문구 · 진단이 이 코드 하나로 이어진다 (member/src/rating-copy.js).
 */
export const RATING_REASON = Object.freeze({
  /** 스위치 꺼짐 · 시범 강사 밖 · 설정 없음. 화면은 아무것도 그리지 않는다. */
  FEATURE_OFF: "feature_off",
  NOT_FOUND: "lesson_not_found",
  /** 이 회원의 수업이 아니다. */
  NOT_OWN: "not_own_lesson",
  /** 강사가 취소했거나 회원이 취소한 수업. */
  CANCELLED: "lesson_cancelled",
  /** 노쇼로 끝난 수업 -- 받지 않은 수업은 평가하지 않는다. */
  NOT_ATTENDED: "lesson_not_attended",
  /** 아직 시작하지 않은 수업. */
  NOT_STARTED: "lesson_not_started",
  /** 평가 기간(RATING_WINDOW_DAYS)이 지났다. */
  EXPIRED: "rating_expired",
  /** 이미 평가했다 -- 두 번 누르기. 오류가 아니라 성공으로 돌려준다. */
  ALREADY: "already_rated",
  /** 점수 모양이 틀렸다 (항목 · 범위). */
  SCORES_INVALID: "scores_invalid",
});

export function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?._seconds === "number") return new Date(value._seconds * 1000);
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at : null;
}

/** 평가 문서 id. 회원 한 명이 한 수업에 한 번 -- 이 id 가 그것을 지킨다. */
export function ratingDocId(lessonId, clientId) {
  const lesson = text(lessonId);
  const client = text(clientId);
  if (!lesson || !client || lesson.includes("/") || client.includes("/")) return "";
  return `${lesson}_${client}`;
}

/**
 * 스위치 한 벌. **못 읽거나 비어 있으면 꺼진 것이다.** listed 의 userIds 는 강사 계정 uid --
 * 그 강사의 수업에만 평가를 받는다 (시범).
 */
export function readLessonRatingConfig(raw) {
  const modes = /** @type {string[]} */ (Object.values(RATING_MODE));
  const mode = modes.includes(text(raw?.mode)) ? text(raw.mode) : RATING_MODE.OFF;
  const userIds = [...new Set((Array.isArray(raw?.userIds) ? raw.userIds : []).map(text).filter(Boolean))];
  return { mode, userIds };
}

/** 이 강사의 수업에 평가를 받는가. scheduleSyncDoc 는 runtimeConfig/scheduleSync 문서 전체. */
export function lessonRatingEnabledFor(scheduleSyncDoc, instructorId) {
  const config = readLessonRatingConfig(scheduleSyncDoc?.memberRating);
  if (config.mode === RATING_MODE.ALL) return true;
  if (config.mode === RATING_MODE.LISTED) return Boolean(text(instructorId)) && config.userIds.includes(text(instructorId));
  return false;
}

/** 수업 문서의 회원 목록 (듀엣은 clientIds, 옛 문서는 clientId 하나). */
function clientIdsOf(lesson) {
  const list = Array.isArray(lesson?.clientIds) ? lesson.clientIds.map(text).filter(Boolean) : [];
  const single = text(lesson?.clientId);
  return single && !list.includes(single) ? [...list, single] : list;
}

/** 이 회원이 이 수업을 취소했는가 (회원 앱 취소가 남긴 표시). */
function cancelledByMember(lesson, clientId) {
  const mark = lesson?.memberCancellations?.[text(clientId)];
  return Boolean(mark && typeof mark === "object");
}

/**
 * 평가해도 되는가. 차례가 곧 우선순위다.
 * 1. 수업 없음 → 2. 이미 평가함 → 3. 기능 꺼짐 → 4. 내 수업 아님 → 5. 취소됨 → 6. 노쇼 → 7. 시작 전 → 8. 기간 지남
 *
 * 2 가 3 보다 앞이다: 보낸 뒤에 스위치를 꺼도 두 번째 클릭은 "보냈어요" 로 끝나야 한다.
 *
 * @param {{ now: Date, lesson: any, clientId: string, scheduleSyncDoc: any, existing?: any }} input
 * @returns {{ ok: boolean, reason: string, instructorId: string, startsAt: Date | null }}
 */
export function decideLessonRating(input) {
  const now = toDate(input?.now) || new Date();
  const lesson = input?.lesson || null;
  const clientId = text(input?.clientId);
  const startsAt = toDate(lesson?.startsAt);
  const instructorId = text(lesson?.instructorId);
  const out = (ok, reason) => ({ ok, reason, instructorId, startsAt });
  if (!lesson) return out(false, RATING_REASON.NOT_FOUND);
  if (input?.existing) return out(false, RATING_REASON.ALREADY);
  if (!lessonRatingEnabledFor(input?.scheduleSyncDoc, instructorId)) return out(false, RATING_REASON.FEATURE_OFF);
  if (!clientId || !clientIdsOf(lesson).includes(clientId)) return out(false, RATING_REASON.NOT_OWN);
  const status = text(lesson.status);
  if (status === "cancel" || status === "cancelled" || lesson.deletedAt || cancelledByMember(lesson, clientId)) {
    return out(false, RATING_REASON.CANCELLED);
  }
  if (status === "noshow") return out(false, RATING_REASON.NOT_ATTENDED);
  if (!startsAt || startsAt.getTime() > now.getTime()) return out(false, RATING_REASON.NOT_STARTED);
  if (now.getTime() - startsAt.getTime() > RATING_WINDOW_DAYS * MS_DAY) return out(false, RATING_REASON.EXPIRED);
  return out(true, "");
}

/**
 * 점수 검사. 모든 항목에 1~5 정수 하나씩 -- 빠진 항목 · 모르는 항목 · 소수 · 범위 밖은 거절.
 * @returns {{ ok: true, scores: Record<string, number> } | { ok: false, reason: string, field: string }}
 */
export function validateScores(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!source) return { ok: false, reason: RATING_REASON.SCORES_INVALID, field: "scores" };
  const unknown = Object.keys(source).find((key) => !RATING_ITEM_IDS.includes(key));
  if (unknown) return { ok: false, reason: RATING_REASON.SCORES_INVALID, field: unknown };
  /** @type {Record<string, number>} */
  const scores = {};
  for (const id of RATING_ITEM_IDS) {
    const value = Number(source[id]);
    if (!Number.isInteger(value) || value < SCORE_RANGE.min || value > SCORE_RANGE.max) {
      return { ok: false, reason: RATING_REASON.SCORES_INVALID, field: id };
    }
    scores[id] = value;
  }
  return { ok: true, scores };
}

/**
 * 강사별 누적 문서에 한 건을 더한 모양. 항목마다 합계 · 건수 (항목이 나중에 늘어도 옛 건수가
 * 섞이지 않게 항목마다 따로 센다).
 */
export function addToStats(stats, scores) {
  const items = stats?.items && typeof stats.items === "object" ? stats.items : {};
  const next = { ...items };
  for (const [id, score] of Object.entries(scores || {})) {
    const current = items[id] && typeof items[id] === "object" ? items[id] : {};
    next[id] = { sum: (Number(current.sum) || 0) + score, count: (Number(current.count) || 0) + 1 };
  }
  return { count: (Number(stats?.count) || 0) + 1, items: next };
}

/** 소수 첫째 자리 평균. 건수가 없으면 null. */
export function averageOf(entry) {
  const count = Number(entry?.count) || 0;
  if (!count) return null;
  return Math.round(((Number(entry?.sum) || 0) / count) * 10) / 10;
}

/**
 * 대표 화면에 돌려줄 줄. 강사 이름 · 누적 응답 수 · 항목별 평균과 건수뿐이다 -- 회원 · 수업 ·
 * 개별 점수는 없다. 응답이 많은 강사부터.
 *
 * @param {Array<{ instructorId: string, count?: number, items?: any }>} statsDocs
 * @param {(instructorId: string) => string} nameOf
 */
export function summarizeStats(statsDocs, nameOf = () => "") {
  return (Array.isArray(statsDocs) ? statsDocs : [])
    .filter((doc) => text(doc?.instructorId) && Number(doc?.count) > 0)
    .map((doc) => ({
      instructorId: text(doc.instructorId),
      instructorName: text(nameOf(text(doc.instructorId))),
      count: Number(doc.count) || 0,
      items: RATING_ITEMS.map((item) => ({
        id: item.id,
        average: averageOf(doc.items?.[item.id]),
        count: Number(doc.items?.[item.id]?.count) || 0,
      })),
    }))
    .sort((left, right) => right.count - left.count || left.instructorName.localeCompare(right.instructorName));
}

/**
 * 회원 화면이 평가를 물을 수업 하나: 기간 안의 가장 최근 출석(차감) 중 아직 묻지 않은 것.
 * 판정은 서버가 다시 한다 -- 여기는 서버에 물을지 정할 뿐이다.
 *
 * @param {any[]} history 회원 투영의 history (최근 것이 앞)
 * @param {{ now?: Date, skip?: Set<string> | string[] }} options skip: 이미 보냈거나 "다음에" 를 누른 수업 id
 */
export function pickRatingCandidate(history, { now = new Date(), skip = [] } = {}) {
  const skipped = skip instanceof Set ? skip : new Set(skip);
  const rows = (Array.isArray(history) ? history : [])
    .filter((row) => text(row?.type) === "deduct" && text(row?.lessonId) && !skipped.has(text(row.lessonId)))
    .map((row) => ({ row, at: toDate(row.occurredAt) }))
    .filter(({ at }) => at && at.getTime() <= now.getTime() && now.getTime() - at.getTime() <= RATING_WINDOW_DAYS * MS_DAY)
    .sort((left, right) => right.at.getTime() - left.at.getTime());
  return rows.length ? rows[0].row : null;
}
