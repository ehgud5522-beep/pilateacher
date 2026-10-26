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

/**
 * 센터 안의 역할. **규칙 전체가 읽는 접근 권한 값이다.**
 *
 * ── 총괄매니저(area_manager) ──
 * 대표와 같은 자리다. 지점 경계가 없고, 전 지점을 보고 처리한다. 대표만
 * 남겨 둔 것은 넷뿐이다 (OWNER_ONLY 참고).
 *
 * `branch_manager` 라고 부르지 않는다 -- 그 글자는 이미 **직함**(점장)이고
 * 급여 판정이 그것을 본다 (MEMBERSHIP_TITLE, deduction-pricing.mjs). 같은
 * 글자가 두 뜻이면 둘 중 하나는 언젠가 틀린 쪽을 읽는다.
 */
export const ROLES = Object.freeze({
  OWNER: "owner",
  /** 총괄매니저. 대표와 같은 권한, 지점 경계 없음. */
  AREA_MANAGER: "area_manager",
  MANAGER: "manager",
  INSTRUCTOR: "instructor",
  STAFF: "staff",
  MEMBER: "member",
});

/**
 * 대표와 같은 자리에 서는 역할들. **규칙의 ownerLevel() 과 같은 목록이다.**
 *
 * 한쪽만 고치면 화면에서는 되는데 규칙이 막거나, 그 반대가 된다. 둘 중 어느
 * 쪽이든 쓰는 사람에게는 "눌렀는데 아무 일도 안 일어남" 으로 도착한다.
 */
export const OWNER_LEVEL_ROLES = Object.freeze(
  /** @type {ReadonlyArray<string>} */ ([ROLES.OWNER, ROLES.AREA_MANAGER]),
);

/** 이 역할이 대표와 같은 자리인가. */
export function isOwnerLevelRole(role) {
  return OWNER_LEVEL_ROLES.includes(String(role || ""));
}

/**
 * 총괄매니저에게 열지 않는 넷. **대표만이다.**
 *
 * 공통점 하나: 넷 다 **자기 자리를 자기가 넓히는 길**이거나 되돌릴 수 없다.
 * 총괄매니저가 총괄매니저를 세울 수 있으면 대표가 모르는 사이에 그 자리가
 * 늘고, 그것을 되돌리는 문은 없다.
 */
export const OWNER_ONLY = Object.freeze({
  /** 총괄매니저 지정·해제 */
  AREA_MANAGER_ROLE: "area_manager_role",
  /** 대표 계정 수정 */
  OWNER_MEMBERSHIP: "owner_membership",
  /** 누구를 대표로 지정 (규칙이 앱에서 owner 를 세우지 못하게 이미 막아 두었다) */
  OWNER_GRANT: "owner_grant",
  /** 이관 초기화 */
  MIGRATION_RESET: "migration_reset",
  /* 앱 업데이트 설정 (runtimeConfig 의 appUpdate · settlement 쓰기).
     숫자 하나가 센터 전체의 수업 확정을 막거나, 모든 앱을 필수 팝업에
     가둔다 -- 다른 자리는 대표와 같아도 여기만은 아니다. */
  RUNTIME_CONFIG: "runtime_config",
});

/**
 * 센터에서 부르는 이름을 **누가 정했는가.**
 *
 * ── 왜 필요한가 ──
 * 강사 앱은 열릴 때마다 로그인 계정의 이름을 소속 문서에 적어 왔다
 * (syncOwnMembershipName). 대표가 강사 관리에서 이름을 고쳐도 그 강사가 앱을
 * 한 번 열면 **구글 계정 이름으로 되돌아갔고**, 급여 집계도 그 이름으로
 * 섰다 -- 2026-10-10 에 "e asy" 로 보고된 것이 이것이다.
 *
 * 이름은 둘 중 하나다: 아직 아무도 정하지 않아 로그인 이름으로 채워진 것,
 * 또는 **대표가 정한 것**. 뒤엣것은 아무도 덮지 못한다. 그 사실을 문서에
 * 적어 두어야 규칙이 옛 앱의 쓰기도 막을 수 있다 -- 앱만 고치면 업데이트하지
 * 않은 기기가 계속 되돌린다.
 *
 * Keep in sync with firestore.foundation.rules (memberships 의 두 이름 문).
 */
export const DISPLAY_NAME_BY = Object.freeze({
  /** 대표·총괄매니저가 강사 관리에서 정했다. 로그인 동기화가 덮지 않는다. */
  OWNER: "owner",
});

/** 이 소속의 이름을 대표가 정했는가. @param {any} membership */
export function displayNameSetByOwner(membership) {
  return String(membership?.displayNameBy ?? "") === DISPLAY_NAME_BY.OWNER;
}

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
  /* 디오사 관리. **PT 와 다른 상품이다** -- 따로 끊고, 따로 쓰고, 단가도
     고정이다. 상품 표에서 1:1·2:1 과 나란히 서야 대표가 발급할 수 있다
     (PAY_CATEGORIES_BY_SESSION_TYPE). */
  DIOSA: "diosa",
});

/**
 * 디오사 수업의 길이. **A 와 B 의 차이가 곧 이것이고, 단가의 차이다.**
 *
 * 둘은 **따로 파는 회원권**이다 (2026-10-10 확인). A 회원권으로 50분 수업을
 * 할 수 없고 그 반대도 안 된다 -- 섞어 쓰게 두면 20,000 짜리 회차가 35,000
 * 짜리 수업에 나가고, 원장은 append-only 라 되돌릴 수 없다.
 */
export const DIOSA_MINUTES = Object.freeze({
  [/** @type {string} */ ("diosa_a")]: 30,
  [/** @type {string} */ ("diosa_b")]: 50,
});

/* ── 결제 수단 ────────────────────────────────────────────────────────────
   **표시용이 아니다.** 부원장의 5:5 가 계약 금액이 아니라 공급가액을 반으로
   접고, 그 공급가액을 이 값이 정한다 (deduction-pricing.mjs 의
   PAYMENT_INCLUDES_VAT). 하나 늘면 거기서 반드시 답해야 한다.

   firestore.foundation.rules 의 passes create 조건에 같은 목록이 리터럴로
   있다 -- 규칙 파일은 import 을 하지 못한다.

   2026-10-27 대표 결정. 제로페이와 바우처를 **기타결제 하나로 접었다** --
   둘 다 부가세를 떼지 않고(둘 다 false 였다) 급여 판정이 둘을 구별하지
   않는데, 고르는 자리에서만 셋으로 갈라져 있었다. 원래 이름은 paymentNote
   칸에 글자로 남는다. 접었다고 그 글자까지 잃으면 "이 회원이 무엇으로
   냈나" 에 답할 수 없다.

   복합결제는 **금액을 쪼개 적는 수단**이다. 카드 50만 + 현금 30만 이면
   부가세가 걸린 돈은 카드분뿐이라, 계약 금액 전체에 10/11 을 걸 수도
   그냥 둘 수도 없다. paymentBreakdown 에 수단별 금액이 함께 저장된다.
   ────────────────────────────────────────────────────────────────────── */
export const PAYMENT_METHOD = Object.freeze({
  CARD: "card",
  CASH: "cash",
  TRANSFER: "transfer",
  /* 제로페이 · 평생교육바우처 · 그 밖의 것. 무엇이었는지는 paymentNote 에 글자로. */
  OTHER: "other",
  /* 한 계약을 여러 수단으로. 금액은 paymentBreakdown 에. */
  MIXED: "mixed",
});

/* ── 옛 값 ────────────────────────────────────────────────────────────────
   2026-10-27 전에 발급된 회원권이 들고 있다. **고를 수는 없고 읽을 수는
   있다** -- 라벨도 부가세 판정도 규칙의 목록도 그대로 받아들인다.

   지우면 그 회원권들이 "결제수단을 알 수 없음" 이 되고, 양도·재계산 경로가
   netContractPriceFor 에서 통째로 멈춘다. 변환(기타결제로 옮기기)이 끝난
   뒤에도 남겨 둔다 -- 비용이 0 이고, 빠뜨린 문서가 하나라도 있으면 그것이
   조용히 깨지는 쪽이 훨씬 비싸다. */
export const LEGACY_PAYMENT_METHOD = Object.freeze({
  ZEROPAY: "zeropay",
  VOUCHER: "voucher",
});

/** 저장된 값으로 받아들이는 전부. 화면이 **고를 수 있는 것은 PAYMENT_METHOD 뿐**이다. */
export const STORED_PAYMENT_METHODS = Object.freeze([
  ...Object.values(PAYMENT_METHOD),
  ...Object.values(LEGACY_PAYMENT_METHOD),
]);

/** 금액 하나로 끝나는 수단. 복합결제만 빠진다 -- 그것은 이 넷의 합이다. */
export const SINGLE_PAYMENT_METHODS = Object.freeze(
  Object.values(PAYMENT_METHOD).filter((method) => method !== PAYMENT_METHOD.MIXED),
);

/**
 * 복합결제가 쪼개는 칸. **순서가 화면의 순서다.**
 *
 * 현금이 끝인 것은 대표가 적는 순서가 그렇기 때문이다 (카드 → 계좌 → 기타 →
 * 현금). 바꾸면 발급 화면의 칸 순서가 함께 바뀐다.
 */
export const MIXED_PAYMENT_PARTS = Object.freeze([
  PAYMENT_METHOD.CARD, PAYMENT_METHOD.TRANSFER, PAYMENT_METHOD.OTHER, PAYMENT_METHOD.CASH,
]);

/** 기타결제의 "내용" 칸 길이. 규칙에도 같은 숫자가 리터럴로 있다. */
export const PAYMENT_NOTE_MAX = 100;

// 급여 단가표의 카테고리. firestore.foundation.rules의 passes/ledger create
// 조건에 같은 목록이 리터럴로 들어가 있다 — 규칙 파일은 import을 할 수 없다.
// 항목을 더하거나 빼면 양쪽을 함께 고쳐야 한다.
export const PAY_CATEGORY = Object.freeze({
  PT_1_1_NEW: "pt_1_1_new",
  PT_1_1_REPURCHASE_EVENT: "pt_1_1_repurchase_event",
  PT_1_1_REPURCHASE_NORMAL: "pt_1_1_repurchase_normal",
  PT_2_1_NEW: "pt_2_1_new",
  PT_2_1_REPURCHASE: "pt_2_1_repurchase",
  /* 2:1 재등록(이벤트). 32,000 고정이고 인수인계·누적 20회·직급에 걸리지
     않는다 (2026-10-09). 짝 규칙은 다른 2:1 과 똑같다. */
  PT_2_1_REPURCHASE_EVENT: "pt_2_1_repurchase_event",
  SERVICE: "service",
  LETMEIN: "letmein",
  /* 디오사 — 관리 수업. PT 와 다른 상품이고 단가도 고정이다 (2026-10-05).
     A 는 30분, B 는 50분이고 그 차이가 곧 단가의 차이다. */
  DIOSA_A: "diosa_a",
  DIOSA_B: "diosa_b",
  ETC: "etc",
});

/**
 * 둘이 함께 쓰는 회원권의 카테고리. **목록은 여기 하나다.**
 *
 * 전에는 네 곳이 각자 들고 있었다 -- 차감(lesson-settlement), 발급 안내
 * (duet-issue), 이관 검사(migration-repository), 발급 화면의 고를 수 있는
 * 카테고리(display-names). 그래서 카테고리를 하나 늘릴 때 네 곳을 모두 고쳐야
 * 했고, 하나를 빠뜨리면 **조용히 다르게** 동작했다: 이관 검사만 빠지면 짝 없는
 * 2:1 이 그대로 들어오고, 차감만 빠지면 그 회원권이 1:1 수업에서 빠진다.
 *
 * 한 곳으로 모은다. 다음에 늘릴 때는 여기만 고치면 된다.
 */
export const DUET_PAY_CATEGORIES = Object.freeze(
  /** @type {ReadonlyArray<string>} */ ([
    PAY_CATEGORY.PT_2_1_NEW,
    PAY_CATEGORY.PT_2_1_REPURCHASE,
    PAY_CATEGORY.PT_2_1_REPURCHASE_EVENT,
  ]),
);

/** 둘이 함께 쓰는 회원권인가. @param {unknown} category */
export function isDuetPayCategory(category) {
  return DUET_PAY_CATEGORIES.includes(String(category ?? ""));
}

/** 디오사 급여 카테고리. 수업 종류 ↔ 회원권 종류를 잇는 데도 쓴다. */
export const DIOSA_CATEGORIES = Object.freeze(
  /** @type {ReadonlyArray<string>} */ ([PAY_CATEGORY.DIOSA_A, PAY_CATEGORY.DIOSA_B]),
);

/** 이 회원권이 디오사인가. @param {unknown} category */
export function isDiosaCategory(category) {
  return DIOSA_CATEGORIES.includes(String(category ?? ""));
}

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
  /**
   * 세션업. 같은 회원권의 회차와 계약 금액이 함께 늘어난다 -- 33회를 쓰다가
   * 100회로 올리는 것은 같은 계약을 키운 것이지 새 회원권이 아니다.
   *
   * delta 는 늘어난 잔여의 양수다. 급여에는 잡히지 않는다 -- 수업이 아니고,
   * PAYROLL_ENTRY_TYPES 가 허용 목록이라 애초에 질의에 걸리지 않는다.
   *
   * **규칙은 이 종류를 받지 않는다.** 서버(Admin SDK)만 쓴다 -- 회원권의
   * totalSessions 를 바꾸는 일이라 클라이언트에 그 문을 열 수 없다.
   */
  SESSIONUP: "sessionup",
  /** 잘못 차감한 한 회차를 되돌린다. delta +1. */
  CORRECTION: "correction",
  /** 잘못 발급한 회원권을 무효화한다. delta 는 남은 횟수의 음수. */
  CANCEL: "cancel",
  /**
   * 잔여 회차 맞추기. delta 는 ±N.
   *
   * **수업이 아니다.** 실제 잔여와 장부가 어긋났을 때 대표가 숫자를 맞추는
   * 자리이고, 그래서 급여에 잡히지 않는다 -- PAYROLL_ENTRY_TYPES 가 허용
   * 목록이라 애초에 질의에 걸리지 않는다. category·unitPrice 도 없다:
   * 필수 목록을 채우자고 지어내면 급여가 그 허구를 카테고리별로 묶어 센다.
   */
  ADJUST: "adjust",
  /**
   * 만료일 옮기기. delta 는 0 이고 previousExpiresAt → newExpiresAt 이 남는다.
   *
   * 홀딩도 이 종류다. 기간만큼 뒤로 미는 것이고, 홀딩이었다는 사실은 사유에
   * 적는다 -- 별도 상태를 두면 규칙·투영·판정 세 군데가 같이 는다.
   */
  EXPIRY: "expiry",
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
  /* 공지사항과 그 읽음 기록. 읽음은 공지 아래에 매단다 -- 공지가 끝나도
     그 글은 남으므로(지우지 않는다) 가리킬 부모가 사라지지 않는다. */
  NOTICES: "notices",
  NOTICE_READS: "reads",
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
