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

export const paths = Object.freeze({
  /** @param {string} userId */
  user: (userId) => `${COLLECTIONS.USERS}/${segment(userId, "userId")}`,
  /** @param {string} organizationId */
  organization: (organizationId) => `${COLLECTIONS.ORGANIZATIONS}/${segment(organizationId, "organizationId")}`,
  /** @param {string} locationId */
  location: (locationId) => `${COLLECTIONS.LOCATIONS}/${segment(locationId, "locationId")}`,
  /** @param {string} membershipId */
  membership: (membershipId) => `${COLLECTIONS.MEMBERSHIPS}/${segment(membershipId, "membershipId")}`,
  /** @param {string} clientId */
  client: (clientId) => `${COLLECTIONS.CLIENTS}/${segment(clientId, "clientId")}`,
  /** @param {string} lessonId */
  lesson: (lessonId) => `${COLLECTIONS.LESSONS}/${segment(lessonId, "lessonId")}`,
  /** @param {string} assessmentId */
  assessment: (assessmentId) => `${COLLECTIONS.ASSESSMENTS}/${segment(assessmentId, "assessmentId")}`,
  /** @param {string} recommendationId */
  recommendation: (recommendationId) =>
    `${COLLECTIONS.AI_RECOMMENDATIONS}/${segment(recommendationId, "recommendationId")}`,
  /** @param {string} outcomeId */
  outcome: (outcomeId) => `${COLLECTIONS.OUTCOMES}/${segment(outcomeId, "outcomeId")}`,
  /** @param {string} userId */
  legacyBackup: (userId) => `${COLLECTIONS.USERS}/${segment(userId, "userId")}/backup/latest`,
});
