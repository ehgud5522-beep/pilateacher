"use strict";

const EMPTY_ROOM_RATE = 25000;
const id = (value) => typeof value === "string" && value.length > 0 && value.length <= 200
  && !value.includes("/") && value !== "." && value !== "..";
const count = (value) => Number.isInteger(value) && value >= 0 && value <= 1000;
const rate = (value) => Number.isSafeInteger(value) && value > 0 ? value : 0;
const locationsOf = (membership) => membership?.locationIds?.length && Array.isArray(membership.locationIds)
  ? membership.locationIds : [membership?.locationId].filter(Boolean);

function fail(httpsCode, reason) {
  throw Object.assign(new Error(reason), { httpsCode });
}

function authorize(caller, organizationId, uid, locationId) {
  if (caller?.status === "active" && caller.organizationId === organizationId && caller.userId === uid) {
    if (["owner", "area_manager"].includes(caller.role)) return;
    if (caller.role === "manager" && locationId && locationsOf(caller).includes(locationId)) return;
  }
  fail("permission-denied", "group_payroll_scope");
}

function buildRows(edits, previous, instructors, locationId) {
  const rows = new Map(previous.map((row) => [row.instructorId, row]));
  const seen = new Set();
  for (const { instructorId, fullCount, emptyCount } of edits) {
    const existing = rows.get(instructorId);
    const instructor = instructors.get(instructorId);
    if (seen.has(instructorId)) fail("invalid-argument", "group_payroll_duplicate");
    seen.add(instructorId);
    if (!existing && (instructor?.status !== "active" || instructor.role !== "instructor"
      || !locationsOf(instructor).includes(locationId))) {
      fail("failed-precondition", "group_payroll_instructor");
    }
    if (fullCount === 0 && emptyCount === 0) {
      rows.delete(instructorId);
      continue;
    }
    const fullRate = rate(existing?.fullRate) || rate(instructor?.fullRoomRate);
    if (fullCount > 0 && !fullRate) fail("failed-precondition", "group_payroll_rate");
    if (!Number.isSafeInteger(fullCount * fullRate + emptyCount * EMPTY_ROOM_RATE)) {
      fail("invalid-argument", "group_payroll_amount");
    }
    rows.set(instructorId, { instructorId, fullCount, emptyCount, fullRate });
  }
  return [...rows.values()];
}

async function manageGroupPayroll(firestore, uid, data, serverTimestamp) {
  if (!uid) fail("unauthenticated", "group_payroll_login");
  const { organizationId, month, action, locationId = "", edits, revision } = data || {};
  if (!id(organizationId) || typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    || (locationId !== "" && !id(locationId)) || !["list", "save"].includes(action)) {
    fail("invalid-argument", "group_payroll_input");
  }
  const organization = firestore.collection("organizations").doc(organizationId);
  const locations = organization.collection("groupPayroll").doc(month).collection("locations");
  const memberships = firestore.collection("memberships");
  const caller = memberships.doc(`${organizationId}_${uid}`);

  if (action === "list") {
    authorize((await caller.get()).data(), organizationId, uid, locationId);
    if (!locationId) {
      const snapshot = await locations.get();
      return { rows: snapshot.docs.flatMap((doc) => (doc.data().rows || []).map((row) => ({ ...row, locationId: doc.id }))) };
    }
    const snapshot = await locations.doc(locationId).get();
    return { rows: snapshot.data()?.rows || [], revision: snapshot.data()?.revision || 0 };
  }

  if (!locationId || !Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(edits)
    || edits.length === 0 || edits.length > 200 || edits.some((row) => !id(row?.instructorId)
      || !count(row.fullCount) || !count(row.emptyCount))) {
    fail("invalid-argument", "group_payroll_input");
  }
  const target = locations.doc(locationId);
  return firestore.runTransaction(async (transaction) => {
    authorize((await transaction.get(caller)).data(), organizationId, uid, locationId);
    const [snapshot, location] = await transaction.getAll(target, organization.collection("locations").doc(locationId));
    if (!location.exists) fail("failed-precondition", "group_payroll_location");
    const previous = snapshot.data() || {};
    if ((previous.revision || 0) !== revision) fail("aborted", "group_payroll_conflict");
    const refs = [...new Set(edits.map(({ instructorId }) => instructorId))]
      .map((instructorId) => memberships.doc(`${organizationId}_${instructorId}`));
    const instructorDocs = await transaction.getAll(...refs);
    const instructors = new Map(instructorDocs.flatMap((doc) => {
      const instructor = doc.data();
      return instructor?.organizationId === organizationId && doc.id === `${organizationId}_${instructor.userId}`
        ? [[instructor.userId, instructor]] : [];
    }));
    const rows = buildRows(edits, previous.rows || [], instructors, locationId);
    transaction.set(target, { rows, revision: revision + 1, updatedBy: uid, updatedAt: serverTimestamp() });
    return { rows, revision: revision + 1 };
  });
}

module.exports = { manageGroupPayroll };
