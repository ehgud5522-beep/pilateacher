/**
 * 회원 단위 수업기록 서버 보관 · AI 처리 동의 (설계 결정 4). 요약 저장소(member-summary-repository.js)는 읽기만 하므로
 * 쓰기는 이 파일에 따로 둔다.
 */

const load = () => import("firebase/firestore");

/**
 * 회원 단위 동의 쓰기 (결정 4). clients/{회원}.aiConsent 한 칸만 바꾼다. 규칙이 모양 · 쓴 사람 · 서버 시각을 본다.
 * @param {string} organizationId @param {string} clientId @param {{ granted: boolean, uid: string, version: string }} input
 */
/**
 * 회원 목표 · 통증 · 주의사항을 센터 회원 문서에 (설계 결정 2). 동의한 회원만 -- 규칙이 aiConsent 를 본다.
 * 기기의 값이 기준이다: 강사가 고칠 때마다 덮어쓴다. 대타 강사 · 새 폰의 브리핑이 이것을 읽는다.
 */
export async function writeMemberCareNotes(organizationId, clientId, { goal, focus, uid }) {
  const { doc, getFirestore, serverTimestamp, updateDoc } = await load();
  await updateDoc(doc(getFirestore(), "organizations", String(organizationId), "clients", String(clientId)), {
    careNotes: {
      goal: String(goal || "").trim().slice(0, 500),
      focus: (Array.isArray(focus) ? focus : []).map((item) => String(item || "").trim().slice(0, 200)).filter(Boolean).slice(0, 10),
      updatedAt: serverTimestamp(),
      updatedBy: String(uid),
    },
  });
}

export async function writeMemberDataConsent(organizationId, clientId, { granted, uid, version }) {
  const { doc, getFirestore, serverTimestamp, updateDoc } = await load();
  const at = serverTimestamp();
  await updateDoc(doc(getFirestore(), "organizations", String(organizationId), "clients", String(clientId)), {
    aiConsent: granted
      ? { status: "granted", version: String(version), grantedAt: at, grantedBy: String(uid), method: "instructor_confirmed" }
      : { status: "revoked", version: String(version), revokedAt: at, revokedBy: String(uid), method: "instructor_confirmed" },
  });
}
