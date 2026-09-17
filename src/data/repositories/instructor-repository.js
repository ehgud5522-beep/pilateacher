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
import { AUDIT_ACTION, auditEntry, auditLogId } from "./audit-repository.js";
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

/**
 * 부원장인가.
 *
 * 부원장은 카테고리도 누적도 보지 않고 계약 금액의 5:5 를 받는다
 * (deduction-pricing.js 판정 1). 그래서 이 강사의 풀방금액은 의미를 잃는다 --
 * 화면이 금액 대신 "부원장 (5:5)" 를 보여주는 이유다.
 */
export function isDeputyDirectorOf(membership) {
  return membership?.isDeputyDirector === true;
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
 * @param {{ newRate: number | string, previousRate?: number | null, changedBy: string, actorRole?: string, entryId?: string }} input
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

  /* 감사 항목을 같은 배치에 얹는다. 따로 쓰면 기록만 실패한 변경이 생기고,
     감사 로그에서 그것은 "일어나지 않은 일"과 구별되지 않는다.

     rateHistory 에도 남지만 그쪽은 한 강사의 이력이라 센터 전체를 보려면 강사
     수만큼 읽어야 한다. 감사 화면은 한 번에 읽는다 -- 목적이 다르다. */
  const auditId = auditLogId(AUDIT_ACTION.FULL_ROOM_RATE_SET, instructorId, entryId);
  const audit = auditEntry(organization, {
    action: AUDIT_ACTION.FULL_ROOM_RATE_SET,
    actorId: changedBy,
    actorRole: requiredText(input?.actorRole, "actorRole"),
    targetId: instructorId,
    amount: newRate,
    previousAmount: previousRate,
    stampedAt,
  });

  await store.commit([
    // set 이 아니라 update 다. set 이면 role 도 status 도 통째로 날아가고,
    // 그 순간 이 강사는 센터의 아무것도 읽지 못한다.
    { path: membershipPath, data: { fullRoomRate: newRate }, operation: "update" },
    { path: `${membershipPath}/${COLLECTIONS.RATE_HISTORY}/${entryId}`, data: entry },
    { path: paths.auditLog(auditId), data: audit },
  ]);
  return { userId: instructorId, entryId, newRate, previousRate, entry, audit };
}

/**
 * 부원장 지정·해제.
 *
 * ── 이력을 rateHistory 에 함께 넣는다 ──
 * 별도 컬렉션을 만들지 않았다. 두 기록이 답하는 질문이 같기 때문이다 -- "이
 * 강사의 단가 근거가 언제 무엇으로 바뀌었나". 부원장 지정은 사실상 단가 변경이다:
 * 그 순간부터 풀방금액은 쓰이지 않고 계약 금액의 5:5 가 그 자리를 대신한다.
 *
 * 나누면 분쟁 때 두 컬렉션을 시간순으로 합쳐야 하고, 합치는 코드가 없으면 한쪽만
 * 보고 "그때 단가가 안 바뀌었다"고 답하게 된다. 한 줄로 이어져 있어야 한다.
 *
 * 항목은 둘 중 한 쌍만 갖는다 -- 금액 변경이면 previousRate·newRate, 부원장
 * 변경이면 previousDeputyDirector·newDeputyDirector. 규칙이 그것을 강제한다.
 *
 * @param {string} organizationId
 * @param {string} userId
 * @param {{ isDeputyDirector?: boolean, previousDeputyDirector?: boolean | null, changedBy?: string, actorRole?: string, entryId?: string }} input
 * @param {{ store?: InstructorRateStore, newId?: () => string }} [options]
 */
export async function setInstructorDeputyDirector(organizationId, userId, input, options = {}) {
  const {
    store = createFirestoreInstructorRateStore(),
    newId = () => globalThis.crypto?.randomUUID?.() || `deputy-${Date.now()}`,
  } = options;
  const organization = requiredText(organizationId, "organizationId");
  const instructorId = requiredText(userId, "userId");
  const changedBy = requiredText(input?.changedBy, "changedBy");

  /* 자기 자신은 지정하지 못한다. 규칙도 막지만 여기서 먼저 막는다 -- 거부된
     쓰기는 "permission-denied" 로만 돌아와 무엇이 문제인지 말해 주지 않는다. */
  if (changedBy === instructorId) throw new Error("Invalid userId");

  const newDeputyDirector = input?.isDeputyDirector;
  if (typeof newDeputyDirector !== "boolean") throw new Error("Missing isDeputyDirector");
  const previous = input?.previousDeputyDirector;
  const previousDeputyDirector = typeof previous === "boolean" ? previous : null;
  // 바뀌지 않는 변경은 이력만 늘린다. 나중에 "그때 무슨 일이 있었나"를 흐린다.
  if (previousDeputyDirector === newDeputyDirector) throw new Error("Invalid isDeputyDirector");

  const membershipPath = paths.orgMembership(organization, instructorId);
  const stampedAt = await store.serverTimestamp();
  const entryId = String(input?.entryId || newId());

  const entry = {
    organizationId: organization,
    userId: instructorId,
    previousDeputyDirector,
    newDeputyDirector,
    effectiveFrom: stampedAt,
    changedBy,
    createdAt: stampedAt,
  };

  const auditId = auditLogId(AUDIT_ACTION.DEPUTY_DIRECTOR_SET, instructorId, entryId);
  const audit = auditEntry(organization, {
    action: AUDIT_ACTION.DEPUTY_DIRECTOR_SET,
    actorId: changedBy,
    actorRole: requiredText(input?.actorRole, "actorRole"),
    targetId: instructorId,
    enabled: newDeputyDirector,
    stampedAt,
  });

  await store.commit([
    { path: membershipPath, data: { isDeputyDirector: newDeputyDirector }, operation: "update" },
    { path: `${membershipPath}/${COLLECTIONS.RATE_HISTORY}/${entryId}`, data: entry },
    { path: paths.auditLog(auditId), data: audit },
  ]);
  return { userId: instructorId, entryId, newDeputyDirector, previousDeputyDirector, entry, audit };
}

/**
 * 내 membership 에 내 이름을 적는다.
 *
 * 대표가 강사 목록을 볼 때 uid 가 아니라 이름을 보게 하는 유일한 경로다.
 * users/{uid} 를 읽어 오지 않는 이유는 규칙 파일의 memberships 블록 주석에
 * 있다 -- 이름을 얻자고 그 문서를 열면 전화번호와 이메일이 함께 열리고,
 * Firestore 규칙은 읽기에서 필드를 가릴 수 없다.
 *
 * 쓰는 사람은 언제나 본인이다. 이름은 본인의 것이고, 남이 고쳐 쓸 이유가 없다.
 *
 * 값이 같으면 쓰지 않는다 -- 앱을 열 때마다 같은 값을 다시 쓰면 규칙 평가와
 * 쓰기 비용만 늘고 얻는 것이 없다.
 *
 * @param {string} organizationId
 * @param {string} userId
 * @param {{ displayName: string, currentDisplayName?: string }} input
 * @param {{ store?: { update: (path: string, data: object) => Promise<void> } }} [options]
 * @returns {Promise<{ written: boolean, displayName: string }>}
 */
export async function syncOwnMembershipName(organizationId, userId, input, options = {}) {
  const { store = createFirestoreMembershipNameStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const id = requiredText(userId, "userId");
  const displayName = String(input?.displayName ?? "").trim();
  // 빈 이름으로 덮어쓰면 목록이 uid 로 되돌아간다. 규칙도 빈 문자열을 거부한다.
  if (!displayName) return { written: false, displayName: "" };
  if (displayName.length > 60) return { written: false, displayName: "" };
  if (displayName === String(input?.currentDisplayName ?? "").trim()) {
    return { written: false, displayName };
  }
  await store.update(paths.orgMembership(organization, id), { displayName });
  return { written: true, displayName };
}

export function createFirestoreMembershipNameStore() {
  return {
    update: async (documentPath, data) => {
      const { doc, getFirestore, updateDoc } = await import("firebase/firestore");
      await updateDoc(doc(getFirestore(), documentPath), data);
    },
  };
}
