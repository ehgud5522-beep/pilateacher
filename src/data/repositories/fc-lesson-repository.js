/**
 * 강사 FC 복지 수업료 저장소 (2026-11-21 대표 결정). 계산 · 한도는 functions/shared/fc-lessons.mjs.
 *
 *   organizations/{센터}/fcLessons/{자동 id}                수업 한 줄 (지정된 강사가 자기 것만)
 *   organizations/{센터}/fcLessonDesignations/{YYYY-MM}     그 달 FC 수업 지정 강사 (대표 · 총괄)
 *   organizations/{센터}/fcLessonMonths/{강사}_{YYYY-MM}    강사 제출 · 서버 확정 · 되돌림
 *
 * 확정은 여기 없다 -- 서버 함수 confirmFcLessonMonth(lib/firebase.js 의 fbConfirmFcLessonMonth)만 한다.
 */
import { readCollection } from "./repository-read.js";

const load = () => import("firebase/firestore");
const text = (value) => String(value ?? "").trim();
export const fcLessonMonthId = (instructorId, month) => `${text(instructorId)}_${text(month)}`;

/** 그 달 센터 전체 FC 수업 (FC 별 남은 횟수를 세려고 -- 규칙이 직원 모두에게 연다). */
export function listFcLessonsOfMonth(organizationId, month) {
  return readCollection({
    feature: "fc_lessons",
    path: `organizations/${organizationId}/fcLessons?month=${month}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(collection(getFirestore(), "organizations", String(organizationId), "fcLessons"), where("month", "==", String(month))));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },
  });
}

const lessonData = (entry) => ({
  fcUserId: text(entry.fcUserId), month: text(entry.month), lessonDate: text(entry.lessonDate),
  outcome: text(entry.outcome) === "cancel" ? "cancel" : "done", note: text(entry.note).slice(0, 100),
});

export async function addFcLesson(organizationId, entry, { uid }) {
  const { addDoc, collection, getFirestore, serverTimestamp } = await load();
  const reference = await addDoc(collection(getFirestore(), "organizations", String(organizationId), "fcLessons"), {
    organizationId: String(organizationId), instructorId: String(uid), ...lessonData(entry),
    createdBy: String(uid), createdAt: serverTimestamp(), updatedBy: String(uid), updatedAt: serverTimestamp(),
  });
  return reference.id;
}

export async function updateFcLesson(organizationId, lessonId, entry, { uid }) {
  const { doc, getFirestore, serverTimestamp, updateDoc } = await load();
  await updateDoc(doc(getFirestore(), "organizations", String(organizationId), "fcLessons", String(lessonId)), {
    ...lessonData(entry), updatedBy: String(uid), updatedAt: serverTimestamp(),
  });
}

/** 지우기 -- 사용자가 [지우기] 를 두 번 눌렀을 때만 (CLAUDE.md 5). */
export async function deleteFcLesson(organizationId, lessonId) {
  const { deleteDoc, doc, getFirestore } = await load();
  await deleteDoc(doc(getFirestore(), "organizations", String(organizationId), "fcLessons", String(lessonId)));
}

/** 그 달 지정 강사 문서 (없으면 null = 아무도 지정 안 됨). */
export async function readFcDesignation(organizationId, month) {
  const { doc, getDoc, getFirestore } = await load();
  const snapshot = await getDoc(doc(getFirestore(), "organizations", String(organizationId), "fcLessonDesignations", String(month)));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/**
 * 대표 · 총괄: 그 달 지정 강사 + 그 달 FC 명단 저장 (통째로). 강사는 소속 명단을 못 읽으므로 FC 이름을 여기에 함께 둔다.
 * @param {string} organizationId
 * @param {string} month
 * @param {{ instructorIds: string[], fcs: Array<{ userId: string, name: string }> }} designation
 * @param {{ uid: string }} actor
 */
export async function saveFcDesignation(organizationId, month, { instructorIds, fcs }, { uid }) {
  const { doc, getFirestore, serverTimestamp, setDoc } = await load();
  const fcList = (fcs || []).filter((item) => text(item?.userId)).slice(0, 100);
  await setDoc(doc(getFirestore(), "organizations", String(organizationId), "fcLessonDesignations", String(month)), {
    organizationId: String(organizationId), month: String(month),
    instructorIds: [...new Set((instructorIds || []).map(text).filter(Boolean))].slice(0, 200),
    fcUserIds: fcList.map((item) => text(item.userId)),
    fcNames: Object.fromEntries(fcList.map((item) => [text(item.userId), text(item.name).slice(0, 40) || "FC"])),
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

async function writeMonth(organizationId, instructorId, month, fields, uid) {
  const { doc, getFirestore, serverTimestamp, setDoc } = await load();
  const stamp = {};
  for (const [key, value] of Object.entries(fields)) stamp[key] = value === "now" ? serverTimestamp() : value;
  await setDoc(doc(getFirestore(), "organizations", String(organizationId), "fcLessonMonths", fcLessonMonthId(instructorId, month)), {
    organizationId: String(organizationId), instructorId: String(instructorId), month: String(month), ...stamp,
    updatedBy: String(uid), updatedAt: serverTimestamp(),
  });
}

export const submitFcLessonMonth = (organizationId, instructorId, month, { uid }) => writeMonth(organizationId, instructorId, month, { status: "submitted", submittedAt: "now" }, uid);
export const reopenFcLessonMonth = (organizationId, instructorId, month, reason, { uid }) => writeMonth(organizationId, instructorId, month, { status: "reopened", reopenReason: text(reason).slice(0, 200) }, uid);
