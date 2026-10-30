/**
 * 강사 앱 일정 → 센터 서버(`organizations/{org}/lessons/{id}`). **순수 함수다.**
 *
 * ── 왜 있는가 (2026-10-30, 회원 앱 개편 3단계) ──
 * 일정은 강사 기기에만 있었다. 센터 서버에는 수업을 확정(차감)한 뒤에야 "완료"
 * 로 한 건 생겼다. 그래서 회원 앱은 예정 수업을 알 수 없었다. 이제 강사가 일정을
 * 등록 · 수정 · 취소하면 **확정 단계 없이 곧바로** 같은 문서에 쓴다. 서버가 그것을
 * 보고 회원 데이터(memberViews)를 다시 만든다.
 *
 * ── 확정과 같은 문서다 ──
 * 확정(pass-repository.js 의 deductPass)도 `lessons/{일정 id}` 에 merge 로 쓴다.
 * 그래서 일정이 먼저 있고, 확정하면 status 가 "completed" 로 바뀐다. **완료된
 * 수업은 일정 쪽에서 다시 쓰지 않는다** -- 그러면 "completed" 가 "scheduled" 로
 * 되돌아간다. 그 판정은 쓰는 쪽(lesson-schedule-repository.js)이 트랜잭션 안에서 한다.
 *
 * ── 무엇을 싣는가 ──
 * 날짜 · 시각 · 수업 유형 · 담당 강사 uid · 지점 · 센터 회원 id. **강사 메모, 상품명,
 * 차수, 단가는 싣지 않는다** -- 이 문서는 센터 직원 누구나 읽고, 회원 데이터의
 * 재료가 된다. 메모는 기기에 남는다.
 *
 * ── 지우지 않는다 ──
 * 규칙이 lessons 삭제를 막는다. 삭제한 일정 · 모두 취소한 수업은 status 를
 * "cancelled" 로 바꾸고, 회원 화면에서는 사라진다 ("취소됨" 을 따로 그리지 않는다).
 */

export const SCHEDULE_STATUS = Object.freeze({
  SCHEDULED: "scheduled",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
});

/** 회원 데이터의 수업 유형 (functions/src/member-view.js 의 LESSON_TYPE 과 같은 값). */
export const SCHEDULE_LESSON_TYPE = Object.freeze({
  SOLO: "1:1",
  DUET: "2:1",
  DIOSA: "diosa",
  OTHER: "other",
});

const text = (value) => String(value ?? "").trim();
const attendeesOf = (entry) => (Array.isArray(entry?.attendees) ? entry.attendees : []);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** "2026-10-30" + "19:00" → 기기 시각(한국)의 Date. 읽을 수 없으면 null. */
export function scheduleTime(date, time) {
  if (!DATE_RE.test(text(date)) || !TIME_RE.test(text(time))) return null;
  const [year, month, day] = text(date).split("-").map(Number);
  const [hour, minute] = text(time).split(":").map(Number);
  const at = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isFinite(at.getTime()) && at.getDate() === day ? at : null;
}

/**
 * 수업 유형. 일정의 종류(개인레슨 · 듀엣)와 관리 등급(디오사)으로 가른다.
 * 그 밖(그룹 등)은 "other" -- 회원 화면이 "필라테스 수업" 으로 부른다.
 */
export function scheduleLessonType(entry) {
  if (attendeesOf(entry).some((attendee) => text(attendee?.careGrade))) return SCHEDULE_LESSON_TYPE.DIOSA;
  const type = text(entry?.type);
  if (type === "개인레슨") return SCHEDULE_LESSON_TYPE.SOLO;
  if (type === "듀엣") return SCHEDULE_LESSON_TYPE.DUET;
  return SCHEDULE_LESSON_TYPE.OTHER;
}

/**
 * 일정 한 건을 서버 문서로. 보낼 것이 없으면 null.
 *
 * 보낼 것이 없는 경우: 개인 일정, 센터 회원이 한 명도 없는 수업(기기 명부에만
 * 있는 회원 · 인원만 적은 그룹), 날짜나 시각을 읽을 수 없는 일정.
 *
 * @param {{
 *   entry: any, members: Array<any>, organizationId: string, instructorId: string,
 *   cancelled?: boolean,
 * }} input
 *   cancelled  일정을 지웠다. 회원은 그대로 두고 status 만 cancelled 다 --
 *              서버가 누구의 화면에서 지울지 알아야 한다.
 */
export function scheduledLessonDocument(input) {
  const entry = input?.entry;
  const organizationId = text(input?.organizationId);
  const lessonId = text(entry?.id);
  if (!entry || !lessonId || !organizationId || entry.personal) return null;

  const byId = new Map((Array.isArray(input?.members) ? input.members : []).map((member) => [text(member?.id), member]));
  const linked = attendeesOf(entry)
    .map((attendee) => ({ attendee, member: byId.get(text(attendee?.memberId)) }))
    .filter(({ member }) => text(member?.orgClientId));
  if (!linked.length) return null;

  const startsAt = scheduleTime(entry.date, entry.start);
  if (!startsAt) return null;
  const endsAt = scheduleTime(entry.date, entry.end);

  /* 취소한 사람은 뺀다. 한 사람만 취소한 듀엣은 남은 사람에게만 보인다. */
  const going = [...new Set(linked
    .filter(({ attendee }) => text(attendee?.status) !== "cancel")
    .map(({ member }) => text(member.orgClientId)))];
  const everyone = [...new Set(linked.map(({ member }) => text(member.orgClientId)))];
  const cancelled = Boolean(input?.cancelled) || going.length === 0;

  return {
    lessonId,
    data: {
      organizationId,
      lessonId,
      status: cancelled ? SCHEDULE_STATUS.CANCELLED : SCHEDULE_STATUS.SCHEDULED,
      date: text(entry.date),
      startsAt,
      endsAt: endsAt && endsAt > startsAt ? endsAt : null,
      /* 취소된 수업에도 회원을 남긴다. 서버가 그 사람들의 화면을 다시 만든다. */
      clientIds: cancelled ? everyone : going,
      clientId: (cancelled ? everyone : going)[0],
      lessonType: scheduleLessonType(entry),
      instructorId: text(input?.instructorId),
      locationId: text(linked[0].member?.orgLocationId) || null,
    },
  };
}

/** 서버로 보낼 때 비교하는 일정의 부분. 메모 · 기록 · 장비가 바뀐 것은 보내지 않는다. */
function publishedShape(entry) {
  return JSON.stringify({
    date: text(entry?.date),
    start: text(entry?.start),
    end: text(entry?.end),
    type: text(entry?.type),
    personal: Boolean(entry?.personal),
    attendees: attendeesOf(entry).map((attendee) => ({
      memberId: text(attendee?.memberId),
      cancelled: text(attendee?.status) === "cancel",
      careGrade: text(attendee?.careGrade),
    })),
  });
}

/**
 * 저장 전후의 일정을 견주어 서버에 쓸 것을 고른다.
 *
 * 바뀐 일정과 새 일정은 그대로, 사라진 일정은 cancelled 로. 출석 · 메모처럼
 * 회원 화면에 상관없는 변경은 보내지 않는다 -- 저장할 때마다 수십 건을 다시 쓰면
 * 회원 데이터도 그만큼 다시 만들어진다.
 *
 * @param {{
 *   before: Array<any>, after: Array<any>, members: Array<any>,
 *   organizationId: string, instructorId: string,
 * }} input
 * @returns {Array<{ lessonId: string, data: object }>}
 */
export function scheduleChanges(input) {
  const before = new Map((Array.isArray(input?.before) ? input.before : []).map((entry) => [text(entry?.id), entry]));
  const after = new Map((Array.isArray(input?.after) ? input.after : []).map((entry) => [text(entry?.id), entry]));
  const base = {
    members: input?.members,
    organizationId: input?.organizationId,
    instructorId: input?.instructorId,
  };
  const out = [];
  for (const [id, entry] of after) {
    if (!id) continue;
    const previous = before.get(id);
    if (previous && publishedShape(previous) === publishedShape(entry)) continue;
    const document = scheduledLessonDocument({ ...base, entry });
    if (document) out.push(document);
    /* 센터 회원이 다 빠진 수업(명부에서 지운 회원만 남은 경우)은 보낼 문서가
       없다. 예전 문서가 있었다면 취소로 남긴다. */
    else if (previous) {
      const gone = scheduledLessonDocument({ ...base, entry: previous, cancelled: true });
      if (gone) out.push(gone);
    }
  }
  for (const [id, previous] of before) {
    if (!id || after.has(id)) continue;
    const gone = scheduledLessonDocument({ ...base, entry: previous, cancelled: true });
    if (gone) out.push(gone);
  }
  return out;
}
