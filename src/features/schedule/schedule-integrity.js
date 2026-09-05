export function dedupeScheduleByLessonId(schedule = []) {
  const seen = new Set();
  return (Array.isArray(schedule) ? schedule : []).filter((lesson) => {
    const lessonId = String(lesson?.id || "").trim();
    if (!lessonId) return true;
    if (seen.has(lessonId)) return false;
    seen.add(lessonId);
    return true;
  });
}

export function appendMemberWithoutScheduleMutation(database = {}, member) {
  return {
    ...database,
    members: [member, ...(Array.isArray(database.members) ? database.members : [])],
  };
}
