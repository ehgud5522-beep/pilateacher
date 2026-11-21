"use strict";

/**
 * 강사 FC 복지 수업료 확정 (2026-11-21 대표 결정: 강사 입력 + FC · 대표 · 총괄 확정, FC 1명당 한 달 진행 + 캔슬 8회, 대표 · 총괄이 달마다 지정한 강사만).
 *
 * 확정은 이 서버 함수만 한다 (규칙은 fcLessonMonths 의 confirmed 를 앱에 열지 않는다). 확정 전에 다시 본다:
 *   1. 그 강사가 그 달 지정 강사인가 (fcLessonDesignations/{달})
 *   2. 그 달 센터 전체 줄로 FC 별 8회 한도를 세어, 이 강사의 줄 중 넘친 것이 없는가 (shared/fc-lessons.mjs 의 fcCapCheck)
 *   3. 확정하는 사람이 이 강사에게 수업을 받은 FC 가 아닌가 (자기가 받은 수업을 자기가 확정하지 못한다)
 * 확정하면 대표 · 총괄 알림함에 한 줄 (확정한 본인 제외). 알림 실패는 확정을 막지 않는다.
 * 누가: 대표 · 총괄, 또는 그 강사가 맡은 지점 안인 FC매니저. 자기 수업료는 자기가 확정하지 못한다.
 */

const text = (value) => String(value ?? "").trim();
const loadShared = () => import("../shared/fc-lessons.mjs");
const MONTH = /^\d{4}-\d{2}$/;

class FcLessonConfirmError extends Error {
  constructor(httpsCode, reason, details = {}) {
    super(reason);
    this.httpsCode = httpsCode;
    this.reason = reason;
    this.details = details;
  }
}

function scopedLocations(data) {
  const many = Array.isArray(data?.locationIds) ? data.locationIds.map(text).filter(Boolean) : [];
  if (many.length) return many;
  const one = text(data?.locationId);
  return one ? [one] : [];
}

function createFcLessonConfirmService({ firestore, membershipId, isOwnerLevel, now = () => new Date(), log = () => {} }) {
  async function authorize(org, callerUid, instructorId) {
    if (!callerUid) throw new FcLessonConfirmError("unauthenticated", "unauthenticated");
    if (callerUid === instructorId) throw new FcLessonConfirmError("permission-denied", "own_lessons");
    const [mine, target] = await Promise.all([
      firestore.collection("memberships").doc(membershipId(org, callerUid)).get(),
      firestore.collection("memberships").doc(membershipId(org, instructorId)).get(),
    ]);
    const membership = mine.exists ? mine.data() : null;
    if (!membership || membership.status !== "active") throw new FcLessonConfirmError("permission-denied", "not_member");
    if (isOwnerLevel(membership)) return membership;
    if (membership.role !== "manager") throw new FcLessonConfirmError("permission-denied", "not_confirmer");
    const myLocations = scopedLocations(membership);
    if (!myLocations.length) return membership;
    if (!target.exists) throw new FcLessonConfirmError("permission-denied", "instructor_unknown");
    const theirs = scopedLocations(target.data());
    if (theirs.length && !theirs.some((location) => myLocations.includes(location))) throw new FcLessonConfirmError("permission-denied", "out_of_scope");
    return membership;
  }

  async function notifyOwners({ org, instructor, key, callerUid, caller, snapshot, at, shared }) {
    try {
      const rows = (await firestore.collection("memberships").where("organizationId", "==", org).get()).docs.map((document) => document.data() || {});
      const nameOf = (uid, fallback) => text(rows.find((row) => text(row.userId) === uid)?.displayName) || fallback;
      const owners = rows.filter((row) => row.status === "active" && isOwnerLevel(row) && text(row.userId) && text(row.userId) !== text(callerUid));
      const notice = shared.fcLessonsConfirmedNotice({
        confirmerName: nameOf(text(callerUid), caller?.role === "manager" ? "FC" : "관리자"), instructorName: nameOf(instructor, "강사"), month: key, snapshot,
      });
      const id = `fc_${instructor}_${key}_${at.getTime()}`;
      for (const owner of owners) {
        await firestore.collection("users").doc(text(owner.userId)).collection("inbox").doc(id).set({
          kind: shared.FC_LESSON_CONFIRMED_INBOX_KIND, organizationId: org, instructorId: instructor, month: key,
          confirmedBy: text(callerUid), title: notice.title, body: notice.body, createdAt: at,
        });
      }
      return { sent: owners.length, errorCode: "" };
    } catch (error) {
      const errorCode = String(error?.code || "unknown");
      log("error", "fc_lessons_notice_failed", { feature: "fc_lessons", stage: "notify_owner", errorDomain: "firestore", errorCode, organizationId: org, month: key, correlationId: instructor.slice(-8) });
      return { sent: 0, errorCode };
    }
  }

  async function confirm({ callerUid, organizationId, instructorId, month }) {
    const shared = await loadShared();
    const org = text(organizationId);
    const instructor = text(instructorId);
    const key = text(month);
    if (!org || !instructor || org.includes("/") || instructor.includes("/") || !MONTH.test(key)) throw new FcLessonConfirmError("invalid-argument", "target_required");
    const caller = await authorize(org, callerUid, instructor);

    const monthRef = firestore.doc(`organizations/${org}/fcLessonMonths/${instructor}_${key}`);
    const [monthSnapshot, designationSnapshot, lessonsSnapshot] = await Promise.all([
      monthRef.get(),
      firestore.doc(`organizations/${org}/fcLessonDesignations/${key}`).get(),
      firestore.collection(`organizations/${org}/fcLessons`).where("month", "==", key).get(),
    ]);
    if (monthSnapshot.exists && monthSnapshot.data()?.status === "confirmed") throw new FcLessonConfirmError("failed-precondition", "already_confirmed");
    if (!shared.isDesignated(designationSnapshot.exists ? designationSnapshot.data() : null, instructor)) throw new FcLessonConfirmError("failed-precondition", "not_designated");
    const all = lessonsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    const mine = all.filter((entry) => text(entry.instructorId) === instructor);
    if (mine.some((entry) => text(entry.fcUserId) === text(callerUid))) throw new FcLessonConfirmError("permission-denied", "received_by_confirmer");
    const { overIds } = shared.fcCapCheck(all);
    const over = mine.filter((entry) => overIds.has(text(entry.id))).map((entry) => text(entry.id));
    const at = now();
    if (over.length) {
      await monthRef.set({
        organizationId: org, instructorId: instructor, month: key, status: monthSnapshot.exists ? monthSnapshot.data()?.status || "submitted" : "submitted",
        lastCheck: { checkedAt: at, checkedBy: text(callerUid), overCapEntryIds: over.slice(0, 200) }, updatedBy: text(callerUid), updatedAt: at,
      }, { merge: true });
      throw new FcLessonConfirmError("failed-precondition", "fc_cap_exceeded", { overCap: over.length });
    }
    const snapshot = shared.fcLessonTotals(mine);
    await monthRef.set({
      organizationId: org, instructorId: instructor, month: key, status: "confirmed", confirmedBy: text(callerUid), confirmedAt: at, snapshot,
      lastCheck: { checkedAt: at, checkedBy: text(callerUid), overCapEntryIds: [] }, updatedBy: text(callerUid), updatedAt: at,
    }, { merge: true });
    const notified = await notifyOwners({ org, instructor, key, callerUid, caller, snapshot, at, shared });
    return { status: "confirmed", snapshot, notified };
  }

  return { confirm };
}

module.exports = { createFcLessonConfirmService, FcLessonConfirmError };
