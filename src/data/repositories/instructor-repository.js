/**
 * 조직의 강사 목록.
 *
 * ── 왜 memberships 를 읽는가 ──
 * "이 센터의 강사"를 적어 둔 곳은 memberships 말고 없다. 역할이 거기 있고,
 * 접근 판정도 거기서 나온다. 강사 명단을 따로 두면 둘이 어긋나는 날이 오고,
 * 그때 화면의 명단과 실제 권한이 다른 사람을 가리킨다.
 *
 * ── 규칙은 바꾸지 않았다 ──
 * memberships 의 read 규칙은
 *   resource.data.userId == request.auth.uid
 *   || hasRole(resource.data.organizationId, ["owner", "manager"])
 * 인데, 아래 쿼리는 organizationId 를 걸어 두 번째 가지를 증명한다. 그래서
 * 대표·매니저에게는 통과하고 강사에게는 거부된다 — 발급 화면이 대표·매니저
 * 전용이므로 그대로 맞는 경계다. 에뮬레이터로 확인했고 테스트로 고정했다.
 *
 * list 는 쿼리가 보장하는 것으로 평가된다. organizationId 필터를 빼면
 * "Property organizationId is undefined" 로 쿼리 전체가 거부된다 --
 * firestore.foundation.rules 머리말의 B 항목이 그 이야기다.
 */

import { COLLECTIONS, MEMBERSHIP_STATUS, ROLES } from "../schema/constants.js";
import { readCollection } from "./repository-read.js";

/**
 * @typedef {object} InstructorStore
 * @property {(organizationId: string, role: string) => Promise<Array<any>>} listByRole
 */

const requiredText = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  return text;
};

/**
 * Firestore 를 읽는 기본 구현. 세 조건 모두 동등 비교라 복합 인덱스가 필요
 * 없다 — 정렬이나 범위를 더하는 순간 필요해지므로 이름순 정렬은 아래에서
 * 클라이언트가 한다.
 */
export function createFirestoreInstructorStore() {
  return {
    listByRole: async (organizationId, role) => {
      const { collection, getDocs, getFirestore, query, where } = await import("firebase/firestore");
      const snapshot = await getDocs(query(
        collection(getFirestore(), COLLECTIONS.MEMBERSHIPS),
        where("organizationId", "==", organizationId),
        where("role", "==", role),
        where("status", "==", MEMBERSHIP_STATUS.ACTIVE),
      ));
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    },
  };
}

const byName = (left, right) =>
  String(left.displayName || left.userId || "").localeCompare(String(right.displayName || right.userId || ""), "ko");

/**
 * 활성 강사만, 이름순으로. 이름이 없으면 userId 를 그대로 보여준다 -- 목록에서
 * 빼면 그 강사에게 회원권을 발급할 길이 사라지는데, 화면에는 그 강사가 없는
 * 것처럼만 보인다.
 *
 * displayName 은 membership 문서가 들고 있으면 쓴다. 없으면 화면이 userId 를
 * 보여주게 두고, 이름을 채우는 일은 별도 작업으로 둔다 -- users/{uid} 를
 * 강사 수만큼 더 읽는 것은 이 화면이 감당할 비용이 아니다.
 *
 * @param {string} organizationId
 * @param {{ store?: InstructorStore, role?: string }} [options]
 */
export async function listInstructors(organizationId, options = {}) {
  const { store = createFirestoreInstructorStore(), role = ROLES.INSTRUCTOR } = options;
  const organization = requiredText(organizationId, "organizationId");
  // 조회 실패는 빈 목록이 아니라 RepositoryReadError 로 나간다 -- repository-read.js 참고.
  const found = await readCollection({
    feature: "instructor_directory",
    path: `${COLLECTIONS.MEMBERSHIPS}?organizationId=${organization}&role=${role}`,
    read: () => store.listByRole(organization, role),
  });
  return found
    .map((membership) => ({
      ...membership,
      userId: String(membership.userId || ""),
      displayName: String(membership.displayName || ""),
    }))
    .filter((membership) => membership.userId)
    .sort(byName);
}
