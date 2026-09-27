"use strict";

/**
 * 회원이 자기 계정을 지운다. 스토어가 요구하는 통로다 (App Store 5.1.1(v)).
 *
 * ── 무엇을 지우고 무엇을 남기는가 ──
 * 지우는 것은 **계정**이다. 센터의 명부가 아니다.
 *
 *   지운다 : Firebase Auth 사용자 · memberLinks/{uid} · 그 회원의 투영 문서
 *            · clients 에 적힌 userId
 *   남긴다 : clients 문서 · passes · ledger · 수업 기록
 *
 * 남기는 쪽이 더 중요하다. `ledger` 는 급여의 유일한 근거이고 덧붙이기만
 * 하는 장부다 -- 회원이 앱을 지웠다고 강사의 급여 근거가 사라지면 안 된다.
 * 회원이 센터를 그만두는 것과 앱 계정을 지우는 것은 다른 일이고, 화면이 그
 * 차이를 말해야 한다.
 *
 * ── 순서가 되돌릴 수 없는 것을 만든다 ──
 * **Firestore 를 먼저, Auth 를 나중에.**
 *
 * 거꾸로 했다가 Firestore 가 실패하면, 그 회원은 로그인할 계정이 없어서 다시
 * 시도할 수도 없는데 명부에는 죽은 uid 가 `clients.userId` 로 남는다. 나중에
 * 다시 가입하면 그 문서는 **이미 다른 계정에 연결된 것**으로 읽혀
 * (`taken`) 영영 자기 회원권을 못 본다. 아무도 이유를 모른다.
 *
 * 이 순서로 하면 실패는 반대로 끝난다. Firestore 는 지워졌는데 Auth 가
 * 남으면, 그 사람은 다시 로그인할 수 있고 번호로 다시 이어진다. 되돌릴 수
 * 있는 쪽으로 틀린다.
 *
 * ── 다시 불러도 같다 ──
 * 연결이 없어도 Auth 사용자는 지운다. 앞선 시도가 중간에 끊긴 계정이 영영
 * 지워지지 않는 것을 막는다.
 */

const STAGES = Object.freeze({
  AUTHORIZE: "authorize",
  READ_LINK: "read_link",
  PURGE: "purge",
  DELETE_USER: "delete_user",
});

class MemberAccountError extends Error {
  constructor(code, { stage, cause } = {}) {
    super(code);
    this.name = "MemberAccountError";
    this.code = code;
    this.stage = stage || "unknown";
    if (cause) this.cause = cause;
  }
}

const text = (value) => String(value ?? "").trim();

/**
 * @param {object} ports
 * @param {(userId: string) => Promise<any>} ports.readLink
 * @param {(input: object) => Promise<any>} ports.purgeMemberAccount
 * @param {(userId: string) => Promise<void>} ports.deleteAuthUser
 * @param {() => Date} [ports.now]
 */
function createMemberAccountService(ports) {
  const { readLink, purgeMemberAccount, deleteAuthUser } = ports || {};
  const now = ports?.now || (() => new Date());

  /**
   * 부른 사람의 계정을 지운다. **남의 계정은 지울 수 없다** -- 지울 대상을
   * 요청에서 받지 않고 토큰의 uid 만 쓴다.
   */
  async function deleteForCaller(request) {
    const userId = text(request?.auth?.uid);
    if (!userId) throw new MemberAccountError("unauthenticated", { stage: STAGES.AUTHORIZE });

    let links = [];
    try {
      const current = await readLink(userId);
      links = (Array.isArray(current?.links) ? current.links : [])
        .map((link) => ({
          organizationId: text(link?.organizationId),
          clientId: text(link?.clientId),
        }))
        .filter((link) => link.organizationId && link.clientId);
    } catch (error) {
      /* 못 읽으면 멈춘다. 모르는 채로 Auth 를 지우면 명부에 죽은 uid 가
         남고, 그 회원은 다시 가입해도 `taken` 에 막힌다. */
      throw new MemberAccountError("delete_unavailable", { stage: STAGES.READ_LINK, cause: error });
    }

    try {
      await purgeMemberAccount({ userId, links, at: now() });
    } catch (error) {
      throw new MemberAccountError("delete_unavailable", { stage: STAGES.PURGE, cause: error });
    }

    try {
      await deleteAuthUser(userId);
    } catch (error) {
      /* 여기서 실패하면 연결은 이미 끊겼고 계정만 남는다. 그 사람은 다시
         로그인해 번호로 다시 이어질 수 있다 -- 되돌릴 수 있는 실패다.
         그래도 실패는 실패라고 말한다. */
      throw new MemberAccountError("account_not_removed", { stage: STAGES.DELETE_USER, cause: error });
    }

    return { status: "deleted", unlinked: links.length };
  }

  return { deleteForCaller };
}

module.exports = {
  MemberAccountError,
  MEMBER_ACCOUNT_STAGES: STAGES,
  createMemberAccountService,
};
