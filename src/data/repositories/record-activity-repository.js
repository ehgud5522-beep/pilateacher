/**
 * 강사 기록 현황 저장소 (2026-11-21). 화면 · 판정은 features/records/record-activity.js.
 *
 * 쓰기: 강사 폰이 자기 칸(organizations/{센터}/recordActivity/{uid}_{YYYY-MM})에 숫자만.
 * 읽기: 대표 · 총괄 -- 기기 보고 · 이 달 원장 · 회원에게 보낸 말.
 */

/* features/records/record-activity.js 와 같은 값. 그 모듈을 불러오면 수업기록 화면 코드까지 타입 검사
   범위(jsconfig.foundation.json 의 src/data)로 끌려 들어온다 -- 테스트가 두 값이 같은지 본다. */
export const RECORD_ACTIVITY_COLLECTION = "recordActivity";
export const recordActivityId = (uid, month) => `${String(uid ?? "").trim()}_${String(month ?? "").trim()}`;
import { readCollection } from "./repository-read.js";

const load = () => import("firebase/firestore");

/** 강사 폰: 내 칸에 이 달 숫자. 같은 달은 덮어쓴다 (최신 숫자 하나). */
export async function writeRecordActivity(document) {
  const { doc, getFirestore, serverTimestamp, setDoc } = await load();
  await setDoc(
    doc(getFirestore(), "organizations", document.organizationId, RECORD_ACTIVITY_COLLECTION, recordActivityId(document.userId, document.month)),
    { ...document, checkedAt: serverTimestamp() },
  );
}

/** 대표 화면: 한 달의 기기 보고 전부. */
export function listRecordActivity(organizationId, month) {
  return readCollection({
    feature: "instructor_record_board",
    path: `organizations/${organizationId}/${RECORD_ACTIVITY_COLLECTION}?month=${month}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(
        collection(getFirestore(), "organizations", String(organizationId), RECORD_ACTIVITY_COLLECTION),
        where("month", "==", String(month)),
      ));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },
  });
}

/**
 * 대표 화면: 이 기간에 만든 회원에게 보낸 말. 수업 날짜가 아니라 만든 시각이라 앞뒤로 며칠 넓혀 읽고,
 * 맞추기는 수업 · 회원(문서 id)으로 한다 -- 넓게 읽어도 차감과 짝이 맞는 것만 센다.
 */
export function listLessonNotesBetween(organizationId, start, end) {
  return readCollection({
    feature: "instructor_record_board",
    path: `organizations/${organizationId}/lessonNotes?createdAt`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(
        collection(getFirestore(), "organizations", String(organizationId), "lessonNotes"),
        where("createdAt", ">=", start),
        where("createdAt", "<", end),
      ));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },
  });
}
