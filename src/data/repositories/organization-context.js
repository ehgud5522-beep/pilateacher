/**
 * 로그인한 사용자가 어느 조직에 속하고 어떤 역할인지 해석한다.
 *
 * 읽는 문서는 규칙의 isActiveMember()·hasRole() 이 읽는 것과 같다 —
 * memberships/{organizationId}_{userId}. 접근 판정의 기반이므로 조직 하위가
 * 아니라 최상위에 있다.
 *
 * 문서 id가 userId 로 끝나지만 Firestore 는 접미사 쿼리를 지원하지 않는다.
 * 그래서 본문의 userId 필드로 조회한다.
 *
 * 소속 문서가 없는 사용자는 강사 1명 = 조직 1개였던 기존 구조의 사용자다.
 * legacyOrganizationId(userId) 로 떨어지고 스스로 owner 가 된다.
 */

import { legacyOrganizationId } from "../dual-write/feature-flags.js";
import { COLLECTIONS, MEMBERSHIP_STATUS, ROLES } from "../schema/constants.js";

/**
 * 아직 아무것도 읽지 않은 상태. ready: false 가 "모른다"이고, ready: true 에
 * isLegacy: true 가 "개인 모드로 확정"이다. 둘을 같은 값으로 두면 시작 중인
 * 화면과 개인 모드 화면을 구분할 수 없다.
 */
export const UNRESOLVED_ORGANIZATION_CONTEXT = Object.freeze({
  organizationId: "",
  role: "",
  status: "",
  /* membership 에 적힌 내 이름. users/{uid} 대신 여기 두는 이유는 규칙 파일의
     memberships 블록 주석에 있다 -- 이름을 읽자고 그 문서를 열면 전화번호와
     이메일이 함께 열린다. */
  displayName: "",
  /* 부원장인가. 차감할 때 급여 판정 1 이 이 값을 본다
     (deduction-pricing.js). 여기 두는 이유는 값이 필요한 그 순간에 이미
     읽혀 있기 때문이다 -- 로그인할 때 내 membership 을 한 번 읽고, 그 문서에
     이 필드가 들어 있다. 차감할 때마다 다시 읽으면 수업이 끝난 자리에서
     누르는 버튼에 왕복이 하나 더 붙는다.

     대가는 최신성이다. 대표가 지금 지정해도 그 강사의 앱은 다음에 컨텍스트를
     다시 읽을 때부터 안다. 등급 승진처럼 미리 정해지고 거의 바뀌지 않는
     값이라 그 대가를 받아들였고, 강사 단가 화면이 그 사실을 말한다. */
  isDeputyDirector: false,
  isLegacy: false,
  ready: false,
});

/** @param {object} resolved */
export function readyOrganizationContext(resolved) {
  return { ...UNRESOLVED_ORGANIZATION_CONTEXT, ...resolved, ready: true };
}

/** 조회 자체가 실패한 상태. legacy 와 구분한다 — 아래 resolve 주석 참고. */
export function unknownOrganizationContext() {
  return { organizationId: "", role: "", status: "unknown", isLegacy: false };
}

/**
 * @typedef {object} MembershipDocument
 * @property {string} [organizationId]
 * @property {string} [userId]
 * @property {string} [role]
 * @property {string} [status]
 * @property {string} [displayName]
 * @property {boolean} [isDeputyDirector]
 */

const required = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  return text;
};

/**
 * Firestore 를 읽는 기본 구현. firebase 모듈은 호출 시점에만 불러온다 —
 * 로그인 전 앱 시작 경로에 Firestore 를 끌어들이지 않기 위해서다.
 */
export function createFirestoreMembershipReader() {
  return async (userId) => {
    const { collection, getDocs, getFirestore, query, where } = await import("firebase/firestore");
    const snapshot = await getDocs(query(
      collection(getFirestore(), COLLECTIONS.MEMBERSHIPS),
      where("userId", "==", userId),
      where("status", "==", MEMBERSHIP_STATUS.ACTIVE),
    ));
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  };
}

/** 이 기능의 모든 진단이 공유하는 이름. 로그를 한 줄로 이어 붙이는 열쇠다. */
export const ORGANIZATION_CONTEXT_FEATURE = "organization_context";

/**
 * 세션이 실제로 쓴 uid 를 값 없이 지목한다. 길이와 양끝 4자면 "콘솔에서 본
 * 그 계정이 맞는가"를 가를 수 있고, 이것만으로 사람을 특정할 수는 없다 --
 * 원본 uid 는 §7 에 따라 남기지 않는다.
 *
 * @param {string} userId
 */
export function userIdFingerprint(userId) {
  const text = String(userId ?? "");
  return {
    uidLength: text.length,
    uidPrefix: text.slice(0, 4),
    uidSuffix: text.slice(-4),
  };
}

/**
 * 소속 조회를 기다리는 한계. 이 시간을 넘기면 unknown 으로 확정한다.
 *
 * 영원히 기다리는 것은 선택지가 아니다. 답이 오지 않는 동안 화면은 ready:false
 * 인데, 그 상태에는 메뉴도 배너도 재시도 버튼도 없다 -- 사용자에게는 아무 일도
 * 일어나지 않는 화면이고, 앱 안에서 빠져나올 방법이 없다. unknown 은 적어도
 * "못 읽었다"고 말하고 [다시 시도]를 준다.
 *
 * 8초는 firebase.js 의 FIRESTORE_READ_TIMEOUT_MS 와 같은 값이다.
 */
export const ORGANIZATION_LOOKUP_TIMEOUT_MS = 8000;

/** 시간 안에 답하지 않은 조회. catch 로 흘려보내 unknown 출구를 같이 쓴다. */
const lookupTimeout = () => Object.assign(
  new Error("Organization lookup did not answer in time."),
  { code: "lookup_timeout" },
);

const withLookupTimeout = (promise, { timeoutMs, setTimer, clearTimer }) => {
  if (!(timeoutMs > 0)) return promise;
  let timer = null;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimer(() => reject(lookupTimeout()), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimer(timer));
};

/**
 * @param {string} userId
 * @param {{ listActiveMemberships?: (userId: string) => Promise<Array<MembershipDocument>>, warn?: (code: string, detail: object) => void, log?: (code: string, detail: object) => void, timeoutMs?: number, setTimer?: Function, clearTimer?: Function }} [options]
 * @returns {Promise<{ organizationId: string, role: string, status: string, displayName?: string, isDeputyDirector?: boolean, isLegacy: boolean }>}
 */
export async function resolveOrganizationContext(userId, options = {}) {
  const id = required(userId, "userId");
  const {
    listActiveMemberships, warn = () => {}, log = () => {},
    timeoutMs = ORGANIZATION_LOOKUP_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout,
  } = options;

  /* 진입과 결말을 둘 다 남긴다. 남기지 않으면 "조회했고 결과가 정상이었다"와
     "조회 자체가 일어나지 않았다"가 콘솔에서 똑같이 무음이라, 소속이 안 잡힐
     때 어느 쪽인지 판정할 방법이 없다. warn 은 문제 전용으로 남겨 둔다 --
     정상 경로가 경고를 찍으면 경고가 신호이기를 그만둔다. */
  log("organization_context_lookup_started", {
    feature: ORGANIZATION_CONTEXT_FEATURE,
    stage: "start",
    source: typeof listActiveMemberships === "function" ? "reader" : "none",
    ...userIdFingerprint(id),
  });
  const resolved = (result, state, detail = {}) => {
    log("organization_context_resolved", {
      feature: ORGANIZATION_CONTEXT_FEATURE,
      stage: "resolved",
      state,
      role: result.role,
      isLegacy: result.isLegacy,
      ...detail,
    });
    return result;
  };

  let memberships = [];
  /* 서버가 몇 건을 돌려줬는지와 필터가 몇 건을 남겼는지는 다른 숫자다. 둘을
     구분하지 않으면 "쿼리가 0건"과 "쿼리는 맞췄는데 필터가 버렸다"가 똑같이
     legacy 로 끝나 원인을 가를 수 없다. 버려진 건은 어느 조건에서 걸렸는지만
     남긴다 -- 값은 남기지 않는다(§7). */
  let receivedCount = 0;
  let dropReason = "";
  if (typeof listActiveMemberships === "function") {
    try {
      const found = await withLookupTimeout(
        Promise.resolve().then(() => listActiveMemberships(id)),
        { timeoutMs, setTimer, clearTimer },
      );
      const received = Array.isArray(found) ? found.filter(Boolean) : [];
      receivedCount = received.length;
      memberships = received
        .filter((entry) => entry && entry.status === MEMBERSHIP_STATUS.ACTIVE && entry.organizationId);
      if (receivedCount > 0 && memberships.length === 0) {
        dropReason = received.some((entry) => entry.status !== MEMBERSHIP_STATUS.ACTIVE)
          ? "status_not_active"
          : "organization_id_missing";
      }
    } catch (error) {
      // 읽지 못한 것과 소속이 없는 것은 다르다. 네트워크 실패로 소속 강사를
      // 개인 모드로 보내면 자기 지점 회원이 보이지 않고, 그 상태에서 한 입력이
      // 엉뚱한 조직에 쌓인다. unknown 으로 남기고 센터 기능을 잠근다.
      const errorCode = error?.code || "unknown";
      // 시간 초과는 Firestore 가 만든 코드가 아니라 이 계층이 만든 코드다.
      // 원본 코드를 덮어쓰지 않도록 계층을 나눠 적는다.
      const errorDomain = errorCode === "lookup_timeout" ? ORGANIZATION_CONTEXT_FEATURE : "firestore";
      warn("organization_context_lookup_failed", {
        feature: ORGANIZATION_CONTEXT_FEATURE,
        stage: "list_memberships",
        errorDomain,
        errorCode,
        message: error?.message || "",
      });
      return resolved(unknownOrganizationContext(), "unknown", { errorDomain, errorCode });
    }
  }

  if (memberships.length === 0) {
    return resolved({
      organizationId: legacyOrganizationId(id),
      role: ROLES.OWNER,
      status: MEMBERSHIP_STATUS.ACTIVE,
      isLegacy: true,
    }, "legacy", { count: receivedCount, membershipCount: 0, reason: dropReason || "no_match" });
  }

  if (memberships.length > 1) {
    // 한 사람이 여러 조직에 속하는 경우는 아직 지원 범위 밖이다. 조용히 하나를
    // 고르면 어느 조직의 화면을 보고 있는지 아무도 모르게 되므로 남긴다.
    warn("organization_context_multiple_memberships", {
      feature: ORGANIZATION_CONTEXT_FEATURE,
      stage: "resolve",
      membershipCount: memberships.length,
      selectedOrganizationId: memberships[0].organizationId,
    });
  }

  const membership = memberships[0];
  return resolved({
    organizationId: membership.organizationId,
    role: membership.role || ROLES.MEMBER,
    status: membership.status,
    displayName: String(membership.displayName || ""),
    // 없으면 false 다. 부원장은 지정받은 사람만이다.
    isDeputyDirector: membership.isDeputyDirector === true,
    isLegacy: false,
  }, "membership", {
    count: receivedCount,
    membershipCount: memberships.length,
    selectedOrganizationId: membership.organizationId,
  });
}
