export const ONBOARDING_SAMPLE_MEMBER_ID = "pilateacher-onboarding-sample-member-v1";
export const ONBOARDING_SAMPLE_LESSON_PREFIX = "pilateacher-onboarding-sample-lesson-v1";
export const NOTIFICATION_SOFT_PROMPT_PREFIX = "pilateacher_notification_soft_prompt_v1_";

const isoShift = (days, now = new Date()) => {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const note = ({ id, sid, date, today, reaction, next, instructor }) => {
  const structuredDraft = {
    didToday: [{ text: today, origin: "ai" }],
    observations: [],
    responses: [{ text: reaction, origin: "ai" }],
    nextFocus: [{ text: next, origin: "ai" }],
    uncertain: [],
    summary: `${today}. ${reaction}. 다음 수업에는 ${next}.`,
  };
  return {
    id, sid, date, type: "개인레슨", instructor: instructor || "", tags: [],
    body: `오늘 수업: ${today}\n회원 반응: ${reaction}\n다음 확인: ${next}`,
    teacherSummary: `오늘 수업: ${today}\n회원 반응: ${reaction}\n다음 확인: ${next}`,
    confirmationStatus: "confirmed",
    confirmedAt: `${date}T11:00:00.000Z`,
    lessonRecord: {
      schemaVersion: 2,
      stage: "confirmed_record",
      status: "confirmed",
      confirmationStatus: "confirmed",
      structuredDraft,
      confirmedRecord: structuredDraft,
      confirmedAt: `${date}T11:00:00.000Z`,
      origin: "sample",
    },
  };
};

export function createOnboardingSampleData(db, { instructor = "", now = new Date() } = {}) {
  const current = db && typeof db === "object" ? db : {};
  const members = Array.isArray(current.members) ? current.members : [];
  const schedule = Array.isArray(current.schedule) ? current.schedule : [];
  const existing = members.find((member) => member?.id === ONBOARDING_SAMPLE_MEMBER_ID || member?.isSample === true);
  if (existing) return { db: current, memberId: existing.id, created: false };

  const dates = [-21, -14, -7].map((days) => isoShift(days, now));
  const lessons = dates.map((date, index) => ({
    id: `${ONBOARDING_SAMPLE_LESSON_PREFIX}-${index + 1}`,
    memberId: ONBOARDING_SAMPLE_MEMBER_ID,
    memberIds: [ONBOARDING_SAMPLE_MEMBER_ID],
    attendees: [{ memberId: ONBOARDING_SAMPLE_MEMBER_ID, status: "done", deductFrom: null, noshowFee: null }],
    date, start: "10:00", end: "10:50", dur: 50, type: "개인레슨", instructor,
    room: "", memo: "", isSample: true,
  }));
  const notes = [
    note({ id: "pilateacher-onboarding-sample-note-v1-1", sid: lessons[0].id, date: dates[0], today: "리포머 풋워크와 브릿지", reaction: "허리가 편해졌다고 함", next: "흉추 회전 범위 확인", instructor }),
    note({ id: "pilateacher-onboarding-sample-note-v1-2", sid: lessons[1].id, date: dates[1], today: "캐딜락 롤다운", reaction: "호흡 연결이 편해졌다고 함", next: "견갑 안정화 다시 확인", instructor }),
    note({ id: "pilateacher-onboarding-sample-note-v1-3", sid: lessons[2].id, date: dates[2], today: "리포머 브릿지", reaction: "허리가 편해졌다고 함", next: "캐딜락으로 흉추", instructor }),
  ].reverse();
  const member = {
    id: ONBOARDING_SAMPLE_MEMBER_ID,
    name: "김예시",
    isSample: true,
    age: "", birth: "", phone: "", duetWith: "", instructor,
    goal: "수업 기록 흐름 둘러보기", passName: "개인레슨 5회", lessonType: "private",
    regular: 5, service: 0, total: 5, startDate: dates[0], contractEnd: "",
    focus: [], defaultLessonDuration: 50, status: "active", payments: [],
    payRate: 0, groupRate: 0, inbody: [], perf: [], notes, aiMemory: [],
  };
  return { db: { ...current, members: [member, ...members], schedule: [...schedule, ...lessons] }, memberId: member.id, created: true };
}

export function withoutSampleData(db, photos = {}) {
  const members = Array.isArray(db?.members) ? db.members : [];
  const sampleIds = new Set(members.filter((member) => member?.isSample === true).map((member) => String(member.id)));
  const lessonHasSample = (lesson) => lesson?.isSample === true
    || sampleIds.has(String(lesson?.memberId || ""))
    || (lesson?.memberIds || []).some((id) => sampleIds.has(String(id)))
    || (lesson?.attendees || []).some((attendee) => sampleIds.has(String(attendee?.memberId || "")));
  return {
    db: {
      ...(db || {}),
      members: members.filter((member) => member?.isSample !== true),
      schedule: (Array.isArray(db?.schedule) ? db.schedule : []).filter((lesson) => !lessonHasSample(lesson)),
    },
    photos: Object.fromEntries(Object.entries(photos || {}).filter(([memberId]) => !sampleIds.has(String(memberId)))),
    sampleIds,
  };
}

export function removeOnboardingSampleData(db, photos = {}) {
  return withoutSampleData(db, photos);
}

export const notificationSoftPromptKey = (accountId) => `${NOTIFICATION_SOFT_PROMPT_PREFIX}${encodeURIComponent(String(accountId || "").trim())}`;

export function claimNotificationSoftPrompt(storage, accountId) {
  const id = String(accountId || "").trim();
  if (!storage || !id) return false;
  const key = notificationSoftPromptKey(id);
  try {
    if (storage.getItem(key) === "1") return false;
    storage.setItem(key, "1");
    return true;
  } catch (_error) { return false; }
}
