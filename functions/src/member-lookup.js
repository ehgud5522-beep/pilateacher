"use strict";

/**
 * 이메일로 강사의 uid 를 찾는다. 대표가 강사를 센터에 붙이기 위한 한 걸음이다.
 *
 * ── 왜 서버인가 ──
 * Firebase Auth 는 클라이언트에서 이메일로 사용자를 조회할 수 없다. users/{uid}
 * 에 이메일이 있지만 그 문서는 본인만 읽을 수 있고, 전화번호가 함께 들어 있어
 * 대표에게 열 수 없다 -- 규칙은 읽기에서 필드를 가리지 못한다.
 *
 * 대안은 강사가 uid 나 짧은 코드를 대표에게 옮겨 적는 것이었다. 28자를 카톡으로
 * 옮기면 오타가 나고, 틀리면 조용히 매칭되지 않는다. 이메일은 이미 서로 아는
 * 값이고, 틀리면 "그 이메일로 가입한 계정이 없습니다"로 크게 실패한다.
 *
 * ── 조회는 대표만 ──
 * 이메일 하나로 uid 를 돌려주는 통로는 계정 존재 여부를 캐는 데 쓰일 수 있다.
 * 그래서 호출자가 그 센터의 대표인지 먼저 확인하고, 아니면 무엇도 돌려주지
 * 않는다. 없는 계정과 권한 없는 호출은 서로 다른 코드로 끝난다 -- 대표에게는
 * 그 구분이 필요하고(오타인가 미가입인가), 대표가 아닌 사람은 어느 쪽도 보지
 * 못한다.
 *
 * ── 돌려주지 않는 것 ──
 * 전화번호는 돌려주지 않는다. 이름은 대표가 "이 사람이 맞나"를 확인하는 데
 * 필요해서 돌려주고, 그것은 대표가 곧 membership 에 적을 값이다. 이메일은
 * 대표가 방금 입력한 값이라 되돌려 줄 이유가 없다.
 */

const STAGES = Object.freeze({
  AUTHORIZE: "authorize",
  VERIFY_OWNER: "verify_owner",
  FIND_USER: "find_user",
  READ_MEMBERSHIP: "read_membership",
});

class MemberLookupError extends Error {
  constructor(code, options = {}) {
    super(options.message || code, options.cause ? { cause: options.cause } : undefined);
    this.name = "MemberLookupError";
    this.code = code;
    this.stage = options.stage || STAGES.AUTHORIZE;
  }
}

/* 규칙의 membershipId() 와 같은 형식이다. 둘이 어긋나면 서버가 찾은 소속과
   규칙이 보는 소속이 다른 문서가 된다. */
const membershipId = (organizationId, userId) => `${organizationId}_${userId}`;

const text = (value) => String(value ?? "").trim();

/**
 * 주소를 하나의 철자로 모은다. 대표가 대문자로 적어도 같은 계정을 찾아야 한다.
 *
 * 아주 느슨한 형태 검사만 한다. 여기서 주소 문법을 다 따지면 Auth 가 받아 주는
 * 주소를 이쪽이 먼저 거절하게 되고, 그 강사는 영영 못 붙는다. 실제 판정은
 * getUserByEmail 이 한다.
 */
function normalizeEmail(value) {
  const email = text(value).toLowerCase();
  if (!email || email.length > 320) throw new MemberLookupError("invalid_email", { stage: STAGES.AUTHORIZE });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MemberLookupError("invalid_email", { stage: STAGES.AUTHORIZE });
  }
  return email;
}

/**
 * @param {{
 *   findUserByEmail: (email: string) => Promise<{ uid: string, displayName?: string } | null>,
 *   readMembership: (membershipDocumentId: string) => Promise<any | null>,
 *   isNotFoundError?: (error: any) => boolean,
 * }} dependencies
 */
function createMemberLookupService(dependencies) {
  const {
    findUserByEmail,
    readMembership,
    isNotFoundError = (error) => String(error?.code || "") === "auth/user-not-found",
  } = dependencies || {};

  /** 이 사람이 이 센터의 대표인가. 규칙의 hasRole(["owner"]) 과 같은 판정이다. */
  async function requireOwner(organizationId, callerUid) {
    let membership = null;
    try {
      membership = await readMembership(membershipId(organizationId, callerUid));
    } catch (error) {
      throw new MemberLookupError("lookup_unavailable", { stage: STAGES.VERIFY_OWNER, cause: error });
    }
    if (!membership || membership.status !== "active" || membership.role !== "owner") {
      throw new MemberLookupError("not_owner", { stage: STAGES.VERIFY_OWNER });
    }
    return membership;
  }

  /**
   * @param {{ auth?: { uid?: string }, data?: { organizationId?: string, email?: string } }} request
   */
  async function lookupByEmail(request) {
    const callerUid = text(request?.auth?.uid);
    if (!callerUid) throw new MemberLookupError("unauthenticated", { stage: STAGES.AUTHORIZE });

    const organizationId = text(request?.data?.organizationId);
    if (!organizationId) throw new MemberLookupError("invalid_request", { stage: STAGES.AUTHORIZE });
    const email = normalizeEmail(request?.data?.email);

    await requireOwner(organizationId, callerUid);

    let user = null;
    try {
      user = await findUserByEmail(email);
    } catch (error) {
      if (isNotFoundError(error)) throw new MemberLookupError("user_not_found", { stage: STAGES.FIND_USER });
      throw new MemberLookupError("lookup_unavailable", { stage: STAGES.FIND_USER, cause: error });
    }
    const userId = text(user?.uid);
    if (!userId) throw new MemberLookupError("user_not_found", { stage: STAGES.FIND_USER });

    /* 이미 이 센터에 있는 사람인가. 없으면 null 이고, 있으면 화면이 "이미
       소속되어 있습니다"라고 말한다 -- 없이 두면 대표가 추가를 눌렀다가
       거부되는 이유를 알 수 없다. 퇴사한 사람도 여기서 잡혀, 새로 만드는 대신
       되살리는 길로 간다. */
    let membership = null;
    try {
      membership = await readMembership(membershipId(organizationId, userId));
    } catch (error) {
      throw new MemberLookupError("lookup_unavailable", { stage: STAGES.READ_MEMBERSHIP, cause: error });
    }

    return {
      userId,
      // Auth 가 이름을 모르는 계정도 있다. 그때는 대표가 직접 적는다.
      displayName: text(user?.displayName),
      membership: membership
        ? {
          role: text(membership.role),
          status: text(membership.status),
          title: text(membership.title),
          displayName: text(membership.displayName),
        }
        : null,
    };
  }

  return { lookupByEmail };
}

module.exports = {
  MemberLookupError,
  STAGES,
  createMemberLookupService,
  membershipId,
  normalizeEmail,
};
