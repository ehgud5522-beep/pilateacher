/**
 * 강사가 회원에게 보낼 말.
 *
 * ── 수업기록과 왜 다른 칸인가 ──
 * 수업기록 원문은 강사가 다음 수업을 준비하려고 쓴 글이다. "코어근육이 많이
 * 약해짐" 은 강사끼리 쓰는 말이고, 같은 문장을 회원이 읽으면 뜻이 달라진다.
 * 그래서 회원에게 가는 것은 강사가 회원을 향해 따로 적은 한두 문장뿐이고,
 * 원문은 기기에 남는다 -- 투영의 금지 목록이 원문 쪽 필드 이름을 전부 막고
 * 있다(member-view.js 의 FORBIDDEN_FIELDS).
 *
 * ── 왜 lessonNotes 인가 ──
 * 이 컬렉션은 이미 규칙에 있었고 쓰는 코드만 없었다. 규칙이 정확히 이 모양을
 * 전제한다: 만들기는 센터 사람만, 고치기는 쓴 사람만, 삭제는 아무도 못 한다.
 * clientId·lessonId·createdBy·createdAt 은 만든 뒤에 바뀌지 않는다.
 *
 * ── 문서 id 가 왜 `${lessonId}_${clientId}` 인가 ──
 * 한 수업에 두 사람이 있으면 회원에게 보낼 말도 둘이다. 그리고 투영을 만드는
 * 트리거가 원장 항목의 lessonId 만으로 경로를 짜맞출 수 있어야 한다 -- 질의를
 * 쓰면 정렬을 붙이는 순간 복합 색인이 필요해진다.
 *
 * ── 회원에게 언제 보이는가 ──
 * 그 수업이 확정되어 회차가 차감된 뒤다. 회원 앱의 수업 탭은 원장의 차감
 * 항목으로 만들어지고, 차감이 없으면 그 수업은 회원의 이력에 아예 없다.
 * 확정되지 않은 수업에 말만 띄우면 일어나지 않은 수업이 회원 화면에 남는다.
 * 화면은 이 사실을 강사에게 그대로 말한다.
 */

import { paths } from "../schema/paths.js";
import { RepositoryReadError } from "./repository-read.js";

/**
 * @typedef {object} MemberNoteStore
 * @property {(documentPath: string) => Promise<any | null>} read
 * @property {(writes: Array<{ path: string, data: object, operation?: "set" | "update" }>) => Promise<void>} commit
 * @property {() => Promise<any>} serverTimestamp
 */

/**
 * 회원에게 보낼 말의 길이. 투영도 같은 값으로 자른다
 * (functions/src/member-view.js 의 MEMBER_NOTE_MAX).
 *
 * 짧아야 하는 이유가 있다. 길어지면 강사가 수업기록을 여기에 옮겨 적게 되고,
 * 그 순간 두 칸을 나눈 이유가 사라진다.
 */
export const MEMBER_NOTE_MAX = 200;

const requiredText = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  return text;
};

/** 화면도 저장도 같은 방식으로 다듬는다 -- 앞뒤 공백과 길이. */
export const trimMemberNote = (value) => String(value ?? "").trim().slice(0, MEMBER_NOTE_MAX);

/**
 * 한 수업에서 한 회원에게 보내는 말의 문서 id.
 *
 * @param {string} lessonId @param {string} clientId
 */
export const memberNoteId = (lessonId, clientId) => (
  `${requiredText(lessonId, "lessonId")}_${requiredText(clientId, "clientId")}`
);

export function createFirestoreMemberNoteStore() {
  const load = () => import("firebase/firestore");
  return {
    read: async (documentPath) => {
      const { doc, getDoc, getFirestore } = await load();
      const snapshot = await getDoc(doc(getFirestore(), documentPath));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    },
    commit: async (writes) => {
      const { doc, getFirestore, writeBatch } = await load();
      const firestore = getFirestore();
      const batch = writeBatch(firestore);
      for (const write of writes) {
        const reference = doc(firestore, write.path);
        if (write.operation === "update") batch.update(reference, write.data);
        else batch.set(reference, write.data, { merge: true });
      }
      await batch.commit();
    },
    serverTimestamp: async () => {
      const { serverTimestamp } = await load();
      return serverTimestamp();
    },
  };
}

/**
 * 저장이 실패했을 때 강사에게 뭐라고 말할 것인가.
 *
 * 종류마다 할 일이 다르다. 권한 거부는 다시 눌러도 같은 답이고, 연결이
 * 끊긴 것은 다시 누르면 된다. 한 문구로 뭉개면 강사는 둘을 구분할 수 없다.
 * 원본 코드는 언제나 함께 보여준다 -- 코드 없는 "오류가 발생했습니다" 는
 * 강사도 대표도 아무것도 할 수 없게 만든다.
 *
 * @param {any} error
 * @returns {{ kind: string, retryable: boolean, errorCode: string, message: string }}
 */
export function memberNoteSaveFailure(error) {
  const errorCode = String(error?.code || "unknown");
  const of = (kind, retryable, message) => ({ kind, retryable, errorCode, message });
  if (errorCode === "permission-denied") {
    /* 규칙은 처음 쓴 사람만 고치게 한다. 다른 강사가 대타로 들어와 고치려다
       막히는 것이 실제로 있을 수 있는 경우라, 그 말을 그대로 적는다. */
    return of("permission", false, `이 메시지는 처음 쓴 강사만 고칠 수 있어요 (코드 ${errorCode})`);
  }
  if (["unavailable", "deadline-exceeded", "resource-exhausted", "aborted", "cancelled"].includes(errorCode)) {
    return of("network", true, `연결이 불안정해 저장하지 못했어요 (코드 ${errorCode})`);
  }
  if (["unauthenticated"].includes(errorCode)) {
    return of("authentication", false, `다시 로그인한 뒤 저장해 주세요 (코드 ${errorCode})`);
  }
  if (["invalid-argument", "failed-precondition", "not-found"].includes(errorCode)) {
    return of("invalid request", false, `저장이 거부되었어요 (코드 ${errorCode})`);
  }
  return of("unknown", false, `저장하지 못했어요 (코드 ${errorCode})`);
}

/**
 * 이 수업에서 이 회원에게 보낸 말. 없으면 빈 문자열이다.
 *
 * 조회 실패는 빈 문자열이 아니라 RepositoryReadError 로 나간다 -- 안 쓴 것과
 * 못 읽은 것을 같은 모양으로 돌려주면, 강사는 지웠다고 읽고 덮어쓴다.
 *
 * @param {string} organizationId
 * @param {{ lessonId: string, clientId: string, store?: MemberNoteStore }} input
 * @returns {Promise<string>}
 */
export async function readMemberNote(organizationId, input) {
  const organization = requiredText(organizationId, "organizationId");
  const path = paths.lessonNote(organization, memberNoteId(input?.lessonId, input?.clientId));
  const store = input?.store || createFirestoreMemberNoteStore();
  try {
    const found = await store.read(path);
    return trimMemberNote(found?.memberNote);
  } catch (error) {
    throw new RepositoryReadError({
      feature: "member_note",
      stage: "read",
      path,
      // 원본 코드를 그대로 싣는다 -- permission-denied 와 unavailable 은 다른 일이다.
      code: String(error?.code || "unknown"),
      cause: error,
    });
  }
}

/**
 * 회원에게 보낼 말을 저장한다. 빈 문자열이면 지운 것으로 본다.
 *
 * 문서를 지우지는 않는다 -- 규칙이 삭제를 막고 있고, 막지 않았더라도 "보냈다가
 * 거둬들였다" 는 사실은 남는 편이 낫다. memberNote 를 빈 문자열로 두면 투영이
 * 그 줄을 빼고, 회원 화면에서 사라진다.
 *
 * @param {string} organizationId
 * @param {{
 *   lessonId: string, clientId: string, memberNote: string,
 *   instructorId?: string, userId: string, store?: MemberNoteStore,
 * }} input
 * @returns {Promise<{ noteId: string, memberNote: string, created: boolean }>}
 */
export async function saveMemberNote(organizationId, input) {
  const organization = requiredText(organizationId, "organizationId");
  const lessonId = requiredText(input?.lessonId, "lessonId");
  const clientId = requiredText(input?.clientId, "clientId");
  const userId = requiredText(input?.userId, "userId");
  const noteId = memberNoteId(lessonId, clientId);
  const store = input?.store || createFirestoreMemberNoteStore();
  const memberNote = trimMemberNote(input?.memberNote);
  const path = paths.lessonNote(organization, noteId);

  /* 처음 쓰는 것인지 고치는 것인지 먼저 본다. 규칙의 immutable 은 값이 아니라
     **건드린 필드**를 본다(affectedKeys). createdAt 에 serverTimestamp 를 다시
     실으면 값이 달라지므로 고치기가 통째로 거부된다 -- 그래서 두 번째부터는
     createdAt 을 아예 보내지 않는다. */
  const existing = await store.read(path);
  const stampedAt = await store.serverTimestamp();
  const data = existing
    ? { memberNote, updatedAt: stampedAt }
    : {
      organizationId: organization,
      clientId,
      lessonId,
      memberNote,
      instructorId: String(input?.instructorId || userId),
      createdBy: userId,
      createdAt: stampedAt,
      updatedAt: stampedAt,
    };

  await store.commit([{ path, data }]);
  return { noteId, memberNote, created: !existing };
}
