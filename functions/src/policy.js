"use strict";

const { createHash } = require("node:crypto");

const POLICY_MODE = "legacy_owner_backup";
/* 한 사람이 여러 센터에 속할 수 있다. 상한을 두는 것은 하나의 요청이 센터 수만큼
   읽기를 만드는 것을 막기 위해서다 -- 지금은 전부 한 곳이다. */
const MAX_MEMBERSHIPS_PER_USER = 5;
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

  /**
   * 이 uid 가 활성 구성원인 조직들. 규칙의 isActiveMember() 와 같은 문서를 본다.
   *
   * 요청에 실려 온 organizationId 는 쓰지 않는다. 그 값을 권한의 근거로 삼으면
   * 아무 uid 나 남의 센터 번호를 적어 보내는 것으로 그 센터의 회원이 된다.
   * uid 는 Firebase 가 검증한 값이고, 소속은 서버가 그 uid 로 찾는다.
   *
   * 조직 번호를 요청에 실어 "확인만" 하는 길도 있었다. 판정은 같아지지만 앱을
   * 새로 내보내야 하고, 그 전 버전은 그대로 막힌 채로 남는다. 여기서 찾으면
   * 이미 설치된 앱도 배포 즉시 풀린다.
   *
   * userId 하나로만 거른다 -- 동등 조건 하나는 자동 인덱스로 처리되므로 새
   * 색인이 필요 없다. status 는 받아서 코드에서 본다.
   */
  async function activeOrganizationIds(uid) {
    const snapshot = await firestore.collection("memberships")
      .where("userId", "==", String(uid || ""))
      .limit(MAX_MEMBERSHIPS_PER_USER)
      .get();
    const documents = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
    return documents
      .map((item) => dataOf(item))
      .filter((membership) => membership
        && membership.status === "active"
        && typeof membership.organizationId === "string"
        && membership.organizationId)
      .map((membership) => membership.organizationId);
  }

  async function authorize({ uid, memberId, lessonId = "", operation }) {
    if (!enabled) return { allowed: false, reason: "policy_mode_disabled" };
    try {
      const backupRef = firestore.doc(`users/${uid}/backup/latest`);
      const consentRef = firestore.doc(`users/${uid}/aiConsents/${memberId}`);
      const [backupSnapshot, consentSnapshot] = await Promise.all([backupRef.get(), consentRef.get()]);
      const backup = exists(backupSnapshot) ? dataOf(backupSnapshot) || {} : null;
      const database = backup && backup.data && typeof backup.data === "object" ? backup.data : {};
      const member = Array.isArray(database.members) ? database.members.find((item) => item?.id === memberId) : null;

      /* 소속은 한 번만 찾아 둔다. 기기 쪽으로 증명되면 아예 찾지 않는다 --
         지금까지처럼 도는 요청에 읽기를 하나 더 붙이지 않기 위해서다. */
      let organizations = null;
      const organizationsOf = async () => {
        if (organizations === null) organizations = await activeOrganizationIds(uid);
        return organizations;
      };

      /* 센터가 등록한 회원은 기기 백업에 없다. 기기에 없는 회원은 없는 회원이
         아니라 "이 강사의 기기가 만들지 않은 회원" 이고, 규칙은 이미 같은 회원을
         같은 강사에게 열어 준다 -- 서버만 그 개념을 몰랐다. */
      let organizationId = "";
      let organizationClient = null;
      if (!member) {
        for (const candidate of await organizationsOf()) {
          const clientSnapshot = await firestore.doc(`organizations/${candidate}/clients/${memberId}`).get();
          if (exists(clientSnapshot)) {
            organizationId = candidate;
            organizationClient = dataOf(clientSnapshot) || {};
            break;
          }
        }
      }

      /* 백업이 없는 것과 회원이 없는 것은 다른 실패다. 둘 다 아니라고 뭉치면
         강사는 무엇을 해야 하는지 알 수 없다 (백업을 켜라 vs 회원을 확인하라). */
      if (!backup && !organizationClient) return { allowed: false, reason: "backup_missing" };
      if (!exists(consentSnapshot)) return { allowed: false, reason: "consent_missing" };
      if (!member && !organizationClient) return { allowed: false, reason: "member_not_owned" };

      if (lessonId) {
        const lesson = Array.isArray(database.schedule) ? database.schedule.find((item) => item?.id === lessonId) : null;
        let lessonProved = Boolean(lesson && lessonHasMember(lesson, memberId));
        /* 정산한 수업은 조직에도 남는다(passes 차감이 lessons/participants 를 함께
           쓴다). 기기 쪽으로 증명되지 않을 때만 그쪽을 본다 -- 정산 전 수업은
           아직 조직에 없으므로 이것만으로는 부족하고, 둘 중 하나면 된다. */
        if (!lessonProved) {
          for (const candidate of organizationId ? [organizationId] : await organizationsOf()) {
            const participant = await firestore
              .doc(`organizations/${candidate}/lessons/${lessonId}/participants/${memberId}`)
              .get();
            if (exists(participant)) { lessonProved = true; break; }
          }
        }
        if (!lessonProved) return { allowed: false, reason: "lesson_not_owned" };
      }

      if (!consentAllows(dataOf(consentSnapshot), operation, consentPolicyVersion)) {
        return { allowed: false, reason: "consent_not_granted" };
      }
      const name = member ? member.name : organizationClient?.name;
      return { allowed: true, memberName: String(name || "").trim().slice(0, 160) };
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
