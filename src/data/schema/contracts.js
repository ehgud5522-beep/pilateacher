import { DATA_KIND, SCHEMA_VERSION } from "./constants.js";

/**
 * Firestore Timestamp-compatible value used by the foundation layer.
 * Runtime writes must use firebase/firestore Timestamp, not date strings.
 * @typedef {{seconds: number, nanoseconds: number}} TimestampLike
 */

/**
 * @typedef {object} EntityIdentity
 * @property {string} organizationId
 * @property {string=} locationId
 * @property {string=} userId
 * @property {string=} clientId
 * @property {string=} lessonId
 * @property {string=} assessmentId
 * @property {string=} recommendationId
 * @property {string=} outcomeId
 */

/**
 * @typedef {object} AuditFields
 * @property {number} schemaVersion
 * @property {TimestampLike} createdAt
 * @property {TimestampLike} updatedAt
 * @property {string} createdBy
 */

/**
 * @typedef {object} DataClassification
 * @property {"source"|"derived"} dataKind
 */

export const REQUIRED_ID_FIELDS = Object.freeze([
  "organizationId",
  "locationId",
  "userId",
  "clientId",
  "lessonId",
  "assessmentId",
  "recommendationId",
  "outcomeId",
]);

export const REQUIRED_AUDIT_FIELDS = Object.freeze([
  "schemaVersion",
  "createdAt",
  "updatedAt",
  "createdBy",
]);

export function sourceClassification() {
  return Object.freeze({ dataKind: DATA_KIND.SOURCE });
}

export function derivedClassification() {
  return Object.freeze({ dataKind: DATA_KIND.DERIVED });
}

/**
 * @param {TimestampLike} timestamp
 * @param {string} createdBy
 * @returns {AuditFields}
 */
export function auditFields(timestamp, createdBy) {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy,
  };
}
