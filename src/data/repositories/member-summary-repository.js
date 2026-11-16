/**
 * AI 회원 요약 읽기 (설계 문서 2단계). organizations/{센터}/memberSummaries/{회원} -- 서버(Functions)만 쓴다.
 * 화면은 이 문서 하나만 읽는다. 화면을 열 때 AI 를 부르지 않는다.
 */

const load = () => import("firebase/firestore");

/** 한 회원의 요약. 없으면 null (요약 전 · 동의 없음 · 스위치 꺼짐). 담당 강사 · 대표 · 총괄만 읽힌다(규칙). */
export async function readMemberSummary(organizationId, clientId) {
  const { doc, getDoc, getFirestore } = await load();
  const snapshot = await getDoc(doc(getFirestore(), "organizations", String(organizationId), "memberSummaries", String(clientId)));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/** 대표 점검 화면: 최근에 고쳐 쓴 요약 30개. */
export async function listRecentMemberSummaries(organizationId, max = 30) {
  const { collection, getDocs, getFirestore, limit, orderBy, query } = await load();
  const snapshot = await getDocs(query(
    collection(getFirestore(), "organizations", String(organizationId), "memberSummaries"),
    orderBy("updatedAt", "desc"), limit(max),
  ));
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

/** 대표 점검 화면: 회원 이름 (화면에만, 요약 문서에는 없다). */
export async function readClientName(organizationId, clientId) {
  const { doc, getDoc, getFirestore } = await load();
  const snapshot = await getDoc(doc(getFirestore(), "organizations", String(organizationId), "clients", String(clientId)));
  return snapshot.exists() ? String(snapshot.data()?.name || "") : "";
}
