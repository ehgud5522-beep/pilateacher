/**
 * 강사 급여 명세 저장소 (2026-11-21 대표 승인). 계산은 src/features/payroll/pay-statement.js, 규칙은 firestore.foundation.rules.
 *
 *   organizations/{센터}/payAdjustments/{자동}           대표 · 총괄 조정 (+ / − · 사유). 고치지 않는다 -- 지우고 다시
 *   organizations/{센터}/payMonths/{YYYY-MM}             급여 확정 · 되돌림
 *   organizations/{센터}/payStatements/{강사}_{YYYY-MM}  확정 때 남기는 세전 · 세금 · 실수령
 *   organizations/{센터}/payrollSettings/tax             3.3% 를 떼지 않는 강사
 */
import { readCollection } from "./repository-read.js";

const load = () => import("firebase/firestore");
const text = (value) => String(value ?? "").trim();
const org = (organizationId) => String(organizationId);
export const payStatementId = (instructorId, month) => `${text(instructorId)}_${text(month)}`;

/** 대표 · 총괄: 그 달 센터 전체 조정. */
export function listPayAdjustments(organizationId, month) {
  return readCollection({
    feature: "pay_adjustments",
    path: `organizations/${organizationId}/payAdjustments?month=${month}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(collection(getFirestore(), "organizations", org(organizationId), "payAdjustments"), where("month", "==", String(month))));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },
  });
}

/** 강사: 그 달 내 조정 (사유 포함). */
export function listMyPayAdjustments(organizationId, instructorId, month) {
  return readCollection({
    feature: "pay_adjustments",
    path: `organizations/${organizationId}/payAdjustments?instructorId=me&month=${month}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(
        collection(getFirestore(), "organizations", org(organizationId), "payAdjustments"),
        where("instructorId", "==", String(instructorId)), where("month", "==", String(month)),
      ));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },
  });
}

export async function addPayAdjustment(organizationId, { instructorId, month, amount, reason }, { uid }) {
  const { addDoc, collection, getFirestore, serverTimestamp } = await load();
  const reference = await addDoc(collection(getFirestore(), "organizations", org(organizationId), "payAdjustments"), {
    organizationId: org(organizationId), instructorId: text(instructorId), month: text(month),
    amount: Math.round(Number(amount) || 0), reason: text(reason).slice(0, 100),
    createdBy: String(uid), createdAt: serverTimestamp(),
  });
  return reference.id;
}

/** 취소 기록 -- 지우지 않는다 (2026-11-22 외부 검토 2차). 금액 · 사유 · 넣은 사람은 남고 계산에서만 빠진다. */
export async function cancelPayAdjustment(organizationId, adjustmentId, reason, { uid }) {
  const { doc, getFirestore, serverTimestamp, updateDoc } = await load();
  await updateDoc(doc(getFirestore(), "organizations", org(organizationId), "payAdjustments", String(adjustmentId)), {
    canceledBy: String(uid), canceledAt: serverTimestamp(), cancelReason: text(reason).slice(0, 100),
  });
}

export async function readPayMonth(organizationId, month) {
  const { doc, getDoc, getFirestore } = await load();
  const snapshot = await getDoc(doc(getFirestore(), "organizations", org(organizationId), "payMonths", String(month)));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function readPayStatement(organizationId, instructorId, month) {
  const { doc, getDoc, getFirestore } = await load();
  const snapshot = await getDoc(doc(getFirestore(), "organizations", org(organizationId), "payStatements", payStatementId(instructorId, month)));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/* 급여 확정은 서버 함수 closePayMonth 만 한다 (lib/firebase.js 의 fbClosePayMonth) -- 서버가 원자료로 다시 계산하고 회차 이력을 남긴다. */

/** 대표 · 총괄: 확정 되돌림 (사유). 회차 · 합계는 그대로 둔다 -- 규칙이 그 칸을 못 건드리게 막는다. */
export async function reopenPayMonth(organizationId, month, reason, { uid }) {
  const { doc, getFirestore, serverTimestamp, updateDoc } = await load();
  await updateDoc(doc(getFirestore(), "organizations", org(organizationId), "payMonths", String(month)), {
    status: "reopened", reopenReason: text(reason).slice(0, 200), updatedBy: String(uid), updatedAt: serverTimestamp(),
  });
}

/** 대표 · 총괄: 지급 완료 표시 (확정된 달에서만). */
export async function markPayMonthPaid(organizationId, month, { uid }) {
  const { doc, getFirestore, serverTimestamp, updateDoc } = await load();
  await updateDoc(doc(getFirestore(), "organizations", org(organizationId), "payMonths", String(month)), {
    status: "paid", paidBy: String(uid), paidAt: serverTimestamp(), updatedBy: String(uid), updatedAt: serverTimestamp(),
  });
}

/** 대표 · 총괄: 그 달 확정 회차 이력 (되돌려도 남는다). */
export function listPayCloseRuns(organizationId, month) {
  return readCollection({
    feature: "pay_close_runs",
    path: `organizations/${organizationId}/payCloseRuns?month=${month}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(collection(getFirestore(), "organizations", org(organizationId), "payCloseRuns"), where("month", "==", String(month))));
      return snapshot.docs.map((item) => /** @type {any} */ ({ id: item.id, ...item.data() })).sort((left, right) => Number(right.revision || 0) - Number(left.revision || 0));
    },
  });
}

export async function readPayTaxSettings(organizationId) {
  const { doc, getDoc, getFirestore } = await load();
  const snapshot = await getDoc(doc(getFirestore(), "organizations", org(organizationId), "payrollSettings", "tax"));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function savePayTaxSettings(organizationId, noTaxIds, { uid }) {
  const { doc, getFirestore, serverTimestamp, setDoc } = await load();
  await setDoc(doc(getFirestore(), "organizations", org(organizationId), "payrollSettings", "tax"), {
    organizationId: org(organizationId), noTaxIds: [...new Set((noTaxIds || []).map(text).filter(Boolean))].slice(0, 200),
    updatedBy: String(uid), updatedAt: serverTimestamp(),
  });
}

/** 대표 · 총괄: 확정 때 남긴 그 달 강사별 명세. */
export function listPayStatements(organizationId, month) {
  return readCollection({
    feature: "pay_statements",
    path: `organizations/${organizationId}/payStatements?month=${month}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(collection(getFirestore(), "organizations", org(organizationId), "payStatements"), where("month", "==", String(month))));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },
  });
}

/* ── 정산 점검 (2026-11-22) ── 결과는 서버가 쓴다(payCheckNightly · runPayCheck · closePayMonth). 앱은 읽고, 확인함만 남긴다. */
export async function readPayCheck(organizationId, month) {
  const { doc, getDoc, getFirestore } = await load();
  const snapshot = await getDoc(doc(getFirestore(), "organizations", org(organizationId), "payChecks", String(month)));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export function listPayCheckAcks(organizationId, month) {
  return readCollection({
    feature: "pay_check_acks",
    path: `organizations/${organizationId}/payCheckAcks?month=${month}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(collection(getFirestore(), "organizations", org(organizationId), "payCheckAcks"), where("month", "==", String(month))));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },
  });
}

/** 대표 · 총괄: 점검 항목 확인함 (사유). 그때의 내용(signature)을 함께 남겨, 내용이 바뀌면 다시 뜬다. */
export async function savePayCheckAck(organizationId, month, item, reason, { uid }) {
  const { doc, getFirestore, serverTimestamp, setDoc } = await load();
  const key = text(item?.key);
  await setDoc(doc(getFirestore(), "organizations", org(organizationId), "payCheckAcks", `${text(month)}__${key.replaceAll("/", "_")}`), {
    organizationId: org(organizationId), month: text(month), key, kind: text(item?.kind), signature: text(item?.signature),
    reason: text(reason).slice(0, 200), ackedBy: String(uid), ackedAt: serverTimestamp(),
  });
}
