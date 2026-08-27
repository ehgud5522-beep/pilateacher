const id = (value) => String(value ?? "").trim();

export function scheduleMemberIds(lesson) {
  if (!lesson) return [];
  return [...new Set([
    lesson.memberId,
    ...(Array.isArray(lesson.memberIds) ? lesson.memberIds : []),
    ...(Array.isArray(lesson.attendees) ? lesson.attendees.map((item) => item?.memberId) : []),
  ].map(id).filter(Boolean))];
}

export function evaluateLessonRecordLink({ members = [], schedule = [], memberId, lessonId } = {}) {
  const requestedMemberId = id(memberId);
  const requestedLessonId = id(lessonId);
  const member = members.find((item) => id(item?.id) === requestedMemberId) || null;
  const lesson = requestedLessonId
    ? schedule.find((item) => id(item?.id) === requestedLessonId) || null
    : null;
  const linkedMemberIds = scheduleMemberIds(lesson);
  const base = {
    memberId: requestedMemberId,
    lessonId: requestedLessonId,
    scheduleId: id(lesson?.id),
    scheduleMemberId: id(lesson?.memberId),
    scheduleMemberIds: linkedMemberIds,
    memberDocumentId: id(member?.id),
    scheduleFound: Boolean(lesson),
    memberFound: Boolean(member),
    memberMatches: linkedMemberIds.includes(requestedMemberId),
  };
  if (!requestedMemberId || !member) return { ...base, state: "link_review_required", reason: "member_missing" };
  if (!requestedLessonId) return { ...base, state: "member_only", reason: "member_only" };
  if (!lesson) return { ...base, state: "link_review_required", reason: "schedule_missing" };
  if (linkedMemberIds.includes(requestedMemberId)) return { ...base, state: "linked", reason: "current_schedule_match" };
  return { ...base, state: "link_review_required", reason: linkedMemberIds.length ? "schedule_member_mismatch" : "schedule_member_missing" };
}

export function linkScheduleToMember(lesson, memberId) {
  if (!lesson || !id(memberId)) return lesson;
  const target = id(memberId);
  const attendees = Array.isArray(lesson.attendees) ? lesson.attendees : [];
  const existing = attendees.find((item) => id(item?.memberId) === target);
  const singleMemberLesson = lesson.type !== "듀엣" && lesson.type !== "그룹";
  const nextAttendees = existing
    ? attendees
    : singleMemberLesson
      ? [{ ...(attendees[0] || {}), memberId: target, status: attendees[0]?.status || "booked", deductFrom: attendees[0]?.deductFrom || null, noshowFee: attendees[0]?.noshowFee ?? null }]
      : [...attendees, { memberId: target, status: "booked", deductFrom: null, noshowFee: null }];
  const nextIds = singleMemberLesson
    ? [target]
    : [...new Set([...(Array.isArray(lesson.memberIds) ? lesson.memberIds : []), target].map(id).filter(Boolean))];
  return { ...lesson, memberId: singleMemberLesson ? target : (lesson.memberId || target), memberIds: nextIds, attendees: nextAttendees };
}

export function upsertLessonRecordNote(notes = [], nextNote, { lessonId, existingNoteId } = {}) {
  const sid = id(lessonId || nextNote?.sid);
  const explicitId = id(existingNoteId);
  const current = notes.find((note) => explicitId && id(note?.id) === explicitId)
    || notes.find((note) => sid && id(note?.sid) === sid)
    || null;
  const canonical = {
    ...(current || {}),
    ...nextNote,
    id: current?.id || nextNote?.id,
    date: current?.date || nextNote?.date,
    sid: sid || current?.sid || nextNote?.sid,
  };
  return [canonical, ...notes.filter((note) => {
    if (current && id(note?.id) === id(current.id)) return false;
    return !(sid && id(note?.sid) === sid);
  })];
}
