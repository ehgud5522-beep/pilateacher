import { checksum } from "../migration/canonical.js";

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function legacyAttendees(lesson) {
  if (Array.isArray(lesson.attendees) && lesson.attendees.length) return lesson.attendees;
  if (lesson.memberId) return [{ status: lesson.status }];
  return [];
}

export function legacyMetrics(source) {
  const data = source.backup?.data ?? source.data ?? {};
  const members = Array.isArray(data.members) ? data.members : [];
  const lessons = Array.isArray(data.schedule) ? data.schedule : [];
  const byDate = {};
  let attended = 0;
  let noshow = 0;
  let cancelled = 0;
  let missingNotes = 0;
  let remainingRegular = 0;
  let remainingService = 0;
  for (const lesson of lessons) {
    increment(byDate, lesson.date || "missing");
    for (const attendee of legacyAttendees(lesson)) {
      if (attendee.status === "done") attended += 1;
      if (attendee.status === "noshow") noshow += 1;
      if (attendee.status === "cancel") cancelled += 1;
    }
  }
  for (const member of members) {
    remainingRegular += Number(member.regular) || 0;
    remainingService += Number(member.service) || 0;
    missingNotes += (member.notes || []).filter((note) => !String(note.body || "").trim()).length;
  }
  const photos = source.local?.photos ?? {};
  const photoMetadataCount = Object.values(photos).reduce(
    (sum, entry) => sum + ["front", "side", "back"].reduce((count, key) => count + (entry?.[key]?.length || 0), 0),
    0,
  );
  const assessmentCount = Object.values(photos).reduce((sum, entry) => sum + (entry?.poses?.length || 0), 0);

  const core = {
    clients: members.length,
    lessons: lessons.length,
    lessonsByDate: byDate,
    attended,
    noshow,
    cancelled,
    missingNotes,
    assessments: assessmentCount,
    photoMetadata: photoMetadataCount,
    remainingRegular,
    remainingService,
  };
  return { ...core, checksum: checksum(core) };
}

export function newMetrics(source) {
  const collections = source.collections ?? {};
  const clients = collections.clients ?? [];
  const lessons = collections.lessons ?? [];
  const participants = collections.lessonParticipants ?? [];
  const notes = collections.lessonNotes ?? [];
  const byDate = {};
  for (const lesson of lessons) increment(byDate, lesson.legacyDate || lesson.dateKey || "missing");
  const core = {
    clients: clients.length,
    lessons: lessons.length,
    lessonsByDate: byDate,
    attended: participants.filter((entry) => entry.attendanceStatus === "attended").length,
    noshow: participants.filter((entry) => entry.attendanceStatus === "noshow").length,
    cancelled: participants.filter((entry) => entry.attendanceStatus === "cancelled").length,
    missingNotes: notes.filter((entry) => entry.recordStatus === "missing" || !String(entry.body || "").trim()).length,
    assessments: (collections.assessments ?? []).length,
    photoMetadata: (collections.assessmentMedia ?? []).length,
    remainingRegular: clients.reduce((sum, client) => sum + (Number(client.remainingSummary?.regular) || 0), 0),
    remainingService: clients.reduce((sum, client) => sum + (Number(client.remainingSummary?.service) || 0), 0),
  };
  return { ...core, checksum: checksum(core) };
}
