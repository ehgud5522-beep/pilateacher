export const SCHEMA_VERSION = 1;

export const DATA_KIND = Object.freeze({
  SOURCE: "source",
  DERIVED: "derived",
});

export const UNITS = Object.freeze({
  WEIGHT: "kg",
  LENGTH: "cm",
  ANGLE: "degree",
  PAIN_MIN: 0,
  PAIN_MAX: 10,
});

export const ROLES = Object.freeze({
  OWNER: "owner",
  MANAGER: "manager",
  INSTRUCTOR: "instructor",
  STAFF: "staff",
  MEMBER: "member",
});

export const MEMBERSHIP_STATUS = Object.freeze({
  ACTIVE: "active",
  INVITED: "invited",
  SUSPENDED: "suspended",
  REVOKED: "revoked",
});

export const CLIENT_STATUS = Object.freeze({
  ACTIVE: "active",
  HOLD: "hold",
  ENDED: "ended",
  DELETED: "deleted",
  INACTIVE: "inactive",
});

export const LESSON_STATUS = Object.freeze({
  SCHEDULED: "scheduled",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

export const ATTENDANCE_STATUS = Object.freeze({
  BOOKED: "booked",
  ATTENDED: "attended",
  NOSHOW: "noshow",
  CANCELLED: "cancelled",
});

export const RECORD_STATUS = Object.freeze({
  MISSING: "missing",
  COMPLETED: "completed",
  NOT_REQUIRED: "not_required",
});

export const DUAL_WRITE_OPERATION = Object.freeze({
  CREATE: "create",
  UPDATE: "update",
  ARCHIVE: "archive",
  DELETE: "delete",
  CHANGE_STATUS: "change_status",
  SAVE_ATTENDANCE: "save_attendance",
  SAVE_RECORD_STATUS: "save_record_status",
});

export const AI_RECOMMENDATION_STATUS = Object.freeze({
  REQUESTED: "requested",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
});

export const COLLECTIONS = Object.freeze({
  USERS: "users",
  ORGANIZATIONS: "organizations",
  LOCATIONS: "locations",
  MEMBERSHIPS: "memberships",
  CLIENTS: "clients",
  LESSONS: "lessons",
  LESSON_PARTICIPANTS: "lessonParticipants",
  LESSON_NOTES: "lessonNotes",
  ASSESSMENTS: "assessments",
  ASSESSMENT_MEDIA: "assessmentMedia",
  INBODY_MEASUREMENTS: "inbodyMeasurements",
  EXERCISE_PROGRAMS: "exercisePrograms",
  EXERCISE_HISTORY: "exerciseHistory",
  AI_RECOMMENDATIONS: "aiRecommendations",
  AI_FEEDBACK: "aiFeedback",
  OUTCOMES: "outcomes",
  MEMBER_GOALS: "memberGoals",
  MEMBER_PROGRESS: "memberProgress",
  EVENTS: "events",
  AUDIT_LOGS: "auditLogs",
  DAILY_STATS: "dailyStats",
  TEACHER_PATTERNS: "teacherPatterns",
});

export const PROTECTED_ORGANIZATION_FIELDS = Object.freeze([
  "plan",
  "subscriptionStatus",
  "aiUsageCount",
]);
