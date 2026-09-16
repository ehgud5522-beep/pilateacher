/**
 * 강사의 이달 수업료 집계.
 *
 * ── 급여의 근거는 원장뿐이다 ──
 * 항목마다 박혀 있는 unitPrice 를 그대로 더한다. pay-rates.js 의 표도,
 * memberships 의 현재 풀방금액도 여기서 읽지 않는다. 단가가 오른 뒤에 지난달을
 * 다시 열면 그때 숫자가 바뀌어야 하는데, 원장은 append-only 라 그 사실을
 * 되돌릴 방법이 없다. 표를 참조하는 순간 이미 정산이 끝난 달이 움직인다.
 *
 * ── occurredAt 기준이다 ──
 * 수업이 실제로 일어난 시각으로 묶는다. createdAt(기록한 시각)으로 묶으면
 * 말일 수업을 다음날 밤에 누른 건이 다음 달로 넘어가고, 강사는 자기가 한
 * 수업이 이달 급여에서 빠진 것을 보게 된다.
 *
 * ── 왜 collectionGroup 인가 ──
 * 원장은 회원권마다 하위 컬렉션으로 흩어져 있다. 회원권을 하나씩 도는 방식은
 * 센터의 회원권 수만큼 읽기가 늘고, 강사 한 사람의 한 달을 보는 데 센터 전체를
 * 훑게 된다. collectionGroup 한 번이면 인덱스가 조직·강사·종류·기간을 한꺼번에
 * 좁힌다. 대신 두 가지가 따라온다 --
 *   firestore.foundation.indexes.json 의 COLLECTION_GROUP 인덱스,
 *   firestore.foundation.rules 의 match /{path=**}/ledger/{entryId}.
 * 중첩 경로의 규칙은 그룹 쿼리에 적용되지 않기 때문이다.
 */

import { COLLECTIONS, LEDGER_ENTRY_TYPE } from "../schema/constants.js";
import { readCollection } from "./repository-read.js";

/**
 * @typedef {object} PayrollStore
 * @property {(query: { organizationId: string, instructorId: string, start: Date, end: Date }) => Promise<Array<any>>} listDeductions
 */

const requiredText = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  return text;
};

/** "2026-09" 을 그 달의 시작과 다음 달의 시작으로 바꾼다. 끝은 열린 구간이다. */
export function monthRange(month) {
  const text = requiredText(month, "month");
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) throw new Error("Invalid month");
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) throw new Error("Invalid month");
  /* 센터의 시계로 자른다. UTC 로 자르면 한국 시각 기준 말일 밤 수업이 다음 달로
     넘어간다 -- occurredAt 으로 묶는 이유와 같은 문제가 경계에서 다시 생긴다. */
  return { start: new Date(year, index, 1, 0, 0, 0, 0), end: new Date(year, index + 1, 1, 0, 0, 0, 0) };
}

/** Firestore Timestamp 든 Date 든 문자열이든 하나의 Date 로 만든다. */
export function toDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") {
    try { return value.toDate(); } catch (_error) { return new Date(NaN); }
  }
  if (typeof value === "number") return new Date(value);
  return new Date(String(value ?? ""));
}

/**
 * Firestore 를 읽는 기본 구현.
 *
 * where 절이 인덱스와 같은 순서로 서 있어야 한다 -- indexes.json 의 ledger
 * COLLECTION_GROUP 항목과 함께 고쳐야 하는 자리다.
 */
export function createFirestorePayrollStore() {
  return {
    listDeductions: async ({ organizationId, instructorId, start, end }) => {
      const {
        collectionGroup, getDocs, getFirestore, query, where,
      } = await import("firebase/firestore");
      const snapshot = await getDocs(query(
        collectionGroup(getFirestore(), COLLECTIONS.LEDGER),
        where("organizationId", "==", organizationId),
        where("instructorId", "==", instructorId),
        where("type", "==", LEDGER_ENTRY_TYPE.DEDUCT),
        where("occurredAt", ">=", start),
        where("occurredAt", "<", end),
      ));
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    },
  };
}

/** 한 항목이 급여에 더하는 금액. delta 는 차감이라 음수다. */
const amountOf = (entry) => Math.abs(Number(entry?.delta) || 0) * (Number(entry?.unitPrice) || 0);
const sessionsOf = (entry) => Math.abs(Number(entry?.delta) || 0);

const byOccurredAtDesc = (left, right) =>
  toDate(right.occurredAt).getTime() - toDate(left.occurredAt).getTime();

/**
 * 항목들을 카테고리별로 묶고 합계를 낸다.
 *
 * 금액은 항목마다 박힌 unitPrice 로 계산한다. 같은 카테고리라도 발급 시점이
 * 다르면 단가가 다를 수 있고, 그것이 맞다 -- 각 수업은 그때의 조건으로 팔렸다.
 *
 * @param {Array<any>} entries
 */
export function summarizeInstructorPay(entries) {
  const rows = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const buckets = new Map();
  let total = 0;
  let sessions = 0;
  for (const entry of rows) {
    const category = String(entry.category || "");
    const amount = amountOf(entry);
    const count = sessionsOf(entry);
    total += amount;
    sessions += count;
    const bucket = buckets.get(category) || { category, sessions: 0, amount: 0 };
    bucket.sessions += count;
    bucket.amount += amount;
    buckets.set(category, bucket);
  }
  return {
    total,
    sessions,
    // 금액이 큰 카테고리가 앞이다. 강사가 먼저 보고 싶은 순서다.
    byCategory: [...buckets.values()].sort((left, right) => right.amount - left.amount),
    entries: rows.slice().sort(byOccurredAtDesc),
  };
}

/**
 * 한 강사의 한 달치 차감을 읽어 집계한다.
 *
 * @param {string} organizationId
 * @param {{ instructorId?: string, month?: string, store?: PayrollStore }} [options]
 */
export async function loadInstructorMonthlyPay(organizationId, options = {}) {
  const { instructorId, month, store = createFirestorePayrollStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const instructor = requiredText(instructorId, "instructorId");
  const { start, end } = monthRange(month);
  // 조회 실패는 빈 목록이 아니라 RepositoryReadError 로 나간다 -- repository-read.js 참고.
  const found = await readCollection({
    feature: "instructor_payroll",
    path: `${COLLECTIONS.LEDGER}?organizationId=${organization}&month=${month}`,
    read: () => store.listDeductions({ organizationId: organization, instructorId: instructor, start, end }),
  });
  /* 서버가 이미 걸러 주지만 한 번 더 본다. 인덱스나 쿼리를 잘못 고치면 남의
     항목이 조용히 섞여 들어오고, 급여 화면에서 그것을 알아차릴 방법이 없다. */
  const mine = found.filter((entry) => (
    entry.instructorId === instructor
    && entry.type === LEDGER_ENTRY_TYPE.DEDUCT
    && entry.organizationId === organization
  ));
  const inMonth = mine.filter((entry) => {
    const at = toDate(entry.occurredAt).getTime();
    return Number.isFinite(at) && at >= start.getTime() && at < end.getTime();
  });
  return { month: String(month), start, end, ...summarizeInstructorPay(inMonth) };
}
