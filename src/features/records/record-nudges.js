/**
 * 권장 문구 두 줄 (2026-11-21 대표).
 *  - "수업기록이 최소한 3번당 1번은 꼭 일지 기록할 수 있게 안내 문구 하나 자동으로"
 *  - "비포애프터도 한 달마다 지나면 최소 하나는 회원에게 보낼 수 있게 권장 문구"
 *
 * 강사 일을 늘리지 않는다 (같은 날 대표): 새 화면 · 새 버튼 없이 수업 관리 "수업 후" 탭, 일지 칸 바로 위에
 * 저절로 뜨고, 할 일을 하면 저절로 사라진다. 막지 않는다 -- 권장일 뿐 확정은 그대로 된다.
 *
 * 판정은 기기에 있는 것만 본다: 이 폰의 일정 · 회원 기록. 비포애프터는 이 강사가 그 회원에게 보낸 카드의
 * 마지막 시각(서버 teacherList). 순수 함수다. 문구 · 기준 숫자는 여기서만 정한다.
 */

const text = (value) => String(value ?? "").trim();
const DAY_MS = 86400000;

/** 3번에 1번. 기록 없이 지나간 수업이 이 수 - 1 개면 이번 수업에 권한다. */
export const RECORD_EVERY_LESSONS = 3;
/** 한 달에 한 장. */
export const BEFORE_AFTER_EVERY_DAYS = 30;

export const NUDGE_CODE = Object.freeze({
  RECORD: "record_every_3",
  BEFORE_AFTER_NEVER: "before_after_never_sent",
  BEFORE_AFTER_STALE: "before_after_monthly",
});

const attendeesOf = (lesson) => {
  if (!lesson || typeof lesson !== "object") return [];
  if (Array.isArray(lesson.attendees) && lesson.attendees.length) return lesson.attendees.filter((item) => item && item.memberId);
  return lesson.memberId ? [{ memberId: lesson.memberId, status: lesson.status || "booked" }] : [];
};
const startOf = (lesson) => new Date(`${text(lesson?.date)}T${text(lesson?.start) || "00:00"}:00`).getTime();
const endOf = (lesson) => new Date(`${text(lesson?.date)}T${text(lesson?.end || lesson?.start) || "23:59"}:00`).getTime();

/** 그 수업에 그 회원 기록이 있는가 (상담 · 인바디 제외, AI 초안도 기록으로 본다 -- 남기긴 했다). */
export const lessonHasRecord = (member, lessonId) => (member?.notes || []).some((note) => note
  && text(note.sid) === text(lessonId)
  && !["상담", "인바디"].includes(text(note.type))
  && text(note.body));

/** 이 회원이 출석(done)한, 이미 끝난 수업들. 새 것부터. 개인 일정 · 예시는 뺀다. */
function attendedLessons(member, schedule, now) {
  const id = text(member?.id);
  return (Array.isArray(schedule) ? schedule : [])
    .filter((lesson) => lesson && !lesson.personal && lesson.isSample !== true)
    .filter((lesson) => attendeesOf(lesson).some((attendee) => text(attendee.memberId) === id && attendee.status === "done"))
    .filter((lesson) => { const end = endOf(lesson); return Number.isFinite(end) && end <= now; })
    .sort((left, right) => startOf(right) - startOf(left));
}

/**
 * 이번 수업 앞에서 기록 없이 이어진 출석 수업 수. 처음 기록이 나오면 멈춘다.
 * @param {{ member: any, schedule: any[], currentLessonId: string, now?: number }} input
 */
export function recordGapBefore({ member, schedule, currentLessonId, now = Date.now() }) {
  if (!member || member.isSample === true) return 0;
  const current = (schedule || []).find((lesson) => text(lesson?.id) === text(currentLessonId));
  const currentStart = current ? startOf(current) : Infinity;
  let gap = 0;
  for (const lesson of attendedLessons(member, schedule, now)) {
    if (text(lesson.id) === text(currentLessonId)) continue;
    if (Number.isFinite(currentStart) && startOf(lesson) >= currentStart) continue;
    if (lessonHasRecord(member, lesson.id)) break;
    gap += 1;
  }
  return gap;
}

/**
 * 수업기록 권장. 지난 2번이 기록 없이 지나갔고 이번 수업도 아직 기록이 없으면 뜬다.
 * @returns {null | { code: string, text: string, gap: number }}
 */
export function recordNudge({ member, schedule, currentLessonId, now = Date.now() }) {
  if (!member || !text(currentLessonId) || lessonHasRecord(member, currentLessonId)) return null;
  const gap = recordGapBefore({ member, schedule, currentLessonId, now });
  if (gap < RECORD_EVERY_LESSONS - 1) return null;
  return {
    code: NUDGE_CODE.RECORD,
    gap,
    text: `최근 ${gap}번 수업에 일지가 없어요 · ${RECORD_EVERY_LESSONS}번에 한 번은 남기기를 권해요`,
  };
}

/**
 * 비포애프터 권장.
 * @param {{ member: any, schedule: any[], share: null | { linked: boolean, lastSentAt: number|null, disabled?: boolean }, now?: number }} input
 *   share = 이 강사가 그 회원에게 보낸 카드 요약. null = 아직 모름 · 못 읽음 → 띄우지 않는다
 */
export function beforeAfterNudge({ member, schedule, share, now = Date.now() }) {
  if (!member || member.isSample === true || !share || share.disabled || !share.linked) return null;
  /* 함께한 지 한 달이 안 된 회원에게는 아직 이르다 -- 첫 출석 기준. */
  const lessons = attendedLessons(member, schedule, now);
  const first = lessons.length ? startOf(lessons[lessons.length - 1]) : NaN;
  if (!Number.isFinite(first) || now - first < BEFORE_AFTER_EVERY_DAYS * DAY_MS) return null;
  const last = Number(share.lastSentAt) || 0;
  if (!last) {
    return { code: NUDGE_CODE.BEFORE_AFTER_NEVER, text: "이 회원에게 아직 비포애프터를 보내지 않았어요 · 한 달에 한 장은 보내기를 권해요" };
  }
  const days = Math.floor((now - last) / DAY_MS);
  if (days < BEFORE_AFTER_EVERY_DAYS) return null;
  return { code: NUDGE_CODE.BEFORE_AFTER_STALE, days, text: `비포애프터를 보낸 지 ${days}일 지났어요 · 한 달에 한 장은 보내기를 권해요` };
}

/** teacherList 결과에서 마지막으로 보낸 시각. 공개 중(active)인 카드만 -- 서버는 거둔 카드를 돌려주지 않는다. */
export function lastSentAtOf(shares) {
  let last = 0;
  for (const share of Array.isArray(shares) ? shares : []) {
    if (text(share?.status) !== "active" || !share.sharedAt) continue;
    const at = new Date(share.sharedAt).getTime();
    if (Number.isFinite(at) && at > last) last = at;
  }
  return last || null;
}
