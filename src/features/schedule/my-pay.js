/**
 * 내 급여 화면 (2026-11-08 대표 개편 지시). **보여 줄 묶음만 만든다 -- 계산은 하지 않는다.**
 *
 * ── 지금 계산 구조 (바꾸지 않는다) ──
 * - 확정 수업료 = 그 달(occurredAt) 원장 항목의 합. 차감(deduct)은 +단가, 정정(correction)은 −단가.
 *   단가는 **항목마다 박혀 있다** -- 나중에 단가표가 바뀌어도 지난 수업 금액은 그대로다
 *   (payroll-repository.js summarizeInstructorPay).
 * - 확정 대기 = 그 달(일정 날짜) 수업 중 아직 확정하지 않은 것의 예상 단가 (upcoming-pay.js).
 *   확정한 순간 일정에서 빠지고 원장으로 간다 -- **두 곳에 동시에 있을 수 없다**.
 * - 정정은 정정한 날의 달에서 빠진다 (지난달은 이미 지급). 같은 차감을 두 번 정정할 수 없다
 *   (pass-repository 가 correctsEntryId 로 막는다).
 * - 수업료다. 인센티브 · 보너스 · 세금 · 공제는 들어 있지 않다.
 *
 * 이 파일의 묶음은 언제나 위 합계와 같다 (테스트가 묶어 둔다).
 */

import { LEDGER_ENTRY_TYPE, isDiosaCategory } from "../../data/schema/constants.js";
import { PAY_CATEGORY_LABELS, PRICING_RULE_LABELS } from "../../data/schema/display-names.js";
import { PRICING_RULE } from "../../data/schema/deduction-pricing.js";
import { summarizeInstructorPay } from "../../data/repositories/payroll-repository.js";
import { clientsOnEntry, weekStartOf } from "./payroll-weeks.js";

const text = (value) => String(value ?? "").trim();
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const toDate = (value) => {
  if (!value) return null;
  const at = typeof value?.toDate === "function" ? value.toDate() : value instanceof Date ? value : new Date(value);
  return Number.isFinite(at?.getTime?.()) ? at : null;
};
const amountOf = (entry) => -num(entry?.delta) * num(entry?.unitPrice);

export const PAY_STATUS = Object.freeze({ CONFIRMED: "confirmed", PENDING: "pending", CORRECTION: "correction" });
export const PAY_STATUS_LABEL = Object.freeze({ confirmed: "확정", pending: "대기", correction: "정정" });
export const PAY_FILTERS = Object.freeze([
  { key: "all", label: "전체" }, { key: "confirmed", label: "확정" }, { key: "pending", label: "대기" }, { key: "correction", label: "정정" },
]);

/** 수업료만이라는 말 -- 화면에 한 번만 선다. */
export const PAY_FEE_NOTICE = "수업료만 계산합니다 · 인센티브 · 보너스 · 세금 · 공제는 들어 있지 않아요 · 확정 대기는 바뀔 수 있어요";

const categoryLabel = (entry) => (entry?.rule === PRICING_RULE.SERVICE_FIRST
  ? "서비스 수업"
  : PAY_CATEGORY_LABELS[text(entry?.category)] || text(entry?.category) || "수업");

function lessonKindOf(category, isDuet) {
  if (isDiosaCategory(text(category))) return "관리";
  if (isDuet || text(category).startsWith("pt_2_1")) return "듀엣";
  return "개인";
}

/** "10월 31일 (금) 14:00" */
export function whenLabel(at, withTime = true) {
  if (!at) return "날짜 없음";
  const dow = ["일", "월", "화", "수", "목", "금", "토"][at.getDay()];
  const base = `${at.getMonth() + 1}월 ${at.getDate()}일 (${dow})`;
  if (!withTime) return base;
  return `${base} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * @param {{
 *   pay?: { total?: number, entries?: Array<any> } | null,
 *   pending?: { rows?: Array<any> } | null,          upcomingPayRows 의 결과
 *   passOf?: (passId: string) => any,
 *   clientNameOf?: (clientId: string) => string,
 *   memberNameOf?: (memberId: string) => string,
 *   originals?: Map<string, any>,                     정정이 가리키는 지난달 차감 (있으면)
 * }} input
 */
export function myPayModel({ pay, pending, passOf, clientNameOf, memberNameOf, originals } = {}) {
  const entries = (Array.isArray(pay?.entries) ? pay.entries : []).filter(Boolean);
  const nameOfClient = typeof clientNameOf === "function" ? clientNameOf : () => "";
  const nameOfMember = typeof memberNameOf === "function" ? memberNameOf : () => "";
  const byId = new Map(entries.map((entry) => [text(entry.id), entry]));
  const namesOf = (entry) => clientsOnEntry(entry, passOf).map(nameOfClient).filter(Boolean);

  /* ── 원장 줄 ── */
  const ledgerRows = entries.map((entry) => {
    const correction = entry.type === LEDGER_ENTRY_TYPE.CORRECTION;
    const names = namesOf(entry);
    const at = toDate(entry.occurredAt);
    const original = correction ? (byId.get(text(entry.correctsEntryId)) || originals?.get?.(text(entry.correctsEntryId)) || null) : null;
    return {
      id: text(entry.id),
      status: correction ? PAY_STATUS.CORRECTION : PAY_STATUS.CONFIRMED,
      at,
      names,
      title: names.join(" · ") || "인수인계된 회원",
      clientId: clientsOnEntry(entry, passOf)[0] || text(entry.clientId),
      kind: lessonKindOf(entry.category, names.length > 1),
      category: categoryLabel(entry),
      unitPrice: num(entry.unitPrice),
      amount: amountOf(entry),
      /* 왜 이 단가인가 (판정). 같은 구분이라도 회차마다 다를 수 있다 -- 없으면 계산이 틀린 것처럼 보인다. */
      ruleLabel: PRICING_RULE_LABELS[text(entry.rule)] || "",
      /* 정정 상세 */
      reason: correction ? text(entry.reason) : "",
      lessonAt: correction ? toDate(original?.occurredAt) : at,
      priorMonth: correction && !byId.has(text(entry.correctsEntryId)),
      correctsEntryId: correction ? text(entry.correctsEntryId) : "",
    };
  });

  /* ── 대기 줄 ── */
  const pendingRows = (Array.isArray(pending?.rows) ? pending.rows : []).map((row) => {
    const at = row.date ? new Date(`${row.date}T${row.start || "00:00"}:00`) : null;
    const name = nameOfMember(row.memberId);
    return {
      id: `pending|${row.id}`,
      status: PAY_STATUS.PENDING,
      at: Number.isFinite(at?.getTime?.()) ? at : null,
      names: name ? [name] : [],
      title: name || "회원",
      memberId: row.memberId,
      lessonId: row.lessonId,
      kind: row.care ? "관리" : row.isDuet ? "듀엣" : "개인",
      category: row.care ? "추가 관리 (예상)" : "예상 단가",
      unitPrice: num(row.unitPrice),
      amount: num(row.unitPrice),
      ruleLabel: "",
      reason: "",
      lessonAt: at,
      priorMonth: false,
    };
  });

  const confirmed = num(pay?.total);
  const pendingAmount = pendingRows.reduce((sum, row) => sum + row.amount, 0);
  const pendingLessons = new Set(pendingRows.map((row) => row.lessonId)).size;

  /* ── 단가별 요약: (구분 · 단가) 묶음. 누르면 그 묶음의 수업 ── */
  const groups = new Map();
  for (const row of ledgerRows) {
    if (row.status !== PAY_STATUS.CONFIRMED) continue;
    const key = `${row.category}|${row.unitPrice}`;
    const found = groups.get(key) || { key, label: row.category, unitPrice: row.unitPrice, sessions: 0, amount: 0, rows: [] };
    found.sessions += 1;
    found.amount += row.amount;
    found.rows.push(row);
    groups.set(key, found);
  }
  const unitRows = [...groups.values()].sort((a, b) => b.amount - a.amount || b.unitPrice - a.unitPrice);
  const corrections = ledgerRows.filter((row) => row.status === PAY_STATUS.CORRECTION)
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  return {
    headline: { expected: confirmed + pendingAmount, confirmed, pending: pendingAmount, pendingLessons },
    unitRows,
    corrections,
    correctionTotal: corrections.reduce((sum, row) => sum + row.amount, 0),
    rows: [...ledgerRows, ...pendingRows],
    /* 원장 합계와 같은 함수로 다시 센 값 -- 화면 합계가 어긋나면 테스트가 잡는다. */
    check: { ledger: summarizeInstructorPay(entries).total, rows: ledgerRows.reduce((sum, row) => sum + row.amount, 0) },
  };
}

/**
 * 주(월요일 시작)로 묶는다. 최신 주가 위. 주 합계는 **보이는 줄**의 순액이다.
 * 달에 걸친 주라도 줄은 이미 그 달 것만 들어 있다 (원장은 occurredAt, 대기는 일정 날짜로 걸렀다).
 *
 * @param {Array<any>} rows myPayModel().rows
 * @param {"all" | "confirmed" | "pending" | "correction"} filter
 */
export function myPayWeeks(rows, filter = "all") {
  const shown = (Array.isArray(rows) ? rows : []).filter((row) => filter === "all" || row.status === filter);
  const buckets = new Map();
  for (const row of shown) {
    const start = weekStartOf(row.at);
    if (!start) continue;
    const key = `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`;
    const found = buckets.get(key) || { key, start, rows: [], net: 0 };
    found.rows.push(row);
    found.net += row.amount;
    buckets.set(key, found);
  }
  return [...buckets.values()]
    .map((week) => {
      const end = new Date(week.start.getFullYear(), week.start.getMonth(), week.start.getDate() + 6);
      return {
        ...week,
        end,
        label: `${week.start.getMonth() + 1}월 ${week.start.getDate()}일 ~ ${end.getMonth() + 1}월 ${end.getDate()}일`,
        rows: week.rows.slice().sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)),
      };
    })
    .sort((a, b) => b.start.getTime() - a.start.getTime());
}

/** 이전 · 다음 달 ("2026-10" → "2026-09" · "2026-11"). 미래 달로는 가지 않는다. */
export function shiftMonth(month, delta) {
  const [y, m] = text(month).split("-").map(Number);
  const at = new Date(y, (m || 1) - 1 + delta, 1);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
}
