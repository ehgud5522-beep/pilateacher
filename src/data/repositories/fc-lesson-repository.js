/**
 * 강사 FC 복지 수업료 저장소 (2026-11-21 대표 결정 · 횟수만 · 지점마다 한 명). 계산은 functions/shared/fc-lessons.mjs.
 *
 *   organizations/{센터}/fcLessonDesignations/{YYYY-MM}    그 달 지점마다 강사 한 명 (branches) -- 대표 · 총괄
 *   organizations/{센터}/fcLessonMonths/{강사}_{YYYY-MM}   진행 · 캔슬 횟수 (강사 제출) · 서버 확정 · 되돌림
 *
 * 확정은 여기 없다 -- 서버 함수 confirmFcLessonMonth(lib/firebase.js 의 fbConfirmFcLessonMonth)만 한다.
 */
import { readCollection } from "./repository-read.js";

const load = () => import("firebase/firestore");
const text = (value) => String(value ?? "").trim();
const count = (value) => { const number = Math.round(Number(value) || 0); return number > 0 ? number : 0; };
export const fcLessonMonthId = (instructorId, month) => `${text(instructorId)}_${text(month)}`;

/** 그 달 지정 문서 (없으면 null = 아무도 지정 안 됨). */
export async function readFcDesignation(organizationId, month) {
  const { doc, getDoc, getFirestore } = await load();
  const snapshot = await getDoc(doc(getFirestore(), "organizations", String(organizationId), "fcLessonDesignations", String(month)));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/**
 * 대표 · 총괄: 그 달 지점마다 강사 한 명 저장 (통째로). 빈 지점은 빼고, instructorIds 는 규칙이 쓰는 목록이다.
 * @param {string} organizationId
 * @param {string} month
 * @param {Record<string, string>} branches  { 지점 id: 강사 uid }
 * @param {{ uid: string }} actor
 */
export async function saveFcDesignation(organizationId, month, branches, { uid }) {
  const { doc, getFirestore, serverTimestamp, setDoc } = await load();
  const clean = Object.fromEntries(Object.entries(branches || {}).map(([branch, id]) => [text(branch), text(id)]).filter(([branch, id]) => branch && id)).valueOf();
  await setDoc(doc(getFirestore(), "organizations", String(organizationId), "fcLessonDesignations", String(month)), {
    organizationId: String(organizationId), month: String(month),
    branches: clean, instructorIds: [...new Set(Object.values(clean))],
    updatedBy: String(uid), updatedAt: serverTimestamp(),
  });
}

export async function readFcLessonMonth(organizationId, instructorId, month) {
  const { doc, getDoc, getFirestore } = await load();
  const snapshot = await getDoc(doc(getFirestore(), "organizations", String(organizationId), "fcLessonMonths", fcLessonMonthId(instructorId, month)));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export function listFcLessonMonths(organizationId, month) {
  return readCollection({
    feature: "fc_lessons",
    path: `organizations/${organizationId}/fcLessonMonths?month=${month}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(collection(getFirestore(), "organizations", String(organizationId), "fcLessonMonths"), where("month", "==", String(month))));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },
  });
}

/** 지정 강사: 그 달 진행 · 캔슬 횟수 저장 = 제출. 확정 전까지 다시 저장할 수 있다. */
export async function saveFcCounts(organizationId, instructorId, month, { done, cancel }, { uid }) {
  const { doc, getFirestore, serverTimestamp, setDoc } = await load();
  await setDoc(doc(getFirestore(), "organizations", String(organizationId), "fcLessonMonths", fcLessonMonthId(instructorId, month)), {
    organizationId: String(organizationId), instructorId: String(instructorId), month: String(month),
    status: "submitted", done: count(done), cancel: count(cancel), submittedAt: serverTimestamp(),
    updatedBy: String(uid), updatedAt: serverTimestamp(),
  });
}

/** FC · 대표 · 총괄: 확정 되돌림 (사유 필수, 횟수는 그대로 -- 규칙이 같은 값인지 본다). */
export async function reopenFcLessonMonth(organizationId, instructorId, month, { done, cancel }, reason, { uid }) {
  const { doc, getFirestore, serverTimestamp, setDoc } = await load();
  await setDoc(doc(getFirestore(), "organizations", String(organizationId), "fcLessonMonths", fcLessonMonthId(instructorId, month)), {
    organizationId: String(organizationId), instructorId: String(instructorId), month: String(month),
    status: "reopened", done: count(done), cancel: count(cancel), reopenReason: text(reason).slice(0, 200),
    updatedBy: String(uid), updatedAt: serverTimestamp(),
  });
}
