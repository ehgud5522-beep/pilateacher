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

export const PRODUCT_STATUS = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
});

export const SESSION_TYPE = Object.freeze({
  PT_1_1: "pt_1_1",
  PT_2_1: "pt_2_1",
});

// 결제 수단. 급여 자동 계산에는 쓰지 않는다 — 바우처 결제는 인센을 수동으로
// 조정하므로, 월말에 해당 건만 뽑아 보기 위한 기록이다.
// firestore.foundation.rules의 passes create 조건에 같은 목록이 리터럴로 있다.
export const PAYMENT_METHOD = Object.freeze({
  CARD: "card",
  CASH: "cash",
  TRANSFER: "transfer",
  ZEROPAY: "zeropay",
  VOUCHER: "voucher",
});

// 급여 단가표의 카테고리. firestore.foundation.rules의 passes/ledger create
// 조건에 같은 목록이 리터럴로 들어가 있다 — 규칙 파일은 import을 할 수 없다.
// 항목을 더하거나 빼면 양쪽을 함께 고쳐야 한다.
export const PAY_CATEGORY = Object.freeze({
  PT_1_1_NEW: "pt_1_1_new",
  PT_1_1_REPURCHASE_EVENT: "pt_1_1_repurchase_event",
  PT_1_1_REPURCHASE_NORMAL: "pt_1_1_repurchase_normal",
  PT_2_1_NEW: "pt_2_1_new",
  PT_2_1_REPURCHASE: "pt_2_1_repurchase",
  SERVICE: "service",
  LETMEIN: "letmein",
  ETC: "etc",
});

// 회원권의 생애. firestore.foundation.rules 의 passes create 는 status 가
// 문자열이기만 요구하므로, 값을 좁히는 것은 여기와 리포지토리의 몫이다.
export const PASS_STATUS = Object.freeze({
  ACTIVE: "active",
  COMPLETED: "completed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});

// 회원권 원장에 남는 항목의 종류. firestore.foundation.rules 의 ledger create
// 조건에 같은 목록이 리터럴로 있다 — 규칙 파일은 import 을 할 수 없다.
//
//   issue     발급. delta 는 양수(총 회차)
//   deduct    차감. delta 는 음수이고 lessonId 를 함께 남긴다
//   transfer  담당 강사 교체. delta 0 — 잔여 횟수는 그대로이고 주인만 바뀐다
export const LEDGER_ENTRY_TYPE = Object.freeze({
  ISSUE: "issue",
  DEDUCT: "deduct",
  TRANSFER: "transfer",
});

export const COLLECTIONS = Object.freeze({
  USERS: "users",
  ORGANIZATIONS: "organizations",
  LOCATIONS: "locations",
  MEMBERSHIPS: "memberships",
  PASSES: "passes",
  CLIENTS: "clients",
  PRODUCTS: "products",
  LESSONS: "lessons",
  LEDGER: "ledger",
  PARTICIPANTS: "participants",
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
