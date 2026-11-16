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

const RECORD_FIELDS = ["didToday", "observations", "responses", "nextFocus", "uncertain"];
const looksStructured = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && RECORD_FIELDS.some((field) => Array.isArray(value[field]));

/**
 * 저장된 음성 기록을 음성 기록 화면에 다시 펼칠 값 (2026-11-15 강사 제보).
 *
 * 음성 기록 화면은 기기 임시 보관함(pending)만 읽었는데, 자동저장이 성공하면 그 보관함을
 * 지운다. 그래서 저장된 음성 기록을 다시 열면 녹음 시작 화면만 나와 "다 없어졌다" 로 보였고,
 * 거기서 다시 녹음하면 앞 기록이 새 녹음으로 덮였다. 보관함이 비었을 때 이것으로 채운다.
 *
 * 펼칠 것이 없으면 null (직접 입력 · 노코멘트 · 전사 없는 기록).
 */
export function voiceNoteRestoreState(note) {
  if (!isVoiceRecordNote(note)) return null;
  const record = note.lessonRecord && typeof note.lessonRecord === "object" ? note.lessonRecord : {};
  const transcript = text(note.transcript) || text(record.rawTranscript);
  if (!transcript) return null;
  const draft = [note.aiSummaryTeacherEdited, record.structuredDraft, record.confirmedRecord].find(looksStructured) || null;
  const original = looksStructured(note.aiSummary) ? note.aiSummary : draft;
  return {
    transcript,
    structuredDraft: draft,
    summaryOriginal: original,
    aiMeta: note.aiMeta || record.aiMeta || null,
    source: text(note.voiceSource) || text(record.source) || "unknown",
    confirmed: text(record.confirmationStatus) === "confirmed" || text(record.stage) === "confirmed_record",
  };
}

/**
 * 수업 없이 저장된 기록을 그 수업에 잇는다 (2026-11-16 하주은 강사 제보: "AI 말하기로 기록했는데
 * 계속 미기록 알림"). "기록" 화면은 기록을 수업과 잇는 칸이 없어 언제나 sid 없이 저장했고, 그 수업은
 * 영영 "미기록" 이었다. 화면은 고쳤고, 이미 쌓인 기록은 이것이 잇는다 -- 앱을 열 때(normalizeDb).
 *
 * **틀리게 잇느니 잇지 않는다.** 한 회원 · 한 날짜에
 *   sid 없는 기록(상담 메모 제외)이 정확히 하나이고,
 *   그 회원이 출석(done)한, 아직 그 회원 기록이 없는 수업도 정확히 하나일 때만 잇는다.
 * 둘 이상이면 어느 것이 어느 것인지 모르므로 그대로 둔다.
 *
 * @param {{ members?: Array<any>, schedule?: Array<any> }} db
 * @returns {{ members: Array<any>, linked: number }} 바뀐 회원만 새 객체
 */
export function linkOrphanLessonNotes({ members = [], schedule = [] } = {}) {
  const lessonsByMemberDate = new Map();
  for (const lesson of Array.isArray(schedule) ? schedule : []) {
    if (!lesson || lesson.personal || lesson.deletedAt || lesson.isSample) continue;
    for (const attendee of Array.isArray(lesson.attendees) ? lesson.attendees : []) {
      if (text(attendee?.status) !== "done") continue;
      const key = `${text(attendee.memberId)}|${text(lesson.date)}`;
      if (!lessonsByMemberDate.has(key)) lessonsByMemberDate.set(key, []);
      lessonsByMemberDate.get(key).push(lesson);
    }
  }
  let linked = 0;
  const next = (Array.isArray(members) ? members : []).map((member) => {
    const notes = Array.isArray(member?.notes) ? member.notes : [];
    if (!notes.length) return member;
    const recorded = new Set(notes.map((note) => text(note?.sid)).filter(Boolean));
    const orphansByDate = new Map();
    notes.forEach((note, index) => {
      if (!note || text(note.sid) || text(note.type) === "상담" || !text(note.date)) return;
      if (!orphansByDate.has(note.date)) orphansByDate.set(note.date, []);
      orphansByDate.get(note.date).push(index);
    });
    let patched = null;
    for (const [date, indexes] of orphansByDate) {
      if (indexes.length !== 1) continue;
      const open = (lessonsByMemberDate.get(`${text(member.id)}|${date}`) || []).filter((lesson) => !recorded.has(text(lesson.id)));
      if (open.length !== 1) continue;
      patched = patched || notes.slice();
      patched[indexes[0]] = { ...notes[indexes[0]], sid: text(open[0].id) };
      linked += 1;
    }
    return patched ? { ...member, notes: patched } : member;
  });
  return { members: next, linked };
}
