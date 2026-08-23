"use strict";

const { createHash } = require("node:crypto");

const POLICY_MODE = "legacy_owner_backup";
const CONSENT_POLICY_VERSION = "2026-08-23";

/*
 * Production implementations must validate the verified uid against the lesson,
 * member, organization membership, and the member/user AI consent record. Client
 * supplied uid, organizationId, studioId, and role must never be used as authority.
 */
function createDisabledPolicyService() {
  return Object.freeze({
    mode: "disabled",
    async authorize(_context) {
      return { allowed: false, reason: "policy_store_not_configured" };
    },
    async consumeRateLimit(_context) {
      return { allowed: false, reason: "rate_limit_store_not_configured" };
    },
    async checkConsent(_context) {
      return { allowed: false, reason: "policy_store_not_configured" };
    },
    async checkRateLimit(_context) {
      return { allowed: false, reason: "rate_limit_store_not_configured" };
    },
  });
}

function dataOf(snapshot) {
  return snapshot && (typeof snapshot.data === "function" ? snapshot.data() : snapshot.data);
}

function exists(snapshot) {
  return snapshot && (typeof snapshot.exists === "function" ? snapshot.exists() : snapshot.exists === true);
}

function lessonHasMember(lesson, memberId) {
  if (!lesson || typeof lesson !== "object") return false;
  if (lesson.memberId === memberId) return true;
  if (Array.isArray(lesson.memberIds) && lesson.memberIds.includes(memberId)) return true;
  return Array.isArray(lesson.attendees) && lesson.attendees.some((attendee) => attendee?.memberId === memberId);
}

function consentAllows(consent, operation, policyVersion) {
  const grantedAt = consent?.grantedAt;
  const hasTimestamp = grantedAt instanceof Date || (grantedAt && typeof grantedAt.toDate === "function");
  return Boolean(
    consent &&
    consent.status === "granted" &&
    consent.policyVersion === policyVersion &&
    Array.isArray(consent.scopes) &&
    (consent.scopes.includes(operation) || consent.scopes.includes("*")) &&
    hasTimestamp &&
    consent.revokedAt === null
  );
}

function asDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

function createFirestorePolicyService({
  firestore,
  mode = "",
  consentPolicyVersion = CONSENT_POLICY_VERSION,
  minuteLimit = 8,
  dailyLimit = 80,
  now = () => new Date(),
} = {}) {
  if (!firestore) return createDisabledPolicyService();
  const enabled = String(mode || "").trim() === POLICY_MODE;
  const perMinute = Math.max(1, Math.min(60, Number(minuteLimit) || 8));
  const perDay = Math.max(perMinute, Math.min(1000, Number(dailyLimit) || 80));

  async function authorize({ uid, memberId, lessonId = "", operation }) {
    if (!enabled) return { allowed: false, reason: "policy_mode_disabled" };
    try {
      const backupRef = firestore.doc(`users/${uid}/backup/latest`);
      const consentRef = firestore.doc(`users/${uid}/aiConsents/${memberId}`);
      const [backupSnapshot, consentSnapshot] = await Promise.all([backupRef.get(), consentRef.get()]);
      if (!exists(backupSnapshot) || !exists(consentSnapshot)) return { allowed: false, reason: "policy_record_missing" };
      const backup = dataOf(backupSnapshot) || {};
      const database = backup.data && typeof backup.data === "object" ? backup.data : {};
      const member = Array.isArray(database.members) ? database.members.find((item) => item?.id === memberId) : null;
      if (!member) return { allowed: false, reason: "member_not_owned" };
      if (lessonId) {
        const lesson = Array.isArray(database.schedule) ? database.schedule.find((item) => item?.id === lessonId) : null;
        if (!lesson || !lessonHasMember(lesson, memberId)) return { allowed: false, reason: "lesson_not_owned" };
      }
      if (!consentAllows(dataOf(consentSnapshot), operation, consentPolicyVersion)) {
        return { allowed: false, reason: "consent_not_granted" };
      }
      return { allowed: true, memberName: String(member.name || "").trim().slice(0, 160) };
    } catch (_error) {
      return { allowed: false, reason: "policy_check_failed" };
    }
  }

  async function consumeRateLimit({ uid }) {
    if (!enabled) return { allowed: false, reason: "policy_mode_disabled" };
    const current = asDate(now());
    if (Number.isNaN(current.valueOf())) return { allowed: false, reason: "rate_limit_clock_invalid" };
    const userHash = createHash("sha256").update(String(uid || "")).digest("hex");
    const ref = firestore.doc(`_aiGatewayUsage/${userHash}`);
    try {
      return await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const previous = exists(snapshot) ? dataOf(snapshot) || {} : {};
        const minuteStart = Math.floor(current.valueOf() / 60000) * 60000;
        const dayStart = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
        const sameMinute = Number(previous.minuteStart || 0) === minuteStart;
        const sameDay = Number(previous.dayStart || 0) === dayStart;
        const minuteCount = sameMinute ? Number(previous.minuteCount || 0) : 0;
        const dayCount = sameDay ? Number(previous.dayCount || 0) : 0;
        if (minuteCount >= perMinute) {
          return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((minuteStart + 60000 - current.valueOf()) / 1000)) };
        }
        if (dayCount >= perDay) {
          return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((dayStart + 86400000 - current.valueOf()) / 1000)) };
        }
        transaction.set(ref, {
          minuteStart,
          minuteCount: minuteCount + 1,
          dayStart,
          dayCount: dayCount + 1,
          updatedAt: current,
        }, { merge: false });
        return { allowed: true, remainingMinute: perMinute - minuteCount - 1, remainingDay: perDay - dayCount - 1 };
      });
    } catch (_error) {
      return { allowed: false, reason: "rate_limit_check_failed" };
    }
  }

  return Object.freeze({
    mode: enabled ? POLICY_MODE : "disabled",
    authorize,
    consumeRateLimit,
    checkConsent: authorize,
    checkRateLimit: consumeRateLimit,
  });
}

module.exports = {
  CONSENT_POLICY_VERSION,
  POLICY_MODE,
  createDisabledPolicyService,
  createFirestorePolicyService,
  consentAllows,
  lessonHasMember,
};
