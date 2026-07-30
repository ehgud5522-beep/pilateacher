import { ATTENDANCE_STATUS, CLIENT_STATUS, DATA_KIND, LESSON_STATUS, SCHEMA_VERSION } from "../../src/data/schema/constants.js";
import { deterministicId } from "../../src/data/schema/ids.js";

function isoToTimestamp(value) {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time)) return null;
  const millis = time;
  return {
    seconds: Math.floor(millis / 1000),
    nanoseconds: (millis % 1000) * 1_000_000,
  };
}

function legacyAttendance(status) {
  if (status === "done") return ATTENDANCE_STATUS.ATTENDED;
  if (status === "noshow") return ATTENDANCE_STATUS.NOSHOW;
  if (status === "cancel") return ATTENDANCE_STATUS.CANCELLED;
  return ATTENDANCE_STATUS.BOOKED;
}

function lessonStatus(item) {
  const attendees = Array.isArray(item.attendees) ? item.attendees : [];
  if (attendees.some((entry) => entry.status === "done") || item.status === "done" || item.groupDone) {
    return LESSON_STATUS.COMPLETED;
  }
  if (attendees.length > 0 && attendees.every((entry) => ["cancel", "noshow"].includes(entry.status))) {
    return LESSON_STATUS.CANCELLED;
  }
  return LESSON_STATUS.SCHEDULED;
}

function baseDocument(organizationId, createdBy, timestamp) {
  return {
    organizationId,
    schemaVersion: SCHEMA_VERSION,
    dataKind: DATA_KIND.SOURCE,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy,
  };
}

export function normalizeLegacyBackup(source, scope = {}) {
  const userId = String(source.userId || "").trim();
  if (!userId) throw new Error("Fixture must include userId");
  if (scope.userId && scope.userId !== userId) return [];

  const data = source.backup?.data ?? source.data ?? {};
  const organizationId = scope.organizationId
    || deterministicId("organization", [userId, data.settings?.center || "default"]);
  const locationId = deterministicId("location", [organizationId, "primary"]);
  const migratedAt = { seconds: 0, nanoseconds: 0 };
  const documents = [];

  documents.push({
    collection: "organizations",
    id: organizationId,
    data: {
      ...baseDocument(organizationId, userId, migratedAt),
      name: data.settings?.center || "Legacy center",
      migrationSource: "users_backup_latest",
    },
  });
  documents.push({
    collection: "locations",
    id: locationId,
    data: {
      ...baseDocument(organizationId, userId, migratedAt),
      locationId,
      name: data.settings?.center || "Primary location",
      timezone: "Asia/Seoul",
    },
  });
  documents.push({
    collection: "users",
    id: userId,
    data: {
      schemaVersion: SCHEMA_VERSION,
      dataKind: DATA_KIND.SOURCE,
      userId,
      displayName: source.profile?.name || data.settings?.staff || "",
      createdAt: migratedAt,
      updatedAt: migratedAt,
      createdBy: userId,
    },
  });
  documents.push({
    collection: "memberships",
    id: `${organizationId}_${userId}`,
    data: {
      ...baseDocument(organizationId, userId, migratedAt),
      userId,
      locationIds: [locationId],
      role: "owner",
      status: "active",
    },
  });

  const clientMap = new Map();
  for (const member of Array.isArray(data.members) ? data.members : []) {
    const legacyId = String(member.id || "");
    if (!legacyId) continue;
    const clientId = deterministicId("client", [userId, legacyId]);
    clientMap.set(legacyId, clientId);
    const timestamp = isoToTimestamp(member.startDate) || migratedAt;
    documents.push({
      collection: "clients",
      id: clientId,
      legacyId,
      data: {
        ...baseDocument(organizationId, userId, timestamp),
        locationId,
        clientId,
        displayName: member.name || "",
        normalizedName: String(member.name || "").trim().toLocaleLowerCase("ko-KR"),
        status: Object.values(CLIENT_STATUS).includes(member.status) ? member.status : CLIENT_STATUS.ACTIVE,
        remainingSummary: {
          regular: Number(member.regular) || 0,
          service: Number(member.service) || 0,
          total: (Number(member.regular) || 0) + (Number(member.service) || 0),
        },
      },
    });

    for (const record of Array.isArray(member.inbody) ? member.inbody : []) {
      const measuredAt = isoToTimestamp(record.date);
      if (!measuredAt) continue;
      const measurementId = deterministicId("inbody", [userId, legacyId, record.id || record.date]);
      documents.push({
        collection: "inbodyMeasurements",
        id: measurementId,
        legacyId: record.id || record.date,
        data: {
          ...baseDocument(organizationId, userId, measuredAt),
          locationId,
          clientId,
          measuredAt,
          weightKg: Number(record.weight) || null,
          skeletalMuscleMassKg: Number(record.smm) || null,
          bodyFatPercent: Number(record.fat) || null,
          source: "legacy_migration",
        },
      });
    }

    for (const note of Array.isArray(member.notes) ? member.notes : []) {
      const occurredAt = isoToTimestamp(note.date) || timestamp;
      const noteId = deterministicId("note", [userId, legacyId, note.id || `${note.date}:${note.body || ""}`]);
      documents.push({
        collection: "lessonNotes",
        id: noteId,
        legacyId: note.id,
        data: {
          ...baseDocument(organizationId, userId, occurredAt),
          locationId,
          clientId,
          legacyLessonId: note.sid || null,
          body: note.body || "",
          tags: Array.isArray(note.tags) ? note.tags : [],
          occurredAt,
          recordStatus: String(note.body || "").trim() ? "written" : "missing",
        },
      });
    }
  }

  for (const item of Array.isArray(data.schedule) ? data.schedule : []) {
    if (!item.id || !item.date) continue;
    const lessonId = deterministicId("lesson", [userId, item.id]);
    const scheduledAt = isoToTimestamp(item.date) || migratedAt;
    documents.push({
      collection: "lessons",
      id: lessonId,
      legacyId: item.id,
      data: {
        ...baseDocument(organizationId, userId, scheduledAt),
        locationId,
        lessonId,
        instructorUserId: userId,
        scheduledAt,
        startTimeLegacy: item.start || null,
        endTimeLegacy: item.end || null,
        lessonType: item.type || "unknown",
        status: lessonStatus(item),
      },
    });

    const attendees = Array.isArray(item.attendees) && item.attendees.length
      ? item.attendees
      : item.memberId
        ? [{ memberId: item.memberId, status: item.status, deductFrom: item.deductFrom, noshowFee: item.noshowFee }]
        : [];
    for (const attendee of attendees) {
      const clientId = clientMap.get(attendee.memberId);
      if (!clientId) continue;
      const participantId = deterministicId("participant", [lessonId, clientId]);
      documents.push({
        collection: "lessonParticipants",
        id: participantId,
        data: {
          ...baseDocument(organizationId, userId, scheduledAt),
          locationId,
          lessonId,
          clientId,
          scheduledAt,
          attendanceStatus: legacyAttendance(attendee.status),
          deductedFrom: attendee.deductFrom || null,
          noShowCharged: attendee.noshowFee === true,
        },
      });
    }
  }

  return documents;
}
