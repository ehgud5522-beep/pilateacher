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

/**
 * @param {string} userId
 * @param {{ listActiveMemberships?: (userId: string) => Promise<Array<MembershipDocument>>, warn?: (code: string, detail: object) => void }} [options]
 * @returns {Promise<{ organizationId: string, role: string, status: string, isLegacy: boolean }>}
 */
export async function resolveOrganizationContext(userId, options = {}) {
  const id = required(userId, "userId");
  const { listActiveMemberships, warn = () => {} } = options;

  let memberships = [];
  if (typeof listActiveMemberships === "function") {
    try {
      const found = await listActiveMemberships(id);
      memberships = (Array.isArray(found) ? found : [])
        .filter((entry) => entry && entry.status === MEMBERSHIP_STATUS.ACTIVE && entry.organizationId);
    } catch (error) {
      // 읽지 못한 것과 소속이 없는 것은 다르다. 네트워크 실패로 소속 강사를
      // 개인 모드로 보내면 자기 지점 회원이 보이지 않고, 그 상태에서 한 입력이
      // 엉뚱한 조직에 쌓인다. unknown 으로 남기고 센터 기능을 잠근다.
      warn("organization_context_lookup_failed", {
        feature: "organization_context",
        stage: "list_memberships",
        errorDomain: "firestore",
        errorCode: error?.code || "unknown",
        message: error?.message || "",
      });
      return unknownOrganizationContext();
    }
  }

  if (memberships.length === 0) {
    return {
      organizationId: legacyOrganizationId(id),
      role: ROLES.OWNER,
      status: MEMBERSHIP_STATUS.ACTIVE,
      isLegacy: true,
    };
  }

  if (memberships.length > 1) {
    // 한 사람이 여러 조직에 속하는 경우는 아직 지원 범위 밖이다. 조용히 하나를
    // 고르면 어느 조직의 화면을 보고 있는지 아무도 모르게 되므로 남긴다.
    warn("organization_context_multiple_memberships", {
      feature: "organization_context",
      stage: "resolve",
      membershipCount: memberships.length,
      selectedOrganizationId: memberships[0].organizationId,
    });
  }

  const membership = memberships[0];
  return {
    organizationId: membership.organizationId,
    role: membership.role || ROLES.MEMBER,
    status: membership.status,
    isLegacy: false,
  };
}
