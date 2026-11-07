/**
 * 수업 기록(member.notes) 고르기 · 고치기 (2026-11-07 대표, 수업일지 D).
 *
 * 한 수업(sid)에 기록이 두 종류 붙는다.
 *   음성 기록  녹음 → 정리 → 확정. lessonRecord 에 confirmedRecord · structuredDraft ·
 *              rawTranscript 가 있거나, note 에 transcript · voiceSource · aiSummary 가 있다
 *   직접 입력  강사가 손으로 쓴 글 · 노코멘트. lessonRecord 가 없다 (있으면 "confirmed_manual")
 *
 * **둘은 서로를 덮지 않는다.** 음성 확정은 음성 기록만 바꾸고(upsertLessonRecordNote),
 * 직접 입력을 다시 열면 그 직접 입력 기록을 불러와 같은 기록을 고친다. 전에는 음성 확정이
 * 같은 수업의 기록 전부를 하나로 합쳐 직접 쓴 글이 사라졌고(손실), 직접 입력은 열 때마다
 * 빈 칸이라 저장할 때마다 같은 수업에 기록이 하나씩 늘었다(중복).
 *
 * 기록은 이 기기에만 있다 -- 서버로 보내지 않는다. 판정만 순수 함수로 둔다.
 */

const text = (value) => String(value ?? "").trim();

/** 음성 경로가 만든 기록인가. 직접 입력 · 노코멘트는 아니다. */
export function isVoiceRecordNote(note) {
  if (!note || typeof note !== "object") return false;
  if (text(note.voiceSource) || text(note.transcript)) return true;
  if (note.aiSummary || note.aiSummaryTeacherEdited) return true;
  /* lessonRecord 는 음성 경로만 단다 (saveScheduleComment). 직접 입력 · 노코멘트는 그 칸이
     없다 -- 혹시 "confirmed_manual" 로 달려 있으면 그것도 직접 입력이다. */
  const record = note.lessonRecord;
  if (!record || typeof record !== "object" || Object.keys(record).length === 0) return false;
  return text(record.status) !== "confirmed_manual";
}

/** 그 수업의 직접 입력 기록 (가장 최근 것). 없으면 null. notes 는 최근 것이 앞이다. */
export function manualNoteFor(notes, lessonId) {
  const sid = text(lessonId);
  if (!sid) return null;
  return (Array.isArray(notes) ? notes : [])
    .find((note) => text(note?.sid) === sid && !isVoiceRecordNote(note)) || null;
}

/** 그 수업의 음성 기록 (가장 최근 것). 없으면 null. */
export function voiceNoteFor(notes, lessonId) {
  const sid = text(lessonId);
  if (!sid) return null;
  return (Array.isArray(notes) ? notes : [])
    .find((note) => text(note?.sid) === sid && isVoiceRecordNote(note)) || null;
}

const attends = (lesson, memberId) => {
  const id = text(memberId);
  if (!id || !lesson) return false;
  if (text(lesson.memberId) === id) return true;
  if (Array.isArray(lesson.memberIds) && lesson.memberIds.map(text).includes(id)) return true;
  return Array.isArray(lesson.attendees) && lesson.attendees.some((item) => text(item?.memberId) === id);
};

/**
 * 회원 상세에서 쓰는 기록을 이을 수 있는 수업. 그 회원이 들어 있는 수업 중 오늘까지,
 * 최근 것이 앞, 최대 limit 개. 취소한 회원 · 지운 수업 · 개인 일정은 뺀다.
 *
 * @param {{ memberId: string, notes?: Array<any>, schedule?: Array<any>, today: string, limit?: number }} input
 *   today 는 "YYYY-MM-DD" (기기 날짜)
 */
export function linkableLessonsFor({ memberId, notes = [], schedule = [], today, limit = 10 }) {
  const day = text(today);
  const recorded = new Set((Array.isArray(notes) ? notes : []).map((note) => text(note?.sid)).filter(Boolean));
  return (Array.isArray(schedule) ? schedule : [])
    .filter((lesson) => lesson && !lesson.personal && !lesson.deletedAt && !lesson.isSample)
    .filter((lesson) => attends(lesson, memberId))
    .filter((lesson) => {
      const mine = (Array.isArray(lesson.attendees) ? lesson.attendees : []).find((item) => text(item?.memberId) === text(memberId));
      return text(mine?.status) !== "cancel";
    })
    .filter((lesson) => !day || text(lesson.date) <= day)
    .sort((left, right) => `${text(right.date)} ${text(right.start)}`.localeCompare(`${text(left.date)} ${text(left.start)}`))
    .slice(0, limit)
    .map((lesson) => ({ id: text(lesson.id), date: text(lesson.date), start: text(lesson.start), type: text(lesson.type), hasRecord: recorded.has(text(lesson.id)) }));
}

/**
 * 처음 골라 둘 수업. 오늘 수업 중 기록이 없는 것, 없으면 가장 최근의 기록 없는 수업.
 * 그것도 없으면 "" -- 수업과 잇지 않는다 (전과 같은 동작).
 */
export function defaultLinkLesson(lessons, today) {
  const list = Array.isArray(lessons) ? lessons : [];
  const todays = list.find((lesson) => lesson.date === text(today) && !lesson.hasRecord);
  if (todays) return todays.id;
  return list.find((lesson) => !lesson.hasRecord)?.id || "";
}
