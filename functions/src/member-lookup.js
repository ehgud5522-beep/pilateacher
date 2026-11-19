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

/* Auth getUsers 한 번이 받는 한계가 100 이다. 한 센터의 강사 목록은 그보다 작다. */
const MAX_EMAIL_LOOKUPS = 100;

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
 *   findUsersByUids?: (uids: string[]) => Promise<Array<{ uid: string, email?: string }>>,
 *   isNotFoundError?: (error: any) => boolean,
 * }} dependencies
 */
function createMemberLookupService(dependencies) {
  const {
    findUserByEmail,
    readMembership,
    findUsersByUids = async () => [],
    isNotFoundError = (error) => String(error?.code || "") === "auth/user-not-found",
  } = dependencies || {};

  /** 이 사람이 이 센터에서 대표와 같은 자리인가. 규칙의 hasRole(ownerLevel()) 과 같다. */
  async function requireOwner(organizationId, callerUid) {
    let membership = null;
    try {
      membership = await readMembership(membershipId(organizationId, callerUid));
    } catch (error) {
      throw new MemberLookupError("lookup_unavailable", { stage: STAGES.VERIFY_OWNER, cause: error });
    }
    if (!membership || membership.status !== "active"
      || !(membership.role === "owner" || membership.role === "area_manager")) {
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

  /**
   * 이 센터 사람들의 로그인 이메일 (2026-11-19 대표: "계정 교체 · 추가 때 이름이 같으면
   * 구분이 어렵다, 기존 것이 어떤 이메일인지 확인이 필요하다").
   *
   * 같은 사람이 계정을 바꾸면 이름이 같은 소속이 둘 생긴다 -- 계정 교체 화면이 그
   * 둘을 이름으로만 보여 주면 대표가 어느 쪽이 새 계정인지 고를 수 없다.
   *
   * 대표 · 총괄매니저만. **이 센터 소속 문서가 있는 uid 만** 돌려준다 -- 아무 uid 나
   * 넣어 남의 이메일을 캐는 통로가 되면 안 된다. 전화번호는 돌려주지 않는다.
   * 로그에는 이메일도 uid 도 남기지 않는다 (§7).
   *
   * @param {{ auth?: { uid?: string }, data?: { organizationId?: string, userIds?: string[] } }} request
   */
  async function listEmails(request) {
    const callerUid = text(request?.auth?.uid);
    if (!callerUid) throw new MemberLookupError("unauthenticated", { stage: STAGES.AUTHORIZE });
    const organizationId = text(request?.data?.organizationId);
    const asked = Array.isArray(request?.data?.userIds) ? request.data.userIds.map(text).filter(Boolean) : [];
    if (!organizationId || asked.length > MAX_EMAIL_LOOKUPS) {
      throw new MemberLookupError("invalid_request", { stage: STAGES.AUTHORIZE });
    }
    await requireOwner(organizationId, callerUid);

    const unique = [...new Set(asked)];
    let memberships;
    try {
      memberships = await Promise.all(unique.map((userId) => readMembership(membershipId(organizationId, userId))));
    } catch (error) {
      throw new MemberLookupError("lookup_unavailable", { stage: STAGES.READ_MEMBERSHIP, cause: error });
    }
    const belonging = unique.filter((userId, index) => memberships[index]);
    if (!belonging.length) return { emails: {} };

    let users;
    try {
      users = await findUsersByUids(belonging);
    } catch (error) {
      throw new MemberLookupError("lookup_unavailable", { stage: STAGES.FIND_USER, cause: error });
    }
    const emails = {};
    for (const user of Array.isArray(users) ? users : []) {
      const uid = text(user?.uid);
      if (uid && belonging.includes(uid) && text(user?.email)) emails[uid] = text(user.email);
    }
    return { emails };
  }

  return { lookupByEmail, listEmails };
}

module.exports = {
  MemberLookupError,
  STAGES,
  createMemberLookupService,
  membershipId,
  normalizeEmail,
};
