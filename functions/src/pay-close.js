"use strict";

/**
 * 서버 급여 확정 (2026-11-22 외부 검토 2차).
 *
 * 화면이 보낸 금액을 저장하지 않는다. 서버가 원장 · 그룹 급여 · 확정된 매출 인센 · FC 수업료 · 조정 · 세금 설정을 직접 읽어
 * 다시 계산하고(shared/pay-close.mjs), 대표가 화면에서 본 실수령 합계와 다르면 거절한다 -- 대표는 다시 읽고 다시 누른다.
 * 확정할 때마다 회차(revision)가 오르고, 그 회차의 명세 전부를 payCloseRuns/{달}_r{회차} 에 남긴다 (되돌려도 지워지지 않는다).
 * 조정 · 세금 · 매출 인센 · FC 수업료 · 달 상태는 트랜잭션 안에서 다시 읽는다 -- 그 사이에 바뀌면 다시 돈다.
 * 원장은 덧붙이기만 하는 기록이라 트랜잭션 밖에서 읽는다.
 *
 * 누가: 대표 · 총괄만. FC 는 급여를 확정하지 않는다.
 */

const text = (value) => String(value ?? "").trim();
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const loadClose = () => import("../shared/pay-close.mjs");
const loadSwap = () => import("../shared/instructor-swap.mjs");
const loadCheck = () => import("../shared/pay-check.mjs");

class PayCloseError extends Error {
  constructor(httpsCode, reason, details = {}) {
    super(reason);
    this.httpsCode = httpsCode;
    this.reason = reason;
    this.details = details;
  }
}

function createPayCloseService({ firestore, membershipId, isOwnerLevel, now = () => new Date(), payCheck = null }) {
  async function close({ callerUid, organizationId, month, expectedNet }) {
    const org = text(organizationId);
    const key = text(month);
    if (!callerUid) throw new PayCloseError("unauthenticated", "unauthenticated");
    if (!org || org.includes("/") || !MONTH.test(key)) throw new PayCloseError("invalid-argument", "target_required");
    const caller = await firestore.collection("memberships").doc(membershipId(org, callerUid)).get();
    if (!caller.exists || caller.data()?.status !== "active" || !isOwnerLevel(caller.data())) throw new PayCloseError("permission-denied", "not_closer");

    /* 확정 직전에 그 달을 다시 점검한다 -- 밤 결과만으로 확정하지 않는다 (2026-11-22 정산 점검).
       점검을 다 못 했거나, 확인하지 않은 차단 항목(완료인데 차감 없음 · 이 달 회원권 잔여 불일치)이 있으면 거절. 경고는 막지 않는다. */
    let checkSummary = null;
    let checkedFingerprint = null;
    if (payCheck) {
      const checked = await payCheck.check(org, key, "close");
      if (!checked.complete) throw new PayCloseError("failed-precondition", "check_incomplete", { failures: checked.failures });
      if (checked.openBlocks) throw new PayCloseError("failed-precondition", "check_blocked", { openBlocks: checked.openBlocks });
      checkSummary = { block: checked.counts.block, warn: checked.counts.warn, openWarns: checked.openWarns, ackedBlocks: checked.counts.block - checked.openBlocks, fingerprint: checked.fingerprint };
      checkedFingerprint = checked.fingerprint;
    }
    const [{ kstMonthRange, lessonTotalsByInstructor, lessonSourceSummary, buildPayClose, PAYROLL_LEDGER_TYPES }, { canonicalInstructorIdFrom }, { sourceFingerprint, sameFingerprint }] = await Promise.all([loadClose(), loadSwap(), loadCheck()]);
    const centre = firestore.collection("organizations").doc(org);
    const { start, end } = kstMonthRange(key);
    const [members, demoClients] = await Promise.all([
      firestore.collection("memberships").where("organizationId", "==", org).get(),
      centre.collection("clients").where("reviewDemo", "==", true).get(),
    ]);
    const canonicalInstructorId = canonicalInstructorIdFrom(members.docs.map((document) => document.data()));
    const rows = (snapshot) => snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));

    const monthRef = centre.collection("payMonths").doc(key);
    const at = now();
    return firestore.runTransaction(async (tx) => {
      /* 원장 · 수업 · 그룹 급여도 트랜잭션 안에서 읽는다 -- 재점검 뒤에 차감 · 보정이 붙었거나 그룹 급여가 바뀌었으면
         점검 때의 지문과 달라 거절한다 (2026-11-22 검토 지적 3). 원장은 고칠 수 없어도 새 항목은 붙을 수 있다. */
      const [monthSnapshot, adjustments, salesMonths, fcMonths, tax, ledger, lessonDocs, groups] = await Promise.all([
        tx.get(monthRef),
        tx.get(centre.collection("payAdjustments").where("month", "==", key)),
        tx.get(centre.collection("salesMonths").where("month", "==", key)),
        tx.get(centre.collection("fcLessonMonths").where("month", "==", key)),
        tx.get(centre.collection("payrollSettings").doc("tax")),
        tx.get(firestore.collectionGroup("ledger").where("organizationId", "==", org).where("type", "in", PAYROLL_LEDGER_TYPES)
          .where("occurredAt", ">=", start).where("occurredAt", "<", end)),
        tx.get(centre.collection("lessons").where("startsAt", ">=", start).where("startsAt", "<", end)),
        tx.get(centre.collection("groupPayroll").doc(key).collection("locations")),
      ]);
      const groupRows = groups.docs.flatMap((document) => (document.data()?.rows || []).map((row) => ({ ...row, locationId: document.id })));
      const monthLedger = rows(ledger);
      const fingerprint = sourceFingerprint({ monthLedger, lessons: rows(lessonDocs), groupRows });
      if (checkedFingerprint && !sameFingerprint(checkedFingerprint, fingerprint)) {
        throw new PayCloseError("failed-precondition", "check_stale", { checked: checkedFingerprint, now: fingerprint });
      }
      const sourceInput = { organizationId: org, month: key, entries: monthLedger, groupRows, excludedClientIds: new Set(demoClients.docs.map((document) => document.id)) };
      const lessons = lessonTotalsByInstructor({ ...sourceInput, canonicalInstructorId });
      const sources = lessonSourceSummary(sourceInput);
      const current = monthSnapshot.exists ? monthSnapshot.data() : null;
      if (["closed", "paid"].includes(text(current?.status))) throw new PayCloseError("failed-precondition", "already_closed");
      const result = buildPayClose({
        lessons, canonicalInstructorId,
        adjustments: adjustments.docs.map((document) => ({ id: document.id, ...document.data() })),
        salesMonths: salesMonths.docs.map((document) => document.data()),
        fcMonths: fcMonths.docs.map((document) => document.data()),
        tax: tax.exists ? tax.data() : null,
      });
      if (!result.statements.length) throw new PayCloseError("failed-precondition", "nothing_to_close");
      if (Number.isFinite(Number(expectedNet)) && Math.round(Number(expectedNet)) !== result.totals.net) {
        throw new PayCloseError("failed-precondition", "totals_changed", { expectedNet: Math.round(Number(expectedNet)), serverNet: result.totals.net });
      }
      const revision = Number(current?.revision || 0) + 1;
      /* 급여 대상 원장 합 = 명세 수업료 합 이어야 한다 -- 기간 · 계정 연결 · 거르기에서 빠진 차감이 없는지 남긴다. */
      const statementLessons = result.statements.reduce((sum, item) => sum + item.snapshot.lessons, 0);
      const reconciliation = { ...sources, statementLessons, matched: statementLessons === sources.ledgerAmount + sources.groupAmount };
      if (!reconciliation.matched) throw new PayCloseError("failed-precondition", "reconcile_mismatch", { statementLessons, sourceAmount: sources.ledgerAmount + sources.groupAmount });
      tx.set(monthRef, {
        organizationId: org, month: key, status: "closed", revision, totals: result.totals,
        closedBy: text(callerUid), closedAt: at, updatedBy: text(callerUid), updatedAt: at,
      });
      for (const item of result.statements) {
        tx.set(centre.collection("payStatements").doc(`${item.instructorId}_${key}`), {
          organizationId: org, instructorId: item.instructorId, month: key, revision, ...item.snapshot, closedBy: text(callerUid), closedAt: at,
        });
      }
      tx.set(centre.collection("payCloseRuns").doc(`${key}_r${revision}`), {
        organizationId: org, month: key, revision, closedBy: text(callerUid), closedAt: at, totals: result.totals,
        statements: Object.fromEntries(result.statements.map((item) => [item.instructorId, item.snapshot])),
        sources: { ledger: ledger.size, adjustments: adjustments.size, salesMonths: salesMonths.size, fcMonths: fcMonths.size, groupLocations: groups.size },
        reconciliation, check: checkSummary, fingerprint,
        previous: current ? { status: text(current.status), revision: Number(current.revision || 0), reopenReason: text(current.reopenReason) } : null,
      });
      return { status: "closed", revision, totals: result.totals, instructors: result.statements.length };
    });
  }
  return { close };
}

module.exports = { createPayCloseService, PayCloseError };
