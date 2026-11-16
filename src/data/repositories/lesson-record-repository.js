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
