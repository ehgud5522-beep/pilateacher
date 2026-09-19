import { COLLECTIONS } from "./constants.js";
import { assertOrganizationId } from "./organization-id.js";

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
    `${COLLECTIONS.MEMBERSHIPS}/${assertOrganizationId(organizationId)}_${segment(userId, "userId")}`,
  /** @param {string} organizationId @param {string} locationId */
  location: (organizationId, locationId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.LOCATIONS}/${segment(locationId, "locationId")}`,
  /** @param {string} organizationId @param {string} clientId */
  client: (organizationId, clientId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.CLIENTS}/${segment(clientId, "clientId")}`,
  /**
   * 강사-회원 쌍의 누적 진행 횟수. 문서 id 가 곧 그 쌍이라 한 쌍에 두 문서가
   * 생길 수 없다 -- 규칙도 같은 형식을 요구한다.
   * @param {string} organizationId @param {string} instructorId @param {string} clientId
   */
  instructorClientTotal: (organizationId, instructorId, clientId) =>
    `${organizationRoot(organizationId)}/${COLLECTIONS.INSTRUCTOR_CLIENT_TOTALS}/${segment(instructorId, "instructorId")}_${segment(clientId, "clientId")}`,
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
  /**
   * 감사 로그. 조직 하위가 아니라 최상위다 -- 규칙의 match 도 최상위에 있다.
   *
   * 이 함수는 조직 하위 경로를 만들고 있었고, 규칙은 최상위만 열어 두고 있었다.
   * 둘이 어긋난 채였지만 쓰는 코드가 없어 드러나지 않았다. 첫 호출자가 생기는
   * 지금 규칙 쪽으로 맞춘다.
   *
   * 최상위라는 것은 경로가 조직을 고정해 주지 않는다는 뜻이다. 읽는 쪽은 반드시
   * where("organizationId", "==", …) 로 좁혀야 하고, 좁히지 않은 list 는 규칙이
   * 거부한다 -- firestore.foundation.rules 머리말의 class B.
   *
   * @param {string} logId
   */
  auditLog: (logId) => `${COLLECTIONS.AUDIT_LOGS}/${segment(logId, "logId")}`,
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
