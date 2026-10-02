/**
 * 센터에 기록된 수업. **대표가 남의 수업을 읽는 자리다.**
 *
 * ── 왜 필요한가 ──
 * 회원 상세의 수업 기록은 `db.schedule` 에서 온다 -- **기기 로컬 데이터**다
 * (selectMemberLessonSessions). 대표 기기에는 대표가 가르친 수업만 있으므로,
 * 다른 강사가 가르친 회원을 열면 "수업 기록 0건" 이 뜬다.
 *
 * 권한 문제가 아니다. lessonNotes 는 이미 대표·FC매니저·강사 전원에게 열려
 * 있고(firestore.foundation.rules 의 lessonNotes get/list), `lessons` 도
 * isCentreStaff 로 열려 있다. **화면이 센터를 읽지 않았을 뿐이다.**
 *
 * ── 읽기 전용이다 ──
 * 대표는 보고 고치지 않는다. 규칙이 이미 그렇게 되어 있다 -- lessonNotes 의
 * update 는 `request.auth.uid == resource.data.createdBy` 라 **작성한 강사만**
 * 고친다. 이 화면은 그 규칙을 그대로 따른다: 여기서 쓰기를 부르지 않는다.
 *
 * ── 누가 썼는지 적는다 ──
 * 남의 글을 읽을 때 누가 썼는지 모르면, 대표는 그 말을 센터의 말로 읽는다.
 * 틀린 말이 있을 때 누구와 이야기해야 하는지도 알 수 없다.
 *
 * ── 색인을 더하지 않는다 ──
 * `clientIds array-contains` 에 `orderBy startsAt` 을 붙이면 복합 색인이
 * 필요하고, 그것은 또 한 번의 배포다. 한 회원의 수업은 많아도 수백 건이라
 * 받아서 여기서 줄 세운다 -- 색인 배포를 기다리느니 그게 낫다.
 */

const text = (value) => String(value ?? "").trim();

/** Firestore Timestamp 도 Date 도 문자열도 온다. 못 읽으면 null 이다. */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    try { return toDate(value.toDate()); } catch { return null; }
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 출석 상태를 사람 말로. 노쇼와 취소는 회원에게 다른 일이다. */
export const ATTENDANCE_LABEL = Object.freeze({
  attended: "출석",
  noshow: "노쇼",
  cancelled: "취소",
  booked: "예약",
});

/**
 * 이 수업에 이 회원이 들어 있는가.
 *
 * 옛 수업 문서에는 clientIds 가 없고 clientId 하나만 있다. 읽는 쪽이 그때
 * 대표 한 명으로 읽는다 -- 안 그러면 듀엣 기능 전에 기록된 수업이 통째로
 * 사라진다.
 */
export const lessonHasClient = (lesson, clientId) => {
  const id = text(clientId);
  if (!id) return false;
  const listed = Array.isArray(lesson?.clientIds) ? lesson.clientIds.map(text) : [];
  if (listed.length) return listed.includes(id);
  return text(lesson?.clientId) === id;
};

/**
 * 센터 수업과 그 수업의 말을 한 줄로 묶는다.
 *
 * @param {{
 *   lessons?: Array<any>, notes?: Array<any>, clientId?: string,
 *   instructorName?: (userId: string) => string,
 * }} input
 *   instructorName  강사 uid 로 이름 찾기. 없으면 빈 문자열이고, 화면은 그때
 *                   "강사 미지정" 으로 적는다 -- uid 를 보여주지 않는다.
 * @returns {Array<object>} 최근 수업이 먼저
 */
export function centreLessonRows(input = {}) {
  const clientId = text(input.clientId);
  const nameOf = typeof input.instructorName === "function" ? input.instructorName : () => "";
  const lessons = (Array.isArray(input.lessons) ? input.lessons : [])
    .filter((lesson) => lesson && lessonHasClient(lesson, clientId));

  /* 말은 수업마다 하나다 (문서 id 가 `${lessonId}_${clientId}`). 같은 수업에
     둘이 오면 나중 것을 쓴다 -- 투영이 그렇게 읽기 때문이다. */
  const noteByLesson = new Map();
  for (const note of Array.isArray(input.notes) ? input.notes : []) {
    if (!note || text(note.clientId) !== clientId) continue;
    const lessonId = text(note.lessonId);
    if (lessonId) noteByLesson.set(lessonId, note);
  }

  const rows = lessons.map((lesson) => {
    const lessonId = text(lesson.lessonId || lesson.id);
    const note = noteByLesson.get(lessonId) || null;
    /* 수업을 가르친 강사와 말을 쓴 강사가 다를 수 있다 -- 인수인계 뒤에 그렇다.
       둘을 한 칸으로 뭉개면 "누구와 이야기할까" 에 답할 수 없다. */
    const taughtBy = text(lesson.instructorId);
    const wroteBy = text(note?.createdBy);
    return {
      lessonId,
      startsAt: toDate(lesson.startsAt),
      taughtBy,
      taughtByName: nameOf(taughtBy),
      memberNote: text(note?.memberNote),
      wroteBy,
      wroteByName: wroteBy ? nameOf(wroteBy) : "",
      /* 말을 쓴 사람이 가르친 사람과 다른가. 화면이 그때만 따로 적는다. */
      writtenByOther: Boolean(wroteBy) && Boolean(taughtBy) && wroteBy !== taughtBy,
      attendance: text(lesson.clientId) === clientId || !lesson.attendanceByClientId
        ? ""
        : text(lesson.attendanceByClientId?.[clientId]),
      duet: Array.isArray(lesson.clientIds) && lesson.clientIds.length > 1,
    };
  });

  /* 최근 수업이 먼저. 날짜를 못 읽은 것은 맨 뒤로 보낸다 -- 맨 앞에 두면
     "가장 최근" 자리에 날짜 없는 줄이 선다. */
  return rows.sort((left, right) => {
    const at = (row) => row.startsAt?.getTime() ?? -1;
    return at(right) - at(left);
  });
}

/**
 * 한 줄 요약. **0 건과 "못 읽었다" 를 가른다.**
 *
 * 둘이 같은 얼굴이면 대표는 기록이 없는 것으로 읽고 강사에게 묻지 않는다.
 *
 * @param {{ rows?: Array<any>, errorCode?: string }} input
 */
export function centreLessonSummary({ rows, errorCode } = {}) {
  if (text(errorCode)) return `센터 기록을 불러오지 못했습니다 (코드 ${text(errorCode)})`;
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return "센터에 기록된 수업이 없습니다";
  const withNote = list.filter((row) => row.memberNote).length;
  return withNote > 0
    ? `센터 기록 ${list.length}건 · 회원에게 보낸 말 ${withNote}건`
    : `센터 기록 ${list.length}건`;
}
