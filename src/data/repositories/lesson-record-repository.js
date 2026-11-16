/**
 * 수업기록 서버 저장소 (설계 문서 1단계). organizations/{센터}/lessonRecords/{기록ID}.
 *
 * 쓰기는 새 줄만(create) -- 규칙이 고치기 · 지우기를 막는다. createdAt 은 서버 시각이어야 한다(규칙).
 * 읽기는 회원을 고정한 질의만 -- 규칙이 회원 문서의 담당 강사를 보고 판정하기 때문이다.
 */

const load = () => import("firebase/firestore");

export function createFirestoreLessonRecordStore() {
  return {
    read: async (documentPath) => {
      const { doc, getDoc, getFirestore } = await load();
      const snapshot = await getDoc(doc(getFirestore(), documentPath));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    },
    create: async (documentPath, data) => {
      const { doc, getFirestore, serverTimestamp, setDoc } = await load();
      await setDoc(doc(getFirestore(), documentPath), { ...data, createdAt: serverTimestamp() });
    },
    /** 한 회원의 서버 기록 (1단계-4 비교 · 1단계-5 읽기 전환에서 쓴다). */
    listForClient: async (organizationId, clientId) => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(
        collection(getFirestore(), "organizations", String(organizationId), "lessonRecords"),
        where("clientId", "==", String(clientId)),
      ));
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    },
  };
}

/** 비교 결과(숫자만)를 내 칸에. 대표 · 총괄이 강사별로 읽는다 (1단계-4). */
export async function writeLessonRecordParity(organizationId, userId, row) {
  const { doc, getFirestore, serverTimestamp, setDoc } = await load();
  await setDoc(doc(getFirestore(), "organizations", String(organizationId), "lessonRecordParity", String(userId)), {
    userId: String(userId),
    device: Number(row.device) | 0, server: Number(row.server) | 0, missing: Number(row.missing) | 0,
    waiting: Number(row.waiting) | 0, extra: Number(row.extra) | 0,
    checkedAt: serverTimestamp(), appBuild: String(row.appBuild || "").slice(0, 40),
  });
}

/** 대표 화면: 강사별 비교 결과. */
export async function listLessonRecordParity(organizationId) {
  const { collection, getDocs, getFirestore } = await load();
  const snapshot = await getDocs(collection(getFirestore(), "organizations", String(organizationId), "lessonRecordParity"));
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}
