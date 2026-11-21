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

/** 지우기 -- 대표가 [정말 지우기] 를 눌렀을 때만. */
export async function deletePayAdjustment(organizationId, adjustmentId) {
  const { deleteDoc, doc, getFirestore } = await load();
  await deleteDoc(doc(getFirestore(), "organizations", org(organizationId), "payAdjustments", String(adjustmentId)));
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

/**
 * 대표 · 총괄: 급여 확정. 달 문서와 강사별 명세를 한 번에 쓴다 (규칙은 달이 아직 닫히지 않았을 때만 명세를 받는다).
 * @param {string} organizationId
 * @param {string} month
 * @param {{ instructorId: string, snapshot: any }[]} statements  statementSnapshot(payStatementOf(...))
 * @param {{ uid: string }} actor
 */
export async function closePayMonth(organizationId, month, statements, { uid }) {
  const { doc, getFirestore, serverTimestamp, writeBatch } = await load();
  const db = getFirestore();
  const batch = writeBatch(db);
  batch.set(doc(db, "organizations", org(organizationId), "payMonths", String(month)), {
    organizationId: org(organizationId), month: String(month), status: "closed",
    closedBy: String(uid), closedAt: serverTimestamp(), updatedBy: String(uid), updatedAt: serverTimestamp(),
  });
  for (const item of statements || []) {
    batch.set(doc(db, "organizations", org(organizationId), "payStatements", payStatementId(item.instructorId, month)), {
      organizationId: org(organizationId), instructorId: text(item.instructorId), month: String(month), ...item.snapshot,
      closedBy: String(uid), closedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function reopenPayMonth(organizationId, month, reason, { uid }) {
  const { doc, getFirestore, serverTimestamp, setDoc } = await load();
  await setDoc(doc(getFirestore(), "organizations", org(organizationId), "payMonths", String(month)), {
    organizationId: org(organizationId), month: String(month), status: "reopened", reopenReason: text(reason).slice(0, 200),
    updatedBy: String(uid), updatedAt: serverTimestamp(),
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
