"use strict";

const { createHash } = require("node:crypto");

const SEED_VERSION = "app-review-v1";
const BLOCKED_PROJECT_FRAGMENT = "pilateacher-prod";
const DEMO_CENTER_NAME = "PilaTeacher Review Studio";
const DEMO_TEACHER_NAME = "App Review Instructor";

function requiredText(value, field) {
  const text = String(value || "").trim();
  if (!text) throw codedError("invalid_input", `${field} is required`);
  return text;
}

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function assertSafeProject(projectId) {
  const normalized = requiredText(projectId, "projectId").toLowerCase();
  if (normalized.includes(BLOCKED_PROJECT_FRAGMENT)) {
    throw codedError("production_project_blocked", "Production project is blocked");
  }
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(normalized)) {
    throw codedError("invalid_project", "projectId format is invalid");
  }
  return normalized;
}

function validateReviewCredentials(email, password) {
  const normalizedEmail = requiredText(email, "APP_REVIEW_EMAIL").toLowerCase();
  const normalizedPassword = String(password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw codedError("invalid_review_email", "APP_REVIEW_EMAIL format is invalid");
  }
  if (normalizedPassword.length < 12) {
    throw codedError("weak_review_password", "APP_REVIEW_PASSWORD must have at least 12 characters");
  }
  return { email: normalizedEmail, password: normalizedPassword };
}

function dateOnly(value) {
  const input = value instanceof Date ? value.toISOString() : String(value || "");
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw codedError("invalid_reference_date", "referenceDate must be an ISO date");
  const output = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${output}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== output) {
    throw codedError("invalid_reference_date", "referenceDate is not a valid calendar date");
  }
  return output;
}

function addDays(iso, count) {
  const date = new Date(`${dateOnly(iso)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function mondayOf(iso) {
  const date = new Date(`${dateOnly(iso)}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(iso, -offset);
}

function deterministicUserId(email) {
  const digest = createHash("sha256").update(String(email || "").trim().toLowerCase()).digest("hex");
  return `app-review-${digest.slice(0, 20)}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function seedChecksum(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function memberFixtures(weekStart, teacherName) {
  return [
    {
      id: "review-member-active",
      name: "리뷰 회원 A",
      status: "active",
      instructor: teacherName,
      phone: "",
      birth: "1992-04-15",
      goal: "코어 안정화와 바른 자세",
      passName: "개인 20회",
      regular: 12,
      service: 1,
      total: 20,
      startDate: addDays(weekStart, -42),
      contractEnd: addDays(weekStart, 45),
      focus: ["호흡", "코어 안정화"],
      inbody: [],
      perf: [],
      notes: [{
        id: "review-note-completed",
        sid: "review-lesson-completed",
        date: weekStart,
        type: "개인레슨",
        instructor: teacherName,
        body: "App Review용 테스트 수업 기록입니다. 실제 회원 정보나 의료 판단을 포함하지 않습니다.",
        tags: [],
        deductFrom: "정규",
      }],
      payments: [],
      appReviewPlaceholder: true,
    },
    {
      id: "review-member-holding",
      name: "리뷰 회원 B",
      status: "hold",
      instructor: teacherName,
      phone: "",
      birth: "1988-09-02",
      goal: "가동 범위 회복",
      passName: "듀엣 10회",
      regular: 6,
      service: 0,
      total: 10,
      startDate: addDays(weekStart, -28),
      contractEnd: addDays(weekStart, 32),
      holdFrom: addDays(weekStart, -2),
      holdTo: addDays(weekStart, 12),
      focus: ["무리 없는 가동 범위"],
      inbody: [],
      perf: [],
      notes: [],
      payments: [],
      appReviewPlaceholder: true,
    },
    {
      id: "review-member-expiring",
      name: "리뷰 회원 C",
      status: "active",
      instructor: teacherName,
      phone: "",
      birth: "1996-12-21",
      goal: "전신 정렬 개선",
      passName: "개인 10회",
      regular: 2,
      service: 0,
      total: 10,
      startDate: addDays(weekStart, -63),
      contractEnd: addDays(weekStart, 8),
      focus: ["전신 정렬"],
      inbody: [],
      perf: [],
      notes: [],
      payments: [],
      appReviewPlaceholder: true,
    },
  ];
}

function attendee(memberId, status, extras = {}) {
  return { memberId, status, deductFrom: null, noshowFee: null, ...extras };
}

function scheduleFixtures(weekStart, teacherName) {
  return [
    {
      id: "review-lesson-completed",
      memberId: "review-member-active",
      memberIds: ["review-member-active"],
      attendees: [attendee("review-member-active", "done", { deductFrom: "regular" })],
      date: weekStart,
      start: "10:00",
      end: "10:50",
      dur: 50,
      type: "개인레슨",
      instructor: teacherName,
      room: "",
      memo: "",
      status: "done",
      deductFrom: "regular",
      noshowFee: null,
      appReviewPlaceholder: true,
    },
    {
      id: "review-lesson-group",
      attendees: [],
      date: addDays(weekStart, 1),
      start: "14:00",
      end: "14:50",
      dur: 50,
      type: "그룹",
      equip: "리포머",
      groupCount: 6,
      groupDone: false,
      instructor: teacherName,
      room: "",
      memo: "",
      appReviewPlaceholder: true,
    },
    {
      id: "review-lesson-upcoming",
      memberId: "review-member-expiring",
      memberIds: ["review-member-expiring"],
      attendees: [attendee("review-member-expiring", "booked")],
      date: addDays(weekStart, 2),
      start: "11:00",
      end: "11:50",
      dur: 50,
      type: "개인레슨",
      instructor: teacherName,
      room: "",
      memo: "",
      status: "booked",
      deductFrom: null,
      noshowFee: null,
      appReviewPlaceholder: true,
    },
    {
      id: "review-lesson-noshow",
      memberId: "review-member-active",
      memberIds: ["review-member-active"],
      attendees: [attendee("review-member-active", "noshow")],
      date: addDays(weekStart, 3),
      start: "17:00",
      end: "17:50",
      dur: 50,
      type: "개인레슨",
      instructor: teacherName,
      room: "",
      memo: "",
      status: "noshow",
      deductFrom: null,
      noshowFee: null,
      appReviewPlaceholder: true,
    },
    {
      id: "review-lesson-cancelled",
      memberId: "review-member-expiring",
      memberIds: ["review-member-expiring"],
      attendees: [attendee("review-member-expiring", "cancel")],
      date: addDays(weekStart, 4),
      start: "09:00",
      end: "09:50",
      dur: 50,
      type: "개인레슨",
      instructor: teacherName,
      room: "",
      memo: "",
      status: "cancel",
      deductFrom: null,
      noshowFee: null,
      appReviewPlaceholder: true,
    },
    {
      id: "review-lesson-missing-note",
      memberId: "review-member-expiring",
      memberIds: ["review-member-expiring"],
      attendees: [attendee("review-member-expiring", "done", { deductFrom: "regular" })],
      date: addDays(weekStart, 5),
      start: "13:00",
      end: "13:50",
      dur: 50,
      type: "개인레슨",
      instructor: teacherName,
      room: "",
      memo: "",
      status: "done",
      deductFrom: "regular",
      noshowFee: null,
      appReviewPlaceholder: true,
    },
  ];
}

function assessmentPlaceholders(weekStart) {
  const memberId = "review-member-active";
  const assessmentId = "review-assessment-manual-placeholder";
  const capturedAt = `${addDays(weekStart, -7)}T09:00:00.000Z`;
  const placeholder = (view) => {
    const label = `PilaTeacher App Review ${view} placeholder`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960"><rect width="720" height="960" fill="#F1F3F6"/><rect x="80" y="80" width="560" height="800" rx="32" fill="#FFFFFF" stroke="#D5DAE3" stroke-width="4"/><circle cx="360" cy="300" r="90" fill="#ECEBF7"/><path d="M220 720 C250 500 470 500 500 720" fill="#ECEBF7"/><text x="360" y="810" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#5E6673">${label}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const common = {
    memberId,
    assessmentId,
    date: capturedAt.slice(0, 10),
    createdAt: capturedAt,
    analysisMethod: "manual",
    assessmentRole: "before",
    assessmentStatus: "completed",
    captureStatus: "completed",
    completedAt: capturedAt,
    mediaState: "safe_review_placeholder",
    appReviewPlaceholder: true,
  };
  return {
    [memberId]: {
      front: [{ ...common, id: "review-photo-front-placeholder", view: "front", src: placeholder("front") }],
      leftSide: [{ ...common, id: "review-photo-side-placeholder", view: "leftSide", src: placeholder("side") }],
      back: [{ ...common, id: "review-photo-back-placeholder", view: "back", src: placeholder("back") }],
      poses: [],
    },
  };
}

function buildReviewSeed({ uid, email, referenceDate = new Date(), centerName = DEMO_CENTER_NAME, teacherName = DEMO_TEACHER_NAME }) {
  const safeUid = requiredText(uid, "uid");
  const safeEmail = requiredText(email, "email").toLowerCase();
  const weekStart = mondayOf(referenceDate);
  const members = memberFixtures(weekStart, teacherName);
  const schedule = scheduleFixtures(weekStart, teacherName);
  const profile = {
    name: teacherName,
    center: centerName,
    phone: "",
    email: safeEmail,
    photo: "",
    provider: "email",
    appReviewDemo: true,
    appReviewSeedVersion: SEED_VERSION,
  };
  const backup = {
    data: {
      settings: {
        center: centerName,
        staff: teacherName,
        payRate: 35000,
        groupRate: 18000,
        templates: [],
      },
      members,
      schedule,
    },
    reviewPhotos: assessmentPlaceholders(weekStart),
    members: members.length,
    device: "App Review seed",
    appReviewDemo: true,
    appReviewSeedVersion: SEED_VERSION,
    appReviewSeedWeek: weekStart,
  };
  return {
    uid: safeUid,
    profile,
    backup,
    summary: {
      members: members.length,
      schedules: schedule.length,
      assessmentSets: 1,
      weekStart,
    },
  };
}

async function runSeedOperation({ mode = "dry-run", projectId, email, password, referenceDate = new Date(), adapter = null }) {
  const safeProjectId = assertSafeProject(projectId);
  const credentials = validateReviewCredentials(email, password);
  const apply = mode === "apply";
  if (mode !== "dry-run" && !apply) throw codedError("invalid_mode", "mode must be dry-run or apply");
  const plannedUid = deterministicUserId(credentials.email);

  if (!apply) {
    const seed = buildReviewSeed({ uid: plannedUid, email: credentials.email, referenceDate });
    return {
      mode: "dry-run",
      projectId: safeProjectId,
      writesPerformed: false,
      summary: seed.summary,
      checksum: seedChecksum(seed),
    };
  }

  if (!adapter || typeof adapter.assertProject !== "function" || typeof adapter.ensureUser !== "function" || typeof adapter.writeSeed !== "function") {
    throw codedError("admin_adapter_required", "An Admin adapter is required for apply mode");
  }
  await adapter.assertProject(safeProjectId);
  const account = await adapter.ensureUser({
    email: credentials.email,
    password: credentials.password,
    displayName: DEMO_TEACHER_NAME,
    deterministicUid: plannedUid,
  });
  const seed = buildReviewSeed({ uid: account.uid, email: credentials.email, referenceDate });
  await adapter.writeSeed({ uid: account.uid, profile: seed.profile, backup: seed.backup });
  return {
    mode: "apply",
    projectId: safeProjectId,
    writesPerformed: true,
    summary: seed.summary,
    checksum: seedChecksum(seed),
  };
}

module.exports = {
  BLOCKED_PROJECT_FRAGMENT,
  DEMO_CENTER_NAME,
  DEMO_TEACHER_NAME,
  SEED_VERSION,
  addDays,
  assertSafeProject,
  buildReviewSeed,
  dateOnly,
  deterministicUserId,
  mondayOf,
  runSeedOperation,
  seedChecksum,
  stableStringify,
  validateReviewCredentials,
};
