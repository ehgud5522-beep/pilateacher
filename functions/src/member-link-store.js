"use strict";

/**
 * 연결 함수가 Firestore 를 만지는 자리. 판정은 `member-link.js` 가 하고 여기는
 * 읽고 쓰기만 한다.
 *
 * ── 왜 나눴는가 ──
 * 판정(누구를 이을 것인가)은 순수 함수로 두어야 테스트가 경우를 전부 짚을 수
 * 있다. 그 판정에 Firestore 가 섞이면 "같은 지점에 동명이인 둘" 같은 경우를
 * 에뮬레이터 없이는 확인할 수 없게 된다.
 *
 * ── 쓰기는 언제나 한 배치다 ──
 * `clients.userId` 와 `memberLinks/{uid}` 가 따로 나가면 한쪽만 성공한 상태가
 * 남는다. 회원 문서에는 uid 가 적혔는데 링크 문서가 없으면 회원 앱은 "찾지
 * 못했습니다"를 보여 주면서 정작 그 회원의 투영은 만들어진다.
 */

/** Keep in sync with AUDIT_ACTION in src/data/repositories/audit-repository.js. */
const AUDIT_ACTION_LINK_CREATED = "member_link_created";
const AUDIT_ACTION_LINK_REMOVED = "member_link_removed";

const LINKED_STATUSES = ["linked", "ended", "multi_location"];

const text = (value) => String(value ?? "").trim();

/**
 * @param {{ firestore: any, FieldValue: any }} dependencies
 */
function createFirestoreMemberLinkPorts(dependencies) {
  const { firestore, FieldValue } = dependencies || {};

  const organizationRef = (organizationId) => firestore.collection("organizations").doc(organizationId);
  const clientRef = (organizationId, clientId) => organizationRef(organizationId).collection("clients").doc(clientId);
  const memberViewRef = (organizationId, clientId) => organizationRef(organizationId).collection("memberViews").doc(clientId);
  const linkRef = (userId) => firestore.collection("memberLinks").doc(userId);

  /* 센터 목록. 문서 id 만 필요하므로 내용은 읽지 않는다. */
  async function listOrganizationIds() {
    const refs = await firestore.collection("organizations").listDocuments();
    return refs.map((ref) => ref.id);
  }

  async function findClientsByPhone(organizationId, phone) {
    const page = await organizationRef(organizationId)
      .collection("clients").where("phone", "==", phone).get();
    return page.docs.map((snapshot) => ({
      organizationId, clientId: snapshot.id, ...snapshot.data(),
    }));
  }

  async function readClient(organizationId, clientId) {
    const snapshot = await clientRef(organizationId, clientId).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }

  async function readMembership(membershipDocumentId) {
    const snapshot = await firestore.collection("memberships").doc(membershipDocumentId).get();
    return snapshot.exists ? snapshot.data() : null;
  }

  async function listLinksByStatus(status) {
    const page = await firestore.collection("memberLinks").where("status", "==", status).get();
    return page.docs.map((snapshot) => ({ userId: snapshot.id, ...snapshot.data() }));
  }

  /**
   * 연결 결과를 쓴다. 이어졌을 때만 `clients.userId` 를 건드린다 --
   * `ambiguous` 와 `not_found` 는 사유만 남기고 명부를 바꾸지 않는다.
   */
  async function writeLink(input) {
    const userId = text(input?.userId);
    const status = text(input?.status);
    const at = input?.at instanceof Date ? input.at : new Date();
    const links = (Array.isArray(input?.links) ? input.links : [])
      .map((link) => ({
        organizationId: text(link.organizationId),
        clientId: text(link.clientId),
        locationId: text(link.locationId),
      }))
      .filter((link) => link.organizationId && link.clientId);

    const batch = firestore.batch();

    if (LINKED_STATUSES.includes(status)) {
      for (const link of links) {
        /* merge 다. 이 함수가 명부에서 건드리는 칸은 userId 하나뿐이어야 한다. */
        batch.set(clientRef(link.organizationId, link.clientId), { userId }, { merge: true });
      }
    }

    /* candidates 와 links 는 언제나 덮어쓴다. 대기 중이던 후보가 남아 있으면
       대표의 대기 목록에 이미 끝난 사람이 계속 보인다. */
    const document = {
      userId,
      status,
      links,
      candidates: (Array.isArray(input?.candidates) ? input.candidates : []).map((candidate) => ({
        organizationId: text(candidate.organizationId),
        clientId: text(candidate.clientId),
        locationId: text(candidate.locationId),
      })),
      candidateCount: Number(input?.candidateCount) || 0,
      updatedAt: at,
    };
    /* 번호는 회원이 직접 부른 길에서만 온다 (인증된 값). 대표가 이은 길에는
       없고, 그때 이미 적힌 값을 지우지 않는다. */
    if (text(input?.phone)) document.phone = text(input.phone);
    if (LINKED_STATUSES.includes(status)) document.linkedAt = at;
    if (text(input?.linkedBy)) document.linkedBy = text(input.linkedBy);
    batch.set(linkRef(userId), document, { merge: true });

    if (input?.audit) batch.set(auditRef(), auditEntry(input.audit, AUDIT_ACTION_LINK_CREATED, at));

    await batch.commit();
    return document;
  }

  /**
   * 연결 하나를 끊는다.
   *
   * 투영 문서를 그 자리에서 지운다 -- `userId` 만 지우면 이미 깔린 투영을 그
   * 사람이 계속 읽는다. (트리거가 뒤따라 다시 만들지 않는 것은
   * member-view-triggers.js 가 userId 없는 회원의 투영을 지우기 때문이다.)
   *
   * 여러 지점에 이어진 회원은 나머지 연결을 남긴다. 한 지점을 잘못 이었다고
   * 다른 지점까지 끊으면 그 회원은 이유를 알 수 없이 전부를 잃는다.
   */
  async function removeLink(input) {
    const userId = text(input?.userId);
    const organizationId = text(input?.organizationId);
    const clientId = text(input?.clientId);
    const at = input?.at instanceof Date ? input.at : new Date();

    const current = await linkRef(userId).get();
    const before = (Array.isArray(current.data()?.links) ? current.data().links : [])
      .map((link) => ({
        organizationId: text(link.organizationId),
        clientId: text(link.clientId),
        locationId: text(link.locationId),
      }));
    const remaining = before.filter((link) => (
      link.organizationId !== organizationId || link.clientId !== clientId
    ));

    const batch = firestore.batch();
    /* 칸을 비우지 않고 없앤다. 아직 아무에게도 연결되지 않은 회원과 같은
       모양이어야 한다 -- 빈 문자열이 남으면 그 둘을 구별할 것이 생긴다. */
    batch.set(clientRef(organizationId, clientId), { userId: FieldValue.delete() }, { merge: true });
    batch.delete(memberViewRef(organizationId, clientId));
    batch.set(linkRef(userId), {
      userId,
      status: remaining.length ? "multi_location" : "rejected",
      links: remaining,
      candidates: [],
      candidateCount: remaining.length,
      updatedAt: at,
      unlinkedAt: at,
      unlinkedBy: text(input?.audit?.actorId),
    }, { merge: true });

    if (input?.audit) batch.set(auditRef(), auditEntry(input.audit, AUDIT_ACTION_LINK_REMOVED, at));

    await batch.commit();
    return { remaining };
  }

  const auditRef = () => firestore.collection("auditLogs").doc();

  /* 규칙의 hasOnly 목록 안에서만 쓴다. 자유 문장 칸은 하나도 없다 -- 있으면
     언젠가 거기에 회원 이름이 들어간다. */
  const auditEntry = (audit, action, at) => ({
    organizationId: text(audit.organizationId),
    actorId: text(audit.actorId),
    actorRole: text(audit.actorRole),
    action,
    createdAt: at,
    clientId: text(audit.clientId),
    targetId: text(audit.targetId),
  });

  return {
    findClientsByPhone,
    listLinksByStatus,
    listOrganizationIds,
    readClient,
    readMembership,
    removeLink,
    writeLink,
  };
}

module.exports = {
  AUDIT_ACTION_LINK_CREATED,
  AUDIT_ACTION_LINK_REMOVED,
  createFirestoreMemberLinkPorts,
};
