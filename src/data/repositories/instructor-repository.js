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
import { paths } from "../schema/paths.js";
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

/* ── 풀방금액 ──────────────────────────────────────────────────────────────
   pt_1_1_repurchase_normal 한 카테고리만 이 값을 쓴다 (pay-rates.js 참고).
   강사가 등급 시험에 합격하면 오르므로 이 값은 바뀌고, "언제부터 이 금액이었나"
   를 확인할 수 있어야 한다.

   이력은 memberships/{id}/rateHistory 하위 컬렉션에 쌓는다. 회원권 문서 안에
   배열로 두지 않는 이유가 있다 -- 규칙의 isActiveMember()·hasRole() 이 판정마다
   membership 문서를 get() 하므로, 그 문서가 자라면 모든 규칙 평가가 같이
   무거워진다. 이력은 거의 읽지 않고 계속 쌓이는 데이터라 그 자리에 두면 안 된다.

   이력은 기록용이다. 급여 기준은 언제나 원장에 박힌 unitPrice 이고, 단가를
   올려도 지난달 급여는 움직이지 않는다. 이 파일을 급여 계산이 참조하면 그
   원칙이 깨진다.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {object} InstructorRateStore
 * @property {(writes: Array<{ path: string, data: object, operation?: "set" | "update" }>) => Promise<void>} commit
 * @property {() => Promise<any>} serverTimestamp
 */

/** 풀방금액을 읽는다. 없거나 숫자가 아니면 null 이다 -- 0 과 구분한다. */
export function fullRoomRateOf(membership) {
  const rate = membership?.fullRoomRate;
  return typeof rate === "number" && Number.isInteger(rate) && rate >= 0 ? rate : null;
}

/** 이 강사에게 재등록(정상) 상품을 발급할 수 있는가. 0 은 아직 정해지지 않은 것으로 본다. */
export function hasUsableFullRoomRate(membership) {
  const rate = fullRoomRateOf(membership);
  return rate !== null && rate > 0;
}

export function createFirestoreInstructorRateStore() {
  const load = () => import("firebase/firestore");
  return {
    commit: async (writes) => {
      const { doc, getFirestore, writeBatch } = await load();
      const firestore = getFirestore();
      const batch = writeBatch(firestore);
      for (const write of writes) {
        const reference = doc(firestore, write.path);
        if (write.operation === "update") batch.update(reference, write.data);
        else batch.set(reference, write.data);
      }
      await batch.commit();
    },
    serverTimestamp: async () => {
      const { serverTimestamp } = await load();
      return serverTimestamp();
    },
  };
}

/**
 * 풀방금액을 바꾸고 이력을 함께 남긴다.
 *
 * 금액만 바뀌고 이력이 없으면 "언제부터 이 금액이었나"가 사라지고, 이력만
 * 남고 금액이 그대로면 둘이 어긋난다. 그래서 한 배치로 묶는다 -- 발급이 회원권과
 * 원장을 묶는 것과 같은 이유다.
 *
 * @param {string} organizationId
 * @param {string} userId 강사의 uid
 * @param {{ newRate: number | string, previousRate?: number | null, changedBy: string, entryId?: string }} input
 * @param {{ store?: InstructorRateStore, newId?: () => string }} [options]
 */
export async function setInstructorFullRoomRate(organizationId, userId, input, options = {}) {
  const {
    store = createFirestoreInstructorRateStore(),
    newId = () => globalThis.crypto?.randomUUID?.() || `rate-${Date.now()}`,
  } = options;
  const organization = requiredText(organizationId, "organizationId");
  const instructorId = requiredText(userId, "userId");
  const changedBy = requiredText(input?.changedBy, "changedBy");

  // 빈 칸을 Number() 에 넘기면 0 이 된다. 0 은 "무보수"이지 "비움"이 아니다.
  const raw = input?.newRate;
  const text = typeof raw === "number" ? raw : String(raw ?? "").trim();
  if (text === "") throw new Error("Missing newRate");
  const newRate = Number(text);
  if (!Number.isInteger(newRate) || newRate < 0) throw new Error("Invalid newRate");

  const previous = input?.previousRate;
  const previousRate = typeof previous === "number" && Number.isInteger(previous) && previous >= 0
    ? previous
    : null;
  if (previousRate === newRate) throw new Error("Invalid newRate");

  const membershipPath = paths.orgMembership(organization, instructorId);
  const stampedAt = await store.serverTimestamp();
  const entryId = String(input?.entryId || newId());

  const entry = {
    organizationId: organization,
    userId: instructorId,
    previousRate,
    newRate,
    effectiveFrom: stampedAt,
    changedBy,
    createdAt: stampedAt,
  };

  await store.commit([
    // set 이 아니라 update 다. set 이면 role 도 status 도 통째로 날아가고,
    // 그 순간 이 강사는 센터의 아무것도 읽지 못한다.
    { path: membershipPath, data: { fullRoomRate: newRate }, operation: "update" },
    { path: `${membershipPath}/${COLLECTIONS.RATE_HISTORY}/${entryId}`, data: entry },
  ]);
  return { userId: instructorId, entryId, newRate, previousRate, entry };
}
