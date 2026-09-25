"use strict";

/**
 * 연락처 변경 callable 의 몸통. 판정은 client-phone.js, 쓰기는
 * client-phone-store.js 가 한다 -- 여기는 부르는 사람이 누구인지 확인하고
 * 둘을 잇는다.
 *
 * ── 역할은 서버가 읽는다 ──
 * 앱이 보낸 역할을 믿지 않는다. memberships 문서를 직접 읽어 그 값으로
 * 판정한다 -- 화면이 버튼을 감추는 것과 서버가 거부하는 것은 다른 일이고,
 * 화면만 감추면 그것은 잠긴 문이 아니다.
 */

const { PHONE_EDIT } = require("./client-phone");

const text = (value) => String(value ?? "").trim();
const membershipId = (organizationId, userId) => `${organizationId}_${userId}`;

/** 활성 소속이어야 한다. 나간 사람이 남의 번호를 바꾸면 안 된다. */
const activeRoleOf = (membership) => (
  membership && membership.status === "active" ? text(membership.role) : ""
);

class ClientPhoneError extends Error {
  /** @param {string} code @param {{ clientName?: string, limit?: number, cause?: any }} [detail] */
  constructor(code, detail = {}) {
    super(code);
    this.name = "ClientPhoneError";
    this.code = code;
    this.clientName = detail.clientName;
    this.limit = detail.limit;
    this.cause = detail.cause;
  }
}

/**
 * @param {{
 *   changePhone: (input: any) => Promise<any>,
 *   listMalformedPhones: (organizationId: string) => Promise<Array<any>>,
 *   readMembership: (membershipDocumentId: string) => Promise<any>,
 *   now?: () => Date,
 * }} dependencies
 */
function createClientPhoneService(dependencies) {
  const { changePhone, listMalformedPhones, readMembership, now = () => new Date() } = dependencies || {};

  async function callerRole(organizationId, callerUid) {
    let membership = null;
    try {
      membership = await readMembership(membershipId(organizationId, callerUid));
    } catch (error) {
      throw new ClientPhoneError("phone_unavailable", { cause: error });
    }
    const role = activeRoleOf(membership);
    if (!role) throw new ClientPhoneError(PHONE_EDIT.NOT_ALLOWED);
    return role;
  }

  function scopeOf(request) {
    const callerUid = text(request?.auth?.uid);
    if (!callerUid) throw new ClientPhoneError("unauthenticated");
    const organizationId = text(request?.data?.organizationId);
    if (!organizationId) throw new ClientPhoneError("phone_invalid_request");
    return { callerUid, organizationId };
  }

  /** 번호를 바꾼다. */
  async function update(request) {
    const { callerUid, organizationId } = scopeOf(request);
    const clientId = text(request?.data?.clientId);
    const newPhone = text(request?.data?.phone);
    if (!clientId) throw new ClientPhoneError("phone_invalid_request");

    const actorRole = await callerRole(organizationId, callerUid);
    try {
      const result = await changePhone({
        organizationId, clientId, newPhone,
        actorId: callerUid, actorRole, now: now(),
      });
      return {
        ok: true,
        clientId,
        /* 바뀐 번호를 돌려주지 않는다. 화면은 이미 그 값을 들고 있고,
           강사 화면은 애초에 전체 번호를 보여주지 않는다. */
        unlinked: result.unlinked === true,
      };
    } catch (error) {
      const code = text(error?.code) || "phone_unavailable";
      throw new ClientPhoneError(code, { clientName: error?.clientName, limit: error?.limit, cause: error });
    }
  }

  /**
   * 번호 철자가 깨진 회원 목록. 대표만 부르고, **읽기만 한다.**
   *
   * 한꺼번에 고치지 않는 이유는 store 의 머리말에 있다 -- 틀린 번호가
   * "정상" 이 되어 더 찾기 어려워진다.
   */
  async function listMalformed(request) {
    const { callerUid, organizationId } = scopeOf(request);
    const actorRole = await callerRole(organizationId, callerUid);
    if (actorRole !== "owner") throw new ClientPhoneError("not_owner");
    try {
      return { ok: true, clients: await listMalformedPhones(organizationId) };
    } catch (error) {
      throw new ClientPhoneError("phone_unavailable", { cause: error });
    }
  }

  return { listMalformed, update };
}

module.exports = { ClientPhoneError, createClientPhoneService };
