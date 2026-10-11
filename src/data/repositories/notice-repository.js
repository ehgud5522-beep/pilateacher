/**
 * 공지사항 읽고 쓰기. **판정은 `functions/shared/notices.mjs` 에 있다.**
 *
 * 여기 있는 것은 Firestore 를 만지는 부분뿐이다 -- 누구에게 보이는지, 어느
 * 순서로 뜨는지, 무엇이 성립하는 글인지는 전부 저쪽이고, 앱과 서버가 같은
 * 답을 내려면 그래야 한다.
 */

import { paths } from "../schema/paths.js";
import { readCollection } from "./repository-read.js";
import {
  NOTICE_STATUS, noticeError, noticeReadId,
} from "../../../functions/shared/notices.mjs";

export {
  NOTICE_STATUS, NOTICE_BODY_MAX, NOTICE_TITLE_MAX,
  noticeError, noticeInWindow, noticeReadId, noticeReadSummary, noticeTargets, pendingNotices,
} from "../../../functions/shared/notices.mjs";

const text = (value) => String(value ?? "").trim();
const requiredText = (value, label) => {
  const found = text(value);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
};
const cleanList = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

export function createFirestoreNoticeStore() {
  const load = () => import("firebase/firestore");
  return {
    list: async (collectionPath) => {
      const { collection, getDocs, getFirestore } = await load();
      const snapshot = await getDocs(collection(getFirestore(), collectionPath));
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    },
    commit: async (writes) => {
      const { doc, getFirestore, setDoc, updateDoc } = await load();
      for (const write of writes) {
        const reference = doc(getFirestore(), write.path);
        if (write.operation === "update") await updateDoc(reference, write.data);
        else await setDoc(reference, write.data);
      }
    },
    /* 문서 하나 읽기. 내 읽음 기록은 이 길로만 온다 -- 목록(list)은 대표만
       읽을 수 있고(규칙), 강사에게 필요한 것은 "내가 봤나" 뿐이다. */
    read: async (documentPath) => {
      const { doc, getDoc, getFirestore } = await load();
      const snapshot = await getDoc(doc(getFirestore(), documentPath));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    },
    serverTimestamp: async () => (await load()).serverTimestamp(),
    newId: () => globalThis.crypto?.randomUUID?.() || `notice-${Date.now()}`,
  };
}

const noticesCollection = (organizationId) => paths.notices(organizationId);
const readsCollection = (organizationId, noticeId) => paths.noticeReads(organizationId, noticeId);

/** 이 센터의 공지 전부. 거르는 것은 부르는 쪽이다 (pendingNotices). */
export async function listNotices(organizationId, options = {}) {
  const { store = createFirestoreNoticeStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  return readCollection({
    feature: "notices",
    path: noticesCollection(organization),
    read: (path) => store.list(path),
  });
}

/** 한 공지의 읽음 기록. 대표만 읽는다 (규칙). */
export async function listNoticeReads(organizationId, noticeId, options = {}) {
  const { store = createFirestoreNoticeStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const notice = requiredText(noticeId, "noticeId");
  return readCollection({
    feature: "notice_reads",
    path: readsCollection(organization, notice),
    read: (path) => store.list(path),
  });
}

/**
 * 내가 읽은 공지의 id 들. **한 건씩 묻는다.**
 *
 * 읽음 목록 전체는 대표만 읽을 수 있다 (규칙) -- 강사끼리 서로의 읽음을 훑을
 * 이유가 없다. 강사에게 필요한 것은 "내가 봤나" 하나라, 문서 id 가 곧
 * 공지-사람 쌍인 것을 이용해 그 문서만 묻는다.
 *
 * 못 읽은 것은 **안 읽은 것으로 세지 않는다.** 네트워크가 흔들렸다고 이미 본
 * 공지를 다시 띄우면, 그 창은 곧 X 를 누르는 손버릇이 된다 -- 읽었는지 모를
 * 때는 띄우지 않는 쪽이 낫다.
 *
 * @param {string} organizationId
 * @param {Array<string>} noticeIds
 * @param {{ userId?: string, store?: any }} [options]
 * @returns {Promise<{ readIds: Array<string>, unknownIds: Array<string> }>}
 */
export async function listMyNoticeReads(organizationId, noticeIds, options = {}) {
  const { store = createFirestoreNoticeStore(), userId } = options;
  const organization = requiredText(organizationId, "organizationId");
  const who = text(userId);
  const ids = (Array.isArray(noticeIds) ? noticeIds : []).map(text).filter(Boolean);
  if (!who || ids.length === 0) return { readIds: [], unknownIds: [] };

  const readIds = [];
  const unknownIds = [];
  await Promise.all(ids.map(async (noticeId) => {
    const path = `${readsCollection(organization, noticeId)}/${noticeReadId(noticeId, who)}`;
    try {
      if (await store.read(path)) readIds.push(noticeId);
    } catch {
      // 못 읽었다. 띄우지 않는 쪽으로 둔다 -- 위 머리말 참고.
      unknownIds.push(noticeId);
    }
  }));
  return { readIds, unknownIds };
}

/**
 * 공지 한 건. **빈 칸은 보내지 않는다** -- 규칙이 모양을 따지는 칸들이라,
 * 빈 문자열을 넣으면 "없음" 이 아니라 "잘못된 값" 이 된다.
 */
function noticeBody(input, { createdBy, stampedAt, forUpdate = false }) {
  const body = {
    title: requiredText(input?.title, "title"),
    body: requiredText(input?.body, "body"),
    status: text(input?.status) || NOTICE_STATUS.ACTIVE,
    important: input?.important === true,
  };
  for (const key of ["imageUrl", "linkUrl", "startsOn", "endsOn"]) {
    const value = text(input?.[key]);
    if (value) body[key] = value;
  }
  for (const key of ["locationIds", "titles", "roles"]) {
    const value = cleanList(input?.[key]);
    if (value.length) body[key] = value;
  }
  if (forUpdate) {
    body.updatedAt = stampedAt;
    body.updatedBy = createdBy;
  } else {
    body.createdAt = stampedAt;
    body.createdBy = createdBy;
  }
  return body;
}

/**
 * 새 공지. 대표·총괄매니저만 (규칙).
 *
 * @param {string} organizationId
 * @param {any} input
 * @param {{ store?: any }} [options]
 */
export async function createNotice(organizationId, input, options = {}) {
  const { store = createFirestoreNoticeStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const createdBy = requiredText(input?.createdBy, "createdBy");
  /* 화면이 먼저 막지만 여기서도 본다 -- 규칙이 거부하면 화면에는
     permission-denied 한 줄로만 돌아오고, 무엇이 잘못됐는지 알 수 없다. */
  const refused = noticeError(input);
  if (refused) throw Object.assign(new Error("invalid_notice"), { code: "invalid_notice", message: refused });

  const stampedAt = await store.serverTimestamp();
  const noticeId = text(input?.noticeId) || store.newId();
  const data = { organizationId: organization, ...noticeBody(input, { createdBy, stampedAt }) };
  await store.commit([{ path: `${noticesCollection(organization)}/${noticeId}`, data }]);
  return { noticeId, data };
}

/** 고친 공지. 만든 사람과 만든 시각은 움직이지 않는다 (규칙). */
export async function updateNotice(organizationId, noticeId, input, options = {}) {
  const { store = createFirestoreNoticeStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const notice = requiredText(noticeId, "noticeId");
  const updatedBy = requiredText(input?.updatedBy, "updatedBy");
  const refused = noticeError(input);
  if (refused) throw Object.assign(new Error("invalid_notice"), { code: "invalid_notice", message: refused });

  const stampedAt = await store.serverTimestamp();
  const data = noticeBody(input, { createdBy: updatedBy, stampedAt, forUpdate: true });
  await store.commit([{
    path: `${noticesCollection(organization)}/${notice}`, data, operation: "update",
  }]);
  return { noticeId: notice, data };
}

/**
 * 공지를 끝낸다. **지우지 않는다** -- 읽음 기록이 가리킬 글이 사라지면
 * "읽음 N명" 이 무엇의 N 인지 알 수 없다.
 */
export async function endNotice(organizationId, noticeId, input, options = {}) {
  const { store = createFirestoreNoticeStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const notice = requiredText(noticeId, "noticeId");
  const updatedBy = requiredText(input?.updatedBy, "updatedBy");
  const stampedAt = await store.serverTimestamp();
  await store.commit([{
    path: `${noticesCollection(organization)}/${notice}`,
    data: { status: NOTICE_STATUS.ENDED, updatedAt: stampedAt, updatedBy },
    operation: "update",
  }]);
  return { noticeId: notice, status: NOTICE_STATUS.ENDED };
}

/**
 * 읽었다. **본인만 자기 것을 적는다** (규칙).
 *
 * 문서 id 가 곧 공지-사람 쌍이라 두 번 눌러도 한 건이다 -- 두 건이 되면
 * "읽음 N명" 이 사람 수가 아니게 된다.
 */
export async function markNoticeRead(organizationId, noticeId, input, options = {}) {
  const { store = createFirestoreNoticeStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const notice = requiredText(noticeId, "noticeId");
  const userId = requiredText(input?.userId, "userId");
  const stampedAt = await store.serverTimestamp();
  const readId = noticeReadId(notice, userId);
  await store.commit([{
    path: `${readsCollection(organization, notice)}/${readId}`,
    data: { organizationId: organization, noticeId: notice, userId, readAt: stampedAt },
  }]);
  return { readId, noticeId: notice, userId };
}
