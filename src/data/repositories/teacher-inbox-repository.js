/**
 * 강사 알림함 (2026-11-07) — users/{uid}/inbox/{itemId}.
 *
 * 서버(memberCancelLesson)만 만든다. 앱은 듣고, 본인 것에 "읽음" 을 한 번 적는다
 * (규칙: readAt 한 칸 · 서버 시각 · 한 번). 화면 판정은 features/notifications/teacher-inbox.js.
 *
 * 질의는 createdAt 내림차순 하나 -- 단일 필드라 자동 색인으로 풀린다.
 */

const text = (value) => String(value ?? "").trim();

export const INBOX_PAGE = 50;

const inboxPath = (uid) => {
  const id = text(uid);
  if (!id || id.includes("/")) throw new Error("Invalid uid");
  return `users/${id}/inbox`;
};

/**
 * 듣기 시작. 끊는 함수를 돌려준다.
 * @param {string} uid
 * @param {{ onChange: (items: Array<any>, meta: { fromCache: boolean }) => void, onError: (error: any) => void }} handlers
 * @param {{ firestore?: any, sdk?: any, pageSize?: number }} [options]
 */
export async function subscribeTeacherInbox(uid, handlers, options = {}) {
  if (!text(uid)) return () => {};
  const sdk = options.sdk || await import("firebase/firestore");
  const { collection, getFirestore, limit, onSnapshot, orderBy, query } = sdk;
  const scoped = query(
    collection(options.firestore || getFirestore(), inboxPath(uid)),
    orderBy("createdAt", "desc"),
    limit(options.pageSize || INBOX_PAGE),
  );
  return onSnapshot(scoped, (snapshot) => {
    handlers.onChange(
      snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
      { fromCache: Boolean(snapshot.metadata?.fromCache) },
    );
  }, (error) => handlers.onError(error));
}

/** 한 번 읽기 (시험 · 듣기를 못 여는 곳). */
export async function listTeacherInbox(uid, options = {}) {
  const sdk = options.sdk || await import("firebase/firestore");
  const { collection, getDocs, getFirestore, limit, orderBy, query } = sdk;
  const page = await getDocs(query(
    collection(options.firestore || getFirestore(), inboxPath(uid)),
    orderBy("createdAt", "desc"),
    limit(options.pageSize || INBOX_PAGE),
  ));
  return page.docs.map((document) => ({ id: document.id, ...document.data() }));
}

/** 읽음. 이미 읽은 것은 규칙이 거절한다 -- 부르는 쪽이 readAt 을 보고 거른다. */
export async function markTeacherInboxRead(uid, itemId, options = {}) {
  const id = text(itemId);
  if (!id || id.includes("/")) throw new Error("Invalid itemId");
  const sdk = options.sdk || await import("firebase/firestore");
  const { doc, getFirestore, serverTimestamp, updateDoc } = sdk;
  await updateDoc(doc(options.firestore || getFirestore(), `${inboxPath(uid)}/${id}`), { readAt: serverTimestamp() });
}
