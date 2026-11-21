"use strict";

/**
 * 정산 점검 서버 (2026-11-22 대표 승인 · 외부 검토 반영). 판정은 shared/pay-check.mjs.
 *
 *   - 밤마다(payCheckNightly) 센터마다 이번 달 -- 15일까지는 지난달도 (급여 지급 전) -- 점검해 payChecks/{달} 에 덮어쓴다.
 *     같은 문제가 밤마다 새 건으로 쌓이지 않는다 (달마다 문서 하나, 항목은 고정 key).
 *   - 대표가 [다시 점검] 을 누르면(runPayCheck) 지금 바로.
 *   - 급여 확정(closePayMonth) 직전에 그 달을 다시 점검한다 -- 밤 결과만으로 확정하지 않는다.
 *
 * pass-reconcile-nightly.js 는 "결과 문서를 쓰지 않는다" 고 적었다 -- 어젯밤 숫자와 지금 숫자가 둘로 보이기 때문.
 * 여기서는 카드에 점검 시각을 꼭 보이고 [다시 점검] 과 확정 직전 재점검을 붙여 그 문제를 푼다.
 * 회원 이름은 쓰지 않는다 (id 만, 대표 화면이 이름을 붙인다).
 */

const text = (value) => String(value ?? "").trim();
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const loadCheck = () => import("../shared/pay-check.mjs");
const loadClose = () => import("../shared/pay-close.mjs");
const loadSwap = () => import("../shared/instructor-swap.mjs");

class PayCheckError extends Error {
  constructor(httpsCode, reason, details = {}) {
    super(reason);
    this.httpsCode = httpsCode;
    this.reason = reason;
    this.details = details;
  }
}

/** runtimeConfig/scheduleSync 의 켜짐 판정 (src/features/schedule/sync-switch.js 와 같은 규칙). */
function syncEnabledFor(raw, userId) {
  const mode = text(raw?.mode);
  if (mode === "all") return true;
  if (mode === "listed") return (Array.isArray(raw?.userIds) ? raw.userIds : []).map(text).includes(text(userId));
  return false;
}

function createPayCheckService({ firestore, membershipId, isOwnerLevel, now = () => new Date() }) {
  /** 한 센터 · 한 달 점검. 읽기 하나가 실패해도 나머지는 돌고, 실패는 failures 에 원본 코드로. */
  async function check(organizationId, month, trigger) {
    const [{ runPayCheck, withAcks }, { kstMonthRange, PAYROLL_LEDGER_TYPES }, { canonicalInstructorIdFrom }] = await Promise.all([loadCheck(), loadClose(), loadSwap()]);
    const org = text(organizationId);
    const centre = firestore.collection("organizations").doc(org);
    const { start, end } = kstMonthRange(month);
    const failures = [];
    const read = async (source, work, fallback) => {
      try { return await work(); } catch (error) { failures.push({ source, code: String(error?.code || "unknown") }); return fallback; }
    };
    const rows = (snapshot) => snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    const [lessons, monthLedger, passes, passLedger, members, syncDoc, acks] = await Promise.all([
      read("lessons", async () => rows(await centre.collection("lessons").where("startsAt", ">=", start).where("startsAt", "<", end).get()), []),
      read("ledger_month", async () => rows(await firestore.collectionGroup("ledger").where("organizationId", "==", org).where("type", "in", PAYROLL_LEDGER_TYPES)
        .where("occurredAt", ">=", start).where("occurredAt", "<", end).get()), []),
      read("passes", async () => rows(await centre.collection("passes").get()), []),
      read("ledger_all", async () => rows(await firestore.collectionGroup("ledger").where("organizationId", "==", org).get()), []),
      read("memberships", async () => rows(await firestore.collection("memberships").where("organizationId", "==", org).get()), []),
      read("schedule_sync", async () => { const snapshot = await firestore.collection("runtimeConfig").doc("scheduleSync").get(); return snapshot.exists ? snapshot.data() : {}; }, null),
      read("acks", async () => rows(await centre.collection("payCheckAcks").where("month", "==", month).get()), []),
    ]);
    const canonicalInstructorId = canonicalInstructorIdFrom(members);
    const teaching = [...new Set(monthLedger.map((entry) => text(entry.instructorId)).filter(Boolean))];
    const result = runPayCheck({
      organizationId: org, month, now: now(), lessons, monthLedger, passes, passLedger, failures, canonicalInstructorId,
      syncedInstructorIds: syncDoc ? new Set(teaching.map((id) => canonicalInstructorId(id)).filter((id) => syncEnabledFor(syncDoc, id))) : null,
      activeInstructorIds: teaching,
    });
    const at = now();
    const stored = { organizationId: org, month, trigger: text(trigger), checkedAt: at, ...result };
    await centre.collection("payChecks").doc(month).set(stored);
    return withAcks(stored, acks);
  }

  async function authorize(org, callerUid) {
    if (!callerUid) throw new PayCheckError("unauthenticated", "unauthenticated");
    const caller = await firestore.collection("memberships").doc(membershipId(org, callerUid)).get();
    if (!caller.exists || caller.data()?.status !== "active" || !isOwnerLevel(caller.data())) throw new PayCheckError("permission-denied", "not_checker");
  }

  /** 대표 · 총괄의 [다시 점검]. */
  async function runNow({ callerUid, organizationId, month }) {
    const org = text(organizationId);
    const key = text(month);
    if (!org || org.includes("/") || !MONTH.test(key)) throw new PayCheckError("invalid-argument", "target_required");
    await authorize(org, callerUid);
    const result = await check(org, key, "manual");
    return { complete: result.complete, counts: result.counts, openBlocks: result.openBlocks, openWarns: result.openWarns, failures: result.failures };
  }

  return { check, runNow };
}

/** 한국 시각 이번 달 · (15일까지) 지난달. */
function nightlyMonths(at) {
  const kst = new Date(at.getTime() + 9 * 3600000);
  const year = kst.getUTCFullYear();
  const monthIndex = kst.getUTCMonth();
  const key = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
  const months = [key(year, monthIndex)];
  if (kst.getUTCDate() <= 15) months.push(monthIndex === 0 ? key(year - 1, 11) : key(year, monthIndex - 1));
  return months;
}

module.exports = { createPayCheckService, PayCheckError, nightlyMonths };
