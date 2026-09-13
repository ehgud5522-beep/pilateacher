import { COLLECTIONS } from "./constants.js";

/**
 * @param {unknown} value
 * @param {string} label
 */
function segment(value, label) {
  const result = String(value ?? "").trim();
  if (!result || result.includes("/")) throw new Error(`Invalid ${label}`);
  return result;
}

/**
 * @param {string} organizationId
 */
function organizationRoot(organizationId) {
  return `${COLLECTIONS.ORGANIZATIONS}/${segment(organizationId, "organizationId")}`;
}

export const paths = Object.freeze({
  /** @param {string} userId */
  user: (userId) => `${COLLECTIONS.USERS}/${segment(userId, "userId")}`,
  /** @param {string} organizationId */
  organization: (organizationId) => organizationRoot(organizationId),
  /**
   * 조직 소속. 접근 판정의 기반이므로 조직 하위가 아니라 최상위에 둔다.
   * 문서 id는 firestore.foundation.rules의 membershipId() 헬퍼와 같은 형식이다.
   * @param {string} organizationId @param {string} userId
   */
  orgMembership: (organizationId, userId) =>
    `${COLLECTIONS.MEMBERSHIPS}/${segment(organizationId, "organizationId")}_${segment(userId, "userId")}`,
  /** @param {string} organizationId @param {string} locationId */
  location: (organizationId, locationId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.LOCATIONS}/${segment(locationId, "locationId")}`,
  /** @param {string} organizationId @param {string} clientId */
  client: (organizationId, clientId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.CLIENTS}/${segment(clientId, "clientId")}`,
  /** @param {string} organizationId @param {string} productId */
  product: (organizationId, productId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.PRODUCTS}/${segment(productId, "productId")}`,
  /** @param {string} organizationId @param {string} passId */
  pass: (organizationId, passId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.PASSES}/${segment(passId, "passId")}`,
  /** @param {string} organizationId @param {string} passId @param {string} entryId */
  passLedgerEntry: (organizationId, passId, entryId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.PASSES}/${segment(passId, "passId")}/${COLLECTIONS.LEDGER}/${segment(entryId, "entryId")}`,
  /** @param {string} organizationId @param {string} lessonId */
  lesson: (organizationId, lessonId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.LESSONS}/${segment(lessonId, "lessonId")}`,
  /** @param {string} organizationId @param {string} lessonId @param {string} clientId */
  lessonParticipant: (organizationId, lessonId, clientId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.LESSONS}/${segment(lessonId, "lessonId")}/${COLLECTIONS.PARTICIPANTS}/${segment(clientId, "clientId")}`,
  /** @param {string} organizationId @param {string} noteId */
  lessonNote: (organizationId, noteId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.LESSON_NOTES}/${segment(noteId, "noteId")}`,
  /** @param {string} organizationId @param {string} logId */
  auditLog: (organizationId, logId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.AUDIT_LOGS}/${segment(logId, "logId")}`,
  /** @param {string} organizationId @param {string} assessmentId */
  assessment: (organizationId, assessmentId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.ASSESSMENTS}/${segment(assessmentId, "assessmentId")}`,
  /** @param {string} organizationId @param {string} recommendationId */
  recommendation: (organizationId, recommendationId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.AI_RECOMMENDATIONS}/${segment(recommendationId, "recommendationId")}`,
  /** @param {string} organizationId @param {string} outcomeId */
  outcome: (organizationId, outcomeId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.OUTCOMES}/${segment(outcomeId, "outcomeId")}`,
  /** @param {string} userId */
  legacyBackup: (userId) => `${COLLECTIONS.USERS}/${segment(userId, "userId")}/backup/latest`,
});
