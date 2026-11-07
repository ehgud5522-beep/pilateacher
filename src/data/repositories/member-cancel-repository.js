/**
 * 회원 앱 수업 취소 — 강사 앱 쪽 읽기 (2026-11-07, 5차 1단계).
 * **판정은 functions/shared/member-cancel.mjs 에 있다.** 여기는 서버를 만지는 부분뿐이다.
 *
 * - 남은 횟수: memberCancelLedger/{clientId} 한 문서 (센터 직원, 규칙)
 * - 추가 부여 월별: memberCancelGrants where month == "2026-11" (대표 · 총괄매니저, 규칙)
 * - 추가 부여 쓰기: 서버 함수 grantMemberCancel (규칙은 앱 쓰기를 닫았다)
 */

export {
  DEFAULT_LIMIT_HINT, GRANT_LIMITS, GRANT_REASON, GRANT_REASON_LABEL, INSTRUCTOR_GRANT_CAP, LIMIT_RANGE, MEMBER_CANCEL_MODE, MEMBER_CANCEL_PERIOD, activePassIdFor,
  bucketKey, bucketOf, grantsByGranter, instructorGrantRoom, isGrantAdmin, memberCancelEnabledFor, monthKey, readMemberCancelConfig, remainingIn,
} from "../../../functions/shared/member-cancel.mjs";

const text = (value) => String(value ?? "").trim();

const organizationPath = (organizationId) => {
  const id = text(organizationId);
  if (!id || id.includes("/")) throw new Error("Invalid organizationId");
  return `organizations/${id}`;
};

/** 회원 한 명의 취소 횟수 문서. 없으면 null (아직 취소 · 부여가 없다). */
export async function readMemberCancelLedger(organizationId, clientId, options = {}) {
  const { doc, getDoc, getFirestore } = await import("firebase/firestore");
  const firestore = options.firestore || getFirestore();
  const id = text(clientId);
  if (!id || id.includes("/")) return null;
  const snapshot = await getDoc(doc(firestore, `${organizationPath(organizationId)}/memberCancelLedger/${id}`));
  return snapshot.exists() ? snapshot.data() : null;
}

/** 한 달의 추가 부여 기록 (대표 화면). 사유 문장은 화면에 그리지 않는다 -- 건수만. */
export async function listMemberCancelGrants(organizationId, month, options = {}) {
  const { collection, getDocs, getFirestore, query, where } = await import("firebase/firestore");
  const firestore = options.firestore || getFirestore();
  const page = await getDocs(query(
    collection(firestore, `${organizationPath(organizationId)}/memberCancelGrants`),
    where("month", "==", text(month)),
  ));
  return page.docs.map((document) => ({ id: document.id, ...document.data() }));
}

/** 추가 부여 실패 문구. 서버 이유 코드 → 문구 (코드를 함께 보인다). */
export function grantFailureMessage(error) {
  const reason = text(error?.details?.reason) || text(error?.code).replace(/^functions\//, "") || "unknown";
  const table = {
    grant_not_assigned: "담당 강사 · 대표 · 총괄매니저만 줄 수 있어요",
    grant_amount_invalid: "횟수는 1~10 사이로 적어 주세요",
    grant_reason_required: "사유를 적어 주세요",
    grant_reason_too_long: "사유는 200자까지 적을 수 있어요",
    grant_reason_code_invalid: "사유를 다시 골라 주세요",
    grant_needs_admin: "담당 강사는 추가 1회까지 줄 수 있어요. 그 이상은 대표 · 총괄매니저에게 요청해 주세요",
    feature_off: "회원 앱 취소 기능이 꺼져 있어요",
    no_active_pass: "사용 중인 회원권이 없어 줄 수 없어요",
    unavailable: "연결이 불안정해요. 다시 시도해 주세요",
  };
  return `${table[reason] || "처리하지 못했어요"} (코드 ${reason})`;
}

/**
 * 추가 부여 요청 ID (2026-11-07). 한 번의 부여에 하나 -- 다시 시도할 때는 같은 값을 보내
 * 서버가 한 번만 준다. 서버 형식: 영문 · 숫자 · _ · - 8~64자.
 */
export function newMemberCancelRequestId(random = globalThis.crypto) {
  if (typeof random?.randomUUID === "function") return random.randomUUID().replaceAll("-", "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
