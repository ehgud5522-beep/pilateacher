/**
 * 보니따 공지 팝업 읽고 쓰기 (대표 화면). **판정은 `functions/shared/member-notice.mjs`.**
 *
 * 문서 하나: organizations/{센터}/memberNotices/popup. 규칙이 대표 · 총괄의 직접 쓰기를 연다 --
 * 이 글에는 작성자 이름이 회원에게 나가지 않으므로 서버 함수를 거칠 까닭이 없다.
 */

import { MEMBER_NOTICE_DOC_ID, memberNoticeError } from "../../../functions/shared/member-notice.mjs";

export {
  MEMBER_NOTICE_BODY_MAX, MEMBER_NOTICE_ERROR_TEXT, MEMBER_NOTICE_IMAGE_MAX, MEMBER_NOTICE_TITLE_MAX,
  memberNoticeError, memberNoticeLive,
} from "../../../functions/shared/member-notice.mjs";

const text = (value) => String(value ?? "").trim();

export const memberNoticePath = (organizationId) => `organizations/${text(organizationId)}/memberNotices/${MEMBER_NOTICE_DOC_ID}`;

export function createFirestoreMemberNoticeStore() {
  const load = () => import("firebase/firestore");
  return {
    read: async (path) => {
      const { doc, getDoc, getFirestore } = await load();
      const snapshot = await getDoc(doc(getFirestore(), path));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    },
    write: async (path, value) => {
      const { doc, getFirestore, serverTimestamp, setDoc } = await load();
      const { getAuth } = await import("firebase/auth");
      await setDoc(doc(getFirestore(), path), {
        ...value, updatedAt: serverTimestamp(), updatedBy: getAuth().currentUser?.uid || "",
      });
    },
  };
}

export async function readMemberNotice(organizationId, { store = createFirestoreMemberNoticeStore() } = {}) {
  if (!text(organizationId)) throw new Error("Missing organizationId");
  return store.read(memberNoticePath(organizationId));
}

/** 저장 전에 화면이 먼저 본다. 규칙이 다시 본다. 거절은 code 를 가진 오류. */
export async function saveMemberNotice(organizationId, value, { store = createFirestoreMemberNoticeStore() } = {}) {
  if (!text(organizationId)) throw new Error("Missing organizationId");
  const clean = {
    organizationId: text(organizationId),
    title: text(value?.title),
    body: String(value?.body ?? "").trim(),
    image: String(value?.image ?? ""),
    active: value?.active === true,
    endsOn: text(value?.endsOn),
  };
  const refused = memberNoticeError(clean);
  if (refused) throw Object.assign(new Error(refused), { code: refused });
  await store.write(memberNoticePath(organizationId), clean);
  return clean;
}
