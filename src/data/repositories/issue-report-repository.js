/**
 * 발급 내역. 이 달에 무엇을 팔았는가.
 *
 * ── 급여가 아니다 ──
 * 같은 원장을 읽지만 묻는 것이 다르다. 급여 집계는 "누가 얼마를 받는가" 를 묻고
 * 여기는 "무엇이 팔렸는가" 를 묻는다. 그래서 단가(unitPrice · baseUnitPrice) 와
 * 급여 판정(rule) 은 이 화면에 오지 않는다 -- 읽기는 하지만 버린다. 한 화면에
 * 매출과 급여가 같이 있으면 둘 중 하나를 다른 하나로 읽는 사람이 반드시 나온다.
 *
 * ── 세 가지를 합계에서 뺀다 ──
 * 취소된 발급, 이관된 발급, 그리고 이 달에 발급되지 않은 것.
 *
 * 취소는 passes.status 로 판정한다 (대표 결정 2026-09-23). 원장의 cancel 항목이
 * 아니라 회원권 상태를 보는 이유는, 취소가 다른 달에 일어났어도 발급한 달 화면에서
 * 취소로 보여야 하기 때문이다. 줄은 남기고 줄을 긋는다 -- 지우면 대표가 "분명
 * 팔았는데" 를 찾게 된다.
 *
 * 이관은 엑셀에서 옮겨 온 것이라 이 달의 매출이 아니다. 목록에서도 뺀다.
 */

import { COLLECTIONS, LEDGER_ENTRY_TYPE, PAY_CATEGORY, PASS_STATUS } from "../schema/constants.js";
import { paths } from "../schema/paths.js";
import { listPasses } from "./pass-repository.js";
import { passIsReviewDemo, withoutReviewDemo } from "../../features/members/review-demo.js";
import { monthRange, toDate } from "./payroll-repository.js";
import { readCollection } from "./repository-read.js";

/**
 * 이관으로 만들어진 회원권인가.
 *
 * 표식이 둘이고 어느 하나만 맞아도 이관으로 본다.
 *
 *   contractedAt  migration-repository 가 "계약일" 열에서 읽어 넣는다.
 *                 issuePass 는 이 필드를 쓰지 않는다 -- 한 번도.
 *   passId        csv_{clientId}_{차수}. 이관은 문서 id 를 정해서 만든다.
 *                 일반 발급은 randomUUID 다.
 *
 * 둘을 함께 보는 것은 한쪽이 바뀌어도 남은 쪽이 잡기 위해서다. id 규칙을 나중에
 * 고치면 contractedAt 이 잡고, 어떤 이관 경로가 contractedAt 을 빠뜨리면 id 가
 * 잡는다.
 *
 * unitPrice 가 0 인 것도 이관의 표식이지만 쓰지 않는다 -- 0원짜리 기타 상품이
 * 정상으로 발급될 수 있어서, 그것까지 매출에서 빼면 진짜 발급이 사라진다.
 */
export const MIGRATION_PASS_ID_PREFIX = "csv_";

export function isMigratedPass(pass) {
  if (!pass) return false;
  if (pass.contractedAt !== undefined && pass.contractedAt !== null) return true;
  return String(pass.id || pass.passId || "").startsWith(MIGRATION_PASS_ID_PREFIX);
}

/**
 * 신규 계약으로 세는 카테고리 (대표 결정 2026-09-23).
 *
 * FC 매출 기준이 "새 회원을 데려왔나" 이므로 2:1 신규도 새 회원이다. 재등록은
 * 이미 있던 회원이 다시 사는 것이라 따로 센다.
 */
export const NEW_PASS_CATEGORIES = Object.freeze(/** @type {Array<string>} */ ([
  PAY_CATEGORY.PT_1_1_NEW,
  PAY_CATEGORY.PT_2_1_NEW,
]));

const isNewCategory = (category) => NEW_PASS_CATEGORIES.includes(String(category ?? ""));
const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** M/D. 취소 날짜는 연도 없이 보여준다 -- 같은 달 화면이라 연도가 군더더기다. */
const monthDayLabel = (value) => {
  const at = toDate(value);
  return Number.isFinite(at?.getTime?.()) ? `${at.getMonth() + 1}/${at.getDate()}` : "";
};

/**
 * 한 달의 발급 내역을 지점 → 발급자로 묶는다.
 *
 * entries       그 달의 원장 항목 (issue · cancel)
 * passes        관련 회원권 문서
 * cancelEntries 다른 달에 일어난 취소 항목 -- 날짜를 위해서만 쓴다
 *
 * @param {{ month: string, entries?: Array<any>, passes?: Array<any>, cancelEntries?: Array<any> }} input
 */
export function summarizeIssues(input) {
  const month = text(input?.month);
  const { start, end } = monthRange(month);
  const entries = Array.isArray(input?.entries) ? input.entries : [];
  const passById = new Map(
    (Array.isArray(input?.passes) ? input.passes : [])
      .filter(Boolean)
      .map((pass) => [text(pass.id || pass.passId), pass]),
  );

  const inMonth = (entry) => {
    const at = toDate(entry?.occurredAt).getTime();
    return Number.isFinite(at) && at >= start.getTime() && at < end.getTime();
  };

  /* 취소 날짜는 두 곳에서 온다: 이 달에 일어난 취소는 entries 에 있고, 다른 달에
     일어난 것은 부르는 쪽이 passId 로 따로 읽어 cancelEntries 로 넘긴다. */
  const cancelAtByPassId = new Map();
  for (const entry of [...entries, ...(Array.isArray(input?.cancelEntries) ? input.cancelEntries : [])]) {
    if (entry?.type !== LEDGER_ENTRY_TYPE.CANCEL) continue;
    const passId = text(entry.passId);
    if (passId && !cancelAtByPassId.has(passId)) cancelAtByPassId.set(passId, entry.occurredAt);
  }

  const issues = entries.filter((entry) => entry?.type === LEDGER_ENTRY_TYPE.ISSUE && inMonth(entry));

  let migratedCount = 0;
  const rows = [];
  for (const entry of issues) {
    const passId = text(entry.passId);
    const pass = passById.get(passId) || null;
    /* 이관은 엑셀에서 옮겨 온 것이라 이 달의 매출이 아니다. 목록에서도 뺀다 --
       섞어 두면 대표가 그것까지 FC 실적으로 읽는다. */
    if (isMigratedPass(pass ? { ...pass, id: pass.id || passId } : { id: passId })) {
      migratedCount += 1;
      continue;
    }
    const cancelled = text(pass?.status) === PASS_STATUS.CANCELLED;
    rows.push({
      entryId: text(entry.id),
      passId,
      occurredAt: entry.occurredAt,
      locationId: text(entry.locationId) || text(pass?.locationId),
      /* 발급자는 createdBy 다. instructorId 는 그 회원권을 맡을 강사이고, 파는
         사람과 가르치는 사람은 다르다 -- FC매니저가 팔면 특히 다르다. */
      issuedBy: text(entry.createdBy),
      clientId: text(entry.clientId) || text(pass?.clientId),
      productId: text(pass?.productId),
      category: text(entry.category) || text(pass?.category),
      /* 총 회차. 원장의 delta 가 이미 기준 + 서비스 합이다. */
      totalCount: count(entry.delta) || count(pass?.totalSessions) + count(pass?.serviceSessions),
      /* 계약 금액과 결제 수단은 원장에 없다. 회원권에서만 온다 -- 못 읽었으면
         지어내지 않고 null 로 둔다. 0 으로 채우면 합계가 조용히 낮아진다. */
      contractPrice: pass ? count(pass.contractPrice) : null,
      paymentMethod: pass ? text(pass.paymentMethod) : "",
      passMissing: !pass,
      cancelled,
      cancelledAtLabel: cancelled ? monthDayLabel(cancelAtByPassId.get(passId)) : "",
      isNew: isNewCategory(entry.category || pass?.category),
    });
  }

  rows.sort((left, right) => toDate(left.occurredAt) - toDate(right.occurredAt));

  /* 이 달에 일어난 취소 중 이 달 발급이 아닌 것. 지난달 매출을 이번 달에서 깎지
     않는다 -- 두 달의 합이 실제와 달라진다. 대신 몇 건인지만 알린다. */
  const issuedPassIds = new Set(issues.map((entry) => text(entry.passId)));
  const priorMonthCancelCount = entries
    .filter((entry) => entry?.type === LEDGER_ENTRY_TYPE.CANCEL && inMonth(entry))
    .filter((entry) => !issuedPassIds.has(text(entry.passId)))
    .length;

  const live = rows.filter((row) => !row.cancelled);
  const totals = {
    count: live.length,
    amount: live.reduce((sum, row) => sum + count(row.contractPrice), 0),
    newCount: live.filter((row) => row.isNew).length,
    newAmount: live.filter((row) => row.isNew).reduce((sum, row) => sum + count(row.contractPrice), 0),
    cancelledCount: rows.filter((row) => row.cancelled).length,
    migratedCount,
    priorMonthCancelCount,
    /* 회원권을 못 읽은 줄. 금액이 빠져 있으므로 합계가 실제보다 낮다는 것을
       화면이 말해야 한다. */
    missingPassCount: rows.filter((row) => row.passMissing).length,
  };

  const byLocation = [];
  for (const row of rows) {
    let location = byLocation.find((item) => item.locationId === row.locationId);
    if (!location) { location = { locationId: row.locationId, byIssuer: [] }; byLocation.push(location); }
    let issuer = location.byIssuer.find((item) => item.issuedBy === row.issuedBy);
    if (!issuer) { issuer = { issuedBy: row.issuedBy, rows: [], count: 0, amount: 0, newCount: 0, newAmount: 0 }; location.byIssuer.push(issuer); }
    issuer.rows.push(row);
    if (row.cancelled) continue;
    issuer.count += 1;
    issuer.amount += count(row.contractPrice);
    if (!row.isNew) continue;
    issuer.newCount += 1;
    issuer.newAmount += count(row.contractPrice);
  }

  return { month, start, end, rows, byLocation, totals };
}

/** 한 줄 = 한 건. 급여 CSV 와 같은 형식이다. */
const csvCell = (value) => {
  const cell = String(value ?? "");
  return /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
};

export function issueReportCsv(summary, names = {}) {
  const nameOfLocation = names.nameOfLocation || ((id) => id);
  const nameOfIssuer = names.nameOfIssuer || ((id) => id);
  const nameOfClient = names.nameOfClient || ((id) => id);
  const nameOfProduct = names.nameOfProduct || ((id) => id);
  const labelOfCategory = names.labelOfCategory || ((value) => value);
  const labelOfPayment = names.labelOfPayment || ((value) => value);
  const dayLabel = names.dayLabel || ((value) => toDate(value).toISOString().slice(0, 10));

  const lines = [[
    "월", "날짜", "지점", "발급자", "회원", "상품", "카테고리",
    "총횟수", "계약금액", "결제수단", "신규", "취소",
  ].join(",")];
  for (const row of summary?.rows || []) {
    lines.push([
      summary.month,
      dayLabel(row.occurredAt),
      nameOfLocation(row.locationId),
      nameOfIssuer(row.issuedBy),
      nameOfClient(row.clientId),
      nameOfProduct(row.productId),
      labelOfCategory(row.category),
      row.totalCount,
      row.contractPrice === null ? "" : row.contractPrice,
      labelOfPayment(row.paymentMethod),
      row.isNew ? "신규" : "",
      row.cancelled ? `취소${row.cancelledAtLabel ? ` ${row.cancelledAtLabel}` : ""}` : "",
    ].map(csvCell).join(","));
  }
  return `﻿${lines.join("\n")}`;
}

/* ── 읽기 ─────────────────────────────────────────────────────────────────

   원장 그룹 질의는 급여 집계와 같은 인덱스를 쓴다
   (organizationId > type > occurredAt). type 만 [issue, cancel] 로 바꾼다 --
   새 인덱스가 필요 없다.

   organizationId 필터는 선택이 아니다. 규칙이 그것으로 판정하므로 빼면 질의
   전체가 거부된다 (firestore.foundation.rules 의 list 주석 참고).
   ────────────────────────────────────────────────────────────────────────── */

/** 이 화면이 읽는 원장 항목. 발급과 그 취소. */
export const ISSUE_REPORT_ENTRY_TYPES = Object.freeze([
  LEDGER_ENTRY_TYPE.ISSUE, LEDGER_ENTRY_TYPE.CANCEL,
]);

/**
 * @typedef {object} IssueReportStore
 * @property {(query: { organizationId: string, start: Date, end: Date }) => Promise<Array<any>>} listOrganizationIssues
 * @property {(organizationId: string, passId: string) => Promise<any | null>} readCancelEntry
 */

/** @returns {IssueReportStore} */
export function createFirestoreIssueReportStore() {
  return {
    listOrganizationIssues: async ({ organizationId, start, end }) => {
      const {
        collectionGroup, getDocs, getFirestore, query, where,
      } = await import("firebase/firestore");
      const snapshot = await getDocs(query(
        collectionGroup(getFirestore(), COLLECTIONS.LEDGER),
        where("organizationId", "==", organizationId),
        where("type", "in", ISSUE_REPORT_ENTRY_TYPES),
        where("occurredAt", ">=", start),
        where("occurredAt", "<", end),
      ));
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    },
    /* 다른 달에 일어난 취소의 날짜. 문서 id 가 정해져 있어 한 건씩 바로 읽는다
       (cancelPass 가 `${passId}_cancel` 로 쓴다) -- 질의도 인덱스도 필요 없다. */
    readCancelEntry: async (organizationId, passId) => {
      const { doc, getDoc, getFirestore } = await import("firebase/firestore");
      const path = paths.passLedgerEntry(organizationId, passId, `${passId}_cancel`);
      const snapshot = await getDoc(doc(getFirestore(), path));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    },
  };
}

/**
 * 한 달의 발급 내역.
 *
 * @param {string} organizationId
 * @param {{
 *   month: string, store?: IssueReportStore,
 *   listPassesFn?: (organizationId: string, options?: any) => Promise<Array<any>>,
 *   excludedClientIds?: Set<string> | null,
 * }} options
 */
export async function loadOrganizationMonthlyIssues(organizationId, options) {
  const {
    month,
    store = createFirestoreIssueReportStore(),
    listPassesFn = listPasses,
    excludedClientIds = null,
  } = options || {};
  const organization = text(organizationId);
  if (!organization) throw new Error("Missing organizationId");
  const { start, end } = monthRange(month);

  // 조회 실패는 빈 목록이 아니라 RepositoryReadError 로 나간다 -- repository-read.js 참고.
  const entries = await readCollection({
    feature: "issue_report",
    path: `${COLLECTIONS.LEDGER}?organizationId=${organization}&month=${month}`,
    read: () => store.listOrganizationIssues({ organizationId: organization, start, end }),
  });
  const passes = await listPassesFn(organization, {});

  /* 이 달에 발급됐는데 취소된 회원권 중, 취소가 이 달 밖에서 일어난 것. 날짜를
     보여주려면 그 항목을 따로 읽어야 한다 -- 보통 0건이고 많아야 몇 건이다. */
  const cancelledInMonth = new Set(
    entries.filter((entry) => entry?.type === LEDGER_ENTRY_TYPE.CANCEL).map((entry) => text(entry.passId)),
  );
  const passById = new Map(passes.map((pass) => [text(pass.id), pass]));
  const needsCancelDate = entries
    .filter((entry) => entry?.type === LEDGER_ENTRY_TYPE.ISSUE)
    .map((entry) => text(entry.passId))
    .filter((passId) => passId
      && !cancelledInMonth.has(passId)
      && text(passById.get(passId)?.status) === PASS_STATUS.CANCELLED);

  /* 날짜 하나를 못 읽었다고 화면 전체를 세우지 않는다. 그 줄은 "취소" 로만
     보이고 날짜가 빈다. */
  const cancelEntries = (await Promise.all(
    [...new Set(needsCancelDate)].map((passId) => (
      store.readCancelEntry(organization, passId).catch(() => null)
    )),
  )).filter(Boolean);

  /* 심사용 회원은 사람이 아니다. 그 회원권이 발급 내역에 서면 이달 판매와
     매출이 실제보다 많아 보인다 -- 0원으로 발급하기로 했더라도 건수는 는다.
     원장에는 그 표시가 없으므로 명부에서 모아 온 id 로 거른다. */
  return summarizeIssues({
    month: String(month),
    entries: withoutReviewDemo(entries, excludedClientIds),
    passes: passes.filter((pass) => !passIsReviewDemo(pass, excludedClientIds)),
    cancelEntries: withoutReviewDemo(cancelEntries, excludedClientIds),
  });
}
