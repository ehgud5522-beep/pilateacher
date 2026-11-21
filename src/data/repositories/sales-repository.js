/**
 * 강사 개인매출 인센 저장소 (2026-11-21 대표 결정). 계산 · 판정은 functions/shared/sales-incentive.mjs.
 *
 *   organizations/{센터}/salesEntries/{자동 id}        결제 한 줄. side = instructor(강사 본인 장부) | office(FC · 대표 · 총괄 장부)
 *   organizations/{센터}/salesMonths/{강사}_{YYYY-MM}  강사 제출 · 서버 확정(두 장부가 같을 때만) · 되돌림
 *
 * 확정은 여기 없다 -- 서버 함수 confirmSalesMonth(lib/firebase.js 의 fbConfirmSalesMonth)만 한다.
 *
 * 권한은 규칙이 가른다 (firestore.foundation.rules 의 salesEntries · salesMonths). 확정된 달의 줄은 규칙이 막는다 --
 * 화면도 먼저 막지만 마지막 문은 규칙이다.
 */
import { readCollection } from "./repository-read.js";

export const SALES_ENTRIES = "salesEntries";
export const SALES_MONTHS = "salesMonths";
export const salesMonthId = (instructorId, month) => `${String(instructorId ?? "").trim()}_${String(month ?? "").trim()}`;

const load = () => import("firebase/firestore");
const text = (value) => String(value ?? "").trim();

/** 저장하는 칸 (규칙의 hasOnly 와 같은 목록). 화면이 넘긴 그 밖의 칸은 버린다. */
const ENTRY_FIELDS = ["instructorId", "side", "month", "paidOn", "kind", "amount", "share", "ot", "clientId", "memberLabel", "productLabel", "recordId", "passId", "refundOfMonth", "note"];
const entryData = (entry) => ({
  instructorId: text(entry.instructorId),
  side: text(entry.side) === "office" ? "office" : "instructor",
  month: text(entry.month),
  paidOn: text(entry.paidOn),
  kind: text(entry.kind),
  amount: Math.round(Number(entry.amount) || 0),
  share: Number(entry.share) === 0.5 ? 0.5 : 1,
  ot: entry.ot === true,
  clientId: text(entry.clientId),
  memberLabel: text(entry.memberLabel).slice(0, 40),
  productLabel: text(entry.productLabel).slice(0, 60),
  recordId: text(entry.recordId),
  passId: text(entry.passId),
  refundOfMonth: ["refund", "group_refund"].includes(text(entry.kind)) ? text(entry.refundOfMonth) : "",
  note: text(entry.note).slice(0, 200),
});
export const SALES_ENTRY_FIELDS = Object.freeze(ENTRY_FIELDS);

/**
 * 강사 한 명 · 한 달의 줄. side 를 주면 그 장부만 -- **강사 화면은 반드시 side "instructor"** (규칙이 사무실 장부를 강사에게
 * 열지 않아, side 없이 물으면 질의 전체가 거부된다). FC · 대표 · 총괄은 side 없이 두 장부를 함께 읽는다.
 */
export function listSalesEntries(organizationId, { instructorId, month, side = "" }) {
  return readCollection({
    feature: "sales_incentive",
    path: `organizations/${organizationId}/${SALES_ENTRIES}?instructorId=${instructorId}&month=${month}${side ? `&side=${side}` : ""}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const filters = [where("instructorId", "==", String(instructorId)), where("month", "==", String(month))];
      if (side) filters.push(where("side", "==", String(side)));
      const snapshot = await getDocs(query(
        collection(getFirestore(), "organizations", String(organizationId), SALES_ENTRIES),
        ...filters,
      ));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },
  });
}

/** 대표 · 총괄: 한 달의 모든 강사 줄 (중복 청구 판정 · 강사 표). */
export function listSalesEntriesOfMonth(organizationId, month) {
  return readCollection({
    feature: "sales_incentive",
    path: `organizations/${organizationId}/${SALES_ENTRIES}?month=${month}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(
        collection(getFirestore(), "organizations", String(organizationId), SALES_ENTRIES),
        where("month", "==", String(month)),
      ));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },
  });
}

/** 줄 넣기. 넣는 사람의 역할을 함께 남긴다 (FC 가 대신 넣었는지 대표가 본다). */
export async function addSalesEntry(organizationId, entry, { uid, role }) {
  const { addDoc, collection, getFirestore, serverTimestamp } = await load();
  const reference = await addDoc(collection(getFirestore(), "organizations", String(organizationId), SALES_ENTRIES), {
    organizationId: String(organizationId),
    ...entryData(entry),
    createdBy: String(uid),
    createdByRole: String(role),
    createdAt: serverTimestamp(),
    updatedBy: String(uid),
    updatedAt: serverTimestamp(),
  });
  return reference.id;
}

/** 줄 고치기. 누구의 매출인지 · 어느 장부인지 · 누가 넣었는지는 바꾸지 않는다 (규칙도 막는다). */
export async function updateSalesEntry(organizationId, entryId, entry, { uid }) {
  const { doc, getFirestore, serverTimestamp, updateDoc } = await load();
  const data = entryData(entry);
  delete data.instructorId;
  delete data.side;
  await updateDoc(doc(getFirestore(), "organizations", String(organizationId), SALES_ENTRIES, String(entryId)), {
    ...data,
    updatedBy: String(uid),
    updatedAt: serverTimestamp(),
  });
}

/** 줄 지우기 -- 사용자가 [지우기] 를 눌렀을 때만 (CLAUDE.md 5). */
export async function deleteSalesEntry(organizationId, entryId) {
  const { deleteDoc, doc, getFirestore } = await load();
  await deleteDoc(doc(getFirestore(), "organizations", String(organizationId), SALES_ENTRIES, String(entryId)));
}

/** 그 달 상태 (없으면 null = 아직 제출 안 함). */
export async function readSalesMonth(organizationId, instructorId, month) {
  const { doc, getDoc, getFirestore } = await load();
  const snapshot = await getDoc(doc(getFirestore(), "organizations", String(organizationId), SALES_MONTHS, salesMonthId(instructorId, month)));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/** 대표 · 총괄: 한 달의 모든 강사 상태. */
export function listSalesMonths(organizationId, month) {
  return readCollection({
    feature: "sales_incentive",
    path: `organizations/${organizationId}/${SALES_MONTHS}?month=${month}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const snapshot = await getDocs(query(
        collection(getFirestore(), "organizations", String(organizationId), SALES_MONTHS),
        where("month", "==", String(month)),
      ));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    },
  });
}

async function writeMonth(organizationId, instructorId, month, fields, uid) {
  const { doc, getFirestore, serverTimestamp, setDoc } = await load();
  const stamp = {};
  for (const [key, value] of Object.entries(fields)) stamp[key] = value === "now" ? serverTimestamp() : value;
  await setDoc(doc(getFirestore(), "organizations", String(organizationId), SALES_MONTHS, salesMonthId(instructorId, month)), {
    organizationId: String(organizationId),
    instructorId: String(instructorId),
    month: String(month),
    ...stamp,
    updatedBy: String(uid),
    updatedAt: serverTimestamp(),
  });
}

/** 강사(또는 대신 넣는 FC · 대표): 이 달 제출. 확정 전까지 다시 고칠 수 있다. */
export const submitSalesMonth = (organizationId, instructorId, month, { uid }) => writeMonth(organizationId, instructorId, month, { status: "submitted", submittedAt: "now" }, uid);

/** FC · 대표 · 총괄: 확정 되돌림. 사유 필수 (규칙도 막는다). */
export const reopenSalesMonth = (organizationId, instructorId, month, reason, { uid }) => writeMonth(organizationId, instructorId, month, {
  status: "reopened", reopenReason: text(reason).slice(0, 200),
}, uid);
