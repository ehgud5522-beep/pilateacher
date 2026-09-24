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

/**
 * 센터 안에서 부르는 직함. 권한이 아니라 표시다.
 *
 * ── role 과 왜 나누는가 ──
 * role 은 규칙 전체가 읽는 접근 권한 값이다. 여기에 팀장·점장을 더하면 rules 의
 * 모든 hasRole 목록을 손봐야 하고, 하나라도 빠뜨리면 그 사람이 조용히 아무것도
 * 읽지 못한다. 직함은 부르는 이름일 뿐이라 그 위험을 질 이유가 없다 -- 넷 다
 * 수업료를 받는 강사이고, role 은 전부 instructor 다.
 *
 * ── 부원장이 여기 없는 이유 ──
 * 부원장은 직함이면서 급여 판정 1 그 자체다 (deduction-pricing.js). 그 판정이
 * 읽는 것은 memberships.isDeputyDirector 이고, 같은 사실을 여기에 한 번 더
 * 적으면 둘이 어긋나는 날이 온다 -- 화면은 부원장이라는데 급여는 아닌 상태다.
 * 그래서 부원장은 플래그 하나로만 두고, 화면이 그 플래그를 직함처럼 그린다
 * (membershipTitleLabel).
 */
export const MEMBERSHIP_TITLE = Object.freeze({
  INSTRUCTOR: "instructor",
  TEAM_LEAD: "team_lead",
  BRANCH_MANAGER: "branch_manager",
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
//   handover  회원권 양도. delta 는 음수 — 그만큼이 받는 회원의 새 회원권이 된다
/**
 * 원장 항목의 종류. 원장은 append-only 라 고치는 항목이 따로 있다.
 *
 * correction 과 cancel 은 "고쳤다"가 아니라 "고친 기록"이다. 원래 항목은 그대로
 * 남고 이력에 둘 다 보인다 -- 잘못 차감한 사실 자체가 사라지면 그것도 기록이
 * 아니다.
 */
export const LEDGER_ENTRY_TYPE = Object.freeze({
  ISSUE: "issue",
  DEDUCT: "deduct",
  TRANSFER: "transfer",
  /**
   * 회원권 양도. delta 는 나가는 회차의 음수이고, 그만큼이 받는 회원의 새
   * 회원권(issue)이 되어 같은 배치에 쓰인다.
   *
   * deduct 와 다르다 -- 수업이 일어나지 않았으므로 급여가 나가지 않는다.
   * cancel 과도 다르다 -- 남은 회차 전부가 아니라 일부만 나갈 수 있고, 돈이
   * 사라지는 것이 아니라 옮겨 간다.
   */
  HANDOVER: "handover",
  /** 잘못 차감한 한 회차를 되돌린다. delta +1. */
  CORRECTION: "correction",
  /** 잘못 발급한 회원권을 무효화한다. delta 는 남은 횟수의 음수. */
  CANCEL: "cancel",
});

/** 사유 칸의 길이. 규칙도 같은 값으로 막는다. */
export const LEDGER_REASON_MAX = 200;

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
  RATE_HISTORY: "rateHistory",
  INSTRUCTOR_CLIENT_TOTALS: "instructorClientTotals",
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
  /* 회원용 투영과 연결 문서. 둘 다 서버만 쓰고 회원 본인만 읽는다 --
     설계 문서 3·4장. */
  MEMBER_VIEWS: "memberViews",
  MEMBER_LINKS: "memberLinks",
  DAILY_STATS: "dailyStats",
  TEACHER_PATTERNS: "teacherPatterns",
});

export const PROTECTED_ORGANIZATION_FIELDS = Object.freeze([
  "plan",
  "subscriptionStatus",
  "aiUsageCount",
]);
