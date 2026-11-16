/**
 * 재등록 알림 읽기 (설계 문서 4단계). 후보 줄(renewalCandidates)은 서버만 쓴다 -- 여기는 읽기만.
 * 출석 속도에 쓰는 최근 차감은 급여가 이미 쓰는 원장 질의(같은 색인)를 그대로 쓴다.
 */
import { createFirestorePayrollStore } from "./payroll-repository.js";

const load = () => import("firebase/firestore");
const DAY_MS = 86400000;

/** 최근 28일 차감 · 되돌림. 대표 · 총괄 · FC 는 센터 전체, 강사는 자기 수업 것만(규칙). */
export async function listRecentDeductions({ organizationId, instructorId = "", now = new Date(), days = 28 }) {
  const store = createFirestorePayrollStore();
  const start = new Date(now.getTime() - days * DAY_MS);
  const end = new Date(now.getTime() + DAY_MS);
  return instructorId
    ? store.listDeductions({ organizationId, instructorId, start, end })
    : store.listOrganizationDeductions({ organizationId, start, end });
}

/** 후보 줄. locationIds 를 주면 그 지점만(FC · 점장 -- 규칙이 지점으로 거른다). */
export async function listRenewalCandidates(organizationId, { locationIds = [] } = {}) {
  const { collection, getDocs, getFirestore, query, where } = await load();
  const base = collection(getFirestore(), "organizations", String(organizationId), "renewalCandidates");
  const ids = [...new Set(locationIds.map(String).filter(Boolean))].slice(0, 30);
  const snapshot = await getDocs(ids.length ? query(base, where("locationId", "in", ids)) : base);
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}
