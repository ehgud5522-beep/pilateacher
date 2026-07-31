import { ATTENDANCE_STATUS, CLIENT_STATUS, DATA_KIND, LESSON_STATUS, RECORD_STATUS, SCHEMA_VERSION } from "../schema/constants.js";
import { paths } from "../schema/paths.js";
import { ClientRepository, LessonRepository } from "./contracts.js";

const values = (constant) => new Set(Object.values(constant));
const assertEnum = (value, constant, label) => {
  if (!values(constant).has(value)) throw new Error(`Invalid ${label}`);
  return value;
};
const required = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  return text;
};
const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

function audit(context, includeCreationFields) {
  return compact({
    schemaVersion: includeCreationFields ? SCHEMA_VERSION : undefined,
    dataKind: includeCreationFields ? DATA_KIND.SOURCE : undefined,
    createdAt: includeCreationFields ? context.serverTimestamp() : undefined,
    updatedAt: context.serverTimestamp(),
    createdBy: includeCreationFields ? required(context.userId, "userId") : undefined,
  });
}

export function mapClientDocument(context, client, includeCreationFields = true) {
  const clientId = required(client.id || client.clientId, "clientId");
  return compact({
    organizationId: required(context.organizationId, "organizationId"),
    locationId: context.locationId || null,
    clientId,
    name: client.name || "",
    phone: client.phone || "",
    status: assertEnum(client.status || CLIENT_STATUS.ACTIVE, CLIENT_STATUS, "client status"),
    instructorId: client.instructorId || client.instructor || null,
    membershipBalance: {
      regular: Number(client.regular || 0),
      service: Number(client.service || 0),
    },
    legacySource: { userId: required(context.userId, "userId"), memberId: clientId },
    ...audit(context, includeCreationFields),
  });
}

export function mapLessonDocument(context, lesson, includeCreationFields = true) {
  const lessonId = required(lesson.id || lesson.lessonId, "lessonId");
  const statusMap = { booked: LESSON_STATUS.SCHEDULED, done: LESSON_STATUS.COMPLETED, cancel: LESSON_STATUS.CANCELLED };
  return compact({
    organizationId: required(context.organizationId, "organizationId"),
    locationId: context.locationId || null,
    lessonId,
    lessonType: lesson.type || null,
    startsAt: lesson.startsAt || null,
    legacyDate: lesson.date || null,
    legacyTime: lesson.time || null,
    status: assertEnum(statusMap[lesson.status] || lesson.status || LESSON_STATUS.SCHEDULED, LESSON_STATUS, "lesson status"),
    participantCount: Number(lesson.participantCount || 0),
    recordStatus: assertEnum(lesson.recordStatus || RECORD_STATUS.MISSING, RECORD_STATUS, "record status"),
    legacySource: { userId: required(context.userId, "userId"), scheduleId: lessonId },
    ...audit(context, includeCreationFields),
  });
}

export class FirestoreClientRepository extends ClientRepository {
  constructor(writer) {
    super();
    this.writer = writer;
  }
  createClient(context, client) {
    const document = mapClientDocument(context, client, true);
    return this.writer.merge(paths.organizationClient(context.organizationId, document.clientId), document);
  }
  updateClient(context, client) { return this.saveClientSnapshot(context, client); }
  archiveClient(context, client) {
    return this.saveClientSnapshot(context, { ...client, status: CLIENT_STATUS.ENDED });
  }
  getClientById() { throw new Error("New Firestore reads are disabled in dual-write v1"); }
  listClients() { throw new Error("New Firestore reads are disabled in dual-write v1"); }
  saveClientSnapshot(context, client) {
    const document = mapClientDocument(context, client, false);
    return this.writer.merge(paths.organizationClient(context.organizationId, document.clientId), document);
  }
}

export class FirestoreLessonRepository extends LessonRepository {
  constructor(writer) {
    super();
    this.writer = writer;
  }
  createLesson(context, lesson) {
    const document = mapLessonDocument(context, lesson, true);
    return this.writer.merge(paths.organizationLesson(context.organizationId, document.lessonId), document);
  }
  updateLesson(context, lesson) {
    const document = mapLessonDocument(context, lesson, false);
    return this.writer.merge(paths.organizationLesson(context.organizationId, document.lessonId), document);
  }
  changeLessonStatus(context, lessonId, status) {
    return this.writer.merge(paths.organizationLesson(context.organizationId, lessonId), {
      status: assertEnum(status, LESSON_STATUS, "lesson status"),
      updatedAt: context.serverTimestamp(),
    });
  }
  saveAttendance(context, lessonId, attendance) {
    const clientId = required(attendance.clientId || attendance.memberId, "clientId");
    return this.writer.merge(paths.lessonParticipant(context.organizationId, lessonId, clientId), {
      organizationId: context.organizationId,
      lessonId,
      clientId,
      attendanceStatus: assertEnum(attendance.status, ATTENDANCE_STATUS, "attendance status"),
      updatedAt: context.serverTimestamp(),
      schemaVersion: SCHEMA_VERSION,
      dataKind: DATA_KIND.SOURCE,
      createdBy: required(context.userId, "userId"),
    });
  }
  saveRecordStatus(context, lessonId, status) {
    return this.writer.merge(paths.organizationLesson(context.organizationId, lessonId), {
      recordStatus: assertEnum(status, RECORD_STATUS, "record status"),
      updatedAt: context.serverTimestamp(),
    });
  }
  getLessonById() { throw new Error("New Firestore reads are disabled in dual-write v1"); }
  listLessonsByRange() { throw new Error("New Firestore reads are disabled in dual-write v1"); }
}
