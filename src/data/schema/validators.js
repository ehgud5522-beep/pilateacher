import {
  ATTENDANCE_STATUS,
  DATA_KIND,
  LESSON_STATUS,
  MEMBERSHIP_STATUS,
  ROLES,
  SCHEMA_VERSION,
  UNITS,
} from "./constants.js";

function oneOf(value, values, label) {
  if (!Object.values(values).includes(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

export function assertTimestamp(value, label = "timestamp") {
  if (
    !value ||
    typeof value !== "object" ||
    !Number.isInteger(value.seconds) ||
    !Number.isInteger(value.nanoseconds) ||
    value.nanoseconds < 0 ||
    value.nanoseconds > 999_999_999
  ) {
    throw new Error(`${label} must be a Firestore Timestamp-compatible UTC value`);
  }
  return value;
}

export function assertAuditFields(value) {
  if (!value || typeof value !== "object") throw new Error("Document must be an object");
  if (value.schemaVersion !== SCHEMA_VERSION) throw new Error("Unsupported schemaVersion");
  assertTimestamp(value.createdAt, "createdAt");
  assertTimestamp(value.updatedAt, "updatedAt");
  if (typeof value.createdBy !== "string" || !value.createdBy.trim()) throw new Error("createdBy is required");
  oneOf(value.dataKind, DATA_KIND, "dataKind");
  return value;
}

export function assertPainScore(value) {
  if (!Number.isInteger(value) || value < UNITS.PAIN_MIN || value > UNITS.PAIN_MAX) {
    throw new Error("pain score must be an integer from 0 to 10");
  }
  return value;
}

export const assertRole = (value) => oneOf(value, ROLES, "role");
export const assertMembershipStatus = (value) => oneOf(value, MEMBERSHIP_STATUS, "membership status");
export const assertLessonStatus = (value) => oneOf(value, LESSON_STATUS, "lesson status");
export const assertAttendanceStatus = (value) => oneOf(value, ATTENDANCE_STATUS, "attendance status");
