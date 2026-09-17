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

import { COLLECTIONS, LEDGER_ENTRY_TYPE, PAY_CATEGORY } from "../schema/constants.js";
import { readCollection } from "./repository-read.js";

/**
 * @typedef {object} PayrollStore
 * @property {(query: { organizationId: string, instructorId: string, start: Date, end: Date }) => Promise<Array<any>>} listDeductions
 */

/**
 * 대표의 정산은 강사를 지정하지 않는다. 두 모양을 하나로 합치면 한쪽만
 * 필요한 호출자가 쓰지도 않을 메서드를 만들어 넣게 된다.
 *
 * @typedef {object} OrganizationPayrollStore
 * @property {(query: { organizationId: string, start: Date, end: Date }) => Promise<Array<any>>} listOrganizationDeductions
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
    /* 감사 화면. 발급·교체·차감을 한 번에 읽는다. 기존 인덱스는 type 이 가운데
       있어 이 쿼리를 풀 수 없으므로 (organizationId, occurredAt) 를 탄다. */
    listOrganizationEntries: async ({ organizationId, start, end }) => {
      const {
        collectionGroup, getDocs, getFirestore, query, where,
      } = await import("firebase/firestore");
      const snapshot = await getDocs(query(
        collectionGroup(getFirestore(), COLLECTIONS.LEDGER),
        where("organizationId", "==", organizationId),
        where("occurredAt", ">=", start),
        where("occurredAt", "<", end),
      ));
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    },
    /* 대표의 월말 정산. 강사를 지정하지 않으므로 위와 다른 인덱스를 탄다 --
       (organizationId, type, occurredAt). 복합 인덱스는 앞에서부터 이어져야
       하므로 instructorId 가 가운데 있는 인덱스로는 이 쿼리를 풀 수 없다. */
    listOrganizationDeductions: async ({ organizationId, start, end }) => {
      const {
        collectionGroup, getDocs, getFirestore, query, where,
      } = await import("firebase/firestore");
      const snapshot = await getDocs(query(
        collectionGroup(getFirestore(), COLLECTIONS.LEDGER),
        where("organizationId", "==", organizationId),
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

/* ── 대표의 월말 정산 ──────────────────────────────────────────────────────

   강사 개인 화면과 같은 원장, 같은 경계, 같은 단가를 쓴다. 다른 것은 범위
   하나뿐이다 -- 한 사람이 아니라 센터 전체를 읽는다.

   ── 카테고리 순서 ──
   금액순이 아니라 확정본 단가표의 순서로 세운다. 이 화면의 첫 용도가 옛 급여
   엑셀과의 대조이고, 두 줄이 같은 순서로 서 있지 않으면 눈이 줄을 잃는다.
   달마다 순서가 달라지는 것은 더 나쁘다 -- 금액순으로 세우면 그렇게 된다.

   ── 지점과 사람 ──
   한 강사가 두 지점에서 수업하는 경우가 있다. 지점별로만 묶으면 그 사람을 두
   번 보게 되고, 급여는 한 번 준다. 그래서 두 가지를 함께 돌려준다 --
   지점별 묶음과, 지점을 가로지르는 강사별 합계. 화면은 앞을 보여주고 뒤로
   지급한다.
   ────────────────────────────────────────────────────────────────────────── */

/** 확정본 단가표의 줄 순서. 옛 급여 엑셀과 눈으로 맞추기 위한 것이다. */
const PAY_CATEGORY_ORDER = Object.values(PAY_CATEGORY);

const bySpecOrder = (left, right) => {
  const a = PAY_CATEGORY_ORDER.indexOf(left.category);
  const b = PAY_CATEGORY_ORDER.indexOf(right.category);
  // 표에 없는 값은 뒤로 보내되 버리지 않는다. 사라지면 합계만 안 맞는다.
  return (a < 0 ? PAY_CATEGORY_ORDER.length : a) - (b < 0 ? PAY_CATEGORY_ORDER.length : b);
};

const emptyBucket = (key, field) => ({ [field]: key, sessions: 0, total: 0, categories: new Map() });

const addToBucket = (bucket, entry) => {
  const category = String(entry.category || "");
  const amount = amountOf(entry);
  const count = sessionsOf(entry);
  bucket.sessions += count;
  bucket.total += amount;
  const row = bucket.categories.get(category) || { category, sessions: 0, amount: 0 };
  row.sessions += count;
  row.amount += amount;
  bucket.categories.set(category, row);
};

const sealBucket = (bucket, field) => ({
  [field]: bucket[field],
  sessions: bucket.sessions,
  total: bucket.total,
  byCategory: [...bucket.categories.values()].sort(bySpecOrder),
});

/**
 * 한 달치 차감을 강사별·지점별로 묶는다.
 *
 * 금액은 항목마다 박힌 unitPrice 로 계산한다. 같은 회원권 안에서도 회차마다
 * 판정이 달라 단가가 섞이는데(deduction-pricing.js), 그래서 항목을 더하는 것
 * 말고는 맞는 방법이 없다 -- 건수 × 어떤 하나의 단가로는 절대 맞지 않는다.
 *
 * @param {Array<any>} entries
 */
export function summarizeOrganizationPay(entries) {
  const rows = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const instructors = new Map();
  const locations = new Map();
  let total = 0;
  let sessions = 0;

  for (const entry of rows) {
    const instructorId = String(entry.instructorId || "");
    const locationId = String(entry.locationId || "");
    total += amountOf(entry);
    sessions += sessionsOf(entry);

    if (!instructors.has(instructorId)) instructors.set(instructorId, emptyBucket(instructorId, "instructorId"));
    addToBucket(instructors.get(instructorId), entry);

    if (!locations.has(locationId)) locations.set(locationId, { locationId, sessions: 0, total: 0, instructors: new Map() });
    const location = locations.get(locationId);
    location.sessions += sessionsOf(entry);
    location.total += amountOf(entry);
    if (!location.instructors.has(instructorId)) {
      location.instructors.set(instructorId, emptyBucket(instructorId, "instructorId"));
    }
    addToBucket(location.instructors.get(instructorId), entry);
  }

  // 많이 번 사람이 앞이다. 정산할 때 큰 금액부터 확인한다.
  const byTotalDesc = (left, right) => right.total - left.total;
  return {
    total,
    sessions,
    byInstructor: [...instructors.values()].map((bucket) => sealBucket(bucket, "instructorId")).sort(byTotalDesc),
    byLocation: [...locations.values()].map((location) => ({
      locationId: location.locationId,
      sessions: location.sessions,
      total: location.total,
      byInstructor: [...location.instructors.values()]
        .map((bucket) => sealBucket(bucket, "instructorId"))
        .sort(byTotalDesc),
    })).sort(byTotalDesc),
  };
}

/**
 * 센터 한 달치 수업료. 대표만 부른다.
 *
 * @param {string} organizationId
 * @param {{ month?: string, store?: OrganizationPayrollStore }} [options]
 */
export async function loadOrganizationMonthlyPayroll(organizationId, options = {}) {
  const { month, store = createFirestorePayrollStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const { start, end } = monthRange(month);
  // 조회 실패는 빈 목록이 아니라 RepositoryReadError 로 나간다 -- repository-read.js 참고.
  const found = await readCollection({
    feature: "organization_payroll",
    path: `${COLLECTIONS.LEDGER}?organizationId=${organization}&month=${month}`,
    read: () => store.listOrganizationDeductions({ organizationId: organization, start, end }),
  });
  /* 서버가 이미 걸러 주지만 한 번 더 본다. 인덱스나 쿼리를 잘못 고치면 발급
     항목이나 남의 조직이 조용히 섞여 들어오고, 합계 한 줄에서는 그것을 알아챌
     방법이 없다. */
  const deductions = found.filter((entry) => (
    entry.type === LEDGER_ENTRY_TYPE.DEDUCT && entry.organizationId === organization
  ));
  const inMonth = deductions.filter((entry) => {
    const at = toDate(entry.occurredAt).getTime();
    return Number.isFinite(at) && at >= start.getTime() && at < end.getTime();
  });
  return { month: String(month), start, end, ...summarizeOrganizationPay(inMonth) };
}

/** 정산이 끝난 달. 화면의 기본값이다 -- 정산은 월이 끝난 뒤에 한다. */
export function previousMonth(today = new Date()) {
  const at = today instanceof Date ? today : new Date(String(today));
  const year = at.getFullYear();
  const index = at.getMonth() - 1;
  const month = new Date(year, index, 1);
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
}

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/**
 * 집계를 CSV 한 장으로. 한 줄이 (지점, 강사, 카테고리) 하나다.
 *
 * 모양을 하나로 둔다. 소계 줄을 섞으면 엑셀에서 정렬 한 번에 무너지고, 대표는
 * 그것을 알아채지 못한 채 대조한다. 소계는 엑셀이 더 잘한다.
 *
 * 앞에 BOM 을 붙인다. 없으면 엑셀이 UTF-8 로 읽지 않아 강사 이름이 깨지고,
 * 대조하려고 내려받은 파일이 대조할 수 없는 파일이 된다.
 *
 * @param {{ month: string, byLocation: Array<any> }} summary
 * @param {{ nameOfInstructor?: (id: string) => string, nameOfLocation?: (id: string) => string, labelOfCategory?: (value: string) => string }} [names]
 */
export function payrollCsv(summary, names = {}) {
  const nameOfInstructor = names.nameOfInstructor || ((id) => id);
  const nameOfLocation = names.nameOfLocation || ((id) => id);
  const labelOfCategory = names.labelOfCategory || ((value) => value);
  const lines = [["월", "지점", "강사", "카테고리", "건수", "수업료"].join(",")];
  for (const location of summary?.byLocation || []) {
    for (const instructor of location.byInstructor || []) {
      for (const row of instructor.byCategory || []) {
        lines.push([
          summary.month,
          nameOfLocation(location.locationId),
          nameOfInstructor(instructor.instructorId),
          labelOfCategory(row.category),
          row.sessions,
          row.amount,
        ].map(csvCell).join(","));
      }
    }
  }
  return `\uFEFF${lines.join("\n")}`;
}

/**
 * @typedef {object} LedgerRangeStore
 * @property {(query: { organizationId: string, start: Date, end: Date }) => Promise<Array<any>>} listOrganizationEntries
 */

/**
 * 한 기간의 원장 항목 전부. 종류를 가리지 않는다.
 *
 * 감사 화면이 쓴다 -- 발급·담당 교체·차감이 모두 여기 있고, 그것을 auditLogs 에
 * 한 벌 더 쓰지 않는 이유는 audit-repository.js 머리말에 있다.
 *
 * @param {string} organizationId
 * @param {{ start?: Date, end?: Date, store?: LedgerRangeStore }} [options]
 */
export async function loadOrganizationLedger(organizationId, options = {}) {
  const { start, end, store = createFirestorePayrollStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  if (!(start instanceof Date) || !(end instanceof Date)) throw new Error("Invalid range");
  // 조회 실패는 빈 목록이 아니라 RepositoryReadError 로 나간다 -- repository-read.js 참고.
  const found = await readCollection({
    feature: "organization_ledger",
    path: `${COLLECTIONS.LEDGER}?organizationId=${organization}`,
    read: () => store.listOrganizationEntries({ organizationId: organization, start, end }),
  });
  return found.filter((entry) => entry.organizationId === organization);
}
