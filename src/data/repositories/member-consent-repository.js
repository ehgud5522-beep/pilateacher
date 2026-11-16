/**
 * 회원 단위 수업기록 서버 보관 · AI 처리 동의 (설계 결정 4). 요약 저장소(member-summary-repository.js)는 읽기만 하므로
 * 쓰기는 이 파일에 따로 둔다.
 */

const load = () => import("firebase/firestore");

/**
 * 회원 단위 동의 쓰기 (결정 4). clients/{회원}.aiConsent 한 칸만 바꾼다. 규칙이 모양 · 쓴 사람 · 서버 시각을 본다.
 * @param {string} organizationId @param {string} clientId @param {{ granted: boolean, uid: string, version: string }} input
 */
export async function writeMemberDataConsent(organizationId, clientId, { granted, uid, version }) {
  const { doc, getFirestore, serverTimestamp, updateDoc } = await load();
  const at = serverTimestamp();
  await updateDoc(doc(getFirestore(), "organizations", String(organizationId), "clients", String(clientId)), {
    aiConsent: granted
      ? { status: "granted", version: String(version), grantedAt: at, grantedBy: String(uid), method: "instructor_confirmed" }
      : { status: "revoked", version: String(version), revokedAt: at, revokedBy: String(uid), method: "instructor_confirmed" },
  });
}
