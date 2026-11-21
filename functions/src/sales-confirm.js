"use strict";

/**
 * 강사 개인매출 인센 확정 (2026-11-21 대표: "강사 입력 + FC · 대표 입력이 같아야 확정이 되는 구조").
 *
 * 확정은 이 서버 함수만 한다 -- 규칙은 salesMonths 의 confirmed 를 앱에 열지 않는다. 앱이 "같다" 고 말해도 서버가 두 쪽
 * 줄을 직접 읽어 다시 짝짓고(shared/sales-incentive.mjs 의 pairSalesEntries), 한 줄이라도 다르거나 빠지면 거절한다.
 * 거절할 때는 무엇이 몇 건 어긋났는지를 그 달 문서(lastCheck)에 남긴다 -- 강사도 자기 줄 중 어느 것이 걸렸는지 본다.
 *
 * 누가: 대표 · 총괄, 또는 그 강사가 맡은 지점 안인 FC매니저(규칙의 instructorInManagerScope 와 같은 판단).
 * **자기 매출은 자기가 확정하지 못한다** (대표가 강사로 수업해도) -- 두 사람이 맞춰 보는 구조다.
 */

const text = (value) => String(value ?? "").trim();
const loadShared = () => import("../shared/sales-incentive.mjs");
const MONTH = /^\d{4}-\d{2}$/;

class SalesConfirmError extends Error {
  constructor(httpsCode, reason, details = {}) {
    super(reason);
    this.httpsCode = httpsCode;
    this.reason = reason;
    this.details = details;
  }
}

/** 소속의 지점 (규칙의 scopedLocationsOf 와 같은 읽기). */
function scopedLocations(data) {
  const many = Array.isArray(data?.locationIds) ? data.locationIds.map(text).filter(Boolean) : [];
  if (many.length) return many;
  const one = text(data?.locationId);
  return one ? [one] : [];
}

/**
 * @param {{ firestore: any, membershipId: (org: string, uid: string) => string, isOwnerLevel: (membership: any) => boolean, now?: () => Date }} deps
 */
function createSalesConfirmService({ firestore, membershipId, isOwnerLevel, now = () => new Date() }) {
  async function authorize(organizationId, callerUid, instructorId) {
    if (!callerUid) throw new SalesConfirmError("unauthenticated", "unauthenticated");
    if (callerUid === instructorId) throw new SalesConfirmError("permission-denied", "own_sales");
    const [mine, target] = await Promise.all([
      firestore.collection("memberships").doc(membershipId(organizationId, callerUid)).get(),
      firestore.collection("memberships").doc(membershipId(organizationId, instructorId)).get(),
    ]);
    const membership = mine.exists ? mine.data() : null;
    if (!membership || membership.status !== "active") throw new SalesConfirmError("permission-denied", "not_member");
    if (isOwnerLevel(membership)) return membership;
    if (membership.role !== "manager") throw new SalesConfirmError("permission-denied", "not_confirmer");
    const myLocations = scopedLocations(membership);
    if (!myLocations.length) return membership;
    if (!target.exists) throw new SalesConfirmError("permission-denied", "instructor_unknown");
    const theirs = scopedLocations(target.data());
    if (theirs.length && !theirs.some((location) => myLocations.includes(location))) throw new SalesConfirmError("permission-denied", "out_of_scope");
    return membership;
  }

  async function readEntries(organizationId, instructorId, month) {
    const snapshot = await firestore.collection(`organizations/${organizationId}/salesEntries`)
      .where("instructorId", "==", instructorId).where("month", "==", month).get();
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }

  /**
   * @returns {Promise<{ status: "confirmed", snapshot: any, counts: any } >}
   */
  async function confirm({ callerUid, organizationId, instructorId, month }) {
    const shared = await loadShared();
    const org = text(organizationId);
    const instructor = text(instructorId);
    const key = text(month);
    if (!org || !instructor || org.includes("/") || instructor.includes("/") || !MONTH.test(key)) throw new SalesConfirmError("invalid-argument", "target_required");
    await authorize(org, callerUid, instructor);

    const monthRef = firestore.doc(`organizations/${org}/salesMonths/${instructor}_${key}`);
    const monthSnapshot = await monthRef.get();
    const current = monthSnapshot.exists ? monthSnapshot.data() : null;
    if (current?.status === "confirmed") throw new SalesConfirmError("failed-precondition", "already_confirmed");

    const entries = await readEntries(org, instructor, key);
    const { pairs, counts, canConfirm } = shared.pairSalesEntries(entries);
    const at = now();
    if (!canConfirm) {
      /* 무엇이 어긋났는지 남긴다. 줄 id 만 -- 금액 · 회원은 이미 각 줄에 있고, 강사는 자기 줄 id 로 어느 것이 걸렸는지 안다. */
      const mismatched = pairs.filter((pair) => pair.code !== shared.PAIR.AGREED);
      await monthRef.set({
        organizationId: org, instructorId: instructor, month: key,
        status: current?.status || "submitted",
        lastCheck: {
          checkedAt: at, checkedBy: text(callerUid), agreed: counts[shared.PAIR.AGREED] || 0,
          differs: counts[shared.PAIR.DIFFERS] || 0, instructorOnly: counts[shared.PAIR.INSTRUCTOR_ONLY] || 0, officeOnly: counts[shared.PAIR.OFFICE_ONLY] || 0,
          instructorEntryIds: mismatched.map((pair) => text(pair.instructor?.id)).filter(Boolean).slice(0, 200),
          officeEntryIds: mismatched.map((pair) => text(pair.office?.id)).filter(Boolean).slice(0, 200),
        },
        updatedBy: text(callerUid), updatedAt: at,
      }, { merge: true });
      throw new SalesConfirmError("failed-precondition", "sides_differ", counts);
    }

    /* 환수 계산에 필요한 지난 달 줄 (강사 쪽만 -- 확정된 달은 두 쪽이 같다). */
    const mine = entries.filter((entry) => entry.side === shared.SALES_SIDE.INSTRUCTOR);
    const priorMonths = [...new Set(mine.filter((entry) => shared.isRefund(entry) && text(entry.refundOfMonth) && text(entry.refundOfMonth) < key).map((entry) => text(entry.refundOfMonth)))];
    const prior = (await Promise.all(priorMonths.map((original) => readEntries(org, instructor, original))))
      .flat().filter((entry) => entry.side === shared.SALES_SIDE.INSTRUCTOR);
    const statement = shared.monthStatement({ entries: [...mine, ...prior], month: key });
    const snapshot = shared.confirmSnapshot(statement, mine.length);
    await monthRef.set({
      organizationId: org, instructorId: instructor, month: key, status: "confirmed",
      confirmedBy: text(callerUid), confirmedAt: at, snapshot,
      lastCheck: { checkedAt: at, checkedBy: text(callerUid), agreed: counts[shared.PAIR.AGREED] || 0, differs: 0, instructorOnly: 0, officeOnly: 0, instructorEntryIds: [], officeEntryIds: [] },
      updatedBy: text(callerUid), updatedAt: at,
    }, { merge: true });
    return { status: "confirmed", snapshot, counts };
  }

  return { confirm };
}

module.exports = { createSalesConfirmService, SalesConfirmError };
