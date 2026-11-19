"use strict";

/**
 * 보관된 빈 회원 삭제 (2026-11-19 대표: "보관됨 이거는 삭제하고").
 *
 * ── 왜 생겼나 ──
 * 정미혜 회원이 두 벌 있었다. 하나는 보관된 빈 회원이고 맞는 번호를 들고 있었다.
 * 쓰는 쪽 회원의 번호를 그 번호로 바꾸려 하자 중복 검사가 막았다 -- 중복 검사는
 * 보관된 회원도 본다(회원 앱 연결이 같은 쿼리를 쓰므로 빼면 안 된다).
 * 보관은 지우는 것이 아니라서 번호를 놓아 주지 않는다. 그 번호를 풀어 줄 길이
 * 이 함수다.
 *
 * ── 무엇을 지울 수 있나 ──
 * **보관된 회원 중 아무것도 붙지 않은 회원만.** 회원권(clientId · clientIds 둘 다),
 * 수업 참여, 서버 수업기록, 회원에게 보낸 말, 앱 취소 기록, 서버 요약 중 하나라도
 * 있으면 지우지 않는다 -- 지우면 그 기록이 주인 없는 기록이 되고, 되돌릴 수 없다.
 * 그런 회원은 회원 합치기의 일이다.
 *
 * ── 회원 앱 연결은 끊고 지운다 ──
 * 번호 변경과 같은 선이다(client-phone-store.js). 연결된 계정은 그 번호로 다시
 * 로그인하면 이번에는 쓰는 쪽 회원을 찾는다.
 *
 * ── 지우기 전에 한 벌 남긴다 ──
 * organizations/{org}/clientDeletions 에 회원 문서 그대로. 규칙이 닫아 둔 자리라
 * 앱에서는 아무도 못 읽고, 잘못 지웠을 때 콘솔에서 되살릴 근거가 된다.
 * 감사 로그에는 번호 · 이름을 넣지 않는다 (CLAUDE.md 7).
 *
 * 역할은 대표 · 총괄매니저만. 규칙의 ownerLevel() 과 같은 선이다.
 */

const CLIENT_DELETE = Object.freeze({
  NOT_ALLOWED: "client_delete_not_allowed",
  NO_CLIENT: "client_delete_no_client",
  NOT_ARCHIVED: "client_delete_not_archived",
  HAS_HISTORY: "client_delete_has_history",
  INVALID_REQUEST: "client_delete_invalid_request",
  UNAVAILABLE: "client_delete_unavailable",
});

const DELETE_ROLES = Object.freeze(["owner", "area_manager"]);
const AUDIT_ACTION_CLIENT_DELETED = "client_deleted";

/** 막는 기록의 종류. 화면이 "무엇이 남아 있어서" 를 말할 때 쓴다. */
const HISTORY_KIND = Object.freeze({
  PASS: "pass",
  LESSON: "lesson",
  LESSON_RECORD: "lesson_record",
  LESSON_NOTE: "lesson_note",
  CANCELLATION: "cancellation",
  SUMMARY: "summary",
});

const text = (value) => String(value ?? "").trim();

class ClientDeleteError extends Error {
  /** @param {string} code @param {{ kinds?: string[], cause?: any }} [detail] */
  constructor(code, detail = {}) {
    super(code);
    this.name = "ClientDeleteError";
    this.code = code;
    this.kinds = detail.kinds;
    this.cause = detail.cause;
  }
}

/**
 * 지워도 되는가. 순수 판정 -- 읽기는 저장소가 하고 결과만 넘긴다.
 *
 * @param {{ role?: string, client?: any, history?: Record<string, number> }} input
 * @returns {{ ok: boolean, code?: string, kinds?: string[] }}
 */
function decideClientDelete(input) {
  if (!DELETE_ROLES.includes(text(input?.role))) return { ok: false, code: CLIENT_DELETE.NOT_ALLOWED };
  const client = input?.client || null;
  if (!client) return { ok: false, code: CLIENT_DELETE.NO_CLIENT };
  if (client.archived !== true) return { ok: false, code: CLIENT_DELETE.NOT_ARCHIVED };
  const history = input?.history || {};
  const kinds = Object.values(HISTORY_KIND).filter((kind) => Number(history[kind]) > 0);
  if (kinds.length) return { ok: false, code: CLIENT_DELETE.HAS_HISTORY, kinds };
  return { ok: true };
}

/**
 * callable 의 몸통. 역할은 앱이 보낸 값이 아니라 memberships 문서에서 읽는다.
 *
 * @param {{
 *   readMembership: (membershipDocumentId: string) => Promise<any>,
 *   inspectClient: (organizationId: string, clientId: string) => Promise<{ client: any, history: Record<string, number> }>,
 *   deleteClient: (input: any) => Promise<{ unlinked: boolean }>,
 *   now?: () => Date,
 * }} dependencies
 */
function createClientDeleteService(dependencies) {
  const { readMembership, inspectClient, deleteClient, now = () => new Date() } = dependencies || {};

  async function remove(request) {
    const callerUid = text(request?.auth?.uid);
    if (!callerUid) throw new ClientDeleteError("unauthenticated");
    const organizationId = text(request?.data?.organizationId);
    const clientId = text(request?.data?.clientId);
    if (!organizationId || !clientId) throw new ClientDeleteError(CLIENT_DELETE.INVALID_REQUEST);

    let membership = null;
    try {
      membership = await readMembership(`${organizationId}_${callerUid}`);
    } catch (error) {
      throw new ClientDeleteError(CLIENT_DELETE.UNAVAILABLE, { cause: error });
    }
    const role = membership && membership.status === "active" ? text(membership.role) : "";
    if (!DELETE_ROLES.includes(role)) throw new ClientDeleteError(CLIENT_DELETE.NOT_ALLOWED);

    let inspected;
    try {
      inspected = await inspectClient(organizationId, clientId);
    } catch (error) {
      throw new ClientDeleteError(CLIENT_DELETE.UNAVAILABLE, { cause: error });
    }
    const decided = decideClientDelete({ role, client: inspected?.client, history: inspected?.history });
    if (!decided.ok) throw new ClientDeleteError(decided.code, { kinds: decided.kinds });

    try {
      const result = await deleteClient({ organizationId, clientId, actorId: callerUid, actorRole: role, at: now() });
      return { ok: true, clientId, unlinked: result?.unlinked === true };
    } catch (error) {
      if (error instanceof ClientDeleteError) throw error;
      throw new ClientDeleteError(CLIENT_DELETE.UNAVAILABLE, { cause: error });
    }
  }

  return { remove };
}

/**
 * Firestore 쪽. 판정에 쓸 것을 세고, 지운다.
 *
 * @param {any} firestore
 * @param {{ removeLink: (input: any) => Promise<any> }} links  member-link-store 의 포트
 */
function createFirestoreClientDeletePorts(firestore, links) {
  const org = (organizationId) => firestore.collection("organizations").doc(organizationId);
  const sizeOf = (snapshot) => (snapshot && Array.isArray(snapshot.docs) ? snapshot.docs.length : 0);

  async function inspectClient(organizationId, clientId) {
    const centre = org(organizationId);
    const clientSnapshot = await centre.collection("clients").doc(clientId).get();
    if (!clientSnapshot.exists) return { client: null, history: {} };

    /* 수업은 lessons 의 clientId · clientIds 로 본다. participants 를 컬렉션 그룹으로
       물으면 색인을 새로 내야 한다 -- 같은 사실을 lessons 가 이미 들고 있다. */
    const [byClient, byClients, lessonByClient, lessonByClients, records, notes, cancellations, summary] = await Promise.all([
      centre.collection("passes").where("clientId", "==", clientId).limit(1).get(),
      centre.collection("passes").where("clientIds", "array-contains", clientId).limit(1).get(),
      centre.collection("lessons").where("clientId", "==", clientId).limit(1).get(),
      centre.collection("lessons").where("clientIds", "array-contains", clientId).limit(1).get(),
      centre.collection("lessonRecords").where("clientId", "==", clientId).limit(1).get(),
      centre.collection("lessonNotes").where("clientId", "==", clientId).limit(1).get(),
      centre.collection("memberCancellations").where("clientId", "==", clientId).limit(1).get(),
      centre.collection("memberSummaries").doc(clientId).get(),
    ]);
    return {
      client: { id: clientSnapshot.id, ...clientSnapshot.data() },
      history: {
        [HISTORY_KIND.PASS]: sizeOf(byClient) + sizeOf(byClients),
        [HISTORY_KIND.LESSON]: sizeOf(lessonByClient) + sizeOf(lessonByClients),
        [HISTORY_KIND.LESSON_RECORD]: sizeOf(records),
        [HISTORY_KIND.LESSON_NOTE]: sizeOf(notes),
        [HISTORY_KIND.CANCELLATION]: sizeOf(cancellations),
        [HISTORY_KIND.SUMMARY]: summary.exists ? 1 : 0,
      },
    };
  }

  async function deleteClient({ organizationId, clientId, actorId, actorRole, at }) {
    const centre = org(organizationId);
    const clientRef = centre.collection("clients").doc(clientId);

    /* 연결부터 끊는다. 지운 뒤에 끊으면 removeLink 가 없는 회원 문서에
       userId 삭제를 merge 로 써서 빈 문서를 되살린다. */
    const before = await clientRef.get();
    if (!before.exists) throw new ClientDeleteError(CLIENT_DELETE.NO_CLIENT);
    const userId = text(before.data()?.userId);
    let unlinked = false;
    if (userId) {
      await links.removeLink({ userId, organizationId, clientId, at, audit: { organizationId, actorId, actorRole, clientId, targetId: clientId } });
      unlinked = true;
    }

    const totals = await centre.collection("instructorClientTotals").where("clientId", "==", clientId).get();

    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(clientRef);
      if (!current.exists) throw new ClientDeleteError(CLIENT_DELETE.NO_CLIENT);
      const data = current.data() || {};
      /* 판정 뒤에 누가 되살렸으면 멈춘다. */
      if (data.archived !== true) throw new ClientDeleteError(CLIENT_DELETE.NOT_ARCHIVED);

      transaction.set(centre.collection("clientDeletions").doc(), {
        organizationId, clientId, deletedAt: at, deletedBy: actorId, client: data,
      });
      transaction.delete(clientRef);
      transaction.delete(centre.collection("memberViews").doc(clientId));
      transaction.delete(centre.collection("memberCancelLedger").doc(clientId));
      for (const total of totals.docs) transaction.delete(total.ref);
      transaction.set(firestore.collection("auditLogs").doc(), {
        organizationId, actorId, actorRole,
        action: AUDIT_ACTION_CLIENT_DELETED,
        createdAt: at, clientId, targetId: clientId,
        ...(unlinked ? { unlinked: true } : {}),
      });
    });
    return { unlinked };
  }

  return { inspectClient, deleteClient };
}

module.exports = {
  AUDIT_ACTION_CLIENT_DELETED,
  CLIENT_DELETE,
  ClientDeleteError,
  DELETE_ROLES,
  HISTORY_KIND,
  createClientDeleteService,
  createFirestoreClientDeletePorts,
  decideClientDelete,
};
