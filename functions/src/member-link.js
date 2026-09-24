"use strict";

/**
 * 계정 ↔ 회원 연결. 설계 문서 4장.
 *
 * ── 이 파일이 여는 것 ──
 * `clients.userId` 는 규칙이 기다리는 칸인데 아무도 채우지 않았다. 회원 본인에게
 * `clients` update 를 열면 자기 이름·상태까지 고칠 수 있고, 무엇보다 **남의
 * 문서에 자기 uid 를 써서 그 회원권을 볼 수 있다.** 그래서 서버만 쓴다.
 *
 * ── 무엇을 믿는가 ──
 * `request.auth.token.phone_number` 하나만 믿는다. Firebase Auth 가 인증한
 * 값이다. 클라이언트가 보낸 번호는 읽지도 않는다 — 보냈다면 그것은 남의 번호일
 * 수 있고, 한 번 잘못 이으면 남의 회원권을 보게 되며 **그 사실은 아무도 모른다.**
 *
 * ── 왜 collectionGroup 이 아닌가 ──
 * 설계 문서는 `collectionGroup("clients").where("phone","==",…)` 로 적었다. 그
 * 질의는 COLLECTION_GROUP 범위의 단일 필드 색인을 따로 선언해야 하는데,
 * fieldOverrides 는 그 필드의 **자동 색인을 통째로 대체한다** — clients.phone 의
 * 나머지 색인을 손으로 다시 적어야 하고, 하나를 빠뜨리면 이미 있는 질의가 조용히
 * 깨진다. 게다가 에뮬레이터는 색인 없이도 그룹 질의를 받아 주어서 테스트가
 * 통과해도 프로덕션에서만 실패한다 — 테스트가 증명하지 못하는 것을 믿게 된다.
 *
 * 그래서 센터를 훑으며 센터마다 묻는다. 동등 조건 하나라 자동 색인으로 끝나고,
 * 연결은 회원 한 명이 가입할 때 한 번 부르는 통로다. 센터 수만큼 질의가 늘지만
 * 그 수는 두 자리를 넘지 않는다.
 */

/* 번호 옮기기는 functions/shared 에 ESM 으로 있다 (앱이 명부에 쓰는 철자와
   같아야 같은 사람을 찾는다). 이 파일은 CommonJS 라 require 할 수 없어 동적
   import 로 읽는다 -- Node 가 모듈을 캐시하므로 인스턴스당 한 번이다. */
let phoneModule = null;
async function loadPhoneFromToken() {
  if (!phoneModule) phoneModule = await import("../shared/phone.mjs");
  return phoneModule.phoneFromVerifiedToken;
}

const STAGES = Object.freeze({
  AUTHORIZE: "authorize",
  FIND_CANDIDATES: "find_candidates",
  VERIFY_OWNER: "verify_owner",
  READ_CLIENT: "read_client",
  WRITE: "write",
});

/**
 * 연결 문서(`memberLinks/{uid}`)의 상태.
 *
 * `taken` 은 설계 문서 표에 없던 것이다. 후보가 **이미 다른 계정에 연결된**
 * 경우인데, 가족 공용 번호에서 실제로 일어난다. 덮어쓰면 먼저 연결한 사람이
 * 조용히 남의 회원권을 보게 되므로 덮지 않고 여기서 멈춘다.
 */
const LINK_STATUS = Object.freeze({
  LINKED: "linked",
  ENDED: "ended",
  MULTI_LOCATION: "multi_location",
  AMBIGUOUS: "ambiguous",
  NOT_FOUND: "not_found",
  TAKEN: "taken",
  REJECTED: "rejected",
});

/** 지금 쓸 수 있는 회원권을 가진 상태. 나머지는 이어 주되 읽기 전용이다. */
const USABLE_CLIENT_STATUS = Object.freeze(["active", "hold"]);

/** 연결이 성립한 상태. 이때만 clients.userId 를 쓴다. */
const LINKED_STATUSES = Object.freeze([
  LINK_STATUS.LINKED, LINK_STATUS.ENDED, LINK_STATUS.MULTI_LOCATION,
]);

/** 대기 목록에 올라가는 상태. 대표가 손으로 골라야 끝난다. */
const PENDING_STATUS = LINK_STATUS.AMBIGUOUS;

class MemberLinkError extends Error {
  constructor(code, options = {}) {
    super(options.message || code, options.cause ? { cause: options.cause } : undefined);
    this.name = "MemberLinkError";
    this.code = code;
    this.stage = options.stage || STAGES.AUTHORIZE;
  }
}

const text = (value) => String(value ?? "").trim();

/* 규칙의 membershipId() 와 같은 형식이다. 어긋나면 서버가 찾은 소속과 규칙이
   보는 소속이 서로 다른 문서가 된다. */
const membershipId = (organizationId, userId) => `${organizationId}_${userId}`;

/**
 * 이 소속 문서가 지금 일하는 대표의 것인가. 규칙의 `hasRole(["owner"])` 과 같다.
 *
 * 한 곳에 둔다 -- 투영 점검 문(member-view-admin.js)도 같은 판정을 쓰는데, 두
 * 벌이 되면 한쪽만 "퇴사한 대표"를 통과시키는 날이 온다.
 */
const isActiveOwner = (membership) => (
  Boolean(membership) && membership.status === "active" && membership.role === "owner"
);

/** 후보 하나를 판정에 필요한 만큼만 남긴다. 이름·연락처는 담지 않는다. */
function normalizeCandidate(candidate) {
  return {
    organizationId: text(candidate?.organizationId),
    clientId: text(candidate?.clientId || candidate?.id),
    locationId: text(candidate?.locationId),
    status: text(candidate?.status),
    userId: text(candidate?.userId),
  };
}

/* 같은 사람이 두 번 잡힌 것인지, 두 지점에 각각 있는 것인지를 가르는 열쇠.
   센터가 다르면 지점도 다르므로 센터를 앞에 둔다. */
const placeKey = (candidate) => `${candidate.organizationId}/${candidate.locationId}`;

/**
 * 찾은 회원들로 무엇을 할지 정한다. **이 파일의 핵심이고 순수 함수다.**
 *
 * 자동으로 잇지 않는 경우(`ambiguous`)가 있다는 것이 설계의 요점이다. 동명이인과
 * 가족 공용 번호가 실제로 있다.
 *
 * @param {Array<any>} input 찾은 회원들
 * @param {string} userId 지금 연결하려는 계정
 */
function decideLink(input, userId) {
  const uid = text(userId);
  const all = (Array.isArray(input) ? input : []).map(normalizeCandidate)
    .filter((candidate) => candidate.organizationId && candidate.clientId);

  /* 이미 남의 계정에 연결된 문서는 후보에서 뺀다. 덮어쓰지 않는 것이 여기서
     가장 중요한 결정이다. 자기 자신에게 이미 연결된 것은 남긴다 — 앱을 다시
     깔고 불러도 같은 답이 나와야 한다. */
  const mine = all.filter((candidate) => !candidate.userId || candidate.userId === uid);
  const takenCount = all.length - mine.length;

  if (!mine.length) {
    return {
      status: takenCount ? LINK_STATUS.TAKEN : LINK_STATUS.NOT_FOUND,
      links: [], candidates: [], candidateCount: all.length, takenCount,
    };
  }

  if (mine.length === 1) {
    const only = mine[0];
    return {
      status: USABLE_CLIENT_STATUS.includes(only.status) ? LINK_STATUS.LINKED : LINK_STATUS.ENDED,
      links: [only], candidates: [], candidateCount: all.length, takenCount,
    };
  }

  /* 둘 이상이다. 같은 지점에 둘이면 어느 쪽인지 서버가 알 수 없다 — 대표가
     고른다. 지점이 전부 다르면 한 사람이 두 지점을 다니는 경우로 보고 전부
     잇는다 (확정 7번). */
  const places = new Set(mine.map(placeKey));
  if (places.size < mine.length) {
    return {
      status: LINK_STATUS.AMBIGUOUS,
      links: [], candidates: mine, candidateCount: all.length, takenCount,
    };
  }
  return {
    status: LINK_STATUS.MULTI_LOCATION,
    links: mine, candidates: [], candidateCount: all.length, takenCount,
  };
}

/**
 * @param {{
 *   listOrganizationIds: () => Promise<Array<string>>,
 *   findClientsByPhone: (organizationId: string, phone: string) => Promise<Array<any>>,
 *   readClient: (organizationId: string, clientId: string) => Promise<any>,
 *   readMembership: (membershipDocumentId: string) => Promise<any>,
 *   writeLink: (input: any) => Promise<any>,
 *   removeLink: (input: any) => Promise<any>,
 *   listLinksByStatus: (status: string) => Promise<Array<any>>,
 *   phoneFromToken?: (value: any) => string,
 *   now?: () => Date,
 * }} dependencies
 */
function createMemberLinkService(dependencies) {
  const {
    listOrganizationIds,
    findClientsByPhone,
    readClient,
    readMembership,
    writeLink,
    removeLink,
    listLinksByStatus,
    phoneFromToken = null,
    now = () => new Date(),
  } = dependencies || {};

  /** 이 사람이 이 센터의 대표인가. 규칙의 hasRole(["owner"]) 과 같은 판정이다. */
  async function requireOwner(organizationId, callerUid) {
    let membership = null;
    try {
      membership = await readMembership(membershipId(organizationId, callerUid));
    } catch (error) {
      throw new MemberLinkError("link_unavailable", { stage: STAGES.VERIFY_OWNER, cause: error });
    }
    if (!isActiveOwner(membership)) {
      throw new MemberLinkError("not_owner", { stage: STAGES.VERIFY_OWNER });
    }
    return membership;
  }

  /* 모든 센터에서 이 번호를 찾는다. 한 센터가 실패하면 전체를 실패로 끝낸다 —
     일부만 보고 "찾지 못했습니다"라고 말하면 그것은 틀린 답이고, 회원은 그 말을
     믿고 센터에 전화하지 않는다. */
  async function findCandidates(phone) {
    let organizationIds = [];
    try {
      organizationIds = await listOrganizationIds();
    } catch (error) {
      throw new MemberLinkError("link_unavailable", { stage: STAGES.FIND_CANDIDATES, cause: error });
    }
    try {
      const pages = await Promise.all(
        organizationIds.map((organizationId) => findClientsByPhone(organizationId, phone)),
      );
      return pages.flat();
    } catch (error) {
      throw new MemberLinkError("link_unavailable", { stage: STAGES.FIND_CANDIDATES, cause: error });
    }
  }

  /** 회원 본인이 부른다. 인증된 번호로 자기 회원 문서를 찾아 잇는다. */
  async function linkForCaller(request) {
    const userId = text(request?.auth?.uid);
    if (!userId) throw new MemberLinkError("unauthenticated", { stage: STAGES.AUTHORIZE });

    /* 클라이언트가 보낸 번호는 보지 않는다. 토큰의 번호만이 인증된 값이다. */
    const toRosterPhone = phoneFromToken || await loadPhoneFromToken();
    const phone = toRosterPhone(request?.auth?.token?.phone_number);
    if (!phone) throw new MemberLinkError("phone_not_verified", { stage: STAGES.AUTHORIZE });

    const decision = decideLink(await findCandidates(phone), userId);

    try {
      await writeLink({
        userId, phone, at: now(),
        status: decision.status,
        links: decision.links,
        candidates: decision.candidates,
        candidateCount: decision.candidateCount,
        linkedBy: "",
      });
    } catch (error) {
      throw new MemberLinkError("link_unavailable", { stage: STAGES.WRITE, cause: error });
    }

    return {
      status: decision.status,
      candidateCount: decision.candidateCount,
      links: decision.links.map(({ organizationId, clientId }) => ({ organizationId, clientId })),
    };
  }

  /**
   * 대표가 후보 중 하나를 골라 잇는다.
   *
   * `linkedBy` 에 그 uid 를 남긴다 — 누가 누구를 이었는지가 남아야 나중에 "왜 이
   * 사람이 저 회원권을 봤나"에 답할 수 있다.
   */
  async function linkByOwner(request) {
    const callerUid = text(request?.auth?.uid);
    if (!callerUid) throw new MemberLinkError("unauthenticated", { stage: STAGES.AUTHORIZE });

    const userId = text(request?.data?.userId);
    const organizationId = text(request?.data?.organizationId);
    const clientId = text(request?.data?.clientId);
    if (!userId || !organizationId || !clientId) {
      throw new MemberLinkError("invalid_request", { stage: STAGES.AUTHORIZE });
    }

    const membership = await requireOwner(organizationId, callerUid);

    let client = null;
    try {
      client = await readClient(organizationId, clientId);
    } catch (error) {
      throw new MemberLinkError("link_unavailable", { stage: STAGES.READ_CLIENT, cause: error });
    }
    if (!client) throw new MemberLinkError("client_not_found", { stage: STAGES.READ_CLIENT });

    /* 이미 다른 계정의 것이면 대표라도 덮어쓰지 않는다. 먼저 끊고 다시 잇는다 —
       그래야 두 조작이 감사에 각각 남는다. */
    const owner = text(client.userId);
    if (owner && owner !== userId) {
      throw new MemberLinkError("already_linked", { stage: STAGES.READ_CLIENT });
    }

    const status = USABLE_CLIENT_STATUS.includes(text(client.status))
      ? LINK_STATUS.LINKED : LINK_STATUS.ENDED;
    const link = {
      organizationId, clientId, userId,
      locationId: text(client.locationId), status: text(client.status),
    };

    try {
      await writeLink({
        /* 번호는 적지 않는다. 대표가 고른 길에는 인증된 번호가 없고, 회원이
           직접 불렀을 때 적힌 값이 있으면 그대로 둔다. */
        userId, phone: "", at: now(),
        status, links: [link], candidates: [], candidateCount: 1,
        linkedBy: callerUid,
        audit: {
          organizationId, actorId: callerUid, actorRole: text(membership.role),
          clientId, targetId: userId,
        },
      });
    } catch (error) {
      throw new MemberLinkError("link_unavailable", { stage: STAGES.WRITE, cause: error });
    }

    return { status, links: [{ organizationId, clientId }] };
  }

  /**
   * 연결을 끊는다. 대표만.
   *
   * 투영 문서도 그 자리에서 지운다 — `userId` 만 지우면 이미 깔린 투영을 그
   * 사람이 계속 읽는다.
   */
  async function unlink(request) {
    const callerUid = text(request?.auth?.uid);
    if (!callerUid) throw new MemberLinkError("unauthenticated", { stage: STAGES.AUTHORIZE });

    const userId = text(request?.data?.userId);
    const organizationId = text(request?.data?.organizationId);
    const clientId = text(request?.data?.clientId);
    if (!userId || !organizationId || !clientId) {
      throw new MemberLinkError("invalid_request", { stage: STAGES.AUTHORIZE });
    }

    const membership = await requireOwner(organizationId, callerUid);

    try {
      await removeLink({
        userId, organizationId, clientId, at: now(),
        audit: {
          organizationId, actorId: callerUid, actorRole: text(membership.role),
          clientId, targetId: userId,
        },
      });
    } catch (error) {
      throw new MemberLinkError("link_unavailable", { stage: STAGES.WRITE, cause: error });
    }

    return { status: LINK_STATUS.REJECTED };
  }

  /**
   * 대표가 볼 대기 목록. `ambiguous` 만 돌려준다.
   *
   * 후보 중 하나라도 이 대표의 센터에 있는 것만 보인다. 그러지 않으면 한 대표가
   * 다른 센터에 전화한 사람의 번호를 보게 된다.
   *
   * `not_found` 는 여기 없다. 그 사람은 어느 센터의 명부에도 없어서 누구에게
   * 보여야 할지 정할 수 없다 — 그 경우의 답은 대표가 명부에 등록하는 것이고,
   * 그러면 회원이 다시 부를 때 이어진다.
   */
  async function listPending(request) {
    const callerUid = text(request?.auth?.uid);
    if (!callerUid) throw new MemberLinkError("unauthenticated", { stage: STAGES.AUTHORIZE });
    const organizationId = text(request?.data?.organizationId);
    if (!organizationId) throw new MemberLinkError("invalid_request", { stage: STAGES.AUTHORIZE });
    await requireOwner(organizationId, callerUid);

    let rows = [];
    try {
      rows = await listLinksByStatus(PENDING_STATUS);
    } catch (error) {
      throw new MemberLinkError("link_unavailable", { stage: STAGES.FIND_CANDIDATES, cause: error });
    }

    return rows
      .map((row) => ({
        userId: text(row?.userId),
        phone: text(row?.phone),
        candidates: (Array.isArray(row?.candidates) ? row.candidates : [])
          .map(normalizeCandidate)
          .filter((candidate) => candidate.organizationId === organizationId),
      }))
      .filter((row) => row.userId && row.candidates.length);
  }

  return { linkForCaller, linkByOwner, unlink, listPending };
}

module.exports = {
  LINKED_STATUSES,
  LINK_STATUS,
  MemberLinkError,
  PENDING_STATUS,
  STAGES,
  USABLE_CLIENT_STATUS,
  createMemberLinkService,
  decideLink,
  isActiveOwner,
  membershipId,
  normalizeCandidate,
};
